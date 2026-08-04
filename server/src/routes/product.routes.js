import express from "express";
import { z } from "zod";
import prisma from "../config/prisma.js";
import { protect, adminOnly } from "../middleware/auth.middleware.js";
import { requireCsrf } from "../middleware/csrf.middleware.js";
const router = express.Router();

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

const updateProductSchema = createProductSchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

/*
|--------------------------------------------------------------------------
| GET /api/products
|--------------------------------------------------------------------------
| Public route.
| Only shows products that are currently active.
*/

router.get("/", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
      },

      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },

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
| Admin route.
| Shows both active and inactive products.
|
| Important: keep this route above /:id so Express does not interpret
| "admin" as a product ID.
*/

router.get("/admin/all", protect, adminOnly, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },

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
    console.error("Get admin products error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve admin products.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/products/:id
|--------------------------------------------------------------------------
| Public route.
| Retrieves one active product using its database ID.
*/

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findFirst({
      where: {
        id,
        isActive: true,
      },

      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
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
| Admin route.
| Creates a new product.
*/

router.post("/", protect, adminOnly, requireCsrf, async (req, res) => {
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

    /*
     * Check whether another product already uses this slug.
     */
    const existingProduct = await prisma.product.findUnique({
      where: {
        slug,
      },
    });

    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message: "A product with that slug already exists.",
      });
    }

    /*
     * If a category ID was supplied, verify that the category exists.
     */
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

    const product = await prisma.product.create({
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

      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
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
| PATCH /api/products/:id
|--------------------------------------------------------------------------
| Admin route.
| Updates one or more product fields.
*/

router.patch("/:id", protect, adminOnly, requireCsrf, async (req, res) => {
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

    /*
     * If the slug is changing, make sure another product does not use it.
     */
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
          message: "Another product already uses that slug.",
        });
      }
    }

    /*
     * If categoryId is being updated, verify that the category exists.
     * A null categoryId is allowed because products can be uncategorized.
     */
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

    const updatedProduct = await prisma.product.update({
      where: {
        id,
      },

      data: result.data,

      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
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
| Admin route.
| This does a soft delete by setting isActive to false.
|
| We do not permanently delete the database record because an existing
| order may refer to this product. Keeping the product preserves order
| history.
*/

router.delete("/:id", protect, adminOnly, requireCsrf, async (req, res) => {
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

    const deactivatedProduct = await prisma.product.update({
      where: {
        id,
      },

      data: {
        isActive: false,
      },
    });

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
