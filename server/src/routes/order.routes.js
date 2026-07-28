import express from "express";
import { success, z } from "zod";
import { Prisma } from "@prisma/client";
import rateLimit from "express-rate-limit";
import prisma from "../config/prisma.js";
import { createHash } from "node:crypto";
import { protect, adminOnly } from "../middleware/auth.middleware.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Request validation
|--------------------------------------------------------------------------
*/

const MAX_DISTINCT_PRODUCTS = 20;
const MAX_QUANTITY_PER_PRODUCT = 20;
const MAX_TOTAL_ORDER_UNITS = 50;

class OrderRequestError extends Error {
  constructor(statusCode, code, message) {
    super(message);

    this.name = "OrderRequestError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const orderItemSchema = z
  .object({
    productId: z
      .string()
      .trim()
      .min(1, "Product ID is required.")
      .max(100, "Product ID is invalid."),

    quantity: z
      .number()
      .int("Quantity must be a whole number.")
      .min(1, "Quantity must be at least 1.")
      .max(
        MAX_QUANTITY_PER_PRODUCT,
        `Quantity cannot exceed ${MAX_QUANTITY_PER_PRODUCT} per product.`,
      ),
  })
  .strict();

const createOrderSchema = z
  .object({
    customerName: z
      .string()
      .trim()
      .min(2, "Customer name must contain at least 2 characters.")
      .max(100, "Customer name cannot exceed 100 characters."),

    customerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "Email address cannot exceed 254 characters.")
      .email("Enter a valid email address.")
      .optional()
      .nullable(),

    customerPhone: z
      .string()
      .trim()
      .regex(
        /^(?:254|0|\+254)(?:7|1)\d{8}$/,
        "Enter a valid Kenyan phone number.",
      ),

    items: z
      .array(orderItemSchema)
      .min(1, "The order must contain at least one product.")
      .max(
        MAX_DISTINCT_PRODUCTS,
        `An order cannot contain more than ${MAX_DISTINCT_PRODUCTS} product entries.`,
      ),
  })
  .strict();

/*
 * PAID is intentionally excluded.
 *
 * Only the verified M-Pesa callback may change an order to PAID.
 * Full transition rules will be added in Step 4D.
 */
const updateOrderStatusSchema = z
  .object({
    status: z.enum(["PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]),
  })
  .strict();

/*
|--------------------------------------------------------------------------
| Safe order-status transitions
|--------------------------------------------------------------------------
|
| PAID is set only by the verified M-Pesa callback.
| Admins may only move orders forward through fulfilment.
*/

const ORDER_STATUS_TRANSITIONS = Object.freeze({
  PENDING: ["CANCELLED"],
  PAID: ["PROCESSING"],
  PROCESSING: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
});

const getStatusTimestampData = (requestedStatus, timestamp) => {
  switch (requestedStatus) {
    case "PROCESSING":
      return {
        processingStartedAt: timestamp,
      };

    case "SHIPPED":
      return {
        shippedAt: timestamp,
      };

    case "DELIVERED":
      return {
        deliveredAt: timestamp,
      };

    case "CANCELLED":
      return {
        cancelledAt: timestamp,
      };

    default:
      return {};
  }
};

const createOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    message: "Too many order requests. Please wait before trying again.",
  },
});

const formatValidationErrors = (issues) =>
  issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

/*
|--------------------------------------------------------------------------
| Phone number normalization
|--------------------------------------------------------------------------
| Converts:
| 0712345678
| +254712345678
| 254712345678
|
| Into:
| 254712345678
*/

const normalizeKenyanPhone = (phone) => {
  const cleanedPhone = phone.replace(/\s+/g, "");

  if (cleanedPhone.startsWith("+254")) {
    return cleanedPhone.substring(1);
  }

  if (cleanedPhone.startsWith("0")) {
    return `254${cleanedPhone.substring(1)}`;
  }

  return cleanedPhone;
};

/*
|--------------------------------------------------------------------------
| Order idempotency
|--------------------------------------------------------------------------
|
| Every checkout request must contain an Idempotency-Key header.
|
| Reusing the same key with the same request returns the original order.
| Reusing the same key with changed information is rejected.
*/

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

const getIdempotencyKey = (req) => {
  const idempotencyKey = req.get("Idempotency-Key")?.trim();

  if (!idempotencyKey) {
    throw new OrderRequestError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "An Idempotency-Key header is required.",
    );
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new OrderRequestError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "The Idempotency-Key must contain 16 to 128 valid characters.",
    );
  }

  return idempotencyKey;
};

const normalizeCustomerName = (name) => name.trim().replace(/\s+/g, " ");

