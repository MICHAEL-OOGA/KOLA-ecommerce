import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { createHash, randomUUID } from "node:crypto";

import { rateLimit, ipKeyGenerator } from "express-rate-limit";

import { z } from "zod";

import prisma from "../config/prisma.js";

import { protectAdmin } from "../middleware/auth.middleware.js";

import {
  createCsrfToken,
  requireCsrf,
  requireTrustedOrigin,
} from "../middleware/csrf.middleware.js";

import {
  ADMIN_AUTH_COOKIE_NAME,
  AUTH_MAX_ACTIVE_SESSIONS,
  AUTH_SESSION_SECONDS,
  AUTH_SESSION_TYPES,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
  getAdminAuthCookieClearOptions,
  getAdminAuthCookieOptions,
} from "../config/auth.config.js";

import { recordSecurityAuditEvent } from "../services/security-audit.service.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Validation
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
| Admin login rate limits
|--------------------------------------------------------------------------
*/

const adminLoginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: 20,

  standardHeaders: true,
  legacyHeaders: false,

  skipSuccessfulRequests: true,

  handler: (req, res) =>
    res.status(429).json({
      success: false,

      message:
        "Too many administrator login attempts. Please wait before trying again.",
    }),
});

const getAdminLoginAttemptKey = (req) => {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "missing-email";

  const emailHash = createHash("sha256").update(email).digest("hex");

  return `${ipKeyGenerator(req.ip)}:${emailHash}`;
};

const adminLoginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: 5,

  standardHeaders: true,
  legacyHeaders: false,

  skipSuccessfulRequests: true,

  keyGenerator: getAdminLoginAttemptKey,

  handler: (req, res) =>
    res.status(429).json({
      success: false,

      message:
        "Too many administrator login attempts. Please wait before trying again.",
    }),
});

/*
 * Unknown/non-admin accounts still perform password comparison.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-admin-password", 10);

/*
|--------------------------------------------------------------------------
| Admin JWT
|--------------------------------------------------------------------------
*/

