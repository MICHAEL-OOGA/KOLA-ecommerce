import express from "express";
import bcrypt from "bcryptjs";

import {
  createHash,
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

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

import { sendVerificationEmail } from "../services/email.service.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Email-verification OTP configuration
|--------------------------------------------------------------------------
|
| We deliberately exclude visually confusing characters:
|
| I, L, O, 0, 1
|
| Example:
|
| K7M4Q2P9
*/

const VERIFICATION_CODE_LENGTH = 8;

const VERIFICATION_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const MAX_VERIFICATION_ATTEMPTS = 5;

/*
|--------------------------------------------------------------------------
| Disposable-email screening
|--------------------------------------------------------------------------
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

/*
|--------------------------------------------------------------------------
| Verification schema
|--------------------------------------------------------------------------
|
| Verification now requires BOTH:
|
| email
| code
|
| Example:
|
| michael@example.com
| K7M4Q2P9
*/

const verificationCodeSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "Email address is too long.")
      .email("Enter a valid email address."),

    code: z
      .string()
      .trim()
      .toUpperCase()
      .length(
        VERIFICATION_CODE_LENGTH,
        `Verification code must contain exactly ${VERIFICATION_CODE_LENGTH} characters.`,
      )
      .regex(
        /^[A-HJ-KM-NP-Z2-9]+$/,
        "The verification code contains invalid characters.",
      ),
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

const isProduction = process.env.NODE_ENV === "production";

const REGISTER_IP_MAX = isProduction ? 10 : 100;

const REGISTER_EMAIL_MAX = isProduction ? 3 : 30;

const registerIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,

  max: REGISTER_IP_MAX,

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

  max: REGISTER_EMAIL_MAX,

  standardHeaders: true,
  legacyHeaders: false,

  keyGenerator: getEmailHash,

  handler: (req, res) =>
    res.status(429).json({
      success: false,

      message: "Too many registration attempts. Please try again later.",
    }),
});

/*
|--------------------------------------------------------------------------
| Verification request rate limiter
|--------------------------------------------------------------------------
|
| This protects the endpoint broadly by IP.
|
| The individual OTP itself also has a maximum of
| five wrong guesses.
*/

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
| Verification-code helpers
|--------------------------------------------------------------------------
*/

/*
 * Generates one cryptographically secure
 * 8-character verification code.
 *
 * We use crypto.randomInt(), NOT Math.random().
 */

const createRawVerificationCode = () => {
  let code = "";

  for (let index = 0; index < VERIFICATION_CODE_LENGTH; index += 1) {
    const randomIndex = randomInt(0, VERIFICATION_CODE_ALPHABET.length);

    code += VERIFICATION_CODE_ALPHABET[randomIndex];
  }

  return code;
};

const createSensitiveHash = (namespace, value) =>
  createHmac("sha256", EMAIL_VERIFICATION_SECRET)
    .update(`${namespace}:${value}`)
    .digest("hex");

/*
|--------------------------------------------------------------------------
| Verification hash
|--------------------------------------------------------------------------
|
| We bind the verification code to the email address.
|
| Therefore:
|
| michael@example.com + K7M4Q2P9
|
| produces a different HMAC than:
|
| another@example.com + K7M4Q2P9
|
*/

const hashVerificationCode = (email, code) =>
  createSensitiveHash("email-verification-code", `${email}:${code}`);

const hashRequestIp = (requestIp) => {
  if (typeof requestIp !== "string" || !requestIp) {
    return null;
  }

  return createSensitiveHash("email-verification-ip", requestIp);
};

/*
|--------------------------------------------------------------------------
| Constant-time hash comparison
|--------------------------------------------------------------------------
*/

const hashesMatch = (firstHash, secondHash) => {
  if (typeof firstHash !== "string" || typeof secondHash !== "string") {
    return false;
  }

  if (firstHash.length !== secondHash.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(firstHash, "hex"),
      Buffer.from(secondHash, "hex"),
    );
  } catch {
    return false;
  }
};

/*
|--------------------------------------------------------------------------
| Create verification record
|--------------------------------------------------------------------------
*/

