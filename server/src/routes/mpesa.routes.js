import express from "express";
import { protect, adminOnly } from "../middleware/auth.middleware.js";
import {
  getMpesaAccessToken,
  initiateMpesaStkPush,
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

/**
 * Converts Safaricom's CallbackMetadata.Item array into
 * a simpler JavaScript object.
 *
 * Example input:
 * [
 *   { Name: "Amount", Value: 2800 },
 *   { Name: "MpesaReceiptNumber", Value: "ABC123XYZ" }
 * ]
 *
 * Example output:
 * {
 *   Amount: 2800,
 *   MpesaReceiptNumber: "ABC123XYZ"
 * }
 */
const extractCallbackMetadata = (items = []) => {
  return items.reduce((metadata, item) => {
    if (item?.Name) {
      metadata[item.Name] = item.Value ?? null;
    }

    return metadata;
  }, {});
};

/**
 * Converts an M-Pesa transaction timestamp such as:
 * 20260717094530
 *
 * into a normal JavaScript Date.
 */
const parseMpesaTransactionDate = (value) => {
  const timestamp = String(value || "");

  if (!/^\d{14}$/.test(timestamp)) {
    return new Date();
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

  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const findPaymentWithRetry = async (
  checkoutRequestId,
  maximumAttempts = 15,
  delayMilliseconds = 2000,
) => {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const payment = await prisma.payment.findUnique({
      where: {
        checkoutRequestId,
      },

      include: {
        order: true,
      },
    });

    if (payment) {
      return payment;
    }

    if (attempt < maximumAttempts) {
      console.log(
        `Payment not saved yet. Retrying callback lookup ${attempt}/${maximumAttempts}...`,
      );

      await wait(delayMilliseconds);
    }
  }

  return null;
};

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
    console.error("M-Pesa token test error:", error);

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
     * Retrieve the order from the database.
     *
     * We also retrieve any existing payment so that we do not
     * accidentally charge an already-paid order twice.
     */
    const order = await prisma.order.findUnique({
      where: {
        id: orderId,
      },

      include: {
        payment: true,
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    if (order.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Payment cannot be initiated for an order with status ${order.status}.`,
      });
    }

    if (order.payment?.status === "SUCCESS") {
      return res.status(409).json({
        success: false,
        message: "This order has already been paid.",
      });
    }

    if (
      order.payment?.status === "PENDING" &&
      order.payment.checkoutRequestId
    ) {
      return res.status(409).json({
        success: false,
        message: "A payment request has already been initiated for this order.",
      });
    }

    /*
     * Never accept the amount from React.
     *
     * The amount comes directly from the order stored in PostgreSQL,
     * preventing someone from changing the amount in the browser.
     */
    const amount = Number(order.totalAmount);

    if (!Number.isSafeInteger(amount) || amount < 1) {
      return res.status(400).json({
        success: false,
        message: "The order amount must be a positive whole number for M-Pesa.",
      });
    }

    /*
     * Keep the account reference short and readable.
     */
    const accountReference = `ORD${order.id.slice(-8).toUpperCase()}`;

    const stkResponse = await initiateMpesaStkPush({
      phoneNumber: order.customerPhone,
      amount,
      accountReference,
    });

    /*
     * Store Safaricom's request IDs.
     *
     * The callback will later use CheckoutRequestID to locate
     * this payment and update its final status.
     */
    const payment = await prisma.payment.upsert({
      where: {
        orderId: order.id,
      },

      update: {
        method: "MPESA",
        status: "PENDING",
        amount: order.totalAmount,
        phoneNumber: order.customerPhone,
        merchantRequestId: stkResponse.MerchantRequestID,
        checkoutRequestId: stkResponse.CheckoutRequestID,
        mpesaReceiptNumber: null,
        resultCode: stkResponse.ResponseCode,
        resultDescription: stkResponse.ResponseDescription,
        paidAt: null,
      },

      create: {
        orderId: order.id,
        method: "MPESA",
        status: "PENDING",
        amount: order.totalAmount,
        phoneNumber: order.customerPhone,
        merchantRequestId: stkResponse.MerchantRequestID,
        checkoutRequestId: stkResponse.CheckoutRequestID,
        resultCode: stkResponse.ResponseCode,
        resultDescription: stkResponse.ResponseDescription,
      },
    });

    return res.status(200).json({
      success: true,
      message:
        stkResponse.CustomerMessage ||
        "M-Pesa payment request sent successfully.",

      payment: {
        orderId: order.id,
        status: payment.status,
        merchantRequestId: payment.merchantRequestId,
        checkoutRequestId: payment.checkoutRequestId,
      },
    });
  } catch (error) {
    console.error("M-Pesa STK Push error:", error);

    return res.status(502).json({
      success: false,
      message: error.message || "M-Pesa could not process the payment request.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| POST /api/mpesa/callback
|--------------------------------------------------------------------------
| Safaricom sends the final STK Push result here.
|
| This route is public because Safaricom does not have our admin
| authentication cookie.
*/

router.post("/callback", async (req, res) => {
  try {
    console.log("M-Pesa callback received:", JSON.stringify(req.body, null, 2));

    /*
     * Safaricom places the STK Push callback inside:
     *
     * req.body.Body.stkCallback
     */
    const stkCallback = req.body?.Body?.stkCallback;

    if (!stkCallback) {
      console.warn("Invalid M-Pesa callback structure received.");

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
    } = stkCallback;

    if (!CheckoutRequestID) {
      console.warn("Callback is missing CheckoutRequestID.");

      return res.status(400).json({
        ResultCode: 1,
        ResultDesc: "CheckoutRequestID is required.",
      });
    }

    /*
     * Find the payment created when the STK Push was initiated.
     */
    const payment = await findPaymentWithRetry(CheckoutRequestID);

    /*
     * Safaricom may send a callback we cannot match, for example after
     * development data has been deleted.
     *
     * We acknowledge it but do not update anything.
     */
    if (!payment) {
      console.warn(
        `No payment found for CheckoutRequestID: ${CheckoutRequestID}`,
      );

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Callback acknowledged.",
      });
    }

    /*
     * Prevent duplicate successful callbacks from processing the
     * same payment more than once.
     */
    if (payment.status === "SUCCESS") {
      console.log(
        `Payment for ${CheckoutRequestID} was already processed successfully.`,
      );

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Payment was already processed.",
      });
    }

    const normalizedResultCode = String(ResultCode);

    /*
     * Safaricom uses ResultCode 0 for a successfully completed
     * STK Push payment.
     */
    const paymentSucceeded = normalizedResultCode === "0";

    if (paymentSucceeded) {
      const metadata = extractCallbackMetadata(CallbackMetadata?.Item);

      const amountPaid = Number(metadata.Amount);
      const expectedAmount = Number(payment.amount);

      const mpesaReceiptNumber = metadata.MpesaReceiptNumber || null;

      const transactionDate = parseMpesaTransactionDate(
        metadata.TransactionDate,
      );

      const callbackPhoneNumber = metadata.PhoneNumber
        ? String(metadata.PhoneNumber)
        : null;

      /*
       * Do not mark the order as paid if the callback amount
       * differs from the amount stored in our database.
       */
      if (!Number.isFinite(amountPaid) || amountPaid !== expectedAmount) {
        console.error("M-Pesa payment amount mismatch:", {
          orderId: payment.orderId,
          expectedAmount,
          amountPaid,
          checkoutRequestId: CheckoutRequestID,
        });

        await prisma.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status: "FAILED",
            merchantRequestId: MerchantRequestID || payment.merchantRequestId,
            resultCode: normalizedResultCode,
            resultDescription: "Payment amount did not match the order amount.",
          },
        });

        return res.status(200).json({
          ResultCode: 0,
          ResultDesc: "Callback acknowledged.",
        });
      }

      if (!mpesaReceiptNumber) {
        console.error(
          "Successful callback did not include an M-Pesa receipt number.",
        );

        await prisma.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status: "FAILED",
            merchantRequestId: MerchantRequestID || payment.merchantRequestId,
            resultCode: normalizedResultCode,
            resultDescription:
              "Successful callback did not contain an M-Pesa receipt number.",
          },
        });

        return res.status(200).json({
          ResultCode: 0,
          ResultDesc: "Callback acknowledged.",
        });
      }

      /*
       * Update the Payment and Order together.
       *
       * If either update fails, neither change should be permanently
       * saved.
       */
      await prisma.$transaction(async (transaction) => {
        await transaction.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status: "SUCCESS",
            merchantRequestId: MerchantRequestID || payment.merchantRequestId,
            checkoutRequestId: CheckoutRequestID,
            mpesaReceiptNumber,
            resultCode: normalizedResultCode,
            resultDescription: ResultDesc || "Payment completed successfully.",
            phoneNumber: callbackPhoneNumber || payment.phoneNumber,
            paidAt: transactionDate,
          },
        });

        await transaction.order.update({
          where: {
            id: payment.orderId,
          },

          data: {
            status: "PAID",
          },
        });
      });

      console.log("M-Pesa payment completed successfully:", {
        orderId: payment.orderId,
        checkoutRequestId: CheckoutRequestID,
        mpesaReceiptNumber,
        amountPaid,
      });

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Callback processed successfully.",
      });
    }

    /*
     * ResultCode 1032 usually represents a user-cancelled STK prompt.
     * Other non-zero codes are treated as failed payments.
     */
    const failedPaymentStatus =
      normalizedResultCode === "1032" ? "CANCELLED" : "FAILED";

    await prisma.payment.update({
      where: {
        id: payment.id,
      },

      data: {
        status: failedPaymentStatus,
        merchantRequestId: MerchantRequestID || payment.merchantRequestId,
        checkoutRequestId: CheckoutRequestID,
        resultCode: normalizedResultCode,
        resultDescription: ResultDesc || "M-Pesa payment was not completed.",
        paidAt: null,
      },
    });

    /*
     * The Order remains PENDING so the customer can try paying again.
     */
    console.log("M-Pesa payment was not completed:", {
      orderId: payment.orderId,
      checkoutRequestId: CheckoutRequestID,
      resultCode: normalizedResultCode,
      resultDescription: ResultDesc,
    });

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback processed successfully.",
    });
  } catch (error) {
    console.error("M-Pesa callback processing error:", {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    return res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Failed to process callback.",
    });
  }
});

export default router;
