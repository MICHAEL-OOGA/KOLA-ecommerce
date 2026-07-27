import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { protect, adminOnly } from "../middleware/auth.middleware.js";
import {
  getMpesaAccessToken,
  initiateMpesaStkPush,
  queryMpesaStkPushStatus,
} from "../services/mpesa.service.js";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import prisma from "../config/prisma.js";

const router = express.Router();

const stkPushSchema = z.object({
  orderId: z.string().trim().min(1, "Order ID is required."),
});

const stkPushLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    message: "Too many payment attempts. Please wait before trying again.",
  },
});

/*
|--------------------------------------------------------------------------
| Payment-attempt protection
|--------------------------------------------------------------------------
|
| A recently initiated STK Push blocks another STK Push for the same order.
| This protects customers from receiving duplicate payment prompts.
*/

const ACTIVE_PAYMENT_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);

    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

const reservePaymentAttempt = async (orderId) => {
  const activeAttemptCutoff = new Date(
    Date.now() - ACTIVE_PAYMENT_ATTEMPT_WINDOW_MS,
  );

  return prisma.$transaction(
    async (transaction) => {
      /*
       * Retrieve the order inside the transaction.
       */
      const order = await transaction.order.findUnique({
        where: {
          id: orderId,
        },

        include: {
          payment: true,
        },
      });

      if (!order) {
        throw new HttpError(404, "Order not found.");
      }

      /*
       * Only pending orders may begin a payment attempt.
       */
      if (order.status !== "PENDING") {
        throw new HttpError(
          409,
          `Payment cannot be initiated for an order with status ${order.status}.`,
        );
      }

      /*
       * A successful summary payment means this order must never be charged
       * again, even if its order status was changed incorrectly.
       */
      if (order.payment?.status === "SUCCESS") {
        throw new HttpError(409, "This order has already been paid.");
      }

      /*
       * Check for an unfinished attempt.
       *
       * Any PENDING or VERIFYING attempt blocks another request. An old
       * unresolved attempt must be investigated rather than silently ignored.
       */
      const activeAttempt = await transaction.paymentAttempt.findFirst({
        where: {
          orderId: order.id,

          status: {
            in: ["PENDING", "VERIFYING"],
          },
        },

        orderBy: {
          createdAt: "desc",
        },
      });

      if (activeAttempt) {
        const attemptIsRecent = activeAttempt.createdAt >= activeAttemptCutoff;

        throw new HttpError(
          409,
          attemptIsRecent
            ? "A recent payment request is still being processed for this order."
            : "A previous payment request still requires verification. Do not retry yet.",
        );
      }

      /*
       * The amount comes from our database, never from the browser.
       */
      const amount = Number(order.totalAmount);

      if (!Number.isSafeInteger(amount) || amount < 1) {
        throw new HttpError(
          400,
          "The order amount must be a positive whole number for M-Pesa.",
        );
      }

      const accountReference = `ORD${order.id.slice(-8).toUpperCase()}`;

      /*
       * Create the attempt before contacting Safaricom.
       *
       * This gives us a permanent record even when the external request
       * fails, times out, or the application restarts.
       */
      const paymentAttempt = await transaction.paymentAttempt.create({
        data: {
          orderId: order.id,
          method: "MPESA",
          status: "PENDING",
          amount: order.totalAmount,
          phoneNumber: order.customerPhone,
          accountReference,
          initiationResponseDescription: "Payment attempt reserved.",
        },
      });

      /*
       * Payment remains the order's current payment summary.
       *
       * PaymentAttempt contains the complete attempt history.
       */
      await transaction.payment.upsert({
        where: {
          orderId: order.id,
        },

        update: {
          method: "MPESA",
          status: "PENDING",
          amount: order.totalAmount,
          phoneNumber: order.customerPhone,
          merchantRequestId: null,
          checkoutRequestId: null,
          mpesaReceiptNumber: null,
          resultCode: null,
          resultDescription: "A new payment attempt has been reserved.",
          verifiedAt: null,
          paidAt: null,
        },

        create: {
          orderId: order.id,
          method: "MPESA",
          status: "PENDING",
          amount: order.totalAmount,
          phoneNumber: order.customerPhone,
          resultDescription: "A payment attempt has been reserved.",
        },
      });

      return {
        order,
        paymentAttempt,
        amount,
        accountReference,
      };
    },

    /*
     * Serializable isolation helps protect the check-and-create sequence
     * from concurrent payment requests.
     */
    {
      isolationLevel: "Serializable",
    },
  );
};