const createVerificationCodeRecord = async ({
  transaction,
  userId,
  email,
  requestIp,
  currentTime,
}) => {
  const rawCode = createRawVerificationCode();

  const expiresAt = new Date(
    currentTime.getTime() + EMAIL_VERIFICATION_MINUTES * 60 * 1000,
  );

  /*
   * Issuing a new code invalidates every
   * previous unused code.
   */
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

      tokenHash: hashVerificationCode(email, rawCode),

      expiresAt,

      failedAttempts: 0,

      requestedIpHash: hashRequestIp(requestIp),
    },
  });

  return rawCode;
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

/*
|--------------------------------------------------------------------------
| Generic responses
|--------------------------------------------------------------------------
*/

const GENERIC_REGISTRATION_RESPONSE = {
  success: true,

  message:
    "If this email address can be registered, a verification code will be sent.",
};

const GENERIC_RESEND_RESPONSE = {
  success: true,

  message:
    "If an unverified account exists for that email address, a verification code will be sent.",
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
       * Expensive bcrypt work happens before
       * entering the database transaction.
       */
      const passwordHash = await bcrypt.hash(password, 12);

      const currentTime = new Date();

      let developmentCode = null;

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
                 * Never trust the
                 * browser to choose role.
                 */
                role: "CUSTOMER",

                emailVerifiedAt: null,
              },

              select: {
                id: true,
              },
            });

            const rawCode = await createVerificationCodeRecord({
              transaction,

              userId: user.id,

              email,

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
              userId: user.id,
              rawCode,
            };
          },
        );

        if (result.created) {
          /*
           * Send the OTP only after the database transaction commits.
           *
           * Email is an external network operation and should not keep a
           * serializable database transaction open.
           */
          try {
            await sendVerificationEmail({
              to: email,
              code: result.rawCode,
              expiresInMinutes: EMAIL_VERIFICATION_MINUTES,
            });
          } catch (emailError) {
            /*
             * Keep the public registration response generic.
             *
             * The customer can safely request another code later while the
             * delivery failure is recorded internally.
             */
            console.error("Verification-email delivery failed:", {
              requestId: req.id,
              name: emailError.name,
              message: emailError.message,
            });

            await recordSecurityAuditEvent({
              req,
              eventType: "EMAIL_VERIFICATION_DELIVERY_FAILED",
              outcome: "FAILURE",
              userId: result.userId,
              actorRole: "CUSTOMER",
              identifier: email,
              resourceType: "USER",
              resourceId: result.userId,
            });
          }

          /*
           * DEVELOPMENT ONLY.
           *
           * Real delivery now uses the shared email service. This preview is
           * retained only for local testing and is rejected in production by
           * auth.config.js.
           */
          if (EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN) {
            developmentCode = result.rawCode;
          }
        }
      } catch (error) {
        /*
         * Protect against simultaneous
         * duplicate-email requests.
         */
        if (error?.code !== "P2002") {
          throw error;
        }
      }

      const response = {
        ...GENERIC_REGISTRATION_RESPONSE,
      };

      if (EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN && developmentCode) {
        response.developmentOnly = true;

        response.developmentVerificationCode = developmentCode;

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
|
| Request:
|
| {
|   "email": "customer@example.com",
|   "code": "K7M4Q2P9"
| }
*/

router.post(
  "/verify-email",

  requireTrustedOrigin,
  verificationIpLimiter,

  async (req, res) => {
    try {
      const validationResult = verificationCodeSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          success: false,

          message: "Invalid email-verification information.",

          errors: formatValidationErrors(validationResult.error.issues),
        });
      }

      const { email, code } = validationResult.data;

      const currentTime = new Date();

      const verificationResult = await runSerializableTransactionWithRetry(
        async (transaction) => {
          const user = await transaction.user.findUnique({
            where: {
              email,
            },

            select: {
              id: true,
              emailVerifiedAt: true,
            },
          });

          /*
           * Do not reveal whether:
           *
           * - the account does not exist
           * - it is already verified
           * - its OTP has expired
           *
           * The public response remains generic.
           */

          if (!user || user.emailVerifiedAt) {
            return {
              verified: false,
            };
          }

          const verificationRecord =
            await transaction.emailVerificationToken.findFirst({
              where: {
                userId: user.id,

                usedAt: null,

                expiresAt: {
                  gt: currentTime,
                },

                failedAttempts: {
                  lt: MAX_VERIFICATION_ATTEMPTS,
                },
              },

              orderBy: {
                createdAt: "desc",
              },

              select: {
                id: true,
                tokenHash: true,
                failedAttempts: true,
              },
            });

          if (!verificationRecord) {
            return {
              verified: false,
            };
          }

          const submittedHash = hashVerificationCode(email, code);

          const codeMatches = hashesMatch(
            submittedHash,
            verificationRecord.tokenHash,
          );

          /*
            |--------------------------------------------------------------------------
            | Wrong OTP
            |--------------------------------------------------------------------------
            */

          if (!codeMatches) {
            const nextAttemptCount = verificationRecord.failedAttempts + 1;

            const updated = await transaction.emailVerificationToken.updateMany(
              {
                where: {
                  id: verificationRecord.id,

                  usedAt: null,

                  failedAttempts: verificationRecord.failedAttempts,
                },

                data: {
                  failedAttempts: {
                    increment: 1,
                  },

                  /*
                   * The fifth incorrect attempt
                   * kills this OTP permanently.
                   */
                  ...(nextAttemptCount >= MAX_VERIFICATION_ATTEMPTS
                    ? {
                        usedAt: currentTime,
                      }
                    : {}),
                },
              },
            );

            /*
             * Another simultaneous request may have
             * modified the same OTP first.
             */
            if (updated.count !== 1) {
              return {
                verified: false,
              };
            }

            /*
             * IMPORTANT:
             *
             * We RETURN instead of throwing.
             *
             * That allows Prisma to COMMIT the
             * failedAttempts increment.
             */
            return {
              verified: false,
            };
          }

          /*
            |--------------------------------------------------------------------------
            | Correct OTP
            |--------------------------------------------------------------------------
            */

          const claimedCode =
            await transaction.emailVerificationToken.updateMany({
              where: {
                id: verificationRecord.id,

                usedAt: null,

                expiresAt: {
                  gt: currentTime,
                },

                failedAttempts: {
                  lt: MAX_VERIFICATION_ATTEMPTS,
                },
              },

              data: {
                usedAt: currentTime,
              },
            });

          if (claimedCode.count !== 1) {
            return {
              verified: false,
            };
          }

          await transaction.user.update({
            where: {
              id: user.id,
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

            userId: user.id,

            resourceType: "USER",

            resourceId: user.id,
          });

          /*
           * Invalidate any other unused
           * verification records.
           */

          await transaction.emailVerificationToken.updateMany({
            where: {
              userId: user.id,

              id: {
                not: verificationRecord.id,
              },

              usedAt: null,
            },

            data: {
              usedAt: currentTime,
            },
          });

          return {
            verified: true,
          };
        },
      );

      /*
      |--------------------------------------------------------------------------
      | Respond AFTER transaction has committed
      |--------------------------------------------------------------------------
      */

      if (!verificationResult.verified) {
        return res.status(400).json({
          success: false,

          code: "INVALID_OR_EXPIRED_VERIFICATION_CODE",

          message: "The verification code is invalid or expired.",
        });
      }

      return res.status(200).json({
        success: true,

        message: "Email address verified successfully. You can now log in.",
      });
    } catch (error) {
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

      let developmentCode = null;

      if (user && !user.emailVerifiedAt) {
        const currentTime = new Date();

        const rawCode = await runSerializableTransactionWithRetry(
          async (transaction) => {
            const code = await createVerificationCodeRecord({
              transaction,

              userId: user.id,

              email,

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

            return code;
          },
        );

        try {
          await sendVerificationEmail({
            to: email,
            code: rawCode,
            expiresInMinutes: EMAIL_VERIFICATION_MINUTES,
          });
        } catch (emailError) {
          console.error("Verification-email resend delivery failed:", {
            requestId: req.id,
            name: emailError.name,
            message: emailError.message,
          });

          await recordSecurityAuditEvent({
            req,
            eventType: "EMAIL_VERIFICATION_DELIVERY_FAILED",
            outcome: "FAILURE",
            userId: user.id,
            identifier: email,
            resourceType: "USER",
            resourceId: user.id,
          });
        }

        if (EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN) {
          developmentCode = rawCode;
        }
      }

      const response = {
        ...GENERIC_RESEND_RESPONSE,
      };

      if (EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN && developmentCode) {
        response.developmentOnly = true;

        response.developmentVerificationCode = developmentCode;

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
