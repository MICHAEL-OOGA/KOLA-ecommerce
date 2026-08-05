import express from "express";

const router = express.Router();

router.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");

  return res.status(200).json({
    success: true,
    status: "ok",

    uptimeSeconds: Math.floor(process.uptime()),

    requestId: req.id,
  });
});

export default router;