/*
|--------------------------------------------------------------------------
| Callback validation and security helpers
|--------------------------------------------------------------------------
*/

const callbackMetadataItemSchema = z.object({
  Name: z.string().trim().min(1).max(100),
  Value: z.unknown().optional(),
});

const mpesaCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().trim().min(1).max(200),

      CheckoutRequestID: z.string().trim().min(1).max(200),

      ResultCode: z.union([
        z.number().int(),
        z
          .string()
          .trim()
          .regex(/^-?\d+$/),
      ]),

      ResultDesc: z.string().trim().max(500).optional().default(""),

      CallbackMetadata: z
        .object({
          Item: z.array(callbackMetadataItemSchema).max(20),
        })
        .optional(),
    }),
  }),
});

const CALLBACK_ATTEMPT_LOOKUP_ATTEMPTS = 8;
const CALLBACK_ATTEMPT_LOOKUP_DELAY_MS = 500;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const getRequiredCallbackToken = () => {
  const token = process.env.MPESA_CALLBACK_TOKEN?.trim();

  if (!token || token.length < 32) {
    throw new Error(
      "MPESA_CALLBACK_TOKEN must contain at least 32 characters.",
    );
  }

  return token;
};

const callbackTokenMatches = (providedToken) => {
  const expectedToken = getRequiredCallbackToken();
  const normalizedProvidedToken = String(providedToken || "");

  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(normalizedProvidedToken);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
};

const extractCallbackMetadata = (items = []) => {
  const metadata = Object.create(null);

  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(metadata, item.Name)) {
      throw new Error(`Duplicate callback metadata field: ${item.Name}`);
    }

    metadata[item.Name] = item.Value ?? null;
  }

  return metadata;
};

