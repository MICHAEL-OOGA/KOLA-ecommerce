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
      });
    } catch (error) {
      const shouldRetry =
        error?.code === "P2034" && attemptNumber < maximumAttempts;

      if (!shouldRetry) {
        throw error;
      }
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

    /*
     * The candidate may have changed after the initial search.
     */
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
     * Never expire an order with a successful payment.
     */
    if (order.payment?.status === "SUCCESS") {
      return {
        expired: false,
        reason: "PAYMENT_SUCCESSFUL",
      };
    }

    /*
     * The summary Payment record may indicate an unresolved request.
     */
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
     * Also check the complete PaymentAttempt history.
     *
     * An unresolved M-Pesa attempt could still produce a successful
     * callback, so its stock must not be restored yet.
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
     * Claim the order for expiry.
     *
     * Only one worker or server instance can successfully change the
     * order from PENDING while stockRestoredAt remains null.
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
     * Restore all reserved inventory in the same transaction.
     *
     * If any product restoration fails, the EXPIRED update rolls back.
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

  const candidates = await prisma.order.findMany({
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
  });

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
        name: error.name,
        code: error.code,
        message: error.message,
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
let expirySweepIsRunning = false;

export const stopOrderExpiryWorker = () => {
  if (!expiryTimer) {
    return;
  }

  clearInterval(expiryTimer);
  expiryTimer = null;
};

export const startOrderExpiryWorker = () => {
  if (expiryTimer) {
    return stopOrderExpiryWorker;
  }

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
      console.error("Order expiry sweep failed:", {
        name: error.name,
        code: error.code,
        message: error.message,
      });
    } finally {
      expirySweepIsRunning = false;
    }
  };

  /*
   * Run once when the backend starts.
   */
  void runSweep();

  expiryTimer = setInterval(() => {
    void runSweep();
  }, ORDER_EXPIRY_SWEEP_SECONDS * 1000);

  /*
   * The timer should not prevent Node from shutting down.
   */
  expiryTimer.unref?.();

  console.log(
    `Order expiry worker started: payment window ${ORDER_PAYMENT_WINDOW_MINUTES} minute(s), sweep every ${ORDER_EXPIRY_SWEEP_SECONDS} second(s).`,
  );

  return stopOrderExpiryWorker;
};
