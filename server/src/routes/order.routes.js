import express from "express";
import { success, z } from "zod";
import PrismaPackage from "@prisma/client";
import rateLimit from "express-rate-limit";
import prisma from "../config/prisma.js";
import { createHash } from "node:crypto";
import { protect, protectAdmin } from "../middleware/auth.middleware.js";
import { getOrderExpiryDate } from "../services/order-expiry.service.js";
import { requireCsrf } from "../middleware/csrf.middleware.js";
import { writeSecurityAuditEvent } from "../services/security-audit.service.js";
import { process } from "zod/v4/core";
import { tr } from "zod/v4/locales";
import { error } from "node:console";
const { Prisma } = PrismaPackage;
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

const createOrderSchema = z
  .object({
    customerPhone: z
      .string()
      .trim()
      .regex(
        /^(?:254|0|\+254)(?:7|1)\d{8}$/,
        "Enter a valid Kenyan phone number.",
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

const orderIdSchema = z
  .string()
  .trim()
  .min(1, "Order ID is required.")
  .max(191, "Order ID is invalid.");

/*
|--------------------------------------------------------------------------
| Admin order-list query validation
|--------------------------------------------------------------------------
|
| Only recognised query parameters are accepted.
| Large page sizes and extreme offsets are rejected.
*/

const adminOrderPageSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return 1;
    }

    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }

    return value;
  },

  z
    .number()
    .int("Page must be a whole number.")
    .min(1, "Page must be at least 1.")
    .max(1000, "Page cannot exceed 1000."),
);

const adminOrderLimitSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return 20;
    }

    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }

    return value;
  },

  z
    .number()
    .int("Limit must be a whole number.")
    .min(1, "Limit must be at least 1.")
    .max(50, "Limit cannot exceed 50 orders per request."),
);

const adminOrderListQuerySchema = z
  .object({
    page: adminOrderPageSchema,

    limit: adminOrderLimitSchema,

    status: z
      .enum([
        "PENDING",
        "PAID",
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "EXPIRED",
      ])
      .optional(),
  })
  .strict();

/*
|--------------------------------------------------------------------------
| Customer order-list query validation
|--------------------------------------------------------------------------
|
| Customers may paginate their own order history and optionally
| filter it by order status.
*/

const customerOrderPageSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return 1;
    }

    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }

    return value;
  },

  z
    .number()
    .int("Page must be a whole number.")
    .min(1, "Page must be at least 1.")
    .max(1000, "Page cannot exceed 1000."),
);

const customerOrderLimitSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return 10;
    }

    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }

    return value;
  },

  z
    .number()
    .int("Limit must be a whole number.")
    .min(1, "Limit must be at least 1.")
    .max(25, "Limit cannot exceed 25 orders per request."),
);

