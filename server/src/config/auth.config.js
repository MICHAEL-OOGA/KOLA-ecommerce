/*
|--------------------------------------------------------------------------
| Authentication configuration
|--------------------------------------------------------------------------
|
| This module centralises:
| - JWT security settings
| - Cookie settings
| - Session duration
| - Environment validation
*/

const readBoundedIntegerEnv = (name, fallback, minimum, maximum) => {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a positive whole number.`);
  }

  const parsedValue = Number(rawValue);

  if (
    !Number.isSafeInteger(parsedValue) ||
    parsedValue < minimum ||
    parsedValue > maximum
  ) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }

  return parsedValue;
};

const readJwtSecret = () => {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error("JWT_SECRET is required.");
  }

  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes.");
  }

  return secret;
};

const readCsrfSecret = () => {
  const secret = process.env.CSRF_SECRET?.trim();

  if (!secret) {
    throw new Error("CSRF_SECRET is required.");
  }

  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("CSRF_SECRET must contain at least 32 bytes.");
  }

  return secret;
};

const readSameSiteSetting = () => {
  const value =
    process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase() || "lax";

  const allowedValues = ["lax", "strict", "none"];

  if (!allowedValues.includes(value)) {
    throw new Error("AUTH_COOKIE_SAME_SITE must be lax, strict, or none.");
  }

  return value;
};

export const JWT_SECRET = readJwtSecret();

export const CSRF_SECRET = readCsrfSecret();

export const JWT_ALGORITHM = "HS256";

export const JWT_ISSUER =
  process.env.JWT_ISSUER?.trim() || "mini-ecommerce-api";

export const JWT_AUDIENCE =
  process.env.JWT_AUDIENCE?.trim() || "mini-ecommerce-client";

export const AUTH_SESSION_MINUTES = readBoundedIntegerEnv(
  "AUTH_SESSION_MINUTES",
  120,
  5,
  1440,
);

export const AUTH_SESSION_SECONDS = AUTH_SESSION_MINUTES * 60;
export const AUTH_MAX_ACTIVE_SESSIONS = readBoundedIntegerEnv(
  "AUTH_MAX_ACTIVE_SESSIONS",
  5,
  1,
  20,
);

const isProduction = process.env.NODE_ENV === "production";

const cookieSameSite = readSameSiteSetting();

if (cookieSameSite === "none" && !isProduction) {
  throw new Error("AUTH_COOKIE_SAME_SITE=none requires production HTTPS.");
}

/*
 * __Host- cookies cannot specify Domain, must use Path=/,
 * and must be Secure. We therefore use this stronger prefix
 * only in production.
 */
export const AUTH_COOKIE_NAME = isProduction
  ? "__Host-auth_token"
  : "auth_token";

export const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: cookieSameSite,
  path: "/",

  maxAge: AUTH_SESSION_SECONDS * 1000,
});

/*
 * Do not include maxAge when clearing the cookie.
 */
export const getAuthCookieClearOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: cookieSameSite,
  path: "/",
});
