/*
|--------------------------------------------------------------------------
| HTTP and API configuration
|--------------------------------------------------------------------------
|
| This module controls:
| - trusted browser origins
| - reverse-proxy trust
| - HTTPS enforcement
| - global API rate limiting
|
| Production configuration fails closed.
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

    /*
     * Trusted CORS values must represent origins only.
     *
     * Valid:
     * https://shop.example.com
     *
     * Invalid:
     * https://shop.example.com/path
     * https://user:pass@example.com
     */
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

const isLoopbackHostname = (hostname) => {
  const normalizedHostname = String(hostname || "").toLowerCase();

  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "[::1]" ||
    normalizedHostname.endsWith(".localhost")
  );
};

const configuredClientOriginValue =
  process.env.CLIENT_URLS?.trim() || process.env.CLIENT_URL?.trim() || null;

/*
 * Development gets a convenient default.
 *
 * Production gets NO default.
 */
const rawClientOrigins =
  configuredClientOriginValue ||
  (IS_PRODUCTION ? null : "http://localhost:5173,http://localhost:5174");

if (!rawClientOrigins) {
  throw new Error("CLIENT_URLS is required when NODE_ENV=production.");
}

const configuredClientOrigins = rawClientOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    const normalizedOrigin = normalizeOrigin(origin);

    if (!normalizedOrigin) {
      throw new Error(`Invalid trusted client origin: ${origin}`);
    }

    const parsedOrigin = new URL(normalizedOrigin);

    /*
     * Production browser origins must use HTTPS
     * and must not point at localhost.
     */
    if (IS_PRODUCTION) {
      if (parsedOrigin.protocol !== "https:") {
        throw new Error(
          `Production trusted origin must use HTTPS: ${normalizedOrigin}`,
        );
      }

      if (isLoopbackHostname(parsedOrigin.hostname)) {
        throw new Error(
          `Production trusted origin cannot use localhost: ${normalizedOrigin}`,
        );
      }
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
| Proxy security
|--------------------------------------------------------------------------
|
| Express must trust only the number of proxy hops actually used
| by the production hosting environment.
|
| Trusting too many proxy hops can allow attacker-controlled
| X-Forwarded-* headers to influence security decisions.
*/

const trustProxyValue = process.env.TRUST_PROXY_HOPS?.trim();

if (IS_PRODUCTION && !trustProxyValue) {
  throw new Error(
    "TRUST_PROXY_HOPS must be explicitly configured in production.",
  );
}

export const TRUST_PROXY_HOPS = readBoundedIntegerEnv(
  "TRUST_PROXY_HOPS",
  0,
  0,
  10,
);

/*
 * KOLA's Node server itself is HTTP.
 *
 * Production TLS is expected to terminate at a trusted reverse proxy.
 * Therefore production must trust at least that proxy hop.
 */
if (IS_PRODUCTION && TRUST_PROXY_HOPS < 1) {
  throw new Error("TRUST_PROXY_HOPS must be at least 1 in production.");
}

/*
|--------------------------------------------------------------------------
| HTTPS enforcement
|--------------------------------------------------------------------------
*/

export const ENFORCE_HTTPS = readBooleanEnv("ENFORCE_HTTPS", IS_PRODUCTION);

if (IS_PRODUCTION && !ENFORCE_HTTPS) {
  throw new Error("ENFORCE_HTTPS cannot be disabled in production.");
}

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
