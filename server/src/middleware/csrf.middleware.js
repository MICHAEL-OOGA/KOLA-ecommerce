import { createHmac, timingSafeEqual } from "node:crypto";

import { CSRF_SECRET } from "../config/auth.config.js";

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const CSRF_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const normalizeOrigin = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const getTrustedClientOrigin = () => {
  const configuredOrigin =
    process.env.CLIENT_URL?.trim() || "http://localhost:5173";

  const normalizedOrigin = normalizeOrigin(configuredOrigin);

  if (!normalizedOrigin) {
    throw new Error("CLIENT_URL must contain a valid origin.");
  }

  return normalizedOrigin;
};

const TRUSTED_CLIENT_ORIGIN = getTrustedClientOrigin();

/*
|--------------------------------------------------------------------------
| Origin validation
|--------------------------------------------------------------------------
|
| Browsers normally supply Origin or Referer for unsafe requests.
| Postman and other non-browser tools may supply neither, so missing
| headers are permitted. Present headers must match CLIENT_URL exactly.
*/

const requestOriginIsTrusted = (req) => {
  const originHeader = req.get("Origin");

  if (originHeader) {
    const requestOrigin = normalizeOrigin(originHeader);

    return requestOrigin !== null && requestOrigin === TRUSTED_CLIENT_ORIGIN;
  }

  const refererHeader = req.get("Referer");

  if (refererHeader) {
    const requestOrigin = normalizeOrigin(refererHeader);

    return requestOrigin !== null && requestOrigin === TRUSTED_CLIENT_ORIGIN;
  }

  /*
   * Non-browser clients such as Postman may not send either header.
   * Their authentication and CSRF token are still required.
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

export const requireTrustedOrigin = (req, res, next) => {
  if (!requestOriginIsTrusted(req)) {
    return rejectUntrustedOrigin(res);
  }

  return next();
};

/*
|--------------------------------------------------------------------------
| Session-bound CSRF token
|--------------------------------------------------------------------------
|
| The token is an HMAC of:
| - AuthSession ID
| - User ID
| - JWT ID
|
| It is therefore valid only for one authenticated session.
*/

const buildCsrfTokenMessage = ({ sessionId, userId, jwtId }) => {
  return [
    `session:${sessionId.length}:${sessionId}`,
    `user:${userId.length}:${userId}`,
    `jwt:${jwtId.length}:${jwtId}`,
  ].join("|");
};

export const createCsrfToken = ({ sessionId, userId, jwtId }) => {
  if (!sessionId || !userId || !jwtId) {
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

const csrfTokensMatch = (receivedToken, expectedToken) => {
  if (
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
| protect must run before this middleware so req.user and req.auth exist.
*/

export const requireCsrf = (req, res, next) => {
  if (SAFE_HTTP_METHODS.has(req.method.toUpperCase())) {
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
