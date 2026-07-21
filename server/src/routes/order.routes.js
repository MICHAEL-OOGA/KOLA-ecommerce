import express from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma.js";
import { protect, adminOnly } from "../middleware/auth.middleware.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Request validation
|--------------------------------------------------------------------------
*/

const createOrderSchema = z.object({
  customerName: z
    .string()
    .trim()
    .min(2, "Customer name must contain at least 2 characters.")
    .max(100, "Customer name cannot exceed 100 characters."),

  customerEmail: z
    .string()
    .trim()
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
    .array(
      z.object({
        productId: z.string().trim().min(1, "Product ID is required."),

        quantity: z
          .number()
          .int("Quantity must be a whole number.")
          .min(1, "Quantity must be at least 1.")
          .max(100, "Quantity cannot exceed 100 per product."),
      }),
    )
    .min(1, "The order must contain at least one product.")
    .max(50, "The order contains too many different products."),
});

const updateOrderStatusSchema = z.object({
  status: z.enum([
    "PENDING",
    "PAID",
    "PROCESSING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ]),
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
| Combine duplicate products
|--------------------------------------------------------------------------
| If the request accidentally contains the same product twice, we combine
| its quantities before processing the order.
*/

const combineDuplicateItems = (items) => {
  const combinedItems = new Map();

  for (const item of items) {
    const currentQuantity = combinedItems.get(item.productId) || 0;

    combinedItems.set(item.productId, currentQuantity + item.quantity);
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

router.post("/", async (req, res) => {
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

    const productIds = combinedItems.map((item) => item.productId);

    const order = await prisma.$transaction(async (transaction) => {
      /*
       * Retrieve current product information from the database.
       * We do not trust names, prices, or stock values from the frontend.
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
        throw new Error(
          "One or more selected products do not exist or are inactive.",
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
          throw new Error("A selected product could not be found.");
        }

        if (item.quantity > product.stock) {
          throw new Error(
            `Only ${product.stock} unit(s) of ${product.name} are available.`,
          );
        }

        /*
         * Use the price stored in the database.
         * Never use a price submitted by the frontend.
         */
        const itemTotal = product.price.mul(item.quantity);

        totalAmount = totalAmount.add(itemTotal);

        preparedItems.push({
          productId: product.id,
          quantity: item.quantity,
          price: product.price,
        });
      }

      /*
       * Atomically reduce stock.
       * updateMany lets us include a stock condition in the update itself.
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

          throw new Error(
            `${product?.name || "A product"} no longer has enough stock.`,
          );
        }
      }

      /*
       * Create the order and all its order items together.
       */
      return transaction.order.create({
        data: {
          customerName,
          customerEmail: customerEmail || null,
          customerPhone: normalizedPhone,
          totalAmount,
          status: "PENDING",

          items: {
            create: preparedItems,
          },
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
        },
      });
    });

    return res.status(201).json({
      success: true,
      message: "Order created successfully.",
      order,
    });
  } catch (error) {
    console.error("Create order error:", error);

    /*
     * These are expected checkout errors, such as low stock or an
     * inactive product.
     */
    if (
      error.message.includes("product") ||
      error.message.includes("stock") ||
      error.message.includes("available")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create order.",
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
| Admins can update fulfilment status.
|
| PAID should eventually be set automatically by the verified M-Pesa
| callback rather than manually.
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

    const existingOrder = await prisma.order.findUnique({
      where: {
        id,
      },
    });

    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    const updatedOrder = await prisma.order.update({
      where: {
        id,
      },

      data: {
        status: result.data.status,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Order status updated successfully.",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Update order status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update order status.",
    });
  }
});

export default router;
