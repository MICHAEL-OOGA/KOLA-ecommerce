import prisma from "../config/prisma.js";
import { queryMpesaStkPushStatus } from "./mpesa.service.js";

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
|
| Do not query Daraja immediately after STK initiation.
|
| We already discovered that an immediate status query can temporarily
| disagree with the callback. Giving Daraja a short settling period makes
| reconciliation less timing-sensitive.
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

const MPESA_RECONCILIATION_MIN_AGE_SECONDS = readBoundedIntegerEnv(
  "MPESA_RECONCILIATION_MIN_AGE_SECONDS",
  60,
  30,
  900,
);

const MPESA_RECONCILIATION_SWEEP_SECONDS = readBoundedIntegerEnv(
  "MPESA_RECONCILIATION_SWEEP_SECONDS",
  60,
  15,
  3600,
);

const MPESA_RECONCILIATION_BATCH_SIZE = readBoundedIntegerEnv(
  "MPESA_RECONCILIATION_BATCH_SIZE",
  25,
  1,
  100,
);

/*
 * Security cleanup starts around 10 seconds.
 * Order expiry starts around 20 seconds.
 * Give reconciliation its own startup slot.
 */
const MPESA_RECONCILIATION_STARTUP_DELAY_MS = 30_000;

const UNRESOLVED_PAYMENT_STATUSES = ["PENDING", "VERIFYING"];

/*
|--------------------------------------------------------------------------
| Database retry helpers
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
   * Prisma interactive transaction start timeout.
   */
  if (
    error?.code === "P2028" &&
    /unable to start a transaction/i.test(error?.message || "")
  ) {
    return true;
  }

  /*
   * Prisma 7 + PostgreSQL driver adapters can expose
   * serialization/write conflicts as DriverAdapterError
   * instead of the usual Prisma P2034 code.
   *
   * These are safe to retry because PostgreSQL has
   * already rejected/rolled back the conflicting
   * transaction.
   */
  const errorMessage = [error?.message, error?.cause?.message]
    .filter(Boolean)
    .join(" ");

  if (
    error?.name === "DriverAdapterError" &&
    /TransactionWriteConflict/i.test(errorMessage)
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
| Provider-response helpers
|--------------------------------------------------------------------------
*/

const normalizeProviderIdentifier = (value) => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
};

const normalizeProviderResultCode = (value) => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
};

const getProviderResultDescription = (providerStatus) => {
  return String(
    providerStatus?.ResultDesc ||
      providerStatus?.ResponseDescription ||
      "M-Pesa payment was not completed.",
  )
    .trim()
    .slice(0, 500);
};

const getFailedPaymentStatus = (resultCode) => {
  /*
   * Safaricom 1032 specifically represents a user cancellation.
   *
   * Other non-zero terminal results, including 1037
   * ("No response from user"), are treated as FAILED.
   */
  return resultCode === "1032" ? "CANCELLED" : "FAILED";
};

/*
|--------------------------------------------------------------------------
| Mark an old attempt as VERIFYING
|--------------------------------------------------------------------------
|
| This does NOT claim that payment succeeded or failed.
|
| It simply says:
|
| "The initial request is now old enough that its final result needs
| reconciliation."
*/

const markAttemptAsVerifying = async (paymentAttemptId, message) => {
  return runSerializableTransactionWithRetry(async (transaction) => {
    const currentAttempt = await transaction.paymentAttempt.findUnique({
      where: {
        id: paymentAttemptId,
      },

      include: {
        order: {
          include: {
            payment: true,
          },
        },
      },
    });

    if (!currentAttempt) {
      return;
    }

    if (!UNRESOLVED_PAYMENT_STATUSES.includes(currentAttempt.status)) {
      return;
    }

    if (currentAttempt.order.status !== "PENDING") {
      return;
    }

    if (currentAttempt.order.payment?.status === "SUCCESS") {
      return;
    }

    /*
     * Never overwrite a payment summary belonging
     * to a different STK attempt.
     */
    const summaryCheckoutRequestId =
      currentAttempt.order.payment?.checkoutRequestId;

    if (
      summaryCheckoutRequestId &&
      currentAttempt.checkoutRequestId &&
      summaryCheckoutRequestId !== currentAttempt.checkoutRequestId
    ) {
      return;
    }

    await transaction.paymentAttempt.updateMany({
      where: {
        id: currentAttempt.id,

        status: {
          in: UNRESOLVED_PAYMENT_STATUSES,
        },
      },

      data: {
        status: "VERIFYING",
      },
    });

    if (currentAttempt.order.payment) {
      await transaction.payment.updateMany({
        where: {
          orderId: currentAttempt.orderId,

          status: {
            in: UNRESOLVED_PAYMENT_STATUSES,
          },
        },

        data: {
          status: "VERIFYING",

          resultDescription: message,
        },
      });
    }
  });
};