const createAdminToken = (userId, jwtId) => {
  return jwt.sign(
    {
      tokenType: "access",

      sessionType: AUTH_SESSION_TYPES.ADMIN,
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
| Admin database session
|--------------------------------------------------------------------------
*/

const createAdminAuthSession = async (userId) => {
  const currentTime = new Date();

  const expiresAt = new Date(
    currentTime.getTime() + AUTH_SESSION_SECONDS * 1000,
  );

  const jwtId = randomUUID();

  return prisma.$transaction(
    async (transaction) => {
      const activeSessions = await transaction.authSession.findMany({
        where: {
          userId,

          sessionType: AUTH_SESSION_TYPES.ADMIN,

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

      const sessionsToRevoke = Math.max(
        0,

        activeSessions.length - AUTH_MAX_ACTIVE_SESSIONS + 1,
      );

      if (sessionsToRevoke > 0) {
        const sessionIds = activeSessions
          .slice(0, sessionsToRevoke)
          .map((session) => session.id);

        await transaction.authSession.updateMany({
          where: {
            id: {
              in: sessionIds,
            },

            sessionType: AUTH_SESSION_TYPES.ADMIN,

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

          sessionType: AUTH_SESSION_TYPES.ADMIN,

          expiresAt,
        },
      });
    },

    {
      isolationLevel: "Serializable",
    },
  );
};

/*
|--------------------------------------------------------------------------
| POST /api/admin/auth/login
|--------------------------------------------------------------------------
*/

router.post(
  "/login",

  requireTrustedOrigin,

  adminLoginIpLimiter,
  adminLoginAccountLimiter,

  async (req, res) => {
    try {
      const validationResult = loginSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid administrator login information.",

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

      /*
       * Do not reveal whether:
       *
       * - account does not exist
       * - password is wrong
       * - account exists but is not ADMIN
       */
      if (!user || !passwordMatches || user.role !== "ADMIN") {
        await recordSecurityAuditEvent({
          req,

          eventType: "ADMIN_LOGIN_FAILED",

          outcome: "FAILURE",

          identifier: email,

          resourceType: "AUTHENTICATION",
        });

        return res.status(401).json({
          success: false,

          message: "Invalid administrator credentials.",
        });
      }

      if (!user.emailVerifiedAt) {
        await recordSecurityAuditEvent({
          req,

          eventType: "ADMIN_LOGIN_DENIED_UNVERIFIED",

          outcome: "DENIED",

          userId: user.id,

          actorRole: user.role,

          identifier: email,

          resourceType: "USER",

          resourceId: user.id,
        });

        return res.status(403).json({
          success: false,

          code: "EMAIL_NOT_VERIFIED",

          message:
            "Please verify your email address before accessing administration.",
        });
      }

      /*
       * Only after role and verification checks pass
       * may an ADMIN session be created.
       */
      const session = await createAdminAuthSession(user.id);

      const token = createAdminToken(user.id, session.jwtId);

      const csrfToken = createCsrfToken({
        sessionId: session.id,

        userId: user.id,

        jwtId: session.jwtId,
      });

      res.cookie(
        ADMIN_AUTH_COOKIE_NAME,

        token,

        getAdminAuthCookieOptions(),
      );

      await recordSecurityAuditEvent({
        req,

        eventType: "ADMIN_LOGIN_SUCCESS",

        outcome: "SUCCESS",

        userId: user.id,

        actorRole: user.role,

        identifier: email,

        resourceType: "AUTH_SESSION",

        resourceId: session.id,

        metadata: {
          sessionType: AUTH_SESSION_TYPES.ADMIN,
        },
      });

      return res.status(200).json({
        success: true,

        message: "Administrator login successful.",

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
      console.error("Secure administrator login error:", {
        requestId: req.id,

        name: error?.name,

        code: error?.code,

        message: error?.message,
      });

      return res.status(500).json({
        success: false,

        message: "Administrator login could not be completed safely.",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| GET /api/admin/auth/csrf-token
|--------------------------------------------------------------------------
*/

router.get("/csrf-token", protectAdmin, (req, res) => {
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
    console.error("Admin CSRF token generation error:", {
      requestId: req.id,

      name: error?.name,

      message: error?.message,
    });

    return res.status(500).json({
      success: false,

      message: "The administrator CSRF token could not be generated safely.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/admin/auth/me
|--------------------------------------------------------------------------
*/

router.get("/me", protectAdmin, (req, res) => {
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
| POST /api/admin/auth/logout
|--------------------------------------------------------------------------
*/

router.post(
  "/logout",

  protectAdmin,

  requireCsrf,

  async (req, res) => {
    try {
      const revokedAt = new Date();

      await prisma.authSession.updateMany({
        where: {
          id: req.auth.sessionId,

          userId: req.user.id,

          sessionType: AUTH_SESSION_TYPES.ADMIN,

          revokedAt: null,
        },

        data: {
          revokedAt,

          revocationReason: "USER_LOGOUT",
        },
      });

      await recordSecurityAuditEvent({
        req,

        eventType: "ADMIN_LOGOUT_SUCCESS",

        outcome: "SUCCESS",

        userId: req.user.id,

        actorRole: req.user.role,

        resourceType: "AUTH_SESSION",

        resourceId: req.auth.sessionId,

        metadata: {
          reason: "USER_LOGOUT",

          sessionType: AUTH_SESSION_TYPES.ADMIN,
        },
      });

      res.clearCookie(
        ADMIN_AUTH_COOKIE_NAME,

        getAdminAuthCookieClearOptions(),
      );

      return res.status(200).json({
        success: true,

        message: "Administrator logout successful.",
      });
    } catch (error) {
      res.clearCookie(
        ADMIN_AUTH_COOKIE_NAME,

        getAdminAuthCookieClearOptions(),
      );

      console.error("Administrator session revocation error:", {
        requestId: req.id,

        name: error?.name,

        code: error?.code,

        message: error?.message,
      });

      return res.status(503).json({
        success: false,

        message:
          "Your local administrator session was cleared, but server-side logout could not be confirmed.",
      });
    }
  },
);

export default router;
