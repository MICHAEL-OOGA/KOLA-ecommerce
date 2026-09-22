import express from "express";
import bcrypt from "bcryptjs";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { rateLimit, ipKeyGenerator } from "express-rate-limit";

import { z } from "zod";

import prisma from "../config/prisma.js";

import { requireTrustedOrigin } from "../middleware/csrf.middleware.js";

import {
  AUTH_COOKIE_NAME,
  PASSWORD_RESET_DEV_EXPOSE_TOKEN,
  PASSWORD_RESET_MINUTES,
  PASSWORD_RESET_SECRET,
  getAuthCookieClearOptions,
} from "../config/auth.config.js";

import {
  recordSecurityAuditEvent,
  writeSecurityAuditEvent,
} from "../services/security-audit.service.js";

import { sendPasswordResetEmail } from "../services/email.service.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Validation
|--------------------------------------------------------------------------
*/

const passwordSchema = z
  .string()
  .min(12, "Password must contain at least 12 characters.")
  .max(128, "Password is too long.")
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72, {
    message: "Password cannot exceed 72 bytes.",
  })
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/\d/, "Password must contain a number.")
  .regex(/[^A-Za-z0-9]/, "Password must contain a special character.");

const forgotPasswordSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "Email address is too long.")
      .email("Enter a valid email address."),
  })
  .strict();

const resetPasswordSchema = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/i, "The password-reset token is invalid.")
      .transform((token) => token.toLowerCase()),

    password: passwordSchema,

    confirmPassword: z.string(),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Password confirmation does not match.",
  });

const formatValidationErrors = (issues) =>
  issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

/*
|--------------------------------------------------------------------------
| Rate limiting
|--------------------------------------------------------------------------
*/

const forgotPasswordIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),

  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: "Too many password-reset requests. Please try again later.",
    });
  },
});

const getEmailRateLimitKey = (req) => {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "missing-email";

  return createHash("sha256").update(email).digest("hex");
};

const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getEmailRateLimitKey,

  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: "Too many password-reset requests. Please try again later.",
    });
  },
});

const resetPasswordIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),

  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: "Too many password-reset attempts. Please try again later.",
    });
  },
});

const getResetTokenRateLimitKey = (req) => {
  const token =
    typeof req.body?.token === "string"
      ? req.body.token.trim()
      : "missing-token";

  return createHash("sha256").update(token).digest("hex");
};

const resetPasswordTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getResetTokenRateLimitKey,

  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      message: "Too many password-reset attempts. Please try again later.",
    });
  },
});

/*
|--------------------------------------------------------------------------
| Token helpers
|--------------------------------------------------------------------------
*/

const createRawResetToken = () => randomBytes(32).toString("hex");

const createSensitiveHash = (namespace, value) => {
  return createHmac("sha256", PASSWORD_RESET_SECRET)
    .update(`${namespace}:${value}`)
    .digest("hex");
};

const hashResetToken = (token) =>
  createSensitiveHash("password-reset-token", token);

const hashRequestIp = (requestIp) => {
  if (typeof requestIp !== "string" || !requestIp) {
    return null;
  }

  return createSensitiveHash("password-reset-ip", requestIp);
};

const createPasswordResetUrl = (rawToken) => {
  const configuredUrl = process.env.PASSWORD_RESET_CLIENT_URL?.trim();

  if (!configuredUrl) {
    throw new Error("PASSWORD_RESET_CLIENT_URL is required.");
  }

  let resetUrl;

  try {
    resetUrl = new URL(configuredUrl);
  } catch {
    throw new Error("PASSWORD_RESET_CLIENT_URL must be a valid URL.");
  }

  if (!["http:", "https:"].includes(resetUrl.protocol)) {
    throw new Error(
      "PASSWORD_RESET_CLIENT_URL must use the HTTP or HTTPS protocol.",
    );
  }

  if (process.env.NODE_ENV === "production" && resetUrl.protocol !== "https:") {
    throw new Error("PASSWORD_RESET_CLIENT_URL must use HTTPS in production.");
  }

  resetUrl.pathname = "/reset-password";
  resetUrl.search = "";
  resetUrl.hash = new URLSearchParams({
    token: rawToken,
  }).toString();

  return resetUrl.toString();
};

