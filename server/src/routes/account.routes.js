import express from "express";
import bcrypt from "bcryptjs";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { rateLimit, ipKeyGenerator } from "express-rate-limit";

import { z } from "zod";

import prisma from "../config/prisma.js";

import { requireTrustedOrigin } from "../middleware/csrf.middleware.js";

import {
  EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN,
  EMAIL_VERIFICATION_MINUTES,
  EMAIL_VERIFICATION_SECRET,
} from "../config/auth.config.js";

import {
  recordSecurityAuditEvent,
  writeSecurityAuditEvent,
} from "../services/security-audit.service.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Disposable-email screening
|--------------------------------------------------------------------------
|
| This list is an additional filter, not a replacement for verification.
| New disposable-email services appear frequently.
*/

const builtInDisposableDomains = [
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "yopmail.com",
  "10minutemail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "fakeinbox.com",
  "getnada.com",
  "dispostable.com",
];

const configuredDisposableDomains =
  process.env.DISPOSABLE_EMAIL_DOMAINS?.split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean) || [];

const disposableEmailDomains = new Set([
  ...builtInDisposableDomains,
  ...configuredDisposableDomains,
]);

const isDisposableEmail = (email) => {
  const domain = email.split("@").pop()?.toLowerCase();

  if (!domain) {
    return true;
  }

  for (const blockedDomain of disposableEmailDomains) {
    if (domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)) {
      return true;
    }
  }

  return false;
};

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

const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Full name must contain at least 2 characters.")
      .max(100, "Full name cannot exceed 100 characters.")
      .transform((name) => name.replace(/\s+/g, " ")),

    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "Email address is too long.")
      .email("Enter a valid email address."),

    phone: z
      .string()
      .trim()
      .regex(
        /^\+?[1-9]\d{7,14}$/,
        "Phone number must use an international format such as +254712345678.",
      )
      .transform((phone) => (phone.startsWith("+") ? phone : `+${phone}`))
      .optional()
      .nullable(),

    password: passwordSchema,

    confirmPassword: z.string(),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],

    message: "Password confirmation does not match.",
  });

const verificationTokenSchema = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/i, "The email-verification token is invalid.")
      .transform((token) => token.toLowerCase()),
  })
  .strict();

const resendVerificationSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "Email address is too long.")
      .email("Enter a valid email address."),
  })
  .strict();

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

const registerIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,

  max: 10,

  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req) => ipKeyGenerator(req.ip),

  handler: (req, res) =>
    res.status(429).json({
      success: false,

      message: "Too many registration attempts. Please try again later.",
    }),
});

const getEmailHash = (req) => {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "missing-email";

  return createHash("sha256").update(email).digest("hex");
};

const registerEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,

  max: 3,

  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: getEmailHash,

  handler: (req, res) =>
    res.status(429).json({
      success: false,

      message: "Too many registration attempts. Please try again later.",
    }),
});

const verificationIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: 20,

  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req) => ipKeyGenerator(req.ip),

  handler: (req, res) =>
    res.status(429).json({
      success: false,

      message: "Too many email-verification attempts. Please try again later.",
    }),
});

const resendIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,

  max: 10,

  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: (req) => ipKeyGenerator(req.ip),

  handler: (req, res) =>
    res.status(429).json({
      success: false,

      message: "Too many verification requests. Please try again later.",
    }),
});

const resendEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,

  max: 3,

  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: getEmailHash,

  handler: (req, res) =>
    res.status(429).json({
      success: false,

      message: "Too many verification requests. Please try again later.",
    }),
});

/*
|--------------------------------------------------------------------------
| Token helpers
|--------------------------------------------------------------------------
*/

const createRawVerificationToken = () => randomBytes(32).toString("hex");

const createSensitiveHash = (namespace, value) =>
  createHmac("sha256", EMAIL_VERIFICATION_SECRET)
    .update(`${namespace}:${value}`)
    .digest("hex");

const hashVerificationToken = (token) =>
  createSensitiveHash("email-verification-token", token);

const hashRequestIp = (requestIp) => {
  if (typeof requestIp !== "string" || !requestIp) {
    return null;
  }

  return createSensitiveHash("email-verification-ip", requestIp);
};

