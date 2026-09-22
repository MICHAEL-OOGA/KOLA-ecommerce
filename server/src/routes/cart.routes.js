import express from "express";
import { success, z } from "zod";

import prisma from "../config/prisma.js";

import { protect } from "../middleware/auth.middleware.js";
import { requireCsrf } from "../middleware/csrf.middleware.js";
import { id } from "zod/v4/locales";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Cart validation
|--------------------------------------------------------------------------
|
| The browser is allowed to tell us only:
|
| - which product
| - how many units to add
|
| It does NOT get to choose:
|
| - userId
| - price
| - stock
| - subtotal
| - cart total
*/

const addCartItemSchema = z
  .object({
    productId: z
      .string()
      .trim()
      .min(1, "Product ID is required.")
      .max(191, "Product ID is invalid."),

    quantity: z
      .number()
      .int("Quantity must be a whole number.")
      .min(1, "Quantity must be at least 1.")
      .max(1000, "Quantity is too large.")
      .default(1),
  })
  .strict();

const updateCartItemSchema = z
  .object({
    quantity: z
      .number()
      .int("Quantity must be a whole number.")
      .min(1, "Quantity must be at least 1.")
      .max(1000, "Quantity is too large."),
  })
  .strict();

const productIdSchema = z
  .string()
  .trim()
  .min(1, "Product ID is required.")
  .max(191, "Product ID is invalid.");

const formatValidationErrors = (issues) =>
  issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

/*
|--------------------------------------------------------------------------
| Cart errors
|--------------------------------------------------------------------------
*/

class CartRequestError extends Error {
  constructor(message, { status = 400, code = "INVALID_CART_REQUEST" } = {}) {
    super(message);

    this.name = "CartRequestError";
    this.status = status;
    this.code = code;
  }
}

/*
|--------------------------------------------------------------------------
| Serializable transaction retry
|--------------------------------------------------------------------------
|
| Two requests could theoretically try to update the same cart at almost
| exactly the same moment.
|
| Serializable transactions help us avoid lost updates such as:
|
| quantity = 2
|
| Request A adds 1
| Request B adds 1
|
| We want:
|
| quantity = 4
|
| not accidentally:
|
| quantity = 3
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
      const retryableConflict =
        error?.code === "P2034" || error?.code === "P2002";

      const shouldRetry = retryableConflict && attemptNumber < maximumAttempts;

      if (!shouldRetry) {
        throw error;
      }
    }
  }
};

/*
|--------------------------------------------------------------------------
| Response helpers
|--------------------------------------------------------------------------
|
| Prisma Decimal values should be represented consistently over JSON.
*/

const serializeProduct = (product) => {
  return {
    ...product,
    price: product.price.toString(),
  };
};

const serializeCartItem = (item) => {
  return {
    id: item.id,
    productId: item.productId,
    quantity: item.quantity,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,

    product: serializeProduct(item.product),
  };
};

/*
|--------------------------------------------------------------------------
| GET /api/cart
|--------------------------------------------------------------------------
|
| Authentication:
|
| required
|
| CSRF:
|
| not required because GET does not modify state.
|
| Important:
|
| The customer does NOT provide a userId.
|
| We obtain the owner from:
|
| req.user.id
|
| which protect() populated from the verified server-side AuthSession.
*/

