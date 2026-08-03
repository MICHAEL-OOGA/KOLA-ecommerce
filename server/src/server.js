import "dotenv/config";
import app from "./app.js";
import prisma from "./config/prisma.js";
import {
  startOrderExpiryWorker,
  stopOrderExpiryWorker,
} from "./services/order-expiry.service.js";

const PORT = Number(process.env.PORT) || 5000;

let shutdownStarted = false;

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  startOrderExpiryWorker();
});

const shutdown = (signal) => {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;

  console.log(`${signal} received. Shutting down safely...`);

  stopOrderExpiryWorker();

  const forcedShutdownTimer = setTimeout(() => {
    console.error("Forced shutdown after waiting for active requests.");

    process.exit(1);
  }, 10_000);

  forcedShutdownTimer.unref();

  server.close(async (error) => {
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error("Prisma disconnect error:", {
        message: disconnectError.message,
      });
    } finally {
      clearTimeout(forcedShutdownTimer);
    }

    if (error) {
      console.error("HTTP server shutdown error:", error);

      process.exit(1);
    }

    console.log("Server stopped safely.");

    process.exit(0);
  });
};

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
