import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";

import healthRoutes from "./routes/health.routes.js";
import dbTestRoutes from "./routes/db-test.routes.js";
import authRoutes from "./routes/auth.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import productRoutes from "./routes/product.routes.js";
import orderRoutes from "./routes/order.routes.js";
import mpesaRoutes from "./routes/mpesa.routes.js";

const app = express();

const isProduction = process.env.NODE_ENV === "production";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

app.disable("x-powered-by");

app.use(helmet());
app.use(limiter);

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",

    credentials: true,
  }),
);

/*
 * Reject unexpectedly large JSON requests.
 */
app.use(
  express.json({
    limit: "32kb",
    strict: true,
  }),
);

app.use(cookieParser());

app.use(morgan(isProduction ? "combined" : "dev"));

app.use("/api/health", healthRoutes);

/*
 * Never expose the database test route in production.
 */
if (!isProduction) {
  app.use("/api/db-test", dbTestRoutes);
}

app.use("/api/auth", authRoutes);

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
  });
});

/*
|--------------------------------------------------------------------------
| Final JSON error handler
|--------------------------------------------------------------------------
|
| This prevents Express from returning HTML stack traces.
*/

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      code: "REQUEST_BODY_TOO_LARGE",

      message: "The request body is too large.",
    });
  }

  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      code: "INVALID_JSON",

      message: "The request body contains invalid JSON.",
    });
  }

  console.error("Unhandled application error:", {
    name: error?.name,
    code: error?.code,
    message: error?.message,
  });

  return res.status(500).json({
    success: false,
    message: "An unexpected server error occurred.",
  });
});

export default app;
