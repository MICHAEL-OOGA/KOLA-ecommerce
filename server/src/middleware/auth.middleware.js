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

/*
|--------------------------------------------------------------------------
| Authentication middleware
|--------------------------------------------------------------------------
*/

export const protect = async (req, res, next) => {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];

    if (!token) {
      return res.status(401).json({
        success: false,

        message: "Authentication required.",
      });
    }

    const decoded = jwt.verify(
      token,
      JWT_SECRET,

      {
        algorithms: [JWT_ALGORITHM],

        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,

        maxAge: AUTH_SESSION_SECONDS,

        clockTolerance: 5,
      },
    );

    /*
     * jwt.verify may technically return a string or an object.
     * Our authentication token must be an object with the expected claims.
     */
    if (
      !decoded ||
      typeof decoded !== "object" ||
      typeof decoded.sub !== "string" ||
      decoded.tokenType !== "access"
    ) {
      throw new Error("Unexpected token payload.");
    }

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.sub,
      },

      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new Error("Authenticated user does not exist.");
    }

    req.user = user;

    req.auth = {
      userId: user.id,
      jwtId: typeof decoded.jti === "string" ? decoded.jti : null,

      issuedAt: typeof decoded.iat === "number" ? decoded.iat : null,

      expiresAt: typeof decoded.exp === "number" ? decoded.exp : null,
    };

    return next();
  } catch (error) {
    /*
     * Remove invalid or expired authentication cookies so that the
     * browser does not repeatedly send them.
     */
    res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieClearOptions());

    return res.status(401).json({
      success: false,

      message: "Your session is invalid or expired. Please log in again.",
    });
  }
};

/*
|--------------------------------------------------------------------------
| Admin authorization
|--------------------------------------------------------------------------
*/

export const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({
      success: false,

      message: "Admin access is required.",
    });
  }

  return next();
};
