/*
|--------------------------------------------------------------------------
| HTTP and API configuration
|--------------------------------------------------------------------------
*/

const readBoundedIntegerEnv = (name, fallback, minimum, maximum) => {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a whole number.`);
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

export const IS_PRODUCTION = process.env.NODE_ENV === "production";

/*
|--------------------------------------------------------------------------
| Trusted frontend origins
|--------------------------------------------------------------------------
*/

export const normalizeOrigin = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsedUrl = new URL(value.trim());

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return null;
    }

    if (
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.search ||
      parsedUrl.hash ||
      parsedUrl.pathname !== "/"
    ) {
      return null;
    }

    return parsedUrl.origin;
  } catch {
    return null;
  }
};

const rawClientOrigins =
  process.env.CLIENT_URLS?.trim() ||
  process.env.CLIENT_URL?.trim() ||
  "http://localhost:5173";

const configuredClientOrigins = rawClientOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    const normalizedOrigin = normalizeOrigin(origin);

    if (!normalizedOrigin) {
      throw new Error(`Invalid trusted client origin: ${origin}`);
    }

    return normalizedOrigin;
  });

if (configuredClientOrigins.length === 0) {
  throw new Error("At least one trusted client origin is required.");
}

export const TRUSTED_CLIENT_ORIGINS = Object.freeze([
  ...new Set(configuredClientOrigins),
]);

export const isTrustedClientOrigin = (value) => {
  const normalizedOrigin = normalizeOrigin(value);

  return Boolean(
    normalizedOrigin && TRUSTED_CLIENT_ORIGINS.includes(normalizedOrigin),
  );
};

/*
|--------------------------------------------------------------------------
| Proxy and transport security
|--------------------------------------------------------------------------
*/

export const TRUST_PROXY_HOPS = readBoundedIntegerEnv(
  "TRUST_PROXY_HOPS",
  0,
  0,
  10,
);

export const ENFORCE_HTTPS = readBooleanEnv("ENFORCE_HTTPS", IS_PRODUCTION);

/*
|--------------------------------------------------------------------------
| Global API rate limit
|--------------------------------------------------------------------------
*/

export const API_RATE_LIMIT_MAX = readBoundedIntegerEnv(
  "API_RATE_LIMIT_MAX",
  600,
  50,
  100_000,
);
