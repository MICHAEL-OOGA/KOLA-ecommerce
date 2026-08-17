/*
|--------------------------------------------------------------------------
| Runtime security configuration
|--------------------------------------------------------------------------
|
| This module performs fail-fast checks before the API begins accepting
| requests.
|
| It must never print secret values.
*/

const ALLOWED_NODE_ENVIRONMENTS = new Set([
  "development",
  "test",
  "production",
]);

const readEnvironmentValue = (name) => {
  return process.env[name]?.trim() || "";
};

const readRequiredSecret = (name) => {
  const value = readEnvironmentValue(name);

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(`${name} must contain at least 32 bytes.`);
  }

  return value;
};

const readBooleanEnvironment = (name, fallback = false) => {
  const value = readEnvironmentValue(name).toLowerCase();

  if (!value) {
    return fallback;
  }

  if (["true", "1", "yes"].includes(value)) {
    return true;
  }

  if (["false", "0", "no"].includes(value)) {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
};

const readBoundedIntegerEnvironment = (name, fallback, minimum, maximum) => {
  const rawValue = readEnvironmentValue(name);

  if (!rawValue) {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a positive whole number.`);
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }

  return value;
};

const validatePostgresUrl = (name, { requireTls = false } = {}) => {
  const rawValue = readEnvironmentValue(name);

  if (!rawValue) {
    throw new Error(`${name} is required.`);
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(rawValue);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error(`${name} must use the PostgreSQL protocol.`);
  }

  if (
    !parsedUrl.hostname ||
    !parsedUrl.pathname ||
    parsedUrl.pathname === "/"
  ) {
    throw new Error(
      `${name} is missing required PostgreSQL connection information.`,
    );
  }

  if (requireTls) {
    const sslMode = parsedUrl.searchParams.get("sslmode")?.toLowerCase();

    if (sslMode !== "require") {
      throw new Error(`${name} must use sslmode=require in production.`);
    }
  }
};

const validateProductionClientOrigins = () => {
  const rawOrigins = readEnvironmentValue("CLIENT_URLS");

  if (!rawOrigins) {
    throw new Error("CLIENT_URLS is required in production.");
  }

  const origins = rawOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      "CLIENT_URLS must contain at least one trusted frontend origin.",
    );
  }

  for (const origin of origins) {
    let parsedOrigin;

    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error("CLIENT_URLS contains an invalid URL.");
    }

    if (parsedOrigin.protocol !== "https:") {
      throw new Error("Production CLIENT_URLS entries must use HTTPS.");
    }

    if (["localhost", "127.0.0.1", "::1"].includes(parsedOrigin.hostname)) {
      throw new Error("Production CLIENT_URLS cannot point to localhost.");
    }
  }
};

const validateProductionMpesa = () => {
  const mpesaEnvironment = readEnvironmentValue("MPESA_ENV").toLowerCase();

  if (mpesaEnvironment !== "production") {
    throw new Error("MPESA_ENV must be production when NODE_ENV=production.");
  }

  const requiredVariables = [
    "MPESA_CONSUMER_KEY",
    "MPESA_CONSUMER_SECRET",
    "MPESA_SHORTCODE",
    "MPESA_PASSKEY",
    "MPESA_CALLBACK_URL",
    "MPESA_CALLBACK_TOKEN",
  ];

  for (const name of requiredVariables) {
    if (!readEnvironmentValue(name)) {
      throw new Error(`${name} is required in production.`);
    }
  }

  let callbackUrl;

  try {
    callbackUrl = new URL(readEnvironmentValue("MPESA_CALLBACK_URL"));
  } catch {
    throw new Error("MPESA_CALLBACK_URL must be a valid URL.");
  }

  if (callbackUrl.protocol !== "https:") {
    throw new Error("MPESA_CALLBACK_URL must use HTTPS.");
  }

  if (
    Buffer.byteLength(readEnvironmentValue("MPESA_CALLBACK_TOKEN"), "utf8") < 32
  ) {
    throw new Error("MPESA_CALLBACK_TOKEN must contain at least 32 bytes.");
  }
};

/*
|--------------------------------------------------------------------------
| Exported values
|--------------------------------------------------------------------------
*/

export const RUNTIME_ENV =
  readEnvironmentValue("NODE_ENV").toLowerCase() || "development";

export const IS_RUNTIME_PRODUCTION = RUNTIME_ENV === "production";

export const AUDIT_HASH_SECRET = readRequiredSecret("AUDIT_HASH_SECRET");

export const SECURITY_CLEANUP_INTERVAL_MINUTES = readBoundedIntegerEnvironment(
  "SECURITY_CLEANUP_INTERVAL_MINUTES",
  60,
  5,
  1440,
);

export const AUTH_SESSION_RETENTION_DAYS = readBoundedIntegerEnvironment(
  "AUTH_SESSION_RETENTION_DAYS",
  30,
  1,
  365,
);

export const SECURITY_TOKEN_RETENTION_HOURS = readBoundedIntegerEnvironment(
  "SECURITY_TOKEN_RETENTION_HOURS",
  24,
  1,
  720,
);

/*
|--------------------------------------------------------------------------
| Complete validation
|--------------------------------------------------------------------------
*/

export const validateRuntimeSecurityConfiguration = () => {
  if (!ALLOWED_NODE_ENVIRONMENTS.has(RUNTIME_ENV)) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }

  /*
   * Database URLs are required in every environment.
   */
  validatePostgresUrl("DATABASE_URL", {
    requireTls: IS_RUNTIME_PRODUCTION,
  });

  validatePostgresUrl("DIRECT_URL", {
    requireTls: IS_RUNTIME_PRODUCTION,
  });

  /*
   * Every cryptographic purpose gets its own secret.
   */
  const securitySecretNames = [
    "JWT_SECRET",
    "CSRF_SECRET",
    "PASSWORD_RESET_SECRET",
    "EMAIL_VERIFICATION_SECRET",
    "AUDIT_HASH_SECRET",
    "MPESA_CALLBACK_TOKEN",
  ];

  const configuredSecrets = securitySecretNames
    .map((name) => ({
      name,
      value: readEnvironmentValue(name),
    }))
    .filter(({ value }) => Boolean(value));

  const uniqueSecrets = new Set(configuredSecrets.map(({ value }) => value));

  if (uniqueSecrets.size !== configuredSecrets.length) {
    throw new Error("Security secrets must not reuse the same value.");
  }

  if (!IS_RUNTIME_PRODUCTION) {
    return;
  }

  /*
   * Development-only token exposure must never reach production.
   */
  if (readBooleanEnvironment("PASSWORD_RESET_DEV_EXPOSE_TOKEN")) {
    throw new Error(
      "PASSWORD_RESET_DEV_EXPOSE_TOKEN must be false in production.",
    );
  }

  if (readBooleanEnvironment("EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN")) {
    throw new Error(
      "EMAIL_VERIFICATION_DEV_EXPOSE_TOKEN must be false in production.",
    );
  }

  if (!readBooleanEnvironment("ENFORCE_HTTPS")) {
    throw new Error("ENFORCE_HTTPS must be true in production.");
  }

  /*
   * Bootstrap administrator credentials should not live permanently
   * inside the production API environment.
   */
  if (readEnvironmentValue("ADMIN_PASSWORD")) {
    throw new Error(
      "ADMIN_PASSWORD must not remain configured in the production runtime environment.",
    );
  }

  validateProductionClientOrigins();

  validateProductionMpesa();
};