/*
|--------------------------------------------------------------------------
| Close a failed/cancelled attempt
|--------------------------------------------------------------------------
*/

const closeUnsuccessfulPaymentAttempt = async ({
  paymentAttemptId,
  providerMerchantRequestId,
  providerCheckoutRequestId,
  resultCode,
  resultDescription,
}) => {
  return runSerializableTransactionWithRetry(async (transaction) => {
    const currentAttempt = await transaction.paymentAttempt.findUnique({
      where: {
        id: paymentAttemptId,
      },

      include: {
        order: {
          include: {
            payment: true,
          },
        },
      },
    });

    if (!currentAttempt) {
      return {
        resolved: false,
        reason: "ATTEMPT_NOT_FOUND",
      };
    }

    /*
     * A callback may have completed the transaction
     * while the worker was talking to Daraja.
     */
    if (!UNRESOLVED_PAYMENT_STATUSES.includes(currentAttempt.status)) {
      return {
        resolved: false,
        reason: "ATTEMPT_ALREADY_RESOLVED",
      };
    }

    if (currentAttempt.order.status !== "PENDING") {
      return {
        resolved: false,
        reason: "ORDER_NOT_PENDING",
      };
    }

    if (currentAttempt.order.payment?.status === "SUCCESS") {
      return {
        resolved: false,
        reason: "PAYMENT_ALREADY_SUCCESSFUL",
      };
    }

    /*
     * The provider IDs returned by the status query
     * must still match this exact reserved attempt.
     */
    if (
      currentAttempt.merchantRequestId !== providerMerchantRequestId ||
      currentAttempt.checkoutRequestId !== providerCheckoutRequestId
    ) {
      return {
        resolved: false,
        reason: "PROVIDER_IDENTIFIER_MISMATCH",
      };
    }

    /*
     * Also ensure the order-level Payment summary
     * does not point at another attempt.
     */
    const summaryCheckoutRequestId =
      currentAttempt.order.payment?.checkoutRequestId;

    if (
      summaryCheckoutRequestId &&
      summaryCheckoutRequestId !== currentAttempt.checkoutRequestId
    ) {
      return {
        resolved: false,
        reason: "PAYMENT_SUMMARY_MISMATCH",
      };
    }

    const resolvedAt = new Date();

    const terminalPaymentStatus = getFailedPaymentStatus(resultCode);

    const attemptUpdate = await transaction.paymentAttempt.updateMany({
      where: {
        id: currentAttempt.id,

        status: {
          in: UNRESOLVED_PAYMENT_STATUSES,
        },
      },

      data: {
        status: terminalPaymentStatus,

        resultCode,

        resultDescription,

        verifiedAt: resolvedAt,

        paidAt: null,
      },
    });

    if (attemptUpdate.count !== 1) {
      return {
        resolved: false,
        reason: "ATTEMPT_CHANGED_CONCURRENTLY",
      };
    }

    /*
     * Payment is the current order-level summary.
     *
     * PaymentAttempt remains the historical attempt record.
     */
    await transaction.payment.upsert({
      where: {
        orderId: currentAttempt.orderId,
      },

      update: {
        method: "MPESA",

        status: terminalPaymentStatus,

        amount: currentAttempt.amount,

        phoneNumber: currentAttempt.phoneNumber,

        merchantRequestId: currentAttempt.merchantRequestId,

        checkoutRequestId: currentAttempt.checkoutRequestId,

        mpesaReceiptNumber: null,

        resultCode,

        resultDescription,

        verifiedAt: resolvedAt,

        paidAt: null,
      },

      create: {
        orderId: currentAttempt.orderId,

        method: "MPESA",

        status: terminalPaymentStatus,

        amount: currentAttempt.amount,

        phoneNumber: currentAttempt.phoneNumber,

        merchantRequestId: currentAttempt.merchantRequestId,

        checkoutRequestId: currentAttempt.checkoutRequestId,

        resultCode,

        resultDescription,

        verifiedAt: resolvedAt,
      },
    });

    /*
     * IMPORTANT:
     *
     * We deliberately leave Order.status = PENDING.
     *
     * If its payment window is still open, the customer can retry.
     *
     * If it has already expired, the existing order-expiry worker
     * will now be allowed to mark it EXPIRED and restore inventory.
     */

    return {
      resolved: true,

      orderId: currentAttempt.orderId,

      paymentAttemptId: currentAttempt.id,

      status: terminalPaymentStatus,

      resultCode,
    };
  });
};