const createVerificationTokenRecord = async ({
  transaction,
  userId,
  requestIp,
  currentTime,
}) => {
  const rawToken = createRawVerificationToken();

  const expiresAt = new Date(
    currentTime.getTime() + EMAIL_VERIFICATION_MINUTES * 60 * 1000,
  );

  await transaction.emailVerificationToken.updateMany({
    where: {
      userId,
      usedAt: null,
    },

    data: {
      usedAt: currentTime,
    },
  });

  await transaction.emailVerificationToken.create({
    data: {
      userId,

      tokenHash: hashVerificationToken(rawToken),

      expiresAt,

      requestedIpHash: hashRequestIp(requestIp),
    },
  });

  return rawToken;
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

class InvalidVerificationTokenError extends Error {
  constructor() {
    super("The email-verification token is invalid or expired.");

    this.name = "InvalidVerificationTokenError";
  }
}

const GENERIC_REGISTRATION_RESPONSE = {
  success: true,

  message:
    "If this email address can be registered, verification instructions will be sent.",
};

const GENERIC_RESEND_RESPONSE = {
  success: true,

  message:
    "If an unverified account exists for that email address, verification instructions will be sent.",
};

/*
|--------------------------------------------------------------------------
| POST /api/auth/register
|--------------------------------------------------------------------------
*/

router.post(
  "/register",
  requireTrustedOrigin,
  registerIpLimiter,
  registerEmailLimiter,
  async (req, res) => {
    try {
      const validationResult = registerSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid registration information.",

          errors: formatValidationErrors(validationResult.error.issues),
        });
      }

      const { fullName, email, phone, password } = validationResult.data;

      if (isDisposableEmail(email)) {
        await recordSecurityAuditEvent({
          req,

          eventType: "REGISTRATION_DENIED_DISPOSABLE_EMAIL",

          outcome: "DENIED",

          identifier: email,

          resourceType: "REGISTRATION",
        });
        return res.status(400).json({
          success: false,

          code: "DISPOSABLE_EMAIL_NOT_ALLOWED",

          message: "Temporary or disposable email addresses cannot be used.",
        });
      }

      /*
       * Hash before entering the transaction so the transaction
       * does not remain open during expensive bcrypt work.
       */
      const passwordHash = await bcrypt.hash(password, 12);

      const currentTime = new Date();

      let developmentToken = null;

      try {
        const result = await runSerializableTransactionWithRetry(
          async (transaction) => {
            const existingUser = await transaction.user.findUnique({
              where: {
                email,
              },

              select: {
                id: true,
              },
            });

            if (existingUser) {
              return {
                created: false,
              };
            }

            const user = await transaction.user.create({
              data: {
                fullName,
                email,

                phone: phone || null,

                password: passwordHash,

                /*
                 * Never accept role from the browser.
                 */
                role: "CUSTOMER",

                emailVerifiedAt: null,
              },

              select: {
                id: true,
              },
            });

            const rawToken = await createVerificationTokenRecord({
              transaction,

              userId: user.id,

              requestIp: req.ip,

              currentTime,
            });

            await writeSecurityAuditEvent({
              database: transaction,

              req,

              eventType: "USER_REGISTERED",

              outcome: "SUCCESS",

              userId: user.id,

              actorRole: "CUSTOMER",

              identifier: email,

              resourceType: "USER",

              resourceId: user.id,
            });

            return {
              created: true,

              rawToken,
            };
          },
        );

        if (result.created && EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN) {
          developmentToken = result.rawToken;
        }
      } catch (error) {
        /*
         * A simultaneous request may win the unique-email race.
         * Return the same generic response instead of exposing it.
         */
        if (error?.code !== "P2002") {
          throw error;
        }
      }

      const response = {
        ...GENERIC_REGISTRATION_RESPONSE,
      };

      if (EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN && developmentToken) {
        response.developmentOnly = true;

        response.developmentVerificationToken = developmentToken;

        response.expiresInMinutes = EMAIL_VERIFICATION_MINUTES;
      }

      return res.status(200).json(response);
    } catch (error) {
      console.error("Registration error:", {
        requestId: req.id,

        name: error.name,

        code: error.code,

        message: error.message,
      });

      return res.status(500).json({
        success: false,

        message: "Registration could not be completed safely.",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| POST /api/auth/verify-email
|--------------------------------------------------------------------------
*/

router.post(
  "/verify-email",
  requireTrustedOrigin,
  verificationIpLimiter,
  async (req, res) => {
    try {
      const validationResult = verificationTokenSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid email-verification information.",

          errors: formatValidationErrors(validationResult.error.issues),
        });
      }

      const { token } = validationResult.data;

      const tokenHash = hashVerificationToken(token);

      const currentTime = new Date();

      await runSerializableTransactionWithRetry(async (transaction) => {
        const verificationToken =
          await transaction.emailVerificationToken.findUnique({
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
          !verificationToken ||
          verificationToken.usedAt ||
          verificationToken.expiresAt <= currentTime
        ) {
          throw new InvalidVerificationTokenError();
        }

        const claimedToken =
          await transaction.emailVerificationToken.updateMany({
            where: {
              id: verificationToken.id,

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
          throw new InvalidVerificationTokenError();
        }

        await transaction.user.update({
          where: {
            id: verificationToken.userId,
          },

          data: {
            emailVerifiedAt: currentTime,
          },
        });

        await writeSecurityAuditEvent({
          database: transaction,

          req,

          eventType: "EMAIL_VERIFIED",

          outcome: "SUCCESS",

          userId: verificationToken.userId,

          resourceType: "USER",

          resourceId: verificationToken.userId,
        });

        await transaction.emailVerificationToken.updateMany({
          where: {
            userId: verificationToken.userId,

            id: {
              not: verificationToken.id,
            },

            usedAt: null,
          },

          data: {
            usedAt: currentTime,
          },
        });
      });

      return res.status(200).json({
        success: true,

        message: "Email address verified successfully. You can now log in.",
      });
    } catch (error) {
      if (error instanceof InvalidVerificationTokenError) {
        return res.status(400).json({
          success: false,

          code: "INVALID_OR_EXPIRED_VERIFICATION_TOKEN",

          message: "The email-verification token is invalid or expired.",
        });
      }

      console.error("Email verification error:", {
        requestId: req.id,

        name: error.name,

        code: error.code,

        message: error.message,
      });

      return res.status(500).json({
        success: false,

        message: "Email verification could not be completed safely.",
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| POST /api/auth/resend-verification
|--------------------------------------------------------------------------
*/

router.post(
  "/resend-verification",
  requireTrustedOrigin,
  resendIpLimiter,
  resendEmailLimiter,
  async (req, res) => {
    try {
      const validationResult = resendVerificationSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid verification request.",

          errors: formatValidationErrors(validationResult.error.issues),
        });
      }

      const { email } = validationResult.data;

      const user = await prisma.user.findUnique({
        where: {
          email,
        },

        select: {
          id: true,

          emailVerifiedAt: true,
        },
      });

      let developmentToken = null;

      if (user && !user.emailVerifiedAt) {
        const currentTime = new Date();

        const rawToken = await runSerializableTransactionWithRetry(
          async (transaction) => {
            const token = await createVerificationTokenRecord({
              transaction,

              userId: user.id,

              requestIp: req.ip,

              currentTime,
            });

            await writeSecurityAuditEvent({
              database: transaction,

              req,

              eventType: "EMAIL_VERIFICATION_REISSUED",

              outcome: "SUCCESS",

              userId: user.id,

              resourceType: "USER",

              resourceId: user.id,
            });

            return token;
          },
        );

        if (EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN) {
          developmentToken = rawToken;
        }
      }

      const response = {
        ...GENERIC_RESEND_RESPONSE,
      };

      if (EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN && developmentToken) {
        response.developmentOnly = true;

        response.developmentVerificationToken = developmentToken;

        response.expiresInMinutes = EMAIL_VERIFICATION_MINUTES;
      }

      return res.status(200).json(response);
    } catch (error) {
      console.error("Resend verification error:", {
        requestId: req.id,

        name: error.name,

        code: error.code,

        message: error.message,
      });

      return res.status(500).json({
        success: false,

        message: "The verification request could not be processed safely.",
      });
    }
  },
);

export default router;
