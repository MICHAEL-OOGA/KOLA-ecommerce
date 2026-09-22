/*
|--------------------------------------------------------------------------
| Authentication configuration
|--------------------------------------------------------------------------
|
| Centralises:
| - JWT security settings
| - Customer/admin cookie settings
| - Session duration
| - Password-reset settings
| - Email-verification settings
| - Environment validation
|
*/

/*
|--------------------------------------------------------------------------
| Environment helpers
|--------------------------------------------------------------------------
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

/*
|--------------------------------------------------------------------------
| Environment
|--------------------------------------------------------------------------
*/

const isProduction = process.env.NODE_ENV === "production";

/*
|--------------------------------------------------------------------------
| Secrets
|--------------------------------------------------------------------------
|
| These secrets must:
|
| - exist
| - contain at least 32 bytes
| - be different from one another
|
*/

export const JWT_SECRET = readRequiredSecret("JWT_SECRET");

export const CSRF_SECRET = readRequiredSecret("CSRF_SECRET");

export const PASSWORD_RESET_SECRET = readRequiredSecret(
  "PASSWORD_RESET_SECRET",
);

export const EMAIL_VERIFICATION_SECRET = readRequiredSecret(
  "EMAIL_VERIFICATION_SECRET",
);

const authenticationSecrets = [
  JWT_SECRET,
  CSRF_SECRET,
  PASSWORD_RESET_SECRET,
  EMAIL_VERIFICATION_SECRET,
];

if (new Set(authenticationSecrets).size !== authenticationSecrets.length) {
  throw new Error(
    "JWT_SECRET, CSRF_SECRET, PASSWORD_RESET_SECRET and EMAIL_VERIFICATION_SECRET must all be different.",
  );
}

/*
|--------------------------------------------------------------------------
| JWT configuration
|--------------------------------------------------------------------------
*/

export const JWT_ALGORITHM = "HS256";

export const JWT_ISSUER =
  process.env.JWT_ISSUER?.trim() || "mini-ecommerce-api";

export const JWT_AUDIENCE =
  process.env.JWT_AUDIENCE?.trim() || "mini-ecommerce-client";

/*
|--------------------------------------------------------------------------
| Session types
|--------------------------------------------------------------------------
|
| CUSTOMER and ADMIN are authentication-session purposes.
|
| They are deliberately separated so the storefront and admin
| application can remain logged in independently.
|
*/

export const AUTH_SESSION_TYPES = Object.freeze({
  CUSTOMER: "CUSTOMER",
  ADMIN: "ADMIN",
});

/*
|--------------------------------------------------------------------------
| Session lifetime
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| Password-reset configuration
|--------------------------------------------------------------------------
*/

export const PASSWORD_RESET_MINUTES = readBoundedIntegerEnv(
  "PASSWORD_RESET_MINUTES",
  15,
  5,
  60,
);

export const PASSWORD_RESET_DEV_EXPOSE_TOKEN = readBooleanEnv(
  "PASSWORD_RESET_DEV_EXPOSE_TOKEN",
  false,
);

if (isProduction && PASSWORD_RESET_DEV_EXPOSE_TOKEN) {
  throw new Error(
    "PASSWORD_RESET_DEV_EXPOSE_TOKEN cannot be enabled in production.",
  );
}

/*
|--------------------------------------------------------------------------
| Email-verification configuration
|--------------------------------------------------------------------------
*/

export const EMAIL_VERIFICATION_MINUTES = readBoundedIntegerEnv(
  "EMAIL_VERIFICATION_MINUTES",
  60,
  10,
  1440,
);

export const EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN = readBooleanEnv(
  "EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN",
  false,
);

if (isProduction && EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN) {
  throw new Error(
    "EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN cannot be enabled in production.",
  );
}

/*
|--------------------------------------------------------------------------
| Cookie configuration
|--------------------------------------------------------------------------
*/

const cookieSameSite = readSameSiteSetting();

/*
 * SameSite=None requires Secure cookies.
 *
 * During local development KOLA uses HTTP,
 * so SameSite=None must not be enabled there.
 */
if (cookieSameSite === "none" && !isProduction) {
  throw new Error("AUTH_COOKIE_SAME_SITE=none requires production HTTPS.");
}

/*
|--------------------------------------------------------------------------
| Authentication cookie names
|--------------------------------------------------------------------------
|
| CUSTOMER and ADMIN deliberately use different cookies.
|
| Development:
|
| KOLA_customer_session
| KOLA_admin_session
|
| Production:
|
| __Host-KOLA_customer_session
| __Host-KOLA_admin_session
|
| __Host- cookies provide stronger browser restrictions:
|
| - Secure is required
| - Path must be /
| - Domain must not be supplied
|
*/

export const CUSTOMER_AUTH_COOKIE_NAME = isProduction
  ? "__Host-KOLA_customer_session"
  : "KOLA_customer_session";

export const ADMIN_AUTH_COOKIE_NAME = isProduction
  ? "__Host-KOLA_admin_session"
  : "KOLA_admin_session";

/*
|--------------------------------------------------------------------------
| Temporary customer-cookie alias
|--------------------------------------------------------------------------
|
| Older customer-only routes may still import AUTH_COOKIE_NAME.
|
| It intentionally points ONLY to the CUSTOMER cookie.
|
| New code should prefer the explicit customer/admin constants.
|
*/

export const AUTH_COOKIE_NAME = CUSTOMER_AUTH_COOKIE_NAME;

/*
|--------------------------------------------------------------------------
| Cookie option builders
|--------------------------------------------------------------------------
*/

const buildAuthCookieOptions = () => ({
  /*
   * JavaScript running in the browser cannot read
   * the authentication token.
   */
  httpOnly: true,

  /*
   * Production cookies travel only over HTTPS.
   */
  secure: isProduction,

  /*
   * Helps protect against cross-site request attacks.
   */
  sameSite: cookieSameSite,

  /*
   * Authentication applies across the entire API.
   */
  path: "/",

  /*
   * Browser cookie lifetime matches the server session lifetime.
   */
  maxAge: AUTH_SESSION_SECONDS * 1000,
});

const buildAuthCookieClearOptions = () => ({
  /*
   * Cookie clearing must use the same significant
   * attributes as cookie creation.
   */
  httpOnly: true,
  secure: isProduction,
  sameSite: cookieSameSite,
  path: "/",
});

/*
|--------------------------------------------------------------------------
| Customer cookie helpers
|--------------------------------------------------------------------------
*/

export const getCustomerAuthCookieOptions = () => buildAuthCookieOptions();

export const getCustomerAuthCookieClearOptions = () =>
  buildAuthCookieClearOptions();

/*
|--------------------------------------------------------------------------
| Admin cookie helpers
|--------------------------------------------------------------------------
*/

export const getAdminAuthCookieOptions = () => buildAuthCookieOptions();

export const getAdminAuthCookieClearOptions = () =>
  buildAuthCookieClearOptions();

/*
|--------------------------------------------------------------------------
| Temporary customer helper aliases
|--------------------------------------------------------------------------
|
| Existing customer routes that still use:
|
| getAuthCookieOptions()
| getAuthCookieClearOptions()
|
| remain compatible.
|
*/

export const getAuthCookieOptions = getCustomerAuthCookieOptions;

export const getAuthCookieClearOptions = getCustomerAuthCookieClearOptions;