/*
|--------------------------------------------------------------------------
| Close a successfully paid attempt from STK Query
|--------------------------------------------------------------------------
|
| This is the recovery path for cases where:
|
| - Safaricom accepted the STK request
| - the customer actually paid
| - the callback was lost/unavailable
| - STK Query later confirms ResultCode = 0
|
| We do NOT invent a receipt number or transaction timestamp.
| Those remain null if the callback was never received.
*/

const closeSuccessfulPaymentAttemptFromQuery = async ({
  paymentAttemptId,
  providerMerchantRequestId,
  providerCheckoutRequestId,
  resultDescription,
}) => {
  return runSerializableTransactionWithRetry(async (transaction) => {
    const currentAttempt = await transaction.paymentAttempt.findUnique({
      where: {
        id: paymentAttemptId,
      },

      include: {
        order: {
          include: {
            payment: true,
          },
        },
      },
    });

    if (!currentAttempt) {
      return {
        resolved: false,
        reason: "ATTEMPT_NOT_FOUND",
      };
    }

    /*
     * A callback may have completed the payment
     * while reconciliation was querying Safaricom.
     */
    if (currentAttempt.status === "SUCCESS") {
      return {
        resolved: false,
        reason: "ATTEMPT_ALREADY_SUCCESSFUL",
      };
    }

    if (!UNRESOLVED_PAYMENT_STATUSES.includes(currentAttempt.status)) {
      return {
        resolved: false,
        reason: "ATTEMPT_ALREADY_RESOLVED",
      };
    }

    /*
     * Never apply a successful provider result
     * to a different STK attempt.
     */
    if (
      currentAttempt.merchantRequestId !== providerMerchantRequestId ||
      currentAttempt.checkoutRequestId !== providerCheckoutRequestId
    ) {
      return {
        resolved: false,
        reason: "PROVIDER_IDENTIFIER_MISMATCH",
      };
    }

    /*
     * Order-level Payment must still correspond
     * to this exact CheckoutRequestID.
     */
    const summaryCheckoutRequestId =
      currentAttempt.order.payment?.checkoutRequestId;

    if (
      summaryCheckoutRequestId &&
      summaryCheckoutRequestId !== currentAttempt.checkoutRequestId
    ) {
      return {
        resolved: false,
        reason: "PAYMENT_SUMMARY_MISMATCH",
      };
    }

    /*
     * The order-expiry worker deliberately refuses
     * to expire unresolved payments, so normally
     * this order should still be PENDING.
     *
     * If stock has already been restored, do NOT
     * silently turn the order into PAID.
     */
    if (
      currentAttempt.order.status !== "PENDING" ||
      currentAttempt.order.stockRestoredAt
    ) {
      return {
        resolved: false,
        reason: "ORDER_NO_LONGER_PAYABLE",
      };
    }

    const verifiedAt = new Date();

    const safeResultDescription = String(
      resultDescription ||
        "M-Pesa confirmed the payment was completed successfully.",
    )
      .trim()
      .slice(0, 500);

    /*
     * Atomically claim the Order first.
     *
     * If expiry/cancellation somehow won concurrently,
     * this update will fail and the transaction will
     * not mark the payment successful.
     */
    const orderUpdate = await transaction.order.updateMany({
      where: {
        id: currentAttempt.orderId,

        status: "PENDING",

        stockRestoredAt: null,
      },

      data: {
        status: "PAID",
      },
    });

    if (orderUpdate.count !== 1) {
      return {
        resolved: false,
        reason: "ORDER_CHANGED_CONCURRENTLY",
      };
    }

    const attemptUpdate = await transaction.paymentAttempt.updateMany({
      where: {
        id: currentAttempt.id,

        status: {
          in: UNRESOLVED_PAYMENT_STATUSES,
        },
      },

      data: {
        status: "SUCCESS",

        resultCode: "0",

        resultDescription: safeResultDescription,

        verifiedAt,

        /*
         * We do not know the exact M-Pesa
         * transaction time without the callback.
         */
        paidAt: null,
      },
    });

    if (attemptUpdate.count !== 1) {
      throw new Error(
        "The payment attempt changed while successful reconciliation was being applied.",
      );
    }

    await transaction.payment.upsert({
      where: {
        orderId: currentAttempt.orderId,
      },

      update: {
        method: "MPESA",

        status: "SUCCESS",

        amount: currentAttempt.amount,

        phoneNumber: currentAttempt.phoneNumber,

        merchantRequestId: currentAttempt.merchantRequestId,

        checkoutRequestId: currentAttempt.checkoutRequestId,

        resultCode: "0",

        resultDescription: safeResultDescription,

        verifiedAt,

        /*
         * Do not manufacture a receipt number
         * or exact paidAt timestamp.
         *
         * A late callback can enrich these later.
         */
        paidAt: null,
      },

      create: {
        orderId: currentAttempt.orderId,

        method: "MPESA",

        status: "SUCCESS",

        amount: currentAttempt.amount,

        phoneNumber: currentAttempt.phoneNumber,

        merchantRequestId: currentAttempt.merchantRequestId,

        checkoutRequestId: currentAttempt.checkoutRequestId,

        resultCode: "0",

        resultDescription: safeResultDescription,

        verifiedAt,
      },
    });

    return {
      resolved: true,

      orderId: currentAttempt.orderId,

      paymentAttemptId: currentAttempt.id,

      status: "SUCCESS",

      resultCode: "0",
    };
  });
};

