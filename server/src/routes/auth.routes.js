import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomUUID } from "node:crypto";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";

import prisma from "../config/prisma.js";
import { protect, adminOnly } from "../middleware/auth.middleware.js";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_SECONDS,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
  getAuthCookieClearOptions,
  getAuthCookieOptions,
} from "../config/auth.config.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Login validation
|--------------------------------------------------------------------------
*/

const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "Email address is too long.")
      .email("Enter a valid email address."),

    password: z
      .string()
      .min(1, "Password is required.")
      .max(128, "Password is too long.")
      .refine(
        (password) => Buffer.byteLength(password, "utf8") <= 72,

        {
          message: "Password cannot exceed 72 bytes.",
        },
      ),
  })
  .strict();

const formatValidationErrors = (issues) =>
  issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

/*
|--------------------------------------------------------------------------
| Login throttling
|--------------------------------------------------------------------------
|
| We use two controls:
|
| 1. A broader IP limit.
| 2. A smaller limit for one IP/email combination.
|
| Successful logins are removed from the failed-attempt count.
*/

const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,

  handler: (req, res) => {
    return res.status(429).json({
      success: false,

      message: "Too many login attempts. Please wait before trying again.",
    });
  },
});

const getLoginAttemptKey = (req) => {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "missing-email";

  const emailHash = createHash("sha256").update(email).digest("hex");

  return `${ipKeyGenerator(req.ip)}:${emailHash}`;
};

const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: getLoginAttemptKey,

  handler: (req, res) => {
    return res.status(429).json({
      success: false,

      message: "Too many login attempts. Please wait before trying again.",
    });
  },
});

/*
 * A nonexistent account still performs a bcrypt comparison.
 *
 * This reduces the timing difference between:
 * - unknown email
 * - known email with wrong password
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-user-password", 10);

/*
|--------------------------------------------------------------------------
| JWT creation
|--------------------------------------------------------------------------
*/

const createToken = (userId) => {
  return jwt.sign(
    {
      tokenType: "access",
    },

    JWT_SECRET,

    {
      algorithm: JWT_ALGORITHM,

      subject: userId,

      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,

      expiresIn: AUTH_SESSION_SECONDS,

      jwtid: randomUUID(),
    },
  );
};

/*
|--------------------------------------------------------------------------
| POST /api/auth/login
|--------------------------------------------------------------------------
*/

router.post("/login", loginIpLimiter, loginAccountLimiter, async (req, res) => {
  try {
    const validationResult = loginSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,

        message: "Invalid login information.",

        errors: formatValidationErrors(validationResult.error.issues),
      });
    }

    const { email, password } = validationResult.data;

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    /*
     * Always perform a bcrypt comparison.
     *
     * Unknown accounts use the dummy hash so they do not
     * return substantially faster than valid accounts.
     */
    const passwordHash = user?.password || DUMMY_PASSWORD_HASH;

    const passwordMatches = await bcrypt.compare(password, passwordHash);

    if (!user || !passwordMatches) {
      return res.status(401).json({
        success: false,

        message: "Invalid email or password.",
      });
    }

    const token = createToken(user.id);

    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());

    return res.status(200).json({
      success: true,
      message: "Login successful.",

      session: {
        expiresInSeconds: AUTH_SESSION_SECONDS,
      },

      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Secure login error:", {
      name: error.name,
      code: error.code,
      message: error.message,
    });

    return res.status(500).json({
      success: false,

      message: "Login could not be completed safely.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| POST /api/auth/logout
|--------------------------------------------------------------------------
|
| This clears the browser cookie.
|
| Server-side token revocation will be added in the next authentication
| security step.
*/

router.post("/logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieClearOptions());

  return res.status(200).json({
    success: true,
    message: "Logout successful.",
  });
});

/*
|--------------------------------------------------------------------------
| GET /api/auth/me
|--------------------------------------------------------------------------
*/

router.get("/me", protect, (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
});

/*
|--------------------------------------------------------------------------
| GET /api/auth/admin-check
|--------------------------------------------------------------------------
*/

router.get("/admin-check", protect, adminOnly, (req, res) => {
  return res.status(200).json({
    success: true,

    message: "Admin access granted.",

    user: req.user,
  });
});

export default router;
