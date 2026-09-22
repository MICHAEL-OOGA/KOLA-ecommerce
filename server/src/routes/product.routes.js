import express from "express";
import { success, z } from "zod";

import prisma from "../config/prisma.js";

import { protectAdmin } from "../middleware/auth.middleware.js";

import { requireCsrf } from "../middleware/csrf.middleware.js";

import { writeSecurityAuditEvent } from "../services/security-audit.service.js";

const router = express.Router();

const LOW_STOCK_THRESHOLD = 10;

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

const isHttpOrHttpsUrl = (value) => {
  try {
    const parsedUrl = new URL(value);

    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
};

const hasMaximumTwoDecimalPlaces = (value) => {
  return /^\d+(?:\.\d{1,2})?$/.test(String(value));
};

const formatValidationErrors = (issues) => {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "body",

    message: issue.message,
  }));
};

/*
|--------------------------------------------------------------------------
| Validation schemas
|--------------------------------------------------------------------------
*/

const createProductSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Product name must contain at least 2 characters.")
      .max(150, "Product name cannot exceed 150 characters."),

    slug: z
      .string()
      .trim()
      .min(2, "Slug must contain at least 2 characters.")
      .max(180, "Slug cannot exceed 180 characters.")
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug must contain lowercase letters, numbers, and hyphens only.",
      ),

    description: z
      .string()
      .trim()
      .max(5000, "Description cannot exceed 5000 characters.")
      .optional()
      .nullable(),

    price: z
      .number()
      .finite("Price must be a finite number.")
      .positive("Price must be greater than zero.")
      .max(99999999.99, "Price is too large.")
      .refine(hasMaximumTwoDecimalPlaces, {
        message: "Price cannot contain more than two decimal places.",
      }),

    stock: z
      .number()
      .int("Stock must be a whole number.")
      .min(0, "Stock cannot be negative.")
      .max(1_000_000, "Stock value is too large."),

    imageUrl: z
      .string()
      .trim()
      .max(2048, "Image URL is too long.")
      .url("Image URL must be a valid URL.")
      .refine(isHttpOrHttpsUrl, {
        message: "Image URL must use HTTP or HTTPS.",
      })
      .optional()
      .nullable(),

    categoryId: z
      .string()
      .trim()
      .min(1, "Category ID cannot be empty.")
      .max(100, "Category ID is invalid.")
      .optional()
      .nullable(),

    isActive: z.boolean().optional(),
  })
  .strict();

const inventoryAlertQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(25).default(5),
  })
  .strict();

/*
 * Stock is deliberately excluded.
 *
 * Inventory receives its own endpoint further below so
 * concurrent checkout changes cannot be accidentally overwritten.
 */
const updateProductSchema = createProductSchema
  .omit({
    stock: true,
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

const updateStockSchema = z
  .object({
    /*
     * Stock value the administrator saw before pressing Save.
     */
    expectedCurrentStock: z.number().int().min(0).max(1_000_000),

    /*
     * Desired new stock.
     */
    stock: z
      .number()
      .int("Stock must be a whole number.")
      .min(0, "Stock cannot be negative.")
      .max(1_000_000, "Stock value is too large."),
  })
  .strict();

const adminProductQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),

    limit: z.coerce.number().int().min(1).max(50).default(20),

    status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),

    search: z.string().trim().max(100).optional(),
  })
  .strict();

const publicCatalogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),

    limit: z.coerce.number().int().min(1).max(50).default(12),

    search: z.string().trim().max(100).optional(),

    category: z.string().trim().max(100).optional(),

    sort: z
      .enum(["NEWEST", "PRICE_ASC", "PRICE_DESC", "NAME_ASC"])
      .default("NEWEST"),
  })
  .strict();

/*
|--------------------------------------------------------------------------
| Reusable product include
|--------------------------------------------------------------------------
*/

const productInclude = {
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
};

/*
|--------------------------------------------------------------------------
| GET /api/products
|--------------------------------------------------------------------------
| Public route.
| Only active products are exposed to customers.
*/