const parseMpesaTransactionDate = (value) => {
  const timestamp = String(value || "");

  if (!/^\d{14}$/.test(timestamp)) {
    return null;
  }

  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  const hour = timestamp.slice(8, 10);
  const minute = timestamp.slice(10, 12);
  const second = timestamp.slice(12, 14);

  const parsedDate = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`,
  );

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const normalizeMpesaPhone = (value) => String(value ?? "").replace(/\D/g, "");

const maskPhoneNumber = (value) => {
  const phone = normalizeMpesaPhone(value);

  if (phone.length < 8) {
    return null;
  }

  return `${phone.slice(0, 5)}*****${phone.slice(-2)}`;
};

const buildCallbackEventKey = ({
  merchantRequestId,
  checkoutRequestId,
  resultCode,
  resultDescription,
  metadata,
}) => {
  const canonicalEvent = JSON.stringify({
    merchantRequestId,
    checkoutRequestId,
    resultCode,
    resultDescription,
    amount: metadata.Amount ?? null,
    mpesaReceiptNumber: metadata.MpesaReceiptNumber ?? null,
    transactionDate: metadata.TransactionDate ?? null,
    phoneNumber: normalizeMpesaPhone(metadata.PhoneNumber),
  });

  return createHash("sha256").update(canonicalEvent).digest("hex");
};

const findPaymentAttemptWithRetry = async (checkoutRequestId) => {
  for (
    let attemptNumber = 1;
    attemptNumber <= CALLBACK_ATTEMPT_LOOKUP_ATTEMPTS;
    attemptNumber += 1
  ) {
    const paymentAttempt = await prisma.paymentAttempt.findUnique({
      where: {
        checkoutRequestId,
      },
    });

    if (paymentAttempt) {
      return paymentAttempt;
    }

    if (attemptNumber < CALLBACK_ATTEMPT_LOOKUP_ATTEMPTS) {
      await wait(CALLBACK_ATTEMPT_LOOKUP_DELAY_MS);
    }
  }

  return null;
};

const createOrResumeCallbackEvent = async ({
  eventKey,
  merchantRequestId,
  checkoutRequestId,
  resultCode,
  payload,
  sourceIp,
}) => {
  try {
    const callbackEvent = await prisma.mpesaCallbackEvent.create({
      data: {
        eventKey,
        merchantRequestId,
        checkoutRequestId,
        resultCode,
        payload,
        sourceIp,
      },
    });

    return {
      callbackEvent,
      alreadyHandled: false,
    };
  } catch (error) {
    if (error?.code !== "P2002") {
      throw error;
    }

    const existingEvent = await prisma.mpesaCallbackEvent.findUnique({
      where: {
        eventKey,
      },
    });

    if (!existingEvent) {
      throw error;
    }

    if (
      existingEvent.processingStatus === "PROCESSED" ||
      existingEvent.processingStatus === "REJECTED"
    ) {
      return {
        callbackEvent: existingEvent,
        alreadyHandled: true,
      };
    }

    const resumedEvent = await prisma.mpesaCallbackEvent.update({
      where: {
        id: existingEvent.id,
      },

      data: {
        processingStatus: "RECEIVED",
        errorMessage: null,
        processedAt: null,
      },
    });

    return {
      callbackEvent: resumedEvent,
      alreadyHandled: false,
    };
  }
};

const markAttemptForManualVerification = async ({
  paymentAttempt,
  callbackEventId,
  message,
  processingStatus = "REJECTED",
}) => {
  await prisma.$transaction([
    prisma.paymentAttempt.update({
      where: {
        id: paymentAttempt.id,
      },

      data: {
        status: "VERIFYING",
        callbackReceivedAt: new Date(),
        resultDescription: message,
      },
    }),

    prisma.payment.updateMany({
      where: {
        orderId: paymentAttempt.orderId,
        checkoutRequestId: paymentAttempt.checkoutRequestId,

        status: {
          in: ["PENDING", "VERIFYING"],
        },
      },

      data: {
        status: "VERIFYING",
        resultDescription: message,
      },
    }),

    prisma.mpesaCallbackEvent.update({
      where: {
        id: callbackEventId,
      },

      data: {
        paymentAttemptId: paymentAttempt.id,
        processingStatus,
        errorMessage: message,
        processedAt: new Date(),
      },
    }),
  ]);
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
| GET /api/mpesa/token-test
|--------------------------------------------------------------------------
| Admin-only diagnostic route.
*/

router.get("/token-test", protect, adminOnly, async (req, res) => {
  try {
    const { accessToken, expiresIn } = await getMpesaAccessToken();

    return res.status(200).json({
      success: true,
      message: "M-Pesa authentication successful.",
      tokenReceived: Boolean(accessToken),
      expiresIn,
    });
  } catch (error) {
    console.error("M-Pesa token test error:", {
      name: error.name,
      message: error.message,
    });

    return res.status(500).json({
      success: false,
      message: error.message || "M-Pesa authentication failed.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| POST /api/mpesa/stk-push
|--------------------------------------------------------------------------
| Initiates M-Pesa payment for an existing pending order.
|
| The frontend only submits the order ID.
| The backend reads the real phone number and amount from the database.
*/

router.post("/stk-push", stkPushLimiter, async (req, res) => {
  try {
    const result = stkPushSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "A valid order ID is required.",

        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { orderId } = result.data;

    /*
     * Reserve the attempt in PostgreSQL before contacting Safaricom.
     */
    const { order, paymentAttempt, amount, accountReference } =
      await reservePaymentAttempt(orderId);

    let stkResponse;

    /*
     * Contact Safaricom only after the database reservation succeeds.
     */
    try {
      stkResponse = await initiateMpesaStkPush({
        phoneNumber: order.customerPhone,
        amount,
        accountReference,
      });
    } catch (providerError) {
      const providerErrorMessage = String(
        providerError.message || "M-Pesa initiation failed.",
      ).slice(0, 500);

      /*
       * A timeout or network interruption creates uncertainty:
       * Safaricom might have received the request even though our backend
       * did not receive the response.
       *
       * Therefore, mark it VERIFYING rather than assuming it failed.
       */
      const resultIsUncertain =
        /timed out|network|fetch failed|socket|ECONNRESET/i.test(
          providerErrorMessage,
        );

      const attemptStatus = resultIsUncertain ? "VERIFYING" : "FAILED";

      await prisma.$transaction([
        prisma.paymentAttempt.update({
          where: {
            id: paymentAttempt.id,
          },

          data: {
            status: attemptStatus,
            initiationResponseDescription: providerErrorMessage,
          },
        }),

        prisma.payment.updateMany({
          where: {
            orderId: order.id,
            status: "PENDING",
            checkoutRequestId: null,
          },

          data: {
            status: attemptStatus,
            resultDescription: providerErrorMessage,
          },
        }),
      ]);

      console.error("M-Pesa initiation failed:", {
        orderId: order.id,
        paymentAttemptId: paymentAttempt.id,
        uncertain: resultIsUncertain,
      });

      return res.status(resultIsUncertain ? 504 : 502).json({
        success: false,

        message: resultIsUncertain
          ? "The payment provider did not respond in time. Do not retry immediately."
          : "M-Pesa could not initiate the payment request.",
      });
    }

    /*
     * Safaricom accepted the request.
     *
     * Store its identifiers in both:
     * - PaymentAttempt: permanent historical record
     * - Payment: current summary for the order
     */
    try {
      await prisma.$transaction([
        prisma.paymentAttempt.update({
          where: {
            id: paymentAttempt.id,
          },

          data: {
            status: "PENDING",

            merchantRequestId: stkResponse.MerchantRequestID,

            checkoutRequestId: stkResponse.CheckoutRequestID,

            initiationResponseCode: String(stkResponse.ResponseCode),

            initiationResponseDescription:
              stkResponse.ResponseDescription ||
              stkResponse.CustomerMessage ||
              "STK Push initiated successfully.",
          },
        }),

        prisma.payment.update({
          where: {
            orderId: order.id,
          },

          data: {
            status: "PENDING",

            merchantRequestId: stkResponse.MerchantRequestID,

            checkoutRequestId: stkResponse.CheckoutRequestID,

            resultCode: null,

            resultDescription:
              stkResponse.CustomerMessage ||
              stkResponse.ResponseDescription ||
              "STK Push initiated successfully.",

            verifiedAt: null,
            paidAt: null,
          },
        }),
      ]);
    } catch (databaseError) {
      /*
       * Safaricom may already have sent the prompt.
       *
       * Never tell the customer simply to retry when provider identifiers
       * could not be stored.
       */
      await prisma.paymentAttempt.update({
        where: {
          id: paymentAttempt.id,
        },

        data: {
          status: "VERIFYING",

          initiationResponseDescription:
            "Safaricom accepted the request, but its identifiers could not be safely saved.",
        },
      });

      console.error("Failed to save M-Pesa request identifiers:", {
        orderId: order.id,

        paymentAttemptId: paymentAttempt.id,

        code: databaseError.code,
      });

      return res.status(500).json({
        success: false,

        message:
          "The payment request may have been initiated, but its status is uncertain. Do not retry immediately.",
      });
    }

    /*
     * Do not expose Safaricom's internal identifiers to the browser.
     */
    return res.status(202).json({
      success: true,

      message:
        stkResponse.CustomerMessage ||
        "M-Pesa payment request sent successfully.",

      payment: {
        orderId: order.id,
        status: "PENDING",
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    /*
     * PostgreSQL may abort one of two simultaneous Serializable
     * transactions. This protects against concurrent duplicate prompts.
     */
    if (error?.code === "P2034") {
      return res.status(409).json({
        success: false,

        message:
          "Another payment request is already being processed for this order.",
      });
    }

    console.error("Secure STK Push route error:", {
      name: error.name,
      code: error.code,
      message: error.message,
    });

    return res.status(500).json({
      success: false,

      message: "The payment request could not be processed safely.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| POST /api/mpesa/callback/:token
|--------------------------------------------------------------------------
| The callback URL contains a high-entropy secret token because Safaricom
| callbacks do not use our normal application authentication cookie.
|
| A callback is treated as a claim, not immediate proof. We store it,
| deduplicate it, match it to a PaymentAttempt, and query Safaricom before
| applying a final payment state.
*/

router.post("/callback/:token", async (req, res) => {
  let callbackEvent = null;

  try {
    const providedCallbackToken = req.params.token;

    if (!callbackTokenMatches(providedCallbackToken)) {
      return res.status(404).json({
        ResultCode: 1,
        ResultDesc: "Callback endpoint not found.",
      });
    }

    /*
     * Redact the valid secret from logs such as Morgan's :url.
     * Express has already matched the route, so changing it here
     * does not affect routing.
     */
    req.originalUrl = req.originalUrl.replace(
      providedCallbackToken,
      "[REDACTED]",
    );

    req.url = req.url.replace(providedCallbackToken, "[REDACTED]");

    const validationResult = mpesaCallbackSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        ResultCode: 1,
        ResultDesc: "Invalid callback structure.",
      });
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata,
    } = validationResult.data.Body.stkCallback;

    const normalizedResultCode = String(ResultCode);

    const metadata = extractCallbackMetadata(CallbackMetadata?.Item || []);

    const eventKey = buildCallbackEventKey({
      merchantRequestId: MerchantRequestID,

      checkoutRequestId: CheckoutRequestID,

      resultCode: normalizedResultCode,

      resultDescription: ResultDesc,

      metadata,
    });

    /*
     * Store only normalized, limited audit data.
     * Avoid storing or logging the complete raw request body.
     */
    const normalizedAuditPayload = {
      merchantRequestId: MerchantRequestID,

      checkoutRequestId: CheckoutRequestID,

      resultCode: normalizedResultCode,

      resultDescription: ResultDesc || null,

      metadata: {
        amount: metadata.Amount ?? null,

        mpesaReceiptNumber: metadata.MpesaReceiptNumber ?? null,

        transactionDate: metadata.TransactionDate ?? null,

        maskedPhoneNumber: maskPhoneNumber(metadata.PhoneNumber),
      },
    };

    const callbackEventResult = await createOrResumeCallbackEvent({
      eventKey,

      merchantRequestId: MerchantRequestID,

      checkoutRequestId: CheckoutRequestID,

      resultCode: normalizedResultCode,

      payload: normalizedAuditPayload,

      sourceIp: req.ip || null,
    });

    callbackEvent = callbackEventResult.callbackEvent;

    if (callbackEventResult.alreadyHandled) {
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Callback already processed.",
      });
    }

    /*
     * Match the callback against the historical payment attempt,
     * not merely the current summary Payment record.
     */
    const paymentAttempt = await findPaymentAttemptWithRetry(CheckoutRequestID);

    if (!paymentAttempt) {
      await prisma.mpesaCallbackEvent.update({
        where: {
          id: callbackEvent.id,
        },

        data: {
          processingStatus: "UNMATCHED",

          errorMessage: "No payment attempt matched this CheckoutRequestID.",

          processedAt: new Date(),
        },
      });

      return res.status(503).json({
        ResultCode: 1,

        ResultDesc: "Callback could not yet be matched.",
      });
    }

    await prisma.mpesaCallbackEvent.update({
      where: {
        id: callbackEvent.id,
      },

      data: {
        paymentAttemptId: paymentAttempt.id,
      },
    });

    /*
     * Both provider IDs must match the attempt originally stored
     * when the STK Push was initiated.
     */
    if (
      paymentAttempt.merchantRequestId !== MerchantRequestID ||
      paymentAttempt.checkoutRequestId !== CheckoutRequestID
    ) {
      await markAttemptForManualVerification({
        paymentAttempt,

        callbackEventId: callbackEvent.id,

        message:
          "Callback request identifiers did not match the reserved payment attempt.",
      });

      return res.status(200).json({
        ResultCode: 0,

        ResultDesc: "Callback rejected for verification.",
      });
    }

    /*
     * Independently ask Safaricom for the status.
     *
     * The callback itself is not treated as unquestionable proof.
     */
    let providerStatus;

    try {
      providerStatus = await queryMpesaStkPushStatus(CheckoutRequestID);
    } catch (providerError) {
      await markAttemptForManualVerification({
        paymentAttempt,

        callbackEventId: callbackEvent.id,

        message: "Safaricom status verification could not be completed.",

        processingStatus: "ERROR",
      });

      throw new Error("Safaricom status verification failed.");
    }

    const providerMerchantRequestId = String(
      providerStatus.MerchantRequestID || "",
    );

    const providerCheckoutRequestId = String(
      providerStatus.CheckoutRequestID || "",
    );

    const providerResultCode = String(providerStatus.ResultCode ?? "");

    /*
     * Safaricom's status response must agree with the callback.
     */
    if (
      providerMerchantRequestId !== MerchantRequestID ||
      providerCheckoutRequestId !== CheckoutRequestID ||
      providerResultCode !== normalizedResultCode
    ) {
      await markAttemptForManualVerification({
        paymentAttempt,

        callbackEventId: callbackEvent.id,

        message: "Callback details did not match Safaricom's status response.",
      });

      return res.status(200).json({
        ResultCode: 0,

        ResultDesc: "Callback rejected for verification.",
      });
    }

    const callbackReceivedAt = new Date();

    /*
     * Handle cancelled and failed transactions.
     */
    if (normalizedResultCode !== "0") {
      const failedPaymentStatus =
        normalizedResultCode === "1032" ? "CANCELLED" : "FAILED";

      await runSerializableTransactionWithRetry(async (transaction) => {
        await transaction.paymentAttempt.updateMany({
          where: {
            id: paymentAttempt.id,

            status: {
              not: "SUCCESS",
            },
          },

          data: {
            status: failedPaymentStatus,

            callbackReceivedAt,

            resultCode: normalizedResultCode,

            resultDescription:
              ResultDesc || "M-Pesa payment was not completed.",

            paidAt: null,
          },
        });

        await transaction.payment.updateMany({
          where: {
            orderId: paymentAttempt.orderId,

            checkoutRequestId: CheckoutRequestID,

            status: {
              not: "SUCCESS",
            },
          },

          data: {
            status: failedPaymentStatus,

            resultCode: normalizedResultCode,

            resultDescription:
              ResultDesc || "M-Pesa payment was not completed.",

            verifiedAt: callbackReceivedAt,

            paidAt: null,
          },
        });

        await transaction.mpesaCallbackEvent.update({
          where: {
            id: callbackEvent.id,
          },

          data: {
            paymentAttemptId: paymentAttempt.id,

            processingStatus: "PROCESSED",

            errorMessage: null,

            processedAt: callbackReceivedAt,
          },
        });
      });

      console.log("M-Pesa payment attempt closed:", {
        orderId: paymentAttempt.orderId,

        paymentAttemptId: paymentAttempt.id,

        resultCode: normalizedResultCode,
      });

      return res.status(200).json({
        ResultCode: 0,

        ResultDesc: "Callback processed successfully.",
      });
    }

    /*
     * A successful transaction requires complete callback metadata.
     */
    const amountPaid = Number(metadata.Amount);

    const expectedAmount = Number(paymentAttempt.amount);

    const mpesaReceiptNumber = String(metadata.MpesaReceiptNumber || "").trim();

    const callbackPhoneNumber = normalizeMpesaPhone(metadata.PhoneNumber);

    const transactionDate = parseMpesaTransactionDate(metadata.TransactionDate);

    const callbackChecks = [
      {
        valid: Number.isFinite(amountPaid) && amountPaid === expectedAmount,

        message: "Callback amount did not match the expected order amount.",
      },

      {
        valid: /^[A-Z0-9]{8,20}$/i.test(mpesaReceiptNumber),

        message: "Callback did not contain a valid M-Pesa receipt number.",
      },

      {
        valid:
          callbackPhoneNumber ===
          normalizeMpesaPhone(paymentAttempt.phoneNumber),

        message: "Callback phone number did not match the payment attempt.",
      },

      {
        valid: Boolean(transactionDate),

        message: "Callback contained an invalid transaction timestamp.",
      },
    ];

    const failedCheck = callbackChecks.find((check) => !check.valid);

    if (failedCheck) {
      await markAttemptForManualVerification({
        paymentAttempt,

        callbackEventId: callbackEvent.id,

        message: failedCheck.message,
      });

      return res.status(200).json({
        ResultCode: 0,

        ResultDesc: "Callback rejected for verification.",
      });
    }

    /*
     * Apply successful-payment changes atomically.
     */
    await runSerializableTransactionWithRetry(async (transaction) => {
      const currentAttempt = await transaction.paymentAttempt.findUnique({
        where: {
          id: paymentAttempt.id,
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
        throw new Error("Payment attempt no longer exists.");
      }

      /*
       * An already successful callback is harmless only when all
       * successful transaction identifiers agree.
       */
      if (currentAttempt.status === "SUCCESS") {
        const sameSuccessfulPayment =
          currentAttempt.mpesaReceiptNumber === mpesaReceiptNumber &&
          currentAttempt.checkoutRequestId === CheckoutRequestID;

        if (!sameSuccessfulPayment) {
          throw new Error(
            "Payment attempt already contains different successful transaction details.",
          );
        }

        await transaction.mpesaCallbackEvent.update({
          where: {
            id: callbackEvent.id,
          },

          data: {
            paymentAttemptId: currentAttempt.id,

            processingStatus: "PROCESSED",

            errorMessage: null,

            processedAt: callbackReceivedAt,
          },
        });

        return;
      }

      /*
       * Only unresolved payment attempts may automatically succeed.
       */
      if (!["PENDING", "VERIFYING"].includes(currentAttempt.status)) {
        throw new Error(
          `A payment in status ${currentAttempt.status} cannot become successful automatically.`,
        );
      }

      /*
       * A callback must never silently change an already progressed,
       * cancelled or otherwise non-pending order into PAID.
       */
      if (currentAttempt.order.status !== "PENDING") {
        throw new Error(
          `An order in status ${currentAttempt.order.status} cannot be marked paid by this callback.`,
        );
      }

      /*
       * Explicitly check receipt reuse before writing.
       * Database uniqueness constraints provide another layer.
       */
      const receiptUsedByAnotherAttempt =
        await transaction.paymentAttempt.findFirst({
          where: {
            mpesaReceiptNumber,

            id: {
              not: currentAttempt.id,
            },
          },

          select: {
            id: true,
          },
        });

      const receiptUsedByAnotherPayment = await transaction.payment.findFirst({
        where: {
          mpesaReceiptNumber,

          orderId: {
            not: currentAttempt.orderId,
          },
        },

        select: {
          id: true,
        },
      });

      if (receiptUsedByAnotherAttempt || receiptUsedByAnotherPayment) {
        throw new Error(
          "The M-Pesa receipt number is already linked to another payment.",
        );
      }

      await transaction.paymentAttempt.update({
        where: {
          id: currentAttempt.id,
        },

        data: {
          status: "SUCCESS",

          callbackReceivedAt,

          verifiedAt: callbackReceivedAt,

          paidAt: transactionDate,

          mpesaReceiptNumber,

          resultCode: normalizedResultCode,

          resultDescription: ResultDesc || "Payment completed successfully.",
        },
      });

      await transaction.payment.upsert({
        where: {
          orderId: currentAttempt.orderId,
        },

        update: {
          method: "MPESA",
          status: "SUCCESS",

          amount: currentAttempt.amount,

          phoneNumber: currentAttempt.phoneNumber,

          merchantRequestId: MerchantRequestID,

          checkoutRequestId: CheckoutRequestID,

          mpesaReceiptNumber,

          resultCode: normalizedResultCode,

          resultDescription: ResultDesc || "Payment completed successfully.",

          verifiedAt: callbackReceivedAt,

          paidAt: transactionDate,
        },

        create: {
          orderId: currentAttempt.orderId,

          method: "MPESA",
          status: "SUCCESS",

          amount: currentAttempt.amount,

          phoneNumber: currentAttempt.phoneNumber,

          merchantRequestId: MerchantRequestID,

          checkoutRequestId: CheckoutRequestID,

          mpesaReceiptNumber,

          resultCode: normalizedResultCode,

          resultDescription: ResultDesc || "Payment completed successfully.",

          verifiedAt: callbackReceivedAt,

          paidAt: transactionDate,
        },
      });

      await transaction.order.update({
        where: {
          id: currentAttempt.orderId,
        },

        data: {
          status: "PAID",
        },
      });

      await transaction.mpesaCallbackEvent.update({
        where: {
          id: callbackEvent.id,
        },

        data: {
          paymentAttemptId: currentAttempt.id,

          processingStatus: "PROCESSED",

          errorMessage: null,

          processedAt: callbackReceivedAt,
        },
      });
    });

    console.log("M-Pesa payment verified successfully:", {
      orderId: paymentAttempt.orderId,

      paymentAttemptId: paymentAttempt.id,

      amountPaid,
    });

    return res.status(200).json({
      ResultCode: 0,

      ResultDesc: "Callback processed successfully.",
    });
  } catch (error) {
    /*
     * Preserve processing failures in the callback audit table.
     */
    if (callbackEvent) {
      try {
        await prisma.mpesaCallbackEvent.update({
          where: {
            id: callbackEvent.id,
          },

          data: {
            processingStatus: "ERROR",

            errorMessage: String(
              error.message || "Callback processing failed.",
            ).slice(0, 500),

            processedAt: new Date(),
          },
        });
      } catch {
        /*
         * Do not hide the original callback-processing error.
         */
      }
    }

    console.error("Secure M-Pesa callback processing error:", {
      name: error.name,
      code: error.code,
      message: error.message,
    });

    return res.status(500).json({
      ResultCode: 1,

      ResultDesc: "Callback could not be processed safely.",
    });
  }
});

export default router;
