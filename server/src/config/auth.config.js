/*
|--------------------------------------------------------------------------
| Authentication configuration
|--------------------------------------------------------------------------
|
| This module centralises:
| - JWT security settings
| - Cookie settings
| - Session duration
| - Password-reset settings
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

const readBooleanEnv = (name, fallback) => {
  const rawValue = process.env[name]?.trim().toLowerCase();

  if (!rawValue) {
    return fallback;
  }

  if (["true", "1", "yes"].includes(rawValue)) {
    return true;
  }

  if (["false", "0", "no"].includes(rawValue)) {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
};

const readRequiredSecret = (name) => {
  const secret = process.env[name]?.trim();

  if (!secret) {
    throw new Error(`${name} is required.`);
  }

  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(`${name} must contain at least 32 bytes.`);
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

export const JWT_SECRET = readRequiredSecret("JWT_SECRET");

export const CSRF_SECRET = readRequiredSecret("CSRF_SECRET");

export const PASSWORD_RESET_SECRET = readRequiredSecret(
  "PASSWORD_RESET_SECRET",
);

if (
  JWT_SECRET === CSRF_SECRET ||
  JWT_SECRET === PASSWORD_RESET_SECRET ||
  CSRF_SECRET === PASSWORD_RESET_SECRET
) {
  throw new Error(
    "JWT_SECRET, CSRF_SECRET and PASSWORD_RESET_SECRET must all be different.",
  );
}

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

export const PASSWORD_RESET_MINUTES = readBoundedIntegerEnv(
  "PASSWORD_RESET_MINUTES",
  15,
  5,
  60,
);

const isProduction = process.env.NODE_ENV === "production";

export const PASSWORD_RESET_DEV_EXPOSE_TOKEN = readBooleanEnv(
  "PASSWORD_RESET_DEV_EXPOSE_TOKEN",
  false,
);

if (isProduction && PASSWORD_RESET_DEV_EXPOSE_TOKEN) {
  throw new Error(
    "PASSWORD_RESET_DEV_EXPOSE_TOKEN cannot be enabled in production.",
  );
}

const cookieSameSite = readSameSiteSetting();

if (cookieSameSite === "none" && !isProduction) {
  throw new Error("AUTH_COOKIE_SAME_SITE=none requires production HTTPS.");
}

/*
 * __Host- cookies cannot specify Domain, must use Path=/,
 * and must be Secure.
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

export const getAuthCookieClearOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: cookieSameSite,
  path: "/",
});