const customerOrderListQuerySchema = z
  .object({
    page: customerOrderPageSchema,

    limit: customerOrderLimitSchema,

    status: z
      .enum([
        "PENDING",
        "PAID",
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "EXPIRED",
      ])
      .optional(),
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
  EXPIRED: [],
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

const adminOrderReadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    message: "Too many admin order requests. Please wait before trying again.",
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

const buildOrderRequestFingerprint = ({ userId, customerPhone }) => {
  const canonicalRequest = JSON.stringify({
    userId,
    customerPhone: normalizeKenyanPhone(customerPhone),
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

/*
|--------------------------------------------------------------------------
| Customer order response
|--------------------------------------------------------------------------
|
| Only expose information the authenticated customer needs.
|
| Internal fields such as:
|
| - idempotencyKey
| - requestFingerprint
|
| are deliberately excluded.
*/

const customerOrderSelect = {
  id: true,

  customerName: true,
  customerEmail: true,
  customerPhone: true,

  totalAmount: true,
  status: true,

  expiresAt: true,
  expiredAt: true,

  processingStartedAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,

  createdAt: true,
  updatedAt: true,

  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      price: true,

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

  payment: {
    select: {
      method: true,
      status: true,
      amount: true,
      phoneNumber: true,

      mpesaReceiptNumber: true,

      verifiedAt: true,
      paidAt: true,
    },
  },
};

/*
|--------------------------------------------------------------------------
| Customer order-list response
|--------------------------------------------------------------------------
|
| This is intentionally smaller than customerOrderSelect.
|
| The history page only needs summary information.
| Full order contents are retrieved from GET /api/orders/:id.
*/

const customerOrderListSelect = {
  id: true,

  totalAmount: true,

  status: true,

  expiresAt: true,
  expiredAt: true,

  processingStartedAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,

  createdAt: true,
  updatedAt: true,

  payment: {
    select: {
      method: true,

      status: true,

      paidAt: true,
    },
  },

  _count: {
    select: {
      items: true,
    },
  },
};

/*
|--------------------------------------------------------------------------
| Admin order-list response
|--------------------------------------------------------------------------
|
| Select only the fields needed by the admin dashboard.
|
| Internal fields such as idempotencyKey and requestFingerprint are not
| returned in the order-list response.
*/

const adminOrderListSelect = {
  id: true,

  customerName: true,
  customerEmail: true,
  customerPhone: true,

  totalAmount: true,
  status: true,

  processingStartedAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  stockRestoredAt: true,
  expiresAt: true,
  expiredAt: true,

  createdAt: true,
  updatedAt: true,

  items: {
    select: {
      quantity: true,
      price: true,

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

  payment: {
    select: {
      method: true,
      status: true,
      amount: true,

      mpesaReceiptNumber: true,
      resultCode: true,

      verifiedAt: true,
      paidAt: true,
    },
  },
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
| POST /api/orders
|--------------------------------------------------------------------------
|
| Converts the authenticated customer's server-side cart into an order.
|
| SECURITY:
|
| The browser does NOT send:
|
| - userId
| - customer name
| - customer email
| - product IDs
| - quantities
| - prices
| - total
|
| The only checkout-specific value supplied by the customer is the
| M-Pesa phone number.
*/

router.post("/", createOrderLimiter, protect, requireCsrf, async (req, res) => {
  let idempotencyKey = null;
  let requestFingerprint = null;

  try {
    /*
      |--------------------------------------------------------------------------
      | Validate checkout-specific input
      |--------------------------------------------------------------------------
      */

    const result = createOrderSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,

        message: "Invalid checkout information.",

        errors: formatValidationErrors(result.error.issues),
      });
    }

    const { customerPhone } = result.data;

    const normalizedPhone = normalizeKenyanPhone(customerPhone);

    /*
      |--------------------------------------------------------------------------
      | Authenticated customer identity
      |--------------------------------------------------------------------------
      |
      | protect already populated req.user from the authenticated,
      | revocable server session.
      */

    const userId = req.user.id;

    const customerName = normalizeCustomerName(req.user.fullName);

    const customerEmail = req.user.email;

    /*
      |--------------------------------------------------------------------------
      | Idempotency
      |--------------------------------------------------------------------------
      */

    idempotencyKey = getIdempotencyKey(req);

    requestFingerprint = buildOrderRequestFingerprint({
      userId,

      customerPhone: normalizedPhone,
    });

    /*
      |--------------------------------------------------------------------------
      | Fast replay check
      |--------------------------------------------------------------------------
      |
      | This happens BEFORE reading the cart.
      |
      | That's important because a successful checkout deletes the cart.
      |
      | If the client lost the original HTTP response and retries with the
      | same Idempotency-Key, we can still return the already-created order.
      */

    const existingOrder = await prisma.order.findUnique({
      where: {
        idempotencyKey,
      },

      include: orderResponseInclude,
    });

    if (existingOrder) {
      /*
       * A customer's idempotency key must never expose
       * another customer's order.
       */

      if (existingOrder.userId !== userId) {
        throw new OrderRequestError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key cannot be used for this checkout.",
        );
      }

      if (existingOrder.requestFingerprint !== requestFingerprint) {
        throw new OrderRequestError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key has already been used for a different checkout.",
        );
      }

      return res.status(200).json({
        success: true,

        replayed: true,

        message: "This order was already created.",

        order: existingOrder,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Convert cart → order
      |--------------------------------------------------------------------------
      */

    const transactionResult = await runSerializableTransactionWithRetry(
      async (transaction) => {
        /*
            |--------------------------------------------------------------------------
            | Re-check idempotency INSIDE transaction
            |--------------------------------------------------------------------------
            |
            | Protects against concurrent identical requests and transaction
            | retries.
            */

        const replayedOrder = await transaction.order.findUnique({
          where: {
            idempotencyKey,
          },

          include: orderResponseInclude,
        });

        if (replayedOrder) {
          if (
            replayedOrder.userId !== userId ||
            replayedOrder.requestFingerprint !== requestFingerprint
          ) {
            throw new OrderRequestError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "This Idempotency-Key has already been used for a different checkout.",
            );
          }

          return {
            order: replayedOrder,

            replayed: true,
          };
        }

        /*
            |--------------------------------------------------------------------------
            | Load authenticated customer's cart
            |--------------------------------------------------------------------------
            */

        const cart = await transaction.cart.findUnique({
          where: {
            userId,
          },

          select: {
            id: true,

            items: {
              select: {
                productId: true,

                quantity: true,
              },
            },
          },
        });

        if (!cart || cart.items.length === 0) {
          throw new OrderRequestError(400, "CART_EMPTY", "Your cart is empty.");
        }

        /*
            |--------------------------------------------------------------------------
            | Cart limits
            |--------------------------------------------------------------------------
            */

        if (cart.items.length > MAX_DISTINCT_PRODUCTS) {
          throw new OrderRequestError(
            400,
            "TOO_MANY_PRODUCTS",
            `An order cannot contain more than ${MAX_DISTINCT_PRODUCTS} different products.`,
          );
        }

        let totalOrderUnits = 0;

        for (const item of cart.items) {
          if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
            throw new OrderRequestError(
              400,
              "INVALID_CART_QUANTITY",
              "Your cart contains an invalid quantity.",
            );
          }

          if (item.quantity > MAX_QUANTITY_PER_PRODUCT) {
            throw new OrderRequestError(
              400,
              "PRODUCT_QUANTITY_LIMIT",
              `An order cannot contain more than ${MAX_QUANTITY_PER_PRODUCT} units of one product.`,
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
        }

        const productIds = cart.items.map((item) => item.productId);

        /*
            |--------------------------------------------------------------------------
            | Load authoritative products
            |--------------------------------------------------------------------------
            |
            | Current prices and stock come from PostgreSQL.
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
            409,
            "PRODUCT_UNAVAILABLE",
            "One or more products in your cart are no longer available.",
          );
        }

        const productsById = new Map(
          products.map((product) => [product.id, product]),
        );

        let totalAmount = new Prisma.Decimal(0);

        const preparedItems = [];

        /*
            |--------------------------------------------------------------------------
            | Validate stock and calculate authoritative total
            |--------------------------------------------------------------------------
            */

        for (const item of cart.items) {
          const product = productsById.get(item.productId);

          if (!product) {
            throw new OrderRequestError(
              409,
              "PRODUCT_UNAVAILABLE",
              "A product in your cart is no longer available.",
            );
          }

          if (item.quantity > product.stock) {
            throw new OrderRequestError(
              409,
              "INSUFFICIENT_STOCK",
              `${product.name} does not have enough stock.`,
            );
          }

          const itemTotal = product.price.mul(item.quantity);

          totalAmount = totalAmount.add(itemTotal);

          preparedItems.push({
            productId: product.id,

            quantity: item.quantity,

            /*
             * Snapshot current price into the
             * OrderItem.
             */

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
            |--------------------------------------------------------------------------
            | Reserve inventory
            |--------------------------------------------------------------------------
            |
            | IMPORTANT:
            |
            | `stock >= quantity` is checked INSIDE each UPDATE.
            |
            | Therefore two concurrent checkouts cannot make stock negative.
            */

        for (const item of cart.items) {
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
              `${
                product?.name || "A product in your cart"
              } no longer has enough stock.`,
            );
          }
        }

        /*
            |--------------------------------------------------------------------------
            | Create order
            |--------------------------------------------------------------------------
            */

        const order = await transaction.order.create({
          data: {
            /*
             * Critical:
             *
             * New orders now belong to the
             * authenticated customer.
             */

            userId,

            customerName,

            customerEmail,

            customerPhone: normalizedPhone,

            totalAmount,

            status: "PENDING",

            expiresAt: getOrderExpiryDate(),

            idempotencyKey,

            requestFingerprint,

            items: {
              create: preparedItems,
            },
          },

          include: orderResponseInclude,
        });

        /*
            |--------------------------------------------------------------------------
            | Consume the cart
            |--------------------------------------------------------------------------
            |
            | CartItem rows disappear through the Cart → CartItem cascade.
            |
            | This happens inside the SAME transaction as:
            |
            | - stock reservation
            | - Order creation
            |
            | Therefore:
            |
            | order fails → cart remains
            | stock fails → cart remains
            | cart deletion fails → whole order rolls back
            */

        await transaction.cart.delete({
          where: {
            id: cart.id,
          },
        });

        return {
          order,

          replayed: false,
        };
      },
    );

    return res.status(transactionResult.replayed ? 200 : 201).json({
      success: true,

      replayed: transactionResult.replayed,

      message: transactionResult.replayed
        ? "This order was already created."
        : "Order created successfully.",

      order: transactionResult.order,
    });
  } catch (error) {
    /*
      |--------------------------------------------------------------------------
      | Expected checkout errors
      |--------------------------------------------------------------------------
      */

    if (error instanceof OrderRequestError) {
      return res.status(error.statusCode).json({
        success: false,

        code: error.code,

        message: error.message,
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Simultaneous idempotent requests
      |--------------------------------------------------------------------------
      */

    if (error?.code === "P2002" && idempotencyKey && requestFingerprint) {
      const existingOrder = await prisma.order.findUnique({
        where: {
          idempotencyKey,
        },

        include: orderResponseInclude,
      });

      /*
       * Never return an order belonging to
       * another account.
       */

      if (
        existingOrder &&
        existingOrder.userId === req.user?.id &&
        existingOrder.requestFingerprint === requestFingerprint
      ) {
        return res.status(200).json({
          success: true,

          replayed: true,

          message: "This order was already created.",

          order: existingOrder,
        });
      }

      return res.status(409).json({
        success: false,

        code: "IDEMPOTENCY_KEY_REUSED",

        message: "This Idempotency-Key cannot be used for this checkout.",
      });
    }

    /*
      |--------------------------------------------------------------------------
      | Serializable concurrency conflict
      |--------------------------------------------------------------------------
      */

    if (error?.code === "P2034") {
      return res.status(409).json({
        success: false,

        code: "ORDER_CONCURRENCY_CONFLICT",

        message:
          "Product availability changed while your order was being created. Please try again.",
      });
    }

    console.error("Create order error:", {
      name: error?.name,

      code: error?.code,

      message: error?.message,
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
| Returns a limited, paginated list of orders.
|
| Supported query parameters:
| - page
| - limit
| - status
*/

router.get(
  "/admin/all",
  protectAdmin,
  adminOrderReadLimiter,
  async (req, res) => {
    try {
      const validationResult = adminOrderListQuerySchema.safeParse(req.query);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid order-list query.",

          errors: formatValidationErrors(validationResult.error.issues),
        });
      }

      const { page, limit, status } = validationResult.data;

      const skip = (page - 1) * limit;

      const where = status
        ? {
            status,
          }
        : {};

      /*
       * Count and retrieve the requested page together.
       */
      const [totalOrders, orders] = await prisma.$transaction([
        prisma.order.count({
          where,
        }),

        prisma.order.findMany({
          where,

          skip,
          take: limit,

          select: adminOrderListSelect,

          /*
           * createdAt provides chronological sorting.
           * id gives deterministic ordering when timestamps match.
           */
          orderBy: [
            {
              createdAt: "desc",
            },
            {
              id: "desc",
            },
          ],
        }),
      ]);

      const totalPages = totalOrders === 0 ? 0 : Math.ceil(totalOrders / limit);

      return res.status(200).json({
        success: true,

        filters: {
          status: status || null,
        },

        pagination: {
          page,
          limit,

          totalOrders,
          totalPages,

          returnedOrders: orders.length,

          hasPreviousPage: page > 1,

          hasNextPage: page < totalPages,
        },

        orders,
      });
    } catch (error) {
      console.error("Get paginated orders error:", {
        name: error.name,
        code: error.code,
        message: error.message,
      });

      return res.status(500).json({
        success: false,

        message: "Failed to retrieve orders safely.",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| GET /api/orders/admin/summary
|--------------------------------------------------------------------------
|
| Returns a lightweight overview for the admin dashboard.
|
| SECURITY:
|
| - authenticated session required
| - ADMIN role required
| - no customer can access these aggregate business metrics
*/

router.get(
  "/admin/summary",
  protectAdmin,
  adminOrderReadLimiter,
  async (req, res) => {
    try {
      const [
        totalOrders,
        pendingOrders,
        paidOrders,
        processingOrders,
        shippedOrders,
        deliveredOrders,
        cancelledOrders,
        expiredOrders,
        successfulPayments,
        recentOrders,
      ] = await prisma.$transaction([
        prisma.order.count(),

        prisma.order.count({
          where: {
            status: "PENDING",
          },
        }),

        prisma.order.count({
          where: {
            status: "PAID",
          },
        }),

        prisma.order.count({
          where: {
            status: "PROCESSING",
          },
        }),

        prisma.order.count({
          where: {
            status: "SHIPPED",
          },
        }),

        prisma.order.count({
          where: {
            status: "DELIVERED",
          },
        }),

        prisma.order.count({
          where: {
            status: "CANCELLED",
          },
        }),

        prisma.order.count({
          where: {
            status: "EXPIRED",
          },
        }),

        /*
         * Revenue comes from verified SUCCESS payments,
         * not from browser totals or merely-created orders.
         */
        prisma.payment.aggregate({
          where: {
            status: "SUCCESS",
          },

          _sum: {
            amount: true,
          },

          _count: {
            _all: true,
          },
        }),

        prisma.order.findMany({
          take: 5,

          orderBy: [
            {
              createdAt: "desc",
            },
            {
              id: "desc",
            },
          ],

          select: {
            id: true,

            customerName: true,

            totalAmount: true,

            status: true,

            createdAt: true,

            payment: {
              select: {
                status: true,
              },
            },

            _count: {
              select: {
                items: true,
              },
            },
          },
        }),
      ]);

      return res.status(200).json({
        success: true,

        summary: {
          totalOrders,

          statuses: {
            pending: pendingOrders,
            paid: paidOrders,
            processing: processingOrders,
            shipped: shippedOrders,
            delivered: deliveredOrders,
            cancelled: cancelledOrders,
            expired: expiredOrders,
          },

          payments: {
            successfulPayments: successfulPayments._count._all,

            totalRevenue:
              successfulPayments._sum.amount || new Prisma.Decimal(0),
          },
        },

        recentOrders,
      });
    } catch (error) {
      console.error("Get admin dashboard summary error:", {
        name: error?.name,
        code: error?.code,
        message: error?.message,
      });

      return res.status(500).json({
        success: false,

        message: "Failed to retrieve dashboard summary.",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| GET /api/orders/admin/:id
|--------------------------------------------------------------------------
| Admins can view one complete order.
*/

router.get("/admin/:id", protectAdmin, async (req, res) => {
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

router.patch(
  "/admin/:id/status",
  protectAdmin,
  requireCsrf,
  async (req, res) => {
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

            await writeSecurityAuditEvent({
              database: transaction,

              req,

              eventType: "ORDER_STATUS_CHANGED",

              outcome: "SUCCESS",

              resourceType: "ORDER",

              resourceId: existingOrder.id,

              metadata: {
                fromStatus: existingOrder.status,

                toStatus: "CANCELLED",

                stockRestored: true,
              },
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

          await writeSecurityAuditEvent({
            database: transaction,

            req,

            eventType: "ORDER_STATUS_CHANGED",

            outcome: "SUCCESS",

            resourceType: "ORDER",

            resourceId: existingOrder.id,

            metadata: {
              fromStatus: existingOrder.status,

              toStatus: requestedStatus,

              stockRestored: false,
            },
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
  },
);

/*
|--------------------------------------------------------------------------
| GET /api/orders
|--------------------------------------------------------------------------
|
| Returns the authenticated customer's own order history.
|
| SECURITY:
|
| - userId comes exclusively from req.user.id
| - the browser cannot request another customer's orders
| - no internal payment-attempt/provider information is exposed
| - results are paginated
|
| Supported query parameters:
|
| - page
| - limit
| - status
*/

router.get("/", protect, async (req, res) => {
  try {
    const validationResult = customerOrderListQuerySchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,

        message: "Invalid order-history query.",

        errors: formatValidationErrors(validationResult.error.issues),
      });
    }

    const { page, limit, status } = validationResult.data;

    const skip = (page - 1) * limit;

    /*
     * Critical ownership boundary.
     *
     * userId never comes from req.query,
     * req.body or req.params.
     */
    const where = {
      userId: req.user.id,

      ...(status
        ? {
            status,
          }
        : {}),
    };

    /*
     * Retrieve the total and requested page
     * from the same database snapshot.
     */
    const [totalOrders, orders] = await prisma.$transaction([
      prisma.order.count({
        where,
      }),

      prisma.order.findMany({
        where,

        skip,

        take: limit,

        select: customerOrderListSelect,

        /*
         * Newest orders first.
         *
         * id provides deterministic ordering
         * if two timestamps happen to match.
         */
        orderBy: [
          {
            createdAt: "desc",
          },

          {
            id: "desc",
          },
        ],
      }),
    ]);

    const totalPages = totalOrders === 0 ? 0 : Math.ceil(totalOrders / limit);

    return res.status(200).json({
      success: true,

      filters: {
        status: status || null,
      },

      pagination: {
        page,

        limit,

        totalOrders,

        totalPages,

        returnedOrders: orders.length,

        hasPreviousPage: page > 1,

        hasNextPage: page < totalPages,
      },

      orders,
    });
  } catch (error) {
    console.error("Get customer order history error:", {
      name: error?.name,

      code: error?.code,

      message: error?.message,
    });

    return res.status(500).json({
      success: false,

      message: "Failed to retrieve your order history.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/orders/:id
|--------------------------------------------------------------------------
|
| Returns one order belonging to the authenticated customer.
|
| SECURITY:
|
| The order must belong to req.user.id.
|
| An order belonging to another customer is treated exactly like an order
| that does not exist. This avoids leaking information about other orders.
*/

router.get("/:id", protect, async (req, res) => {
  try {
    const validationResult = orderIdSchema.safeParse(req.params.id);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,

        message: "Invalid order ID.",

        errors: formatValidationErrors(validationResult.error.issues),
      });
    }

    const orderId = validationResult.data;

    /*
     * IMPORTANT:
     *
     * Ownership is checked directly in the
     * database query.
     */

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,

        userId: req.user.id,
      },

      select: customerOrderSelect,
    });

    /*
     * We return the same 404 whether:
     *
     * - the order does not exist
     * - it exists but belongs to somebody else
     */

    if (!order) {
      return res.status(404).json({
        success: false,

        code: "ORDER_NOT_FOUND",

        message: "Order not found.",
      });
    }

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("Get customer order error:", {
      name: error?.name,

      code: error?.code,

      message: error?.message,
    });

    return res.status(500).json({
      success: false,

      message: "Failed to retrieve the order.",
    });
  }
});

export default router;