router.get("/", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
      },

      include: productInclude,

      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error("Get products error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve products.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/products/admin/all
|--------------------------------------------------------------------------
|
| ADMIN only.
|
| Supports:
| - pagination
| - active/inactive filtering
| - name/slug search
|
| Keep above /admin/:id and /:id.
*/

router.get("/admin/all", protectAdmin, async (req, res) => {
  try {
    const result = adminProductQuerySchema.safeParse(req.query);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid product query.",
        errors: formatValidationErrors(result.error.issues),
      });
    }

    const { page, limit, status, search } = result.data;

    const where = {};

    if (status === "ACTIVE") {
      where.isActive = true;
    }

    if (status === "INACTIVE") {
      where.isActive = false;
    }

    if (search) {
      where.OR = [
        {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },

        {
          slug: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    const skip = (page - 1) * limit;

    const [totalItems, products] = await prisma.$transaction([
      prisma.product.count({
        where,
      }),

      prisma.product.findMany({
        where,

        skip,
        take: limit,

        include: productInclude,

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

    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    return res.status(200).json({
      success: true,

      count: products.length,

      products,

      pagination: {
        page,
        limit,

        totalItems,
        totalPages,

        hasPreviousPage: page > 1,

        hasNextPage: page < totalPages,
      },
    });
  } catch (error) {
    console.error("Get admin products error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve admin products.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/products/admin/summary
|--------------------------------------------------------------------------
|
| Lightweight inventory metrics for the admin dashboard.
*/

router.get("/admin/summary", protectAdmin, async (req, res) => {
  try {
    const [
      totalProducts,
      activeProducts,
      inactiveProducts,
      lowStockProducts,
      outOfStockProducts,
    ] = await prisma.$transaction([
      prisma.product.count(),

      prisma.product.count({
        where: {
          isActive: true,
        },
      }),

      prisma.product.count({
        where: {
          isActive: false,
        },
      }),

      prisma.product.count({
        where: {
          isActive: true,

          stock: {
            gt: 0,
            lte: LOW_STOCK_THRESHOLD,
          },
        },
      }),

      prisma.product.count({
        where: {
          isActive: true,
          stock: 0,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,

      summary: {
        totalProducts,
        activeProducts,
        inactiveProducts,
        lowStockProducts,
        outOfStockProducts,

        lowStockThreshold: LOW_STOCK_THRESHOLD,
      },
    });
  } catch (error) {
    console.error("Get product summary error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve product summary.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/products/admin/inventory-alerts
|--------------------------------------------------------------------------
|
| ADMIN only.
|
| Returns active products whose stock requires attention.
|
| This is calculated by the backend from current database inventory.
*/

router.get("/admin/inventory-alerts", protectAdmin, async (req, res) => {
  try {
    const result = inventoryAlertQuerySchema.safeParse(req.query);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid inventory alert query.",

        errors: formatValidationErrors(result.error.issues),
      });
    }

    const { limit } = result.data;

    const products = await prisma.product.findMany({
      where: {
        isActive: true,

        stock: {
          gte: 0,
          lte: LOW_STOCK_THRESHOLD,
        },
      },

      take: limit,

      select: {
        id: true,
        name: true,
        slug: true,
        price: true,
        stock: true,
        imageUrl: true,
        updatedAt: true,

        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },

      /*
       * Most urgent inventory appears first:
       *
       * 0 → out of stock
       * 1 → very low
       * 2...
       */
      orderBy: [
        {
          stock: "asc",
        },
        {
          updatedAt: "desc",
        },
        {
          id: "asc",
        },
      ],
    });

    return res.status(200).json({
      success: true,

      lowStockThreshold: LOW_STOCK_THRESHOLD,

      count: products.length,

      products,
    });
  } catch (error) {
    console.error("Get inventory alerts error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve inventory alerts.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/products/admin/:id
|--------------------------------------------------------------------------
|
| ADMIN only.
|
| Unlike the public endpoint, this route can retrieve an
| inactive product.
*/

router.get("/admin/:id", protectAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: {
        id,
      },

      include: productInclude,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    return res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    console.error("Get admin product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve product.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/products/catalog
|--------------------------------------------------------------------------
|
| Public storefront catalogue.
|
| SECURITY / AUTHORITY:
|
| - Only ACTIVE products are exposed.
| - Search/filter/sort rules are server-controlled.
| - Prices and stock come from the database.
| - Pagination is bounded.
| - Customers cannot request arbitrary Prisma fields/order clauses.
*/

router.get("/catalog", async (req, res) => {
  try {
    const result = publicCatalogQuerySchema.safeParse(req.query);

    if (!result.success) {
      return res.status(400).json({
        success: false,

        message: "Invalid catalogue query.",

        errors: formatValidationErrors(result.error.issues),
      });
    }

    const { page, limit, search, category, sort } = result.data;

    /*
     * This is the non-negotiable storefront boundary.
     *
     * No query parameter can override this.
     */
    const where = {
      isActive: true,
    };

    /*
     * Search only fields we intentionally allow.
     */
    if (search) {
      where.OR = [
        {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },

        {
          slug: {
            contains: search,
            mode: "insensitive",
          },
        },

        {
          description: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    /*
     * Category is identified by public-facing slug,
     * not an internal database ID.
     */
    if (category) {
      where.category = {
        is: {
          slug: category,
        },
      };
    }

    let orderBy;

    switch (sort) {
      case "PRICE_ASC":
        orderBy = [
          {
            price: "asc",
          },
          {
            id: "asc",
          },
        ];
        break;

      case "PRICE_DESC":
        orderBy = [
          {
            price: "desc",
          },
          {
            id: "asc",
          },
        ];
        break;

      case "NAME_ASC":
        orderBy = [
          {
            name: "asc",
          },
          {
            id: "asc",
          },
        ];
        break;

      case "NEWEST":
      default:
        orderBy = [
          {
            createdAt: "desc",
          },
          {
            id: "desc",
          },
        ];
        break;
    }

    const skip = (page - 1) * limit;

    const [totalItems, products] = await prisma.$transaction([
      prisma.product.count({
        where,
      }),

      prisma.product.findMany({
        where,

        skip,
        take: limit,

        orderBy,

        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          price: true,
          imageUrl: true,
          stock: true,
          createdAt: true,
          updatedAt: true,

          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    return res.status(200).json({
      success: true,

      count: products.length,

      products,

      pagination: {
        page,
        limit,

        totalItems,
        totalPages,

        hasPreviousPage: page > 1,

        hasNextPage: page < totalPages,
      },

      filters: {
        search: search || null,

        category: category || null,

        sort,
      },
    });
  } catch (error) {
    console.error("Get public catalogue error:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to retrieve catalogue.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/products/:id
|--------------------------------------------------------------------------
| Public route.
| Only active products can be retrieved.
*/

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findFirst({
      where: {
        id,
        isActive: true,
      },

      include: productInclude,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    return res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    console.error("Get product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve product.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| POST /api/products
|--------------------------------------------------------------------------
| ADMIN only.
| Creates a product.
*/

router.post("/", protectAdmin, requireCsrf, async (req, res) => {
  try {
    const result = createProductSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid product information.",
        errors: formatValidationErrors(result.error.issues),
      });
    }

    const {
      name,
      slug,
      description,
      price,
      stock,
      imageUrl,
      categoryId,
      isActive,
    } = result.data;

    const existingProduct = await prisma.product.findUnique({
      where: {
        slug,
      },
    });

    if (existingProduct) {
      return res.status(409).json({
        success: false,
        code: "PRODUCT_ALREADY_EXISTS",
        message: "A product with that slug already exists.",
      });
    }

    if (categoryId) {
      const category = await prisma.category.findUnique({
        where: {
          id: categoryId,
        },
      });

      if (!category) {
        return res.status(400).json({
          success: false,
          message: "The selected category does not exist.",
        });
      }
    }

    const product = await prisma.$transaction(async (transaction) => {
      const createdProduct = await transaction.product.create({
        data: {
          name,
          slug,

          description: description || null,

          price,
          stock,

          imageUrl: imageUrl || null,

          categoryId: categoryId || null,

          isActive: isActive ?? true,
        },

        include: productInclude,
      });

      await writeSecurityAuditEvent({
        database: transaction,

        req,

        eventType: "PRODUCT_CREATED",

        outcome: "SUCCESS",

        resourceType: "PRODUCT",

        resourceId: createdProduct.id,

        metadata: {
          slug: createdProduct.slug,

          categoryId: createdProduct.categoryId,

          initialStock: createdProduct.stock,
        },
      });

      return createdProduct;
    });

    return res.status(201).json({
      success: true,
      message: "Product created successfully.",
      product,
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        success: false,
        code: "PRODUCT_ALREADY_EXISTS",
        message: "A product with that slug already exists.",
      });
    }

    console.error("Create product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create product.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| PATCH /api/products/admin/:id/stock
|--------------------------------------------------------------------------
|
| ADMIN only.
|
| Inventory has its own endpoint rather than being part of the generic
| product update route.
|
| expectedCurrentStock prevents a stale admin screen from overwriting
| inventory that changed during checkout.
*/

router.patch(
  "/admin/:id/stock",
  protectAdmin,
  requireCsrf,
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = updateStockSchema.safeParse(req.body);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid stock information.",
          errors: formatValidationErrors(result.error.issues),
        });
      }

      const { stock, expectedCurrentStock } = result.data;

      const existingProduct = await prisma.product.findUnique({
        where: {
          id,
        },

        select: {
          id: true,
          stock: true,
          slug: true,
        },
      });

      if (!existingProduct) {
        return res.status(404).json({
          success: false,
          message: "Product not found.",
        });
      }

      /*
       * Fast stale-state check.
       */
      if (existingProduct.stock !== expectedCurrentStock) {
        return res.status(409).json({
          success: false,
          code: "PRODUCT_STOCK_CHANGED",

          message:
            "Product stock changed since it was loaded. Refresh the product and try again.",

          currentStock: existingProduct.stock,
        });
      }

      const updatedProduct = await prisma.$transaction(async (transaction) => {
        /*
         * Compare-and-set.
         *
         * The update only succeeds if stock still equals the
         * value the administrator originally saw.
         */
        const updateResult = await transaction.product.updateMany({
          where: {
            id,
            stock: expectedCurrentStock,
          },

          data: {
            stock,
          },
        });

        if (updateResult.count !== 1) {
          const current = await transaction.product.findUnique({
            where: {
              id,
            },

            select: {
              stock: true,
            },
          });

          const conflict = new Error("Product stock changed concurrently.");

          conflict.code = "PRODUCT_STOCK_CHANGED";

          conflict.currentStock = current?.stock;

          throw conflict;
        }

        const product = await transaction.product.findUnique({
          where: {
            id,
          },

          include: productInclude,
        });

        await writeSecurityAuditEvent({
          database: transaction,

          req,

          eventType: "PRODUCT_STOCK_UPDATED",

          outcome: "SUCCESS",

          resourceType: "PRODUCT",

          resourceId: id,

          metadata: {
            previousStock: expectedCurrentStock,

            newStock: stock,

            difference: stock - expectedCurrentStock,
          },
        });

        return product;
      });

      return res.status(200).json({
        success: true,

        message: "Product stock updated successfully.",

        product: updatedProduct,
      });
    } catch (error) {
      if (error?.code === "PRODUCT_STOCK_CHANGED") {
        return res.status(409).json({
          success: false,

          code: "PRODUCT_STOCK_CHANGED",

          message:
            "Product stock changed while you were editing it. Refresh and try again.",

          currentStock: error.currentStock ?? null,
        });
      }

      console.error("Update product stock error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update product stock.",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| PATCH /api/products/:id
|--------------------------------------------------------------------------
|
| ADMIN only.
|
| Updates product information EXCEPT stock.
*/

router.patch("/:id", protectAdmin, requireCsrf, async (req, res) => {
  try {
    const { id } = req.params;

    const result = updateProductSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid product information.",
        errors: formatValidationErrors(result.error.issues),
      });
    }

    const existingProduct = await prisma.product.findUnique({
      where: {
        id,
      },
    });

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    if (result.data.slug) {
      const conflictingProduct = await prisma.product.findFirst({
        where: {
          slug: result.data.slug,

          id: {
            not: id,
          },
        },
      });

      if (conflictingProduct) {
        return res.status(409).json({
          success: false,
          code: "PRODUCT_SLUG_CONFLICT",

          message: "Another product already uses that slug.",
        });
      }
    }

    if (result.data.categoryId) {
      const category = await prisma.category.findUnique({
        where: {
          id: result.data.categoryId,
        },
      });

      if (!category) {
        return res.status(400).json({
          success: false,
          message: "The selected category does not exist.",
        });
      }
    }

    const updateData = {
      ...result.data,
    };

    /*
     * Normalize an intentionally cleared description.
     */
    if (updateData.description === "") {
      updateData.description = null;
    }

    const updatedProduct = await prisma.$transaction(async (transaction) => {
      const product = await transaction.product.update({
        where: {
          id,
        },

        data: updateData,

        include: productInclude,
      });

      await writeSecurityAuditEvent({
        database: transaction,

        req,

        eventType: "PRODUCT_UPDATED",

        outcome: "SUCCESS",

        resourceType: "PRODUCT",

        resourceId: product.id,

        metadata: {
          changedFields: Object.keys(updateData),
        },
      });

      return product;
    });

    return res.status(200).json({
      success: true,

      message: "Product updated successfully.",

      product: updatedProduct,
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        success: false,

        code: "PRODUCT_SLUG_CONFLICT",

        message: "Another product already uses that slug.",
      });
    }

    console.error("Update product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update product.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| DELETE /api/products/:id
|--------------------------------------------------------------------------
|
| Soft delete.
|
| Historical product/order relationships stay intact.
*/

router.delete("/:id", protectAdmin, requireCsrf, async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: {
        id,
      },
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    if (!product.isActive) {
      return res.status(400).json({
        success: false,
        message: "Product is already inactive.",
      });
    }

    const deactivatedProduct = await prisma.$transaction(
      async (transaction) => {
        const updatedProduct = await transaction.product.update({
          where: {
            id,
          },

          data: {
            isActive: false,
          },

          include: productInclude,
        });

        await writeSecurityAuditEvent({
          database: transaction,

          req,

          eventType: "PRODUCT_DEACTIVATED",

          outcome: "SUCCESS",

          resourceType: "PRODUCT",

          resourceId: updatedProduct.id,

          metadata: {
            slug: updatedProduct.slug,
          },
        });

        return updatedProduct;
      },
    );

    return res.status(200).json({
      success: true,

      message: "Product deactivated successfully.",

      product: deactivatedProduct,
    });
  } catch (error) {
    console.error("Deactivate product error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to deactivate product.",
    });
  }
});

export default router;