/*
|--------------------------------------------------------------------------
| Reconcile one payment attempt
|--------------------------------------------------------------------------
*/

const reconcilePaymentAttempt = async (paymentAttempt) => {
  let providerStatus;

  try {
    providerStatus = await queryMpesaStkPushStatus(
      paymentAttempt.checkoutRequestId,
    );
  } catch (error) {
    /*
     * We do NOT assume failure merely because the
     * provider query itself failed.
     */

    await markAttemptAsVerifying(
      paymentAttempt.id,
      "KOLA is still confirming the M-Pesa payment result.",
    );

    return {
      resolved: false,

      reason: "PROVIDER_QUERY_FAILED",

      paymentAttemptId: paymentAttempt.id,

      error: String(error?.message || "M-Pesa status query failed.").slice(
        0,
        500,
      ),
    };
  }

  const providerMerchantRequestId = normalizeProviderIdentifier(
    providerStatus.MerchantRequestID,
  );

  const providerCheckoutRequestId = normalizeProviderIdentifier(
    providerStatus.CheckoutRequestID,
  );

  /*
   * We refuse to apply a provider result to a
   * different payment attempt.
   */
  if (
    providerMerchantRequestId !== paymentAttempt.merchantRequestId ||
    providerCheckoutRequestId !== paymentAttempt.checkoutRequestId
  ) {
    await markAttemptAsVerifying(
      paymentAttempt.id,
      "KOLA is still confirming the M-Pesa payment result.",
    );

    return {
      resolved: false,

      reason: "PROVIDER_IDENTIFIER_MISMATCH",

      paymentAttemptId: paymentAttempt.id,
    };
  }

  const resultCode = normalizeProviderResultCode(providerStatus.ResultCode);

  /*
   * Some provider responses may not yet contain a terminal result.
   */
  if (!/^-?\d+$/.test(resultCode)) {
    await markAttemptAsVerifying(
      paymentAttempt.id,
      "KOLA is still confirming the M-Pesa payment result.",
    );

    return {
      resolved: false,

      reason: "PROVIDER_RESULT_NOT_TERMINAL",

      paymentAttemptId: paymentAttempt.id,
    };
  }

  /*
   * IMPORTANT:
   *
   * ResultCode 0 indicates a successful provider result,
   * but our existing secure success path also verifies callback
   * metadata such as:
   *
   * - amount
   * - phone
   * - M-Pesa receipt number
   * - transaction timestamp
   *
   * STK Query alone does not give this worker everything needed
   * to safely reproduce that validation.
   *
   * Therefore reconciliation must NEVER mark an order PAID merely
   * because the query returned ResultCode 0.
   */

  if (resultCode === "0") {
    const resultDescription = getProviderResultDescription(providerStatus);

    return closeSuccessfulPaymentAttemptFromQuery({
      paymentAttemptId: paymentAttempt.id,

      providerMerchantRequestId,

      providerCheckoutRequestId,

      resultDescription,
    });
  }

  /*
   * A verified non-zero result is terminal.
   *
   * Examples:
   *
   * 1032 → customer cancelled
   * 1037 → no response from customer
   */

  const resultDescription = getProviderResultDescription(providerStatus);

  return closeUnsuccessfulPaymentAttempt({
    paymentAttemptId: paymentAttempt.id,

    providerMerchantRequestId,

    providerCheckoutRequestId,

    resultCode,

    resultDescription,
  });
};

