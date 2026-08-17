import { createHmac } from "node:crypto";

import prisma from "../config/prisma.js";

import { AUDIT_HASH_SECRET } from "../config/security.config.js";

/*
|--------------------------------------------------------------------------
| Validation
|--------------------------------------------------------------------------
*/

const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/;

const ALLOWED_OUTCOMES = new Set(["SUCCESS", "FAILURE", "DENIED", "ERROR"]);

const SENSITIVE_METADATA_KEY_PATTERN =
  /password|token|secret|authorization|cookie|csrf|jwt|passkey|consumer.?secret|database.?url|direct.?url/i;

/*
|--------------------------------------------------------------------------
| Hashing
|--------------------------------------------------------------------------
*/

const hashAuditValue = (namespace, value) => {
  if (typeof value !== "string" || !value) {
    return null;
  }

  return createHmac("sha256", AUDIT_HASH_SECRET)
    .update(`${namespace}:${value}`)
    .digest("hex");
};

/*
|--------------------------------------------------------------------------
| Safe text normalization
|--------------------------------------------------------------------------
*/

const normalizeOptionalText = (value, maximumLength) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maximumLength);
};

/*
|--------------------------------------------------------------------------
| Metadata sanitizer
|--------------------------------------------------------------------------
|
| Metadata must never accidentally become a second secret store.
*/

const sanitizeMetadata = (value, depth = 0) => {
  if (depth > 4) {
    return "[TRUNCATED]";
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return value.slice(0, 500);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeMetadata(item, depth + 1));
  }

  if (typeof value === "object") {
    const safeObject = {};

    const entries = Object.entries(value).slice(0, 30);

    for (const [key, item] of entries) {
      const safeKey = String(key).slice(0, 100);

      if (SENSITIVE_METADATA_KEY_PATTERN.test(safeKey)) {
        safeObject[safeKey] = "[REDACTED]";

        continue;
      }

      safeObject[safeKey] = sanitizeMetadata(item, depth + 1);
    }

    return safeObject;
  }

  return String(value).slice(0, 500);
};

/*
|--------------------------------------------------------------------------
| Build audit data
|--------------------------------------------------------------------------
*/

export const buildSecurityAuditData = ({
  req = null,

  eventType,
  outcome,

  userId = null,
  actorRole = null,

  identifier = null,

  resourceType = null,
  resourceId = null,

  metadata = null,
}) => {
  if (typeof eventType !== "string" || !EVENT_TYPE_PATTERN.test(eventType)) {
    throw new Error("Security audit eventType is invalid.");
  }

  if (!ALLOWED_OUTCOMES.has(outcome)) {
    throw new Error("Security audit outcome is invalid.");
  }

  const resolvedUserId = userId || req?.user?.id || null;

  const resolvedActorRole = actorRole || req?.user?.role || null;

  const requestIp = typeof req?.ip === "string" ? req.ip : null;

  const userAgent =
    typeof req?.get === "function" ? req.get("User-Agent") : null;

  return {
    eventType,
    outcome,

    userId: normalizeOptionalText(resolvedUserId, 191),

    actorRole: resolvedActorRole || null,

    requestId: normalizeOptionalText(req?.id, 100),

    ipHash: hashAuditValue("ip", requestIp),

    userAgentHash: hashAuditValue("user-agent", userAgent),

    identifierHash: hashAuditValue("identifier", identifier),

    resourceType: normalizeOptionalText(resourceType, 64),

    resourceId: normalizeOptionalText(resourceId, 191),

    metadata: metadata === null ? null : sanitizeMetadata(metadata),
  };
};

/*
|--------------------------------------------------------------------------
| Transaction-aware audit writer
|--------------------------------------------------------------------------
|
| Passing a Prisma transaction lets us later make an administrative
| database change and its audit record atomic.
*/

export const writeSecurityAuditEvent = async ({
  database = prisma,
  ...options
}) => {
  const data = buildSecurityAuditData(options);

  return database.securityAuditLog.create({
    data,
  });
};

/*
|--------------------------------------------------------------------------
| Best-effort audit writer
|--------------------------------------------------------------------------
|
| Useful for events such as failed login attempts where an audit failure
| should not crash the endpoint.
*/

export const recordSecurityAuditEvent = async (options) => {
  try {
    await writeSecurityAuditEvent(options);

    return true;
  } catch (error) {
    console.error("Security audit write failed:", {
      requestId: options.req?.id,

      eventType: options.eventType,

      code: error?.code,

      message: error?.message,
    });

    return false;
  }
};
