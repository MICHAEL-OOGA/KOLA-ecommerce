import jwt from "jsonwebtoken";

import prisma from "../config/prisma.js";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_SECONDS,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
  getAuthCookieClearOptions,
} from "../config/auth.config.js";

export const protect = async (req, res, next) => {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],

      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,

      maxAge: AUTH_SESSION_SECONDS,

      clockTolerance: 5,
    });

    if (
      !decoded ||
      typeof decoded !== "object" ||
      typeof decoded.sub !== "string" ||
      typeof decoded.jti !== "string" ||
      decoded.tokenType !== "access"
    ) {
      throw new Error("Unexpected authentication token.");
    }

    /*
     * Retrieve the database session using the JWT ID.
     */
    const session = await prisma.authSession.findUnique({
      where: {
        jwtId: decoded.jti,
      },

      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });

    const currentTime = new Date();

    /*
     * Reject missing, revoked, mismatched or expired sessions.
     */
    if (
      !session ||
      session.userId !== decoded.sub ||
      session.revokedAt ||
      session.expiresAt <= currentTime
    ) {
      throw new Error("Authentication session is inactive.");
    }

    req.user = session.user;

    /*
     * These three values are required by createCsrfToken().
     */
    req.auth = {
      sessionId: session.id,

      jwtId: session.jwtId,

      issuedAt: typeof decoded.iat === "number" ? decoded.iat : null,

      expiresAt: session.expiresAt,
    };

    return next();
  } catch {
    res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieClearOptions());

    return res.status(401).json({
      success: false,

      message: "Your session is invalid or expired. Please log in again.",
    });
  }
};

export const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Admin access is required.",
    });
  }

  return next();
};
