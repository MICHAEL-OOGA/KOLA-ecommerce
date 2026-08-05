import { createHmac, timingSafeEqual } from "node:crypto";

import { CSRF_SECRET } from "../config/auth.config.js";

import { isTrustedClientOrigin } from "../config/http.config.js";

/*
|--------------------------------------------------------------------------
| Safe HTTP methods
|--------------------------------------------------------------------------
|
| GET, HEAD and OPTIONS should not change server-side data, so they do not
| require a CSRF token.
*/

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const CSRF_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/*
|--------------------------------------------------------------------------
| Request-origin validation
|--------------------------------------------------------------------------
|
| Browser requests normally include either:
| - Origin
| - Referer
|
| When either header is present, it must match one of the trusted frontend header is present, it must match one of the trusted frontend
| origins configured in CLIENT_URLS.
|
| Non-browser clients such as Postman may omit both headers.
*/

const requestOriginIsTrusted = (req) => {
  const originHeader = req.get("Origin");

  if (originHeader) {
    return isTrustedClientOrigin(originHeader);
  }

  const refererHeader = req.get("Referer");

  if (refererHeader) {
    try {
      const refererOrigin = new URL(refererHeader).origin;

      return isTrustedClientOrigin(refererOrigin);
    } catch {
      return false;
    }
  }

  /*
   * Postman, Safaricom and other non-browser clients may not send
   * Origin or Referer.
   */
  return true;
};

const rejectUntrustedOrigin = (res) => {
  return res.status(403).json({
    success: false,
    code: "UNTRUSTED_REQUEST_ORIGIN",

    message: "The request origin is not permitted.",
  });
};

/*
|--------------------------------------------------------------------------
| Trusted-origin middleware
|--------------------------------------------------------------------------
|
| Use this on routes such as:
| - POST /api/auth/login
| - POST /api/mpesa/stk-push
*/

export const requireTrustedOrigin = (req, res, next) => {
  if (!requestOriginIsTrusted(req)) {
    return rejectUntrustedOrigin(res);
  }

  return next();
};

/*
|--------------------------------------------------------------------------
| Session-bound CSRF-token creation
|--------------------------------------------------------------------------
|
| The CSRF token is tied to:
| - The database AuthSession ID
| - The authenticated user ID
| - The JWT ID
|
| A token from one login session cannot be used by another login session.
*/

const buildCsrfTokenMessage = ({ sessionId, userId, jwtId }) => {
  return [
    `session:${sessionId.length}:${sessionId}`,
    `user:${userId.length}:${userId}`,
    `jwt:${jwtId.length}:${jwtId}`,
  ].join("|");
};

export const createCsrfToken = ({ sessionId, userId, jwtId }) => {
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    typeof userId !== "string" ||
    !userId ||
    typeof jwtId !== "string" ||
    !jwtId
  ) {
    throw new Error(
      "Complete session information is required to generate a CSRF token.",
    );
  }

  const message = buildCsrfTokenMessage({
    sessionId,
    userId,
    jwtId,
  });

  return createHmac("sha256", CSRF_SECRET).update(message).digest("hex");
};

/*
|--------------------------------------------------------------------------
| Constant-time CSRF-token comparison
|--------------------------------------------------------------------------
*/

const csrfTokensMatch = (receivedToken, expectedToken) => {
  if (
    typeof receivedToken !== "string" ||
    typeof expectedToken !== "string" ||
    !CSRF_TOKEN_PATTERN.test(receivedToken) ||
    !CSRF_TOKEN_PATTERN.test(expectedToken)
  ) {
    return false;
  }

  const receivedBuffer = Buffer.from(receivedToken, "hex");

  const expectedBuffer = Buffer.from(expectedToken, "hex");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
};

/*
|--------------------------------------------------------------------------
| CSRF enforcement middleware
|--------------------------------------------------------------------------
|
| Middleware order must be:
|
| protect
| adminOnly, where required
| requireCsrf
| route handler
*/

export const requireCsrf = (req, res, next) => {
  const requestMethod = req.method.toUpperCase();

  if (SAFE_HTTP_METHODS.has(requestMethod)) {
    return next();
  }

  if (!requestOriginIsTrusted(req)) {
    return rejectUntrustedOrigin(res);
  }

  if (!req.user?.id || !req.auth?.sessionId || !req.auth?.jwtId) {
    return res.status(401).json({
      success: false,

      message: "Authentication is required.",
    });
  }

  const receivedToken = req.get("X-CSRF-Token")?.trim().toLowerCase();

  if (!receivedToken) {
    return res.status(403).json({
      success: false,
      code: "CSRF_TOKEN_REQUIRED",

      message: "A valid CSRF token is required.",
    });
  }

  const expectedToken = createCsrfToken({
    sessionId: req.auth.sessionId,

    userId: req.user.id,

    jwtId: req.auth.jwtId,
  });

  if (!csrfTokensMatch(receivedToken, expectedToken)) {
    return res.status(403).json({
      success: false,
      code: "INVALID_CSRF_TOKEN",

      message: "The CSRF token is invalid.",
    });
  }

  return next();
};
