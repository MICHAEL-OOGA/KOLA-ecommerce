import prisma from "../config/prisma.js";

import {
  AUTH_SESSION_RETENTION_DAYS,
  SECURITY_CLEANUP_INTERVAL_MINUTES,
  SECURITY_TOKEN_RETENTION_HOURS,
} from "../config/security.config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

let cleanupTimer = null;

let cleanupIsRunning = false;

/*
|--------------------------------------------------------------------------
| Security-record cleanup
|--------------------------------------------------------------------------
|
| We deliberately retain records for a short period instead of deleting
| them immediately.
|
| Financial records and SecurityAuditLog records are NOT touched here.
*/

export const runSecurityCleanup = async () => {
  if (cleanupIsRunning) {
    return {
      skipped: true,
    };
  }

  cleanupIsRunning = true;

  try {
    const currentTime = new Date();

    const sessionCutoff = new Date(
      currentTime.getTime() - AUTH_SESSION_RETENTION_DAYS * DAY_MS,
    );

    const tokenCutoff = new Date(
      currentTime.getTime() - SECURITY_TOKEN_RETENTION_HOURS * HOUR_MS,
    );

    const [
      deletedSessions,
      deletedPasswordResetTokens,
      deletedVerificationTokens,
    ] = await prisma.$transaction([
      prisma.authSession.deleteMany({
        where: {
          OR: [
            {
              expiresAt: {
                lt: sessionCutoff,
              },
            },

            {
              revokedAt: {
                lt: sessionCutoff,
              },
            },
          ],
        },
      }),

      prisma.passwordResetToken.deleteMany({
        where: {
          OR: [
            {
              expiresAt: {
                lt: tokenCutoff,
              },
            },

            {
              usedAt: {
                lt: tokenCutoff,
              },
            },
          ],
        },
      }),

      prisma.emailVerificationToken.deleteMany({
        where: {
          OR: [
            {
              expiresAt: {
                lt: tokenCutoff,
              },
            },

            {
              usedAt: {
                lt: tokenCutoff,
              },
            },
          ],
        },
      }),
    ]);

    return {
      skipped: false,

      deletedSessions: deletedSessions.count,

      deletedPasswordResetTokens: deletedPasswordResetTokens.count,

      deletedVerificationTokens: deletedVerificationTokens.count,
    };
  } finally {
    cleanupIsRunning = false;
  }
};

const executeScheduledCleanup = async () => {
  try {
    const result = await runSecurityCleanup();

    if (result.skipped) {
      return;
    }

    const totalDeleted =
      result.deletedSessions +
      result.deletedPasswordResetTokens +
      result.deletedVerificationTokens;

    if (totalDeleted > 0) {
      console.log("Security cleanup completed:", result);
    }
  } catch (error) {
    console.error("Security cleanup failed:", {
      name: error?.name,

      code: error?.code,

      message: error?.message,
    });
  }
};

export const startSecurityCleanupWorker = () => {
  if (cleanupTimer) {
    return;
  }

  /*
   * Perform one cleanup shortly after startup.
   */
  void executeScheduledCleanup();

  cleanupTimer = setInterval(
    () => {
      void executeScheduledCleanup();
    },

    SECURITY_CLEANUP_INTERVAL_MINUTES * 60 * 1000,
  );

  /*
   * Do not keep Node alive only because this timer exists.
   */
  cleanupTimer.unref?.();

  console.log(
    `Security cleanup worker started. Interval: ${SECURITY_CLEANUP_INTERVAL_MINUTES} minute(s).`,
  );
};

export const stopSecurityCleanupWorker = () => {
  if (!cleanupTimer) {
    return;
  }

  clearInterval(cleanupTimer);

  cleanupTimer = null;

  console.log("Security cleanup worker stopped.");
};
