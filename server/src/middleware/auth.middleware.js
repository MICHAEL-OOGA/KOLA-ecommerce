import jwt from "jsonwebtoken";

import prisma from "../config/prisma.js";

import {
  ADMIN_AUTH_COOKIE_NAME,
  AUTH_SESSION_SECONDS,
  AUTH_SESSION_TYPES,
  CUSTOMER_AUTH_COOKIE_NAME,
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
  getAdminAuthCookieClearOptions,
  getCustomerAuthCookieClearOptions,
} from "../config/auth.config.js";

/*
|--------------------------------------------------------------------------
| Shared session authentication
|--------------------------------------------------------------------------
|
| Authentication requires agreement between:
|
| 1. Cookie being read
| 2. JWT sessionType
| 3. Database AuthSession.sessionType
|
| This prevents a CUSTOMER token from being treated as an ADMIN token
| simply because both use the same JWT signing secret.
*/

const authenticateSession =
  ({
    cookieName,
    expectedSessionType,
    getCookieClearOptions,
    requireAdminRole = false,
  }) =>
  async (req, res, next) => {
    try {
      const token = req.cookies?.[cookieName];

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

      /*
       * Validate required JWT claims.
       */
      if (
        !decoded ||
        typeof decoded !== "object" ||
        typeof decoded.sub !== "string" ||
        typeof decoded.jti !== "string" ||
        decoded.tokenType !== "access" ||
        decoded.sessionType !== expectedSessionType
      ) {
        throw new Error("Unexpected authentication token.");
      }

      /*
       * Retrieve the server-side session.
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
       * JWT and database session must agree.
       */
      if (
        !session ||
        session.userId !== decoded.sub ||
        session.sessionType !== expectedSessionType ||
        session.revokedAt ||
        session.expiresAt <= currentTime
      ) {
        throw new Error("Authentication session is inactive.");
      }

      /*
       * ADMIN sessions additionally require the account
       * to still have the ADMIN role.
       *
       * This matters if an administrator is demoted while
       * an old admin session still exists.
       */
      if (requireAdminRole && session.user.role !== "ADMIN") {
        throw new Error("Administrator privileges are no longer active.");
      }

      req.user = session.user;

      req.auth = {
        sessionId: session.id,

        jwtId: session.jwtId,

        sessionType: session.sessionType,

        issuedAt: typeof decoded.iat === "number" ? decoded.iat : null,

        expiresAt: session.expiresAt,
      };

      return next();
    } catch {
      res.clearCookie(cookieName, getCookieClearOptions());

      return res.status(401).json({
        success: false,

        message: "Your session is invalid or expired. Please log in again.",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| Customer session middleware
|--------------------------------------------------------------------------
*/

export const protectCustomer = authenticateSession({
  cookieName: CUSTOMER_AUTH_COOKIE_NAME,

  expectedSessionType: AUTH_SESSION_TYPES.CUSTOMER,

  getCookieClearOptions: getCustomerAuthCookieClearOptions,
});

/*
|--------------------------------------------------------------------------
| Admin session middleware
|--------------------------------------------------------------------------
*/

export const protectAdmin = authenticateSession({
  cookieName: ADMIN_AUTH_COOKIE_NAME,

  expectedSessionType: AUTH_SESSION_TYPES.ADMIN,

  getCookieClearOptions: getAdminAuthCookieClearOptions,

  requireAdminRole: true,
});

/*
|--------------------------------------------------------------------------
| Backwards-compatible customer alias
|--------------------------------------------------------------------------
|
| Existing customer routes currently import:
|
|   protect
|
| During migration, "protect" explicitly means
| CUSTOMER authentication.
*/

export const protect = protectCustomer;

/*
|--------------------------------------------------------------------------
| Role guard
|--------------------------------------------------------------------------
|
| This remains available for existing routes during the migration.
|
| In Stage 1C all real administrator routes will be moved to
| protectAdmin directly.
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