/*
|--------------------------------------------------------------------------
| One reconciliation sweep
|--------------------------------------------------------------------------
*/

export const reconcileUnresolvedMpesaPayments = async () => {
  const reconciliationCutoff = new Date(
    Date.now() - MPESA_RECONCILIATION_MIN_AGE_SECONDS * 1000,
  );

  const paymentAttempts = await runDatabaseOperationWithRetry(() =>
    prisma.paymentAttempt.findMany({
      where: {
        method: "MPESA",

        status: {
          in: UNRESOLVED_PAYMENT_STATUSES,
        },

        /*
         * Without CheckoutRequestID we cannot safely
         * ask Daraja about this attempt.
         */
        checkoutRequestId: {
          not: null,
        },

        merchantRequestId: {
          not: null,
        },

        createdAt: {
          lte: reconciliationCutoff,
        },

        order: {
          status: "PENDING",
        },
      },

      select: {
        id: true,

        orderId: true,

        status: true,

        merchantRequestId: true,

        checkoutRequestId: true,

        createdAt: true,
      },

      orderBy: {
        createdAt: "asc",
      },

      take: MPESA_RECONCILIATION_BATCH_SIZE,
    }),
  );

  let resolvedAttempts = 0;
  let unresolvedAttempts = 0;
  let failedChecks = 0;

  for (const paymentAttempt of paymentAttempts) {
    try {
      const result = await reconcilePaymentAttempt(paymentAttempt);

      if (result?.resolved) {
        resolvedAttempts += 1;

        console.log("M-Pesa payment reconciliation resolved:", {
          orderId: result.orderId,

          paymentAttemptId: result.paymentAttemptId,

          status: result.status,

          resultCode: result.resultCode,
        });
      } else {
        unresolvedAttempts += 1;
      }
    } catch (error) {
      failedChecks += 1;

      console.error("M-Pesa payment reconciliation failed:", {
        orderId: paymentAttempt.orderId,

        paymentAttemptId: paymentAttempt.id,

        name: error?.name,

        code: error?.code,

        message: error?.message,
      });
    }
  }

  return {
    checkedAttempts: paymentAttempts.length,

    resolvedAttempts,

    unresolvedAttempts,

    failedChecks,
  };
};

/*
|--------------------------------------------------------------------------
| Background worker
|--------------------------------------------------------------------------
*/

let reconciliationTimer = null;

let reconciliationStartupTimer = null;

let reconciliationSweepIsRunning = false;

const runReconciliationSweep = async () => {
  if (reconciliationSweepIsRunning) {
    return;
  }

  reconciliationSweepIsRunning = true;

  try {
    const result = await reconcileUnresolvedMpesaPayments();

    if (result.resolvedAttempts > 0 || result.failedChecks > 0) {
      console.log("M-Pesa reconciliation sweep completed:", result);
    }
  } catch (error) {
    console.error("M-Pesa reconciliation sweep failed:", {
      name: error?.name,

      code: error?.code,

      message: error?.message,
    });
  } finally {
    reconciliationSweepIsRunning = false;
  }
};

export const stopMpesaReconciliationWorker = () => {
  if (reconciliationStartupTimer) {
    clearTimeout(reconciliationStartupTimer);

    reconciliationStartupTimer = null;
  }

  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);

    reconciliationTimer = null;
  }
};

export const startMpesaReconciliationWorker = () => {
  if (reconciliationTimer || reconciliationStartupTimer) {
    return stopMpesaReconciliationWorker;
  }

  reconciliationStartupTimer = setTimeout(() => {
    reconciliationStartupTimer = null;

    void runReconciliationSweep();
  }, MPESA_RECONCILIATION_STARTUP_DELAY_MS);

  reconciliationStartupTimer.unref?.();

  reconciliationTimer = setInterval(() => {
    void runReconciliationSweep();
  }, MPESA_RECONCILIATION_SWEEP_SECONDS * 1000);

  reconciliationTimer.unref?.();

  console.log(
    `M-Pesa reconciliation worker started: attempts become eligible after ${MPESA_RECONCILIATION_MIN_AGE_SECONDS} second(s), first sweep in ${
      MPESA_RECONCILIATION_STARTUP_DELAY_MS / 1000
    } seconds, then every ${MPESA_RECONCILIATION_SWEEP_SECONDS} second(s).`,
  );

  return stopMpesaReconciliationWorker;
};
