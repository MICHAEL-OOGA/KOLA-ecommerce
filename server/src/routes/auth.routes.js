import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomUUID } from "node:crypto";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";

import prisma from "../config/prisma.js";
import { protect, adminOnly } from "../middleware/auth.middleware.js";
import {
  createCsrfToken,
  requireCsrf,
  requireTrustedOrigin,
} from "../middleware/csrf.middleware.js";
import {
  AUTH_COOKIE_NAME,
  AUTH_MAX_ACTIVE_SESSIONS,
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
      .refine((password) => Buffer.byteLength(password, "utf8") <= 72, {
        message: "Password cannot exceed 72 bytes.",
      }),
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
 * Unknown accounts still perform a bcrypt comparison.
 * This reduces account-enumeration timing differences.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-user-password", 10);

/*
|--------------------------------------------------------------------------
| JWT creation
|--------------------------------------------------------------------------
|
| The JWT ID must be the same ID stored in AuthSession.
*/

const createToken = (userId, jwtId) => {
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
      jwtid: jwtId,
    },
  );
};

/*
|--------------------------------------------------------------------------
| Server-side session creation
|--------------------------------------------------------------------------
*/

const createAuthSession = async (userId) => {
  const currentTime = new Date();

  const expiresAt = new Date(
    currentTime.getTime() + AUTH_SESSION_SECONDS * 1000,
  );

  const jwtId = randomUUID();

  const session = await prisma.$transaction(
    async (transaction) => {
      const activeSessions = await transaction.authSession.findMany({
        where: {
          userId,
          revokedAt: null,

          expiresAt: {
            gt: currentTime,
          },
        },

        orderBy: {
          createdAt: "asc",
        },

        select: {
          id: true,
        },
      });

      /*
       * Revoke the oldest session or sessions when the
       * account has reached its active-session limit.
       */
      const sessionsToRevoke = Math.max(
        0,
        activeSessions.length - AUTH_MAX_ACTIVE_SESSIONS + 1,
      );

      if (sessionsToRevoke > 0) {
        const sessionIds = activeSessions
          .slice(0, sessionsToRevoke)
          .map((activeSession) => activeSession.id);

        await transaction.authSession.updateMany({
          where: {
            id: {
              in: sessionIds,
            },
            revokedAt: null,
          },

          data: {
            revokedAt: currentTime,

            revocationReason: "SESSION_LIMIT_REACHED",
          },
        });
      }

      return transaction.authSession.create({
        data: {
          userId,
          jwtId,
          expiresAt,
        },
      });
    },
    {
      isolationLevel: "Serializable",
    },
  );

  return session;
};

/*
|--------------------------------------------------------------------------
| POST /api/auth/login
|--------------------------------------------------------------------------
*/

router.post(
  "/login",
  requireTrustedOrigin,
  loginIpLimiter,
  loginAccountLimiter,
  async (req, res) => {
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

      const passwordHash = user?.password || DUMMY_PASSWORD_HASH;

      const passwordMatches = await bcrypt.compare(password, passwordHash);

      if (!user || !passwordMatches) {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password.",
        });
      }

      if (!user.emailVerifiedAt) {
        return res.status(403).json({
          success: false,
          code: "EMAIL_NOT_VERIFIED",

          message: "Please verify your email address before logging in.",
        });
      }

      /*
       * Create the database session first.
       */
      const session = await createAuthSession(user.id);

      /*
       * The token uses the same JWT ID stored in AuthSession.
       */
      const token = createToken(user.id, session.jwtId);

      const csrfToken = createCsrfToken({
        sessionId: session.id,

        userId: user.id,

        jwtId: session.jwtId,
      });

      res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());

      return res.status(200).json({
        success: true,
        message: "Login successful.",

        session: {
          expiresAt: session.expiresAt,

          expiresInSeconds: AUTH_SESSION_SECONDS,

          csrfToken,
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
  },
);

/*
|--------------------------------------------------------------------------
| GET /api/auth/csrf-token
|--------------------------------------------------------------------------
|
| Allows the frontend to retrieve its session-bound CSRF token
| after refreshing the page.
*/

router.get("/csrf-token", protect, (req, res) => {
  try {
    const csrfToken = createCsrfToken({
      sessionId: req.auth.sessionId,

      userId: req.user.id,

      jwtId: req.auth.jwtId,
    });

    res.set("Cache-Control", "no-store");

    return res.status(200).json({
      success: true,
      csrfToken,
    });
  } catch (error) {
    console.error("CSRF token generation error:", {
      name: error.name,
      message: error.message,
    });

    return res.status(500).json({
      success: false,
      message: "The CSRF token could not be generated safely.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| POST /api/auth/logout
|--------------------------------------------------------------------------
|
| Logout requires:
| - A valid authenticated session
| - A valid session-bound CSRF token
| - Database session revocation
*/

router.post("/logout", protect, requireCsrf, async (req, res) => {
  try {
    const revokedAt = new Date();

    await prisma.authSession.updateMany({
      where: {
        id: req.auth.sessionId,

        userId: req.user.id,

        revokedAt: null,
      },

      data: {
        revokedAt,

        revocationReason: "USER_LOGOUT",
      },
    });

    res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieClearOptions());

    return res.status(200).json({
      success: true,
      message: "Logout successful.",
    });
  } catch (error) {
    /*
     * Clear the browser cookie even if database revocation fails,
     * but do not claim that server-side revocation succeeded.
     */
    res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieClearOptions());

    console.error("Session revocation error:", {
      name: error.name,
      code: error.code,
      message: error.message,
    });

    return res.status(503).json({
      success: false,

      message:
        "Your local session was cleared, but server-side logout could not be confirmed.",
    });
  }
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

    session: {
      expiresAt: req.auth.expiresAt,
    },
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
