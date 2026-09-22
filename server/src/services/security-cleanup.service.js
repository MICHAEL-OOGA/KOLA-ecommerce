import prisma from "../config/prisma.js";

import {
  AUTH_SESSION_RETENTION_DAYS,
  SECURITY_CLEANUP_INTERVAL_MINUTES,
  SECURITY_TOKEN_RETENTION_HOURS,
} from "../config/security.config.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/*
 * Don't hammer Neon immediately when the backend starts.
 */
const SECURITY_CLEANUP_STARTUP_DELAY_MS = 10_000;

let cleanupTimer = null;
let cleanupStartupTimer = null;

let cleanupIsRunning = false;

/*
|--------------------------------------------------------------------------
| Transient database retry
|--------------------------------------------------------------------------
|
| Background maintenance should tolerate a short Neon cold start or
| temporary pool delay.
*/

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const isTransientDatabaseError = (error) => {
  if (
    error?.code === "P1001" ||
    error?.code === "P2024" ||
    error?.code === "P2034"
  ) {
    return true;
  }

  if (
    error?.code === "P2028" &&
    /unable to start a transaction/i.test(error?.message || "")
  ) {
    return true;
  }

  return false;
};

const runDatabaseOperationWithRetry = async (
  operation,
  maximumAttempts = 3,
) => {
  for (
    let attemptNumber = 1;
    attemptNumber <= maximumAttempts;
    attemptNumber += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry =
        isTransientDatabaseError(error) && attemptNumber < maximumAttempts;

      if (!shouldRetry) {
        throw error;
      }

      /*
       * Small exponential backoff:
       *
       * attempt 1 → 1 second
       * attempt 2 → 2 seconds
       */
      const delayMilliseconds = 1000 * 2 ** (attemptNumber - 1);

      await sleep(delayMilliseconds);
    }
  }
};

/*
|--------------------------------------------------------------------------
| Security-record cleanup
|--------------------------------------------------------------------------
|
| These operations are deliberately independent.
|
| If password-reset cleanup temporarily fails after old sessions were
| successfully removed, there is no reason to restore those old sessions.
|
| Each deleteMany is already an atomic database operation by itself.
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

    /*
     * Run sequentially rather than creating a burst of DB work.
     */

    const deletedSessions = await runDatabaseOperationWithRetry(() =>
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
    );

    const deletedPasswordResetTokens = await runDatabaseOperationWithRetry(() =>
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
    );

    const deletedVerificationTokens = await runDatabaseOperationWithRetry(() =>
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
    );

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
    /*
     * Cleanup failure must never crash the API.
     *
     * Old security records remaining for another cleanup cycle
     * is preferable to disrupting customer traffic.
     */

    console.error("Security cleanup failed:", {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });
  }
};

export const startSecurityCleanupWorker = () => {
  if (cleanupTimer || cleanupStartupTimer) {
    return;
  }

  /*
   * Give the API/Neon connection time to settle
   * before the first maintenance operation.
   */

  cleanupStartupTimer = setTimeout(() => {
    cleanupStartupTimer = null;

    void executeScheduledCleanup();
  }, SECURITY_CLEANUP_STARTUP_DELAY_MS);

  cleanupStartupTimer.unref?.();

  cleanupTimer = setInterval(
    () => {
      void executeScheduledCleanup();
    },

    SECURITY_CLEANUP_INTERVAL_MINUTES * 60 * 1000,
  );

  cleanupTimer.unref?.();

  console.log(
    `Security cleanup worker started. First run in ${
      SECURITY_CLEANUP_STARTUP_DELAY_MS / 1000
    } seconds. Interval: ${SECURITY_CLEANUP_INTERVAL_MINUTES} minute(s).`,
  );
};

export const stopSecurityCleanupWorker = () => {
  if (cleanupStartupTimer) {
    clearTimeout(cleanupStartupTimer);

    cleanupStartupTimer = null;
  }

  if (cleanupTimer) {
    clearInterval(cleanupTimer);

    cleanupTimer = null;
  }

  console.log("Security cleanup worker stopped.");
};
