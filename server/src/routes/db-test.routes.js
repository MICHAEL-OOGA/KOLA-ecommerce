import express from "express";

import prisma from "../config/prisma.js";
import { protect, adminOnly } from "../middleware/auth.middleware.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Development-only database test
|--------------------------------------------------------------------------
|
| app.js must not mount this route in production.
*/

router.get("/", protect, adminOnly, async (req, res) => {
  try {
    /*
     * Perform a harmless database query.
     * Do not expose record counts or database details.
     */
    await prisma.user.count();

    return res.status(200).json({
      success: true,
      message: "Database connection is working.",
    });
  } catch (error) {
    console.error("Database test error:", {
      name: error.name,
      code: error.code,
      message: error.message,
    });

    return res.status(503).json({
      success: false,
      message: "Database connection is unavailable.",
    });
  }
});

export default router;