const buildOrderRequestFingerprint = ({
  customerName,
  customerEmail,
  customerPhone,
  items,
}) => {
  /*
   * Sort items so that changing their order in the JSON array does not
   * create a different fingerprint.
   */
  const canonicalItems = [...items]
    .sort((firstItem, secondItem) =>
      firstItem.productId.localeCompare(secondItem.productId),
    )
    .map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }));

  const canonicalRequest = JSON.stringify({
    customerName: normalizeCustomerName(customerName),

    customerEmail: customerEmail?.toLowerCase() || null,

    customerPhone: normalizeKenyanPhone(customerPhone),

    items: canonicalItems,
  });

  return createHash("sha256").update(canonicalRequest).digest("hex");
};

const orderResponseInclude = {
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
        },
      },
    },
  },
};

const adminOrderResponseInclude = {
  ...orderResponseInclude,
  payment: true,
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
| Combine duplicate products
|--------------------------------------------------------------------------
| If the request accidentally contains the same product twice, we combine
| its quantities before processing the order.
*/

const combineDuplicateItems = (items) => {
  const combinedItems = new Map();
  let totalOrderUnits = 0;

  for (const item of items) {
    const currentQuantity = combinedItems.get(item.productId) || 0;

    const combinedQuantity = currentQuantity + item.quantity;

    /*
     * The same product may appear more than once in the request.
     * Its combined quantity must still respect the per-product limit.
     */
    if (combinedQuantity > MAX_QUANTITY_PER_PRODUCT) {
      throw new OrderRequestError(
        400,
        "PRODUCT_QUANTITY_LIMIT",
        `Combined quantity cannot exceed ${MAX_QUANTITY_PER_PRODUCT} units per product.`,
      );
    }

    totalOrderUnits += item.quantity;

    if (totalOrderUnits > MAX_TOTAL_ORDER_UNITS) {
      throw new OrderRequestError(
        400,
        "TOTAL_QUANTITY_LIMIT",
        `An order cannot contain more than ${MAX_TOTAL_ORDER_UNITS} total units.`,
      );
    }

    combinedItems.set(item.productId, combinedQuantity);
  }

  return Array.from(combinedItems, ([productId, quantity]) => ({
    productId,
    quantity,
  }));
};

/*
|--------------------------------------------------------------------------
| POST /api/orders
|--------------------------------------------------------------------------
| Creates an order.
| This route currently supports guest checkout.
*/

router.post("/", createOrderLimiter, async (req, res) => {
  let idempotencyKey = null;
  let requestFingerprint = null;
  try {
    const result = createOrderSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid order information.",

        errors: formatValidationErrors(result.error.issues),
      });
    }

    const { customerName, customerEmail, customerPhone, items } = result.data;

    const normalizedPhone = normalizeKenyanPhone(customerPhone);

    const combinedItems = combineDuplicateItems(items);

    idempotencyKey = getIdempotencyKey(req);

    const normalizedCustomerName = normalizeCustomerName(customerName);

    requestFingerprint = buildOrderRequestFingerprint({
      customerName: normalizedCustomerName,

      customerEmail,
      customerPhone: normalizedPhone,

      items: combinedItems,
    });

    /*
     * Fast replay check before beginning the stock transaction.
     */
    const existingOrder = await prisma.order.findUnique({
      where: {
        idempotencyKey,
      },

      include: orderResponseInclude,
    });

    if (existingOrder) {
      if (existingOrder.requestFingerprint !== requestFingerprint) {
        throw new OrderRequestError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key has already been used for a different order request.",
        );
      }

      return res.status(200).json({
        success: true,
        replayed: true,
        message: "This order was already created.",
        order: existingOrder,
      });
    }

    const productIds = combinedItems.map((item) => item.productId);

    const order = await prisma.$transaction(
      async (transaction) => {
        /*
         * Retrieve prices and stock from our database.
         * Nothing financial is trusted from the browser.
         */
        const products = await transaction.product.findMany({
          where: {
            id: {
              in: productIds,
            },

            isActive: true,
          },
        });

        if (products.length !== productIds.length) {
          throw new OrderRequestError(
            400,
            "PRODUCT_UNAVAILABLE",
            "One or more selected products are unavailable.",
          );
        }

        const productsById = new Map(
          products.map((product) => [product.id, product]),
        );

        let totalAmount = new Prisma.Decimal(0);

        const preparedItems = [];

        for (const item of combinedItems) {
          const product = productsById.get(item.productId);

          if (!product) {
            throw new OrderRequestError(
              400,
              "PRODUCT_UNAVAILABLE",
              "A selected product is unavailable.",
            );
          }

          if (item.quantity > product.stock) {
            throw new OrderRequestError(
              409,
              "INSUFFICIENT_STOCK",
              `${product.name} does not have enough stock.`,
            );
          }

          /*
           * The product price comes exclusively from PostgreSQL.
           */
          const itemTotal = product.price.mul(item.quantity);

          totalAmount = totalAmount.add(itemTotal);

          preparedItems.push({
            productId: product.id,

            quantity: item.quantity,

            price: product.price,
          });
        }

        if (totalAmount.lte(new Prisma.Decimal(0))) {
          throw new OrderRequestError(
            400,
            "INVALID_ORDER_TOTAL",
            "The order total must be greater than zero.",
          );
        }

        /*
         * Each stock update includes stock >= requested quantity.
         *
         * Even if another customer buys the product between our
         * initial lookup and this update, stock cannot become negative.
         */
        for (const item of combinedItems) {
          const stockUpdate = await transaction.product.updateMany({
            where: {
              id: item.productId,

              isActive: true,

              stock: {
                gte: item.quantity,
              },
            },

            data: {
              stock: {
                decrement: item.quantity,
              },
            },
          });

          if (stockUpdate.count !== 1) {
            const product = productsById.get(item.productId);

            throw new OrderRequestError(
              409,
              "INSUFFICIENT_STOCK",
              `${product?.name || "A selected product"} no longer has enough stock.`,
            );
          }
        }

        return transaction.order.create({
          data: {
            customerName: normalizedCustomerName,

            customerEmail: customerEmail || null,

            customerPhone: normalizedPhone,

            totalAmount,
            status: "PENDING",

            idempotencyKey,
            requestFingerprint,

            items: {
              create: preparedItems,
            },
          },

          include: orderResponseInclude,
        });
      },

      {
        isolationLevel: "Serializable",
      },
    );

    return res.status(201).json({
      success: true,
      message: "Order created successfully.",
      order,
    });
  } catch (error) {
    if (error instanceof OrderRequestError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    /*
     * Two identical requests might arrive simultaneously.
     *
     * PostgreSQL's unique idempotencyKey constraint allows only one
     * transaction to create the order. The losing request retrieves and
     * returns the order created by the winning request.
     */
    if (error?.code === "P2002" && idempotencyKey && requestFingerprint) {
      const existingOrder = await prisma.order.findUnique({
        where: {
          idempotencyKey,
        },

        include: orderResponseInclude,
      });

      if (existingOrder) {
        if (existingOrder.requestFingerprint !== requestFingerprint) {
          return res.status(409).json({
            success: false,
            code: "IDEMPOTENCY_KEY_REUSED",

            message:
              "This Idempotency-Key has already been used for a different order request.",
          });
        }

        return res.status(200).json({
          success: true,
          replayed: true,

          message: "This order was already created.",

          order: existingOrder,
        });
      }
    }

    /*
     * Prisma may abort a serializable transaction when another checkout
     * changes the same stock at the same time.
     */
    if (error?.code === "P2034") {
      return res.status(409).json({
        success: false,
        code: "ORDER_CONCURRENCY_CONFLICT",

        message:
          "Product availability changed while the order was being created. Please try again.",
      });
    }

    console.error("Create order error:", {
      name: error.name,
      code: error.code,
      message: error.message,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to create order safely.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/orders/admin/all
|--------------------------------------------------------------------------
| Admins can view all orders.
*/

router.get("/admin/all", protect, adminOnly, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                imageUrl: true,
              },
            },
          },
        },

        payment: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Get orders error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve orders.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/orders/admin/:id
|--------------------------------------------------------------------------
| Admins can view one complete order.
*/

router.get("/admin/:id", protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: {
        id,
      },

      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                imageUrl: true,
              },
            },
          },
        },

        payment: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("Get order error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve the order.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| PATCH /api/orders/admin/:id/status
|--------------------------------------------------------------------------
| Admins may only perform approved fulfilment transitions.
|
| PAID is never set here. Only the verified M-Pesa callback may set PAID.
| Cancelling an unpaid order restores its reserved stock exactly once.
*/

router.patch("/admin/:id/status", protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const result = updateOrderStatusSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid order status.",

        errors: formatValidationErrors(result.error.issues),
      });
    }

    const requestedStatus = result.data.status;

    const statusChangeResult = await runSerializableTransactionWithRetry(
      async (transaction) => {
        const existingOrder = await transaction.order.findUnique({
          where: {
            id,
          },

          include: {
            items: true,
            payment: true,
          },
        });

        if (!existingOrder) {
          throw new OrderRequestError(
            404,
            "ORDER_NOT_FOUND",
            "Order not found.",
          );
        }

        /*
         * Repeating the same status request is harmless.
         *
         * This also prevents repeated cancellation requests from
         * restoring stock more than once.
         */
        if (existingOrder.status === requestedStatus) {
          const unchangedOrder = await transaction.order.findUnique({
            where: {
              id,
            },

            include: adminOrderResponseInclude,
          });

          return {
            order: unchangedOrder,
            unchanged: true,
            stockRestored: false,
          };
        }

        const allowedNextStatuses =
          ORDER_STATUS_TRANSITIONS[existingOrder.status] || [];

        if (!allowedNextStatuses.includes(requestedStatus)) {
          throw new OrderRequestError(
            409,
            "INVALID_ORDER_STATUS_TRANSITION",
            `An order cannot move from ${existingOrder.status} to ${requestedStatus}.`,
          );
        }

        const statusChangedAt = new Date();

        /*
         * Cancelling a PENDING order restores the stock that was
         * reserved during order creation.
         */
        if (requestedStatus === "CANCELLED") {
          if (existingOrder.payment?.status === "SUCCESS") {
            throw new OrderRequestError(
              409,
              "PAID_ORDER_CANNOT_BE_CANCELLED",
              "A paid order cannot be cancelled without completing a refund workflow.",
            );
          }

          /*
           * Do not cancel while an M-Pesa request is unresolved.
           *
           * Safaricom could still complete the transaction and send
           * its callback.
           */
          const unresolvedPaymentAttempt =
            await transaction.paymentAttempt.findFirst({
              where: {
                orderId: existingOrder.id,

                status: {
                  in: ["PENDING", "VERIFYING"],
                },
              },

              select: {
                id: true,
                status: true,
              },
            });

          if (unresolvedPaymentAttempt) {
            throw new OrderRequestError(
              409,
              "PAYMENT_STILL_PROCESSING",
              "This order has an unresolved payment request and cannot be cancelled yet.",
            );
          }

          /*
           * The conditional update is our one-time cancellation lock.
           *
           * Only a PENDING order whose stock has not been restored
           * may pass this update.
           */
          const cancellationUpdate = await transaction.order.updateMany({
            where: {
              id: existingOrder.id,

              status: "PENDING",

              stockRestoredAt: null,
            },

            data: {
              status: "CANCELLED",

              cancelledAt: statusChangedAt,

              stockRestoredAt: statusChangedAt,
            },
          });

          if (cancellationUpdate.count !== 1) {
            throw new OrderRequestError(
              409,
              "ORDER_STATUS_CONFLICT",
              "The order changed while cancellation was being processed.",
            );
          }

          /*
           * Restore every reserved order item.
           *
           * This runs in the same transaction as the cancellation.
           * If one restoration fails, the entire cancellation rolls back.
           */
          for (const item of existingOrder.items) {
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
                `Could not restore stock for product ${item.productId}.`,
              );
            }
          }

          const cancelledOrder = await transaction.order.findUnique({
            where: {
              id: existingOrder.id,
            },

            include: adminOrderResponseInclude,
          });

          return {
            order: cancelledOrder,
            unchanged: false,
            stockRestored: true,
          };
        }

        /*
         * PAID → PROCESSING requires a verified successful payment.
         */
        if (
          requestedStatus === "PROCESSING" &&
          existingOrder.payment?.status !== "SUCCESS"
        ) {
          throw new OrderRequestError(
            409,
            "PAYMENT_NOT_VERIFIED",
            "The order cannot enter processing because its payment is not verified.",
          );
        }

        const statusTimestampData = getStatusTimestampData(
          requestedStatus,
          statusChangedAt,
        );

        /*
         * Update only when the database status still matches the
         * status we originally validated.
         */
        const statusUpdate = await transaction.order.updateMany({
          where: {
            id: existingOrder.id,

            status: existingOrder.status,
          },

          data: {
            status: requestedStatus,

            ...statusTimestampData,
          },
        });

        if (statusUpdate.count !== 1) {
          throw new OrderRequestError(
            409,
            "ORDER_STATUS_CONFLICT",
            "The order status changed while this request was being processed.",
          );
        }

        const updatedOrder = await transaction.order.findUnique({
          where: {
            id: existingOrder.id,
          },

          include: adminOrderResponseInclude,
        });

        return {
          order: updatedOrder,
          unchanged: false,
          stockRestored: false,
        };
      },
    );

    return res.status(200).json({
      success: true,

      unchanged: statusChangeResult.unchanged,

      stockRestored: statusChangeResult.stockRestored,

      message: statusChangeResult.unchanged
        ? "The order already has this status."
        : statusChangeResult.stockRestored
          ? "Order cancelled and stock restored successfully."
          : "Order status updated successfully.",

      order: statusChangeResult.order,
    });
  } catch (error) {
    if (error instanceof OrderRequestError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    if (error?.code === "P2034") {
      return res.status(409).json({
        success: false,
        code: "ORDER_STATUS_CONCURRENCY_CONFLICT",

        message:
          "The order was changed by another request. Refresh it and try again.",
      });
    }

    console.error("Update order status error:", {
      name: error.name,
      code: error.code,
      message: error.message,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to update the order status safely.",
    });
  }
});

export default router;
