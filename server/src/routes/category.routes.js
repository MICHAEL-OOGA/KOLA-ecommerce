import express from "express";
import { z } from "zod";
import prisma from "../config/prisma.js";
import { protect, adminOnly } from "../middleware/auth.middleware.js";
import { requireCsrf } from "../middleware/csrf.middleware.js";
const router = express.Router();

const createCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Category name must contain at least 2 characters.")
      .max(80, "Category name cannot exceed 80 characters."),

    slug: z
      .string()
      .trim()
      .min(2, "Slug must contain at least 2 characters.")
      .max(100, "Slug cannot exceed 100 characters.")
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug must contain lowercase letters, numbers, and hyphens only.",
      ),
  })
  .strict();

const updateCategorySchema = createCategorySchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  });

const formatValidationErrors = (issues) => {
  return issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
};

/**
 * GET /api/categories
 * Public route: anyone can view categories.
 */
router.get("/", async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: {
        name: "asc",
      },
      include: {
        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      count: categories.length,
      categories,
    });
  } catch (error) {
    console.error("Get categories error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve categories.",
    });
  }
});

/**
 * POST /api/categories
 * Protected route: only admins can create categories.
 */
router.post("/", protect, adminOnly, requireCsrf, async (req, res) => {
  try {
    const result = createCategorySchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid category information.",
        errors: formatValidationErrors(result.error.issues),
      });
    }

    const { name, slug } = result.data;

    const existingCategory = await prisma.category.findFirst({
      where: {
        OR: [{ name }, { slug }],
      },
    });

    if (existingCategory) {
      return res.status(409).json({
        success: false,
        message: "A category with that name or slug already exists.",
      });
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Category created successfully.",
      category,
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        success: false,
        code: "CATEGORY_CONFLICT",

        message: "A category with that name or slug already exists.",
      });
    }
    console.error("Create category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create category.",
    });
  }
});

/**
 * PATCH /api/categories/:id
 * Protected route: only admins can edit categories.
 */
router.patch("/:id", protect, adminOnly, requireCsrf, async (req, res) => {
  try {
    const { id } = req.params;

    const result = updateCategorySchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid category information.",
        errors: formatValidationErrors(result.error.issues),
      });
    }

    const category = await prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found.",
      });
    }

    const conflictChecks = [];

    if (result.data.name) {
      conflictChecks.push({ name: result.data.name });
    }

    if (result.data.slug) {
      conflictChecks.push({ slug: result.data.slug });
    }

    if (conflictChecks.length > 0) {
      const conflictingCategory = await prisma.category.findFirst({
        where: {
          id: {
            not: id,
          },
          OR: conflictChecks,
        },
      });

      if (conflictingCategory) {
        return res.status(409).json({
          success: false,
          message: "Another category already uses that name or slug.",
        });
      }
    }

    const updatedCategory = await prisma.category.update({
      where: { id },
      data: result.data,
    });

    return res.status(200).json({
      success: true,
      message: "Category updated successfully.",
      category: updatedCategory,
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        success: false,
        code: "CATEGORY_CONFLICT",

        message: "A category with that name or slug already exists.",
      });
    }
    console.error("Update category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update category.",
    });
  }
});

/**
 * DELETE /api/categories/:id
 * Protected route: only admins can delete categories.
 */
router.delete("/:id", protect, adminOnly, requireCsrf, async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.category.findUnique({
      where: {
        id,
      },

      select: {
        id: true,
        name: true,

        _count: {
          select: {
            products: true,
          },
        },
      },
    });

    if (!category) {
      if (category._count.products > 0) {
        return res.status(409).json({
          success: false,
          code: "CATEGORY_NOT_EMPTY",

          message:
            "This category cannot be deleted while products are assigned to it.",
        });
      }
      return res.status(404).json({
        success: false,
        message: "Category not found.",
      });
    }

    await prisma.category.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: "Category deleted successfully.",
    });
  } catch (error) {
    console.error("Delete category error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete category.",
    });
  }
});

export default router;