router.get("/", protect, async (req, res) => {
  try {
    const cart = await prisma.cart.findUnique({
      where: {
        userId: req.user.id,
      },

      select: {
        id: true,
        createdAt: true,
        updatedAt: true,

        items: {
          orderBy: {
            createdAt: "asc",
          },

          select: {
            id: true,
            productId: true,
            quantity: true,
            createdAt: true,
            updatedAt: true,

            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                price: true,
                imageUrl: true,
                stock: true,
                isActive: true,

                category: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    /*
     * A newly registered customer may not have
     * a Cart row yet.
     *
     * That is perfectly valid.
     */

    if (!cart) {
      return res.status(200).json({
        success: true,

        cart: {
          id: null,
          items: [],
          itemCount: 0,
        },
      });
    }

    const items = cart.items.map(serializeCartItem);

    const itemCount = items.reduce((total, item) => total + item.quantity, 0);

    return res.status(200).json({
      success: true,

      cart: {
        id: cart.id,
        items,
        itemCount,
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get cart error:", {
      requestId: req.id,
      userId: req.user?.id,
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });

    return res.status(500).json({
      success: false,

      message: "Your cart could not be loaded.",

      requestId: req.id,
    });
  }
});

/*
|--------------------------------------------------------------------------
| POST /api/cart/items
|--------------------------------------------------------------------------
|
| Request:
|
| {
|   "productId": "cmt...",
|   "quantity": 1
| }
|
| If the product is already in the cart:
|
| existing quantity + requested quantity
|
| Example:
|
| existing = 2
| add      = 1
|
| result   = 3
*/

router.post(
  "/items",

  protect,
  requireCsrf,

  async (req, res) => {
    try {
      const validationResult = addCartItemSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid cart information.",

          errors: formatValidationErrors(validationResult.error.issues),

          requestId: req.id,
        });
      }

      const { productId, quantity } = validationResult.data;

      const result = await runSerializableTransactionWithRetry(
        async (transaction) => {
          /*
            |--------------------------------------------------------------------------
            | Retrieve authoritative product
            |--------------------------------------------------------------------------
            |
            | We don't trust product information sent by React.
            */

          const product = await transaction.product.findUnique({
            where: {
              id: productId,
            },

            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              price: true,
              imageUrl: true,
              stock: true,
              isActive: true,

              category: {
                select: {
                  name: true,
                },
              },
            },
          });

          /*
            |--------------------------------------------------------------------------
            | Product availability
            |--------------------------------------------------------------------------
            */

          if (!product || !product.isActive) {
            throw new CartRequestError("This product is not available.", {
              status: 404,
              code: "PRODUCT_NOT_AVAILABLE",
            });
          }

          if (!Number.isInteger(product.stock) || product.stock <= 0) {
            throw new CartRequestError(
              "This product is currently out of stock.",
              {
                status: 409,
                code: "PRODUCT_OUT_OF_STOCK",
              },
            );
          }

          /*
            |--------------------------------------------------------------------------
            | Find or create customer's cart
            |--------------------------------------------------------------------------
            |
            | userId comes from protect().
            |
            | Never from req.body.
            */

          const cart = await transaction.cart.upsert({
            where: {
              userId: req.user.id,
            },

            update: {},

            create: {
              userId: req.user.id,
            },

            select: {
              id: true,
            },
          });

          /*
            |--------------------------------------------------------------------------
            | Is product already in cart?
            |--------------------------------------------------------------------------
            */

          const existingItem = await transaction.cartItem.findUnique({
            where: {
              cartId_productId: {
                cartId: cart.id,

                productId: product.id,
              },
            },

            select: {
              id: true,
              quantity: true,
            },
          });

          const currentQuantity = existingItem?.quantity ?? 0;

          const nextQuantity = currentQuantity + quantity;

          /*
            |--------------------------------------------------------------------------
            | Stock enforcement
            |--------------------------------------------------------------------------
            |
            | Example:
            |
            | stock = 4
            |
            | cart currently = 3
            | requested      = 2
            |
            | nextQuantity = 5
            |
            | REJECT.
            */

          if (nextQuantity > product.stock) {
            throw new CartRequestError(
              `Only ${product.stock} unit${
                product.stock === 1 ? "" : "s"
              } of this product ${
                product.stock === 1 ? "is" : "are"
              } currently available.`,
              {
                status: 409,
                code: "CART_QUANTITY_EXCEEDS_STOCK",
              },
            );
          }

          /*
            |--------------------------------------------------------------------------
            | Create or increment item
            |--------------------------------------------------------------------------
            */

          let savedItem;

          let created = false;

          if (existingItem) {
            savedItem = await transaction.cartItem.update({
              where: {
                id: existingItem.id,
              },

              data: {
                quantity: nextQuantity,
              },

              select: {
                id: true,
                productId: true,
                quantity: true,
                createdAt: true,
                updatedAt: true,
              },
            });
          } else {
            created = true;

            savedItem = await transaction.cartItem.create({
              data: {
                cartId: cart.id,

                productId: product.id,

                quantity,
              },

              select: {
                id: true,
                productId: true,
                quantity: true,
                createdAt: true,
                updatedAt: true,
              },
            });
          }

          return {
            created,

            item: {
              ...savedItem,

              product: serializeProduct(product),
            },
          };
        },
      );

      return res.status(result.created ? 201 : 200).json({
        success: true,

        message: result.created
          ? "Product added to cart."
          : "Cart quantity updated.",

        item: result.item,
      });
    } catch (error) {
      /*
       * Expected business-rule failure.
       */

      if (error instanceof CartRequestError) {
        return res.status(error.status).json({
          success: false,

          code: error.code,

          message: error.message,

          requestId: req.id,
        });
      }

      console.error("Add cart item error:", {
        requestId: req.id,
        userId: req.user?.id,
        name: error?.name,
        code: error?.code,
        message: error?.message,
      });

      return res.status(500).json({
        success: false,

        message: "The product could not be added to your cart.",

        requestId: req.id,
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| PATCH /api/cart/items/:productId
|--------------------------------------------------------------------------
|
| Sets the cart item's quantity to an exact value.
|
| Request:
|
| {
|   "quantity": 3
| }
*/

router.patch(
  "/items/:productId",

  protect,
  requireCsrf,

  async (req, res) => {
    try {
      /*
      |--------------------------------------------------------------------------
      | Validate product ID
      |--------------------------------------------------------------------------
      */

      const productIdResult = productIdSchema.safeParse(req.params.productId);

      if (!productIdResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid product information.",

          errors: formatValidationErrors(productIdResult.error.issues),

          requestId: req.id,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Validate quantity
      |--------------------------------------------------------------------------
      */

      const validationResult = updateCartItemSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid cart information.",

          errors: formatValidationErrors(validationResult.error.issues),

          requestId: req.id,
        });
      }

      const productId = productIdResult.data;

      const { quantity } = validationResult.data;

      const result = await runSerializableTransactionWithRetry(
        async (transaction) => {
          /*
            |--------------------------------------------------------------------------
            | Find customer's cart
            |--------------------------------------------------------------------------
            */

          const cart = await transaction.cart.findUnique({
            where: {
              userId: req.user.id,
            },

            select: {
              id: true,
            },
          });

          if (!cart) {
            throw new CartRequestError("This product is not in your cart.", {
              status: 404,
              code: "CART_ITEM_NOT_FOUND",
            });
          }

          /*
            |--------------------------------------------------------------------------
            | Find cart item
            |--------------------------------------------------------------------------
            */

          const existingItem = await transaction.cartItem.findUnique({
            where: {
              cartId_productId: {
                cartId: cart.id,

                productId,
              },
            },

            select: {
              id: true,
            },
          });

          if (!existingItem) {
            throw new CartRequestError("This product is not in your cart.", {
              status: 404,
              code: "CART_ITEM_NOT_FOUND",
            });
          }

          /*
            |--------------------------------------------------------------------------
            | Retrieve authoritative product
            |--------------------------------------------------------------------------
            */

          const product = await transaction.product.findUnique({
            where: {
              id: productId,
            },

            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              price: true,
              imageUrl: true,
              stock: true,
              isActive: true,

              category: {
                select: {
                  name: true,
                },
              },
            },
          });

          if (!product || !product.isActive) {
            throw new CartRequestError("This product is no longer available.", {
              status: 409,
              code: "PRODUCT_NOT_AVAILABLE",
            });
          }

          if (!Number.isInteger(product.stock) || product.stock <= 0) {
            throw new CartRequestError(
              "This product is currently out of stock.",
              {
                status: 409,
                code: "PRODUCT_OUT_OF_STOCK",
              },
            );
          }

          /*
            |--------------------------------------------------------------------------
            | Enforce current stock
            |--------------------------------------------------------------------------
            */

          if (quantity > product.stock) {
            throw new CartRequestError(
              `Only ${product.stock} unit${
                product.stock === 1 ? "" : "s"
              } of this product ${
                product.stock === 1 ? "is" : "are"
              } currently available.`,
              {
                status: 409,

                code: "CART_QUANTITY_EXCEEDS_STOCK",
              },
            );
          }

          /*
            |--------------------------------------------------------------------------
            | Update quantity
            |--------------------------------------------------------------------------
            */

          const updatedItem = await transaction.cartItem.update({
            where: {
              id: existingItem.id,
            },

            data: {
              quantity,
            },

            select: {
              id: true,
              productId: true,
              quantity: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          return {
            ...updatedItem,

            product: serializeProduct(product),
          };
        },
      );

      return res.status(200).json({
        success: true,

        message: "Cart quantity updated.",

        item: result,
      });
    } catch (error) {
      if (error instanceof CartRequestError) {
        return res.status(error.status).json({
          success: false,
          code: error.code,
          message: error.message,
          requestId: req.id,
        });
      }

      console.error("Update cart item error:", {
        requestId: req.id,
        userId: req.user?.id,
        name: error?.name,
        code: error?.code,
        message: error?.message,
      });

      return res.status(500).json({
        success: false,

        message: "The cart item could not be updated.",

        requestId: req.id,
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| DELETE /api/cart/items/:productId
|--------------------------------------------------------------------------
|
| Removes one product completely from the authenticated customer's cart.
*/

router.delete(
  "/items/:productId",

  protect,
  requireCsrf,

  async (req, res) => {
    try {
      const productIdResult = productIdSchema.safeParse(req.params.productId);

      if (!productIdResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid product information.",

          requestId: req.id,
        });
      }

      const productId = productIdResult.data;

      /*
      |--------------------------------------------------------------------------
      | Find customer's cart
      |--------------------------------------------------------------------------
      */

      const cart = await prisma.cart.findUnique({
        where: {
          userId: req.user.id,
        },

        select: {
          id: true,
        },
      });

      /*
       * DELETE is intentionally idempotent here.
       *
       * If the customer already has no cart/item,
       * the desired final state is still:
       *
       * product not in cart.
       */

      if (!cart) {
        return res.status(200).json({
          success: true,

          message: "Product removed from cart.",
        });
      }

      await prisma.cartItem.deleteMany({
        where: {
          cartId: cart.id,

          productId,
        },
      });

      return res.status(200).json({
        success: true,

        message: "Product removed from cart.",
      });
    } catch (error) {
      console.error("Remove cart item error:", {
        requestId: req.id,
        userId: req.user?.id,
        name: error?.name,
        code: error?.code,
        message: error?.message,
      });

      return res.status(500).json({
        success: false,

        message: "The product could not be removed from your cart.",

        requestId: req.id,
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| DELETE /api/cart
|--------------------------------------------------------------------------
|
| Clears the authenticated customer's entire cart.
|
| Deleting Cart automatically deletes CartItems because our Prisma
| relationship uses:
|
| onDelete: Cascade
*/

router.delete(
  "/",

  protect,
  requireCsrf,

  async (req, res) => {
    try {
      /*
       * deleteMany keeps this operation idempotent.
       *
       * No cart?
       * That's fine — the customer's cart is already empty.
       */

      await prisma.cart.deleteMany({
        where: {
          userId: req.user.id,
        },
      });

      return res.status(200).json({
        success: true,

        message: "Cart cleared successfully.",
      });
    } catch (error) {
      console.error("Clear cart error:", {
        requestId: req.id,
        userId: req.user?.id,
        name: error?.name,
        code: error?.code,
        message: error?.message,
      });

      return res.status(500).json({
        success: false,

        message: "Your cart could not be cleared.",

        requestId: req.id,
      });
    }
  },
);

export default router;