/*
|--------------------------------------------------------------------------
| Transaction retry
|--------------------------------------------------------------------------
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
      const shouldRetry =
        error?.code === "P2034" && attemptNumber < maximumAttempts;

      if (!shouldRetry) {
        throw error;
      }
    }
  }
};

class InvalidResetTokenError extends Error {
  constructor() {
    super("The password-reset token is invalid or expired.");

    this.name = "InvalidResetTokenError";
  }
}

/*
 * Run the same bcrypt operation for every forgot-password request.
 * This helps reduce obvious timing differences between existing and
 * nonexistent email addresses.
 */
const DUMMY_RESET_PASSWORD_HASH = bcrypt.hashSync(
  "not-a-real-password-reset-account",
  10,
);

const GENERIC_FORGOT_RESPONSE = {
  success: true,

  message:
    "If an account exists for that email address, password-reset instructions will be sent.",
};

/*
|--------------------------------------------------------------------------
| POST /api/auth/forgot-password
|--------------------------------------------------------------------------
*/

router.post(
  "/forgot-password",
  requireTrustedOrigin,
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,

  async (req, res) => {
    try {
      const validationResult = forgotPasswordSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid password-reset request.",

          errors: formatValidationErrors(validationResult.error.issues),
        });
      }

      const { email } = validationResult.data;

      await bcrypt.compare(
        "password-reset-timing-check",
        DUMMY_RESET_PASSWORD_HASH,
      );

      const user = await prisma.user.findUnique({
        where: {
          email,
        },

        select: {
          id: true,
          email: true,
        },
      });

      let developmentResetToken = null;

      if (user) {
        const currentTime = new Date();

        const expiresAt = new Date(
          currentTime.getTime() + PASSWORD_RESET_MINUTES * 60 * 1000,
        );

        const rawToken = createRawResetToken();

        const tokenHash = hashResetToken(rawToken);

        await runSerializableTransactionWithRetry(async (transaction) => {
          /*
           * Issuing a new token invalidates every previous unused token.
           */
          await transaction.passwordResetToken.updateMany({
            where: {
              userId: user.id,
              usedAt: null,
            },

            data: {
              usedAt: currentTime,
            },
          });

          await transaction.passwordResetToken.create({
            data: {
              userId: user.id,
              tokenHash,
              expiresAt,
              requestedIpHash: hashRequestIp(req.ip),
            },
          });
        });

        const resetUrl = createPasswordResetUrl(rawToken);

        try {
          await sendPasswordResetEmail({
            to: user.email,
            resetUrl,
            expiresInMinutes: PASSWORD_RESET_MINUTES,
          });
        } catch (emailError) {
          /*
           * Keep the public response generic so delivery problems cannot be
           * used to determine whether an account exists.
           */
          console.error("Password-reset email delivery failed:", {
            requestId: req.id,
            name: emailError.name,
            message: emailError.message,
          });

          await recordSecurityAuditEvent({
            req,
            eventType: "PASSWORD_RESET_EMAIL_FAILED",
            outcome: "FAILURE",
            userId: user.id,
            identifier: email,
            resourceType: "PASSWORD_RESET",
          });
        }

        if (PASSWORD_RESET_DEV_EXPOSE_TOKEN) {
          developmentResetToken = rawToken;
        }
      }

      const response = {
        ...GENERIC_FORGOT_RESPONSE,
      };

      if (PASSWORD_RESET_DEV_EXPOSE_TOKEN && developmentResetToken) {
        response.developmentOnly = true;
        response.developmentResetToken = developmentResetToken;
        response.expiresInMinutes = PASSWORD_RESET_MINUTES;
      }

      await recordSecurityAuditEvent({
        req,
        eventType: "PASSWORD_RESET_REQUESTED",
        outcome: "SUCCESS",
        identifier: email,
        resourceType: "PASSWORD_RESET",
      });

      return res.status(200).json(response);
    } catch (error) {
      console.error("Forgot-password error:", {
        requestId: req.id,
        name: error.name,
        code: error.code,
        message: error.message,
      });

      return res.status(500).json({
        success: false,
        message: "The password-reset request could not be processed safely.",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| POST /api/auth/reset-password
|--------------------------------------------------------------------------
*/

router.post(
  "/reset-password",
  requireTrustedOrigin,
  resetPasswordIpLimiter,
  resetPasswordTokenLimiter,

  async (req, res) => {
    try {
      const validationResult = resetPasswordSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid password-reset information.",

          errors: formatValidationErrors(validationResult.error.issues),
        });
      }

      const { token, password } = validationResult.data;

      const tokenHash = hashResetToken(token);

      /*
       * Hash before opening the database transaction.
       */
      const passwordHash = await bcrypt.hash(password, 12);

      const currentTime = new Date();

      await runSerializableTransactionWithRetry(async (transaction) => {
        const resetToken = await transaction.passwordResetToken.findUnique({
          where: {
            tokenHash,
          },

          select: {
            id: true,
            userId: true,
            expiresAt: true,
            usedAt: true,
          },
        });

        if (
          !resetToken ||
          resetToken.usedAt ||
          resetToken.expiresAt <= currentTime
        ) {
          throw new InvalidResetTokenError();
        }

        /*
         * Atomically claim the token. Only one simultaneous reset request may
         * change usedAt from null.
         */
        const claimedToken = await transaction.passwordResetToken.updateMany({
          where: {
            id: resetToken.id,
            usedAt: null,

            expiresAt: {
              gt: currentTime,
            },
          },

          data: {
            usedAt: currentTime,
          },
        });

        if (claimedToken.count !== 1) {
          throw new InvalidResetTokenError();
        }

        await transaction.user.update({
          where: {
            id: resetToken.userId,
          },

          data: {
            password: passwordHash,
          },
        });

        /*
         * A password reset invalidates every active authenticated session.
         */
        await transaction.authSession.updateMany({
          where: {
            userId: resetToken.userId,
            revokedAt: null,
          },

          data: {
            revokedAt: currentTime,
            revocationReason: "PASSWORD_RESET",
          },
        });

        /*
         * Invalidate every other unused reset token for this account.
         */
        await transaction.passwordResetToken.updateMany({
          where: {
            userId: resetToken.userId,

            id: {
              not: resetToken.id,
            },

            usedAt: null,
          },

          data: {
            usedAt: currentTime,
          },
        });

        /*
         * Keep the password update, session revocation and success audit event
         * inside the same serializable transaction.
         *
         * This also fixes the previous out-of-scope transaction/resetToken bug.
         */
        await writeSecurityAuditEvent({
          database: transaction,
          req,
          eventType: "PASSWORD_RESET_SUCCESS",
          outcome: "SUCCESS",
          userId: resetToken.userId,
          resourceType: "USER",
          resourceId: resetToken.userId,

          metadata: {
            activeSessionsRevoked: true,
          },
        });
      });

      /*
       * Remove any authentication cookie currently held by this browser.
       */
      res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieClearOptions());

      return res.status(200).json({
        success: true,

        message:
          "Your password has been reset successfully. Please log in using your new password.",
      });
    } catch (error) {
      if (error instanceof InvalidResetTokenError) {
        await recordSecurityAuditEvent({
          req,
          eventType: "PASSWORD_RESET_FAILED",
          outcome: "FAILURE",
          resourceType: "PASSWORD_RESET",
        });

        return res.status(400).json({
          success: false,
          code: "INVALID_OR_EXPIRED_RESET_TOKEN",
          message: "The password-reset token is invalid or expired.",
        });
      }

      console.error("Reset-password error:", {
        requestId: req.id,
        name: error.name,
        code: error.code,
        message: error.message,
      });

      return res.status(500).json({
        success: false,
        message: "The password could not be reset safely.",
      });
    }
  },
);

export default router;
