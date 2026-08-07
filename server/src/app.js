import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";

import healthRoutes from "./routes/health.routes.js";
import dbTestRoutes from "./routes/db-test.routes.js";
import authRoutes from "./routes/auth.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import productRoutes from "./routes/product.routes.js";
import orderRoutes from "./routes/order.routes.js";
import mpesaRoutes from "./routes/mpesa.routes.js";
import passwordResetRoutes from "./routes/password-reset.routes.js";
import {
  API_RATE_LIMIT_MAX,
  ENFORCE_HTTPS,
  IS_PRODUCTION,
  TRUSTED_CLIENT_ORIGINS,
  TRUST_PROXY_HOPS,
  isTrustedClientOrigin,
} from "./config/http.config.js";
import accountRoutes from "./routes/account.routes.js";
const app = express();

app.disable("x-powered-by");

/*
|--------------------------------------------------------------------------
| Reverse-proxy configuration
|--------------------------------------------------------------------------
*/

app.set("trust proxy", TRUST_PROXY_HOPS);

/*
|--------------------------------------------------------------------------
| Request identifiers
|--------------------------------------------------------------------------
*/

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

app.use((req, res, next) => {
  const incomingRequestId = req.get("X-Request-ID")?.trim();

  req.id =
    incomingRequestId && REQUEST_ID_PATTERN.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();

  res.set("X-Request-ID", req.id);

  return next();
});

/*
|--------------------------------------------------------------------------
| Secure HTTP logging
|--------------------------------------------------------------------------
|
| Query strings are omitted and the M-Pesa callback token is redacted.
*/

const getSafeRequestUrl = (req) => {
  const pathOnly = String(req.originalUrl || req.url || "/").split("?")[0];

  return pathOnly.replace(/(\/api\/mpesa\/callback\/)[^/?#]+/i, "$1[REDACTED]");
};

morgan.token("request-id", (req) => req.id || "-");

morgan.token("safe-url", getSafeRequestUrl);

const logFormat = IS_PRODUCTION
  ? ":remote-addr :method :safe-url :status :response-time ms requestId=:request-id"
  : ":method :safe-url :status :response-time ms requestId=:request-id";

app.use(morgan(logFormat));

/*
|--------------------------------------------------------------------------
| Security headers
|--------------------------------------------------------------------------
*/

app.use(helmet());

/*
|--------------------------------------------------------------------------
| CORS allowlist
|--------------------------------------------------------------------------
*/

const corsOptions = {
  origin(origin, callback) {
    /*
     * Allow clients without Origin headers, including Postman,
     * server-to-server calls and Safaricom callbacks.
     */
    if (!origin) {
      return callback(null, true);
    }

    if (isTrustedClientOrigin(origin)) {
      return callback(null, true);
    }

    const error = new Error("Request origin is not permitted.");

    error.code = "CORS_ORIGIN_DENIED";

    return callback(error);
  },

  credentials: true,

  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: [
    "Accept",
    "Content-Type",
    "X-CSRF-Token",
    "Idempotency-Key",
    "X-Request-ID",
  ],

  exposedHeaders: [
    "X-Request-ID",
    "RateLimit",
    "RateLimit-Policy",
    "RateLimit-Remaining",
    "RateLimit-Reset",
  ],

  maxAge: 600,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

/*
|--------------------------------------------------------------------------
| HTTPS enforcement
|--------------------------------------------------------------------------
|
| TLS should normally terminate at the hosting provider or reverse proxy.
| This middleware rejects HTTP rather than redirecting using an untrusted
| Host header.
*/

if (ENFORCE_HTTPS) {
  app.use((req, res, next) => {
    if (req.secure) {
      return next();
    }

    return res.status(426).json({
      success: false,
      code: "HTTPS_REQUIRED",
      message: "HTTPS is required for this API.",
      requestId: req.id,
    });
  });
}

/*
|--------------------------------------------------------------------------
| Global rate limiting
|--------------------------------------------------------------------------
|
| The callback has its own limiter and should not be blocked because normal
| frontend traffic used up the general API quota.
*/

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: API_RATE_LIMIT_MAX,

  standardHeaders: true,
  legacyHeaders: false,

  skip: (req) => {
    return (
      req.method === "OPTIONS" ||
      req.path === "/api/health" ||
      req.path.startsWith("/api/mpesa/callback/")
    );
  },

  handler: (req, res) => {
    return res.status(429).json({
      success: false,
      code: "API_RATE_LIMIT_EXCEEDED",

      message: "Too many requests. Please try again later.",

      requestId: req.id,
    });
  },
});

app.use(globalLimiter);

/*
|--------------------------------------------------------------------------
| Request Content-Type enforcement
|--------------------------------------------------------------------------
|
| Empty POST requests such as logout remain valid. A request that actually
| contains a body must send JSON.
*/

app.use((req, res, next) => {
  const contentLength = req.get("Content-Length");

  const hasRequestBody =
    Boolean(req.get("Transfer-Encoding")) ||
    Boolean(contentLength && contentLength !== "0");

  if (hasRequestBody && !req.is(["application/json", "application/*+json"])) {
    return res.status(415).json({
      success: false,
      code: "UNSUPPORTED_MEDIA_TYPE",

      message: "Request bodies must use application/json.",

      requestId: req.id,
    });
  }

  return next();
});

/*
|--------------------------------------------------------------------------
| JSON and cookie parsing
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: "32kb",
    strict: true,

    type: ["application/json", "application/*+json"],
  }),
);

app.use(cookieParser());

/*
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
*/

app.use("/api/health", healthRoutes);

if (!IS_PRODUCTION) {
  app.use(
    "/api/db-test",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");

      return next();
    },
    dbTestRoutes,
  );
}

app.use(
  "/api/auth",
  (req, res, next) => {
    res.set("Cache-Control", "no-store");

    return next();
  },
  authRoutes,
  passwordResetRoutes,
  accountRoutes,
);

app.use("/api/categories", categoryRoutes);

app.use("/api/products", productRoutes);

app.use("/api/orders", orderRoutes);

app.use("/api/mpesa", mpesaRoutes);

/*
|--------------------------------------------------------------------------
| JSON 404 response
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  return res.status(404).json({
    success: false,

    message: "The requested API endpoint was not found.",

    requestId: req.id,
  });
});

/*
|--------------------------------------------------------------------------
| Final JSON error handler
|--------------------------------------------------------------------------
*/

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error?.code === "CORS_ORIGIN_DENIED") {
    return res.status(403).json({
      success: false,
      code: "CORS_ORIGIN_DENIED",

      message: "The request origin is not permitted.",

      requestId: req.id,
    });
  }

  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      code: "REQUEST_BODY_TOO_LARGE",

      message: "The request body is too large.",

      requestId: req.id,
    });
  }

  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      code: "INVALID_JSON",

      message: "The request body contains invalid JSON.",

      requestId: req.id,
    });
  }

  console.error("Unhandled application error:", {
    requestId: req.id,
    name: error?.name,
    code: error?.code,
    message: error?.message,
  });

  return res.status(500).json({
    success: false,

    message: "An unexpected server error occurred.",

    requestId: req.id,
  });
});

console.log("Trusted client origins:", TRUSTED_CLIENT_ORIGINS);

export default app;
