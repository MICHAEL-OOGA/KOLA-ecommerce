import prisma from "../config/prisma.js";

/*
|--------------------------------------------------------------------------
| Order-expiry configuration
|--------------------------------------------------------------------------
*/

const readBoundedIntegerEnv = (name, fallback, minimum, maximum) => {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a positive whole number.`);
  }

  const parsedValue = Number(rawValue);

  if (
    !Number.isSafeInteger(parsedValue) ||
    parsedValue < minimum ||
    parsedValue > maximum
  ) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }

  return parsedValue;
};

const ORDER_PAYMENT_WINDOW_MINUTES = readBoundedIntegerEnv(
  "ORDER_PAYMENT_WINDOW_MINUTES",
  15,
  1,
  1440,
);

const ORDER_EXPIRY_SWEEP_SECONDS = readBoundedIntegerEnv(
  "ORDER_EXPIRY_SWEEP_SECONDS",
  60,
  5,
  3600,
);

const ORDER_EXPIRY_BATCH_SIZE = readBoundedIntegerEnv(
  "ORDER_EXPIRY_BATCH_SIZE",
  50,
  1,
  500,
);

/*
 * Security cleanup starts after 10 seconds.
 *
 * Start order expiry later so they do not both
 * hit Neon at exactly the same time.
 */
const ORDER_EXPIRY_STARTUP_DELAY_MS = 20_000;

/*
|--------------------------------------------------------------------------
| Public expiry-date helper
|--------------------------------------------------------------------------
*/

export const getOrderExpiryDate = (startingDate = new Date()) => {
  return new Date(
    startingDate.getTime() + ORDER_PAYMENT_WINDOW_MINUTES * 60 * 1000,
  );
};

/*
|--------------------------------------------------------------------------
| Transient database retry
|--------------------------------------------------------------------------
*/

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const isTransientDatabaseError = (error) => {
  if (
    error?.code === "P1001" ||
    error?.code === "P2024" ||
    error?.code === "P2034"
  ) {
    return true;
  }

  /*
   * Do not blindly retry every P2028.
   *
   * Retry only the specific transaction-start
   * timeout we've observed.
   */
  if (
    error?.code === "P2028" &&
    /unable to start a transaction/i.test(error?.message || "")
  ) {
    return true;
  }

  return false;
};

const runDatabaseOperationWithRetry = async (
  operation,
  maximumAttempts = 3,
) => {
  for (
    let attemptNumber = 1;
    attemptNumber <= maximumAttempts;
    attemptNumber += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry =
        isTransientDatabaseError(error) && attemptNumber < maximumAttempts;

      if (!shouldRetry) {
        throw error;
      }

      const delayMilliseconds = 1000 * 2 ** (attemptNumber - 1);

      await sleep(delayMilliseconds);
    }
  }
};

/*
|--------------------------------------------------------------------------
| Serializable transaction retry
|--------------------------------------------------------------------------
*/

const runSerializableTransactionWithRetry = async (
  operation,
  maximumAttempts = 3,
) => {
  for (
    let attemptNumber = 1;
    attemptNumber <= maximumAttempts;
    attemptNumber += 1
  ) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: "Serializable",

        /*
         * Explicitly provide sensible values
         * for this important background task.
         */
        maxWait: 30_000,
        timeout: 30_000,
      });
    } catch (error) {
      const shouldRetry =
        isTransientDatabaseError(error) && attemptNumber < maximumAttempts;

      if (!shouldRetry) {
        throw error;
      }

      const delayMilliseconds = 1000 * 2 ** (attemptNumber - 1);

      await sleep(delayMilliseconds);
    }
  }
};

/*
|--------------------------------------------------------------------------
| Expire one eligible order
|--------------------------------------------------------------------------
*/

const expireOrderIfEligible = async (orderId, currentTime) => {
  return runSerializableTransactionWithRetry(async (transaction) => {
    const order = await transaction.order.findUnique({
      where: {
        id: orderId,
      },

      include: {
        items: {
          select: {
            productId: true,
            quantity: true,
          },
        },

        payment: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!order) {
      return {
        expired: false,
        reason: "ORDER_NOT_FOUND",
      };
    }

    if (order.status !== "PENDING") {
      return {
        expired: false,
        reason: "ORDER_NOT_PENDING",
      };
    }

    if (order.stockRestoredAt) {
      return {
        expired: false,
        reason: "STOCK_ALREADY_RESTORED",
      };
    }

    if (!order.expiresAt || order.expiresAt > currentTime) {
      return {
        expired: false,
        reason: "ORDER_NOT_EXPIRED",
      };
    }

    /*
     * Never expire a successfully
     * paid order.
     */

    if (order.payment?.status === "SUCCESS") {
      return {
        expired: false,
        reason: "PAYMENT_SUCCESSFUL",
      };
    }

    const summaryPaymentIsUnresolved = ["PENDING", "VERIFYING"].includes(
      order.payment?.status,
    );

    if (summaryPaymentIsUnresolved) {
      return {
        expired: false,
        reason: "PAYMENT_SUMMARY_UNRESOLVED",
      };
    }

    /*
     * Check complete payment-attempt
     * history as well.
     */

    const unresolvedPaymentAttempt = await transaction.paymentAttempt.findFirst(
      {
        where: {
          orderId: order.id,

          status: {
            in: ["PENDING", "VERIFYING"],
          },
        },

        select: {
          id: true,
        },
      },
    );

    if (unresolvedPaymentAttempt) {
      return {
        expired: false,
        reason: "PAYMENT_ATTEMPT_UNRESOLVED",
      };
    }

    /*
     * Atomically claim the order.
     */

    const expiryUpdate = await transaction.order.updateMany({
      where: {
        id: order.id,

        status: "PENDING",

        stockRestoredAt: null,

        expiresAt: {
          not: null,
          lte: currentTime,
        },
      },

      data: {
        status: "EXPIRED",

        expiredAt: currentTime,

        stockRestoredAt: currentTime,
      },
    });

    if (expiryUpdate.count !== 1) {
      return {
        expired: false,
        reason: "ORDER_CHANGED_CONCURRENTLY",
      };
    }

    /*
     * Restore inventory inside the
     * SAME transaction.
     */

    for (const item of order.items) {
      const stockRestoration = await transaction.product.updateMany({
        where: {
          id: item.productId,
        },

        data: {
          stock: {
            increment: item.quantity,
          },
        },
      });

      if (stockRestoration.count !== 1) {
        throw new Error(
          `Could not restore inventory for product ${item.productId}.`,
        );
      }
    }

    return {
      expired: true,
      orderId: order.id,
    };
  });
};

/*
|--------------------------------------------------------------------------
| Run one expiry sweep
|--------------------------------------------------------------------------
*/

export const expireAbandonedOrders = async () => {
  const currentTime = new Date();

  /*
   * This query previously failed with P1001.
   *
   * It is a safe read, so transient retries are
   * appropriate.
   */

  const candidates = await runDatabaseOperationWithRetry(() =>
    prisma.order.findMany({
      where: {
        status: "PENDING",

        stockRestoredAt: null,

        expiresAt: {
          not: null,
          lte: currentTime,
        },
      },

      select: {
        id: true,
      },

      orderBy: {
        expiresAt: "asc",
      },

      take: ORDER_EXPIRY_BATCH_SIZE,
    }),
  );

  let expiredOrders = 0;
  let skippedOrders = 0;
  let failedOrders = 0;

  for (const candidate of candidates) {
    try {
      const result = await expireOrderIfEligible(candidate.id, currentTime);

      if (result.expired) {
        expiredOrders += 1;
      } else {
        skippedOrders += 1;
      }
    } catch (error) {
      failedOrders += 1;

      console.error("Failed to expire an abandoned order:", {
        orderId: candidate.id,

        name: error?.name,

        code: error?.code,

        message: error?.message,
      });
    }
  }

  return {
    checkedOrders: candidates.length,

    expiredOrders,
    skippedOrders,
    failedOrders,
  };
};

/*
|--------------------------------------------------------------------------
| Background expiry worker
|--------------------------------------------------------------------------
*/

let expiryTimer = null;

let expiryStartupTimer = null;

let expirySweepIsRunning = false;

const runSweep = async () => {
  if (expirySweepIsRunning) {
    return;
  }

  expirySweepIsRunning = true;

  try {
    const result = await expireAbandonedOrders();

    if (result.expiredOrders > 0 || result.failedOrders > 0) {
      console.log("Order expiry sweep completed:", result);
    }
  } catch (error) {
    /*
     * A temporary database failure must not
     * bring down customer-facing API traffic.
     */

    console.error("Order expiry sweep failed:", {
      name: error?.name,

      code: error?.code,

      message: error?.message,
    });
  } finally {
    expirySweepIsRunning = false;
  }
};

export const stopOrderExpiryWorker = () => {
  if (expiryStartupTimer) {
    clearTimeout(expiryStartupTimer);

    expiryStartupTimer = null;
  }

  if (expiryTimer) {
    clearInterval(expiryTimer);

    expiryTimer = null;
  }
};

export const startOrderExpiryWorker = () => {
  if (expiryTimer || expiryStartupTimer) {
    return stopOrderExpiryWorker;
  }

  /*
   * Do NOT run immediately.
   *
   * Security cleanup starts around 10s.
   * Order expiry gets its turn around 20s.
   */

  expiryStartupTimer = setTimeout(() => {
    expiryStartupTimer = null;

    void runSweep();
  }, ORDER_EXPIRY_STARTUP_DELAY_MS);

  expiryStartupTimer.unref?.();

  expiryTimer = setInterval(
    () => {
      void runSweep();
    },

    ORDER_EXPIRY_SWEEP_SECONDS * 1000,
  );

  expiryTimer.unref?.();

  console.log(
    `Order expiry worker started: payment window ${ORDER_PAYMENT_WINDOW_MINUTES} minute(s), first sweep in ${
      ORDER_EXPIRY_STARTUP_DELAY_MS / 1000
    } seconds, then every ${ORDER_EXPIRY_SWEEP_SECONDS} second(s).`,
  );

  return stopOrderExpiryWorker;
};
