import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  getCsrfToken,
  getCurrentUser,
  login,
  logout,
} from "../api/auth.api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const [session, setSession] = useState(null);

  /*
   * CSRF remains only in React memory.
   *
   * Never localStorage/sessionStorage.
   */
  const [csrfToken, setCsrfToken] = useState(null);

  /*
   * Becomes true after the first backend session
   * verification attempt finishes.
   */
  const [authReady, setAuthReady] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Clear local administrator authentication state
  |--------------------------------------------------------------------------
  */

  const clearAuthenticationState = useCallback(() => {
    setUser(null);

    setSession(null);

    setCsrfToken(null);
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Verify administrator session against backend
  |--------------------------------------------------------------------------
  |
  | React is not the security authority.
  |
  | /admin/auth/me verifies:
  |
  | - admin HttpOnly cookie
  | - ADMIN JWT purpose
  | - ADMIN database session
  | - current ADMIN account role
  */

  const refreshAuthentication = useCallback(
    async ({ signal } = {}) => {
      try {
        const response = await getCurrentUser({
          signal,
        });

        if (signal?.aborted) {
          return false;
        }

        /*
         * The backend already guarantees that this is
         * a valid administrator session.
         */
        setUser(response.user);

        setSession(response.session);

        /*
         * CSRF lives only in memory.
         *
         * Retrieve a fresh token after restoring
         * the administrator session.
         */
        const freshCsrfToken = await getCsrfToken({
          signal,
        });

        if (signal?.aborted) {
          return false;
        }

        setCsrfToken(freshCsrfToken);

        return true;
      } catch (error) {
        if (error?.name === "AbortError") {
          return false;
        }

        if (error?.status !== 401) {
          console.error(
            "Administrator authentication verification failed:",
            error,
          );
        }

        /*
         * Fail closed.
         */
        clearAuthenticationState();

        return false;
      }
    },

    [clearAuthenticationState],
  );

  /*
  |--------------------------------------------------------------------------
  | Restore administrator session when app starts
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const controller = new AbortController();

    const restoreAuthentication = async () => {
      try {
        await refreshAuthentication({
          signal: controller.signal,
        });
      } finally {
        if (!controller.signal.aborted) {
          setAuthReady(true);
        }
      }
    };

    void restoreAuthentication();

    return () => {
      controller.abort();
    };
  }, [refreshAuthentication]);

  /*
  |--------------------------------------------------------------------------
  | Synchronise local state with known session expiration
  |--------------------------------------------------------------------------
  |
  | The backend still remains authoritative.
  */

  useEffect(() => {
    if (!user || !session?.expiresAt) {
      return undefined;
    }

    const expiresAt = new Date(session.expiresAt).getTime();

    if (!Number.isFinite(expiresAt)) {
      return undefined;
    }

    let timerId;

    const scheduleExpiryCheck = () => {
      const remaining = expiresAt - Date.now();

      if (remaining <= 0) {
        clearAuthenticationState();

        return;
      }

      /*
       * Browser setTimeout has a practical
       * maximum delay of roughly 24.8 days.
       */
      const delay = Math.min(remaining, 2_147_000_000);

      timerId = window.setTimeout(scheduleExpiryCheck, delay);
    };

    scheduleExpiryCheck();

    return () => {
      if (timerId) {
        window.clearTimeout(timerId);
      }
    };
  }, [user, session?.expiresAt, clearAuthenticationState]);

  /*
  |--------------------------------------------------------------------------
  | Administrator login
  |--------------------------------------------------------------------------
  */

  const loginAdmin = async ({ email, password }) => {
    const response = await login({
      email,
      password,
    });

    /*
     * The backend /admin/auth/login endpoint will only
     * issue a session after confirming ADMIN access.
     *
     * This role check is therefore defensive UI validation,
     * not our security boundary.
     */
    if (response.user?.role !== "ADMIN") {
      clearAuthenticationState();

      throw new Error("Administrator access was not granted.");
    }

    setUser(response.user);

    setSession({
      expiresAt: response.session.expiresAt,
    });

    setCsrfToken(response.session.csrfToken);

    return response;
  };

  /*
  |--------------------------------------------------------------------------
  | Administrator logout
  |--------------------------------------------------------------------------
  */

  const logoutUser = async () => {
    let token = csrfToken;

    if (!token) {
      token = await getCsrfToken();
    }

    try {
      const response = await logout(token);

      clearAuthenticationState();

      return response;
    } catch (error) {
      /*
       * 401 means the admin session is already unusable.
       *
       * 503 means the backend cleared the browser cookie but
       * could not confirm database revocation.
       *
       * Either way this React application must stop treating
       * the administrator as authenticated.
       */
      if (error?.status === 401 || error?.status === 503) {
        clearAuthenticationState();
      }

      throw error;
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Derived state
  |--------------------------------------------------------------------------
  */

  const isAuthenticated = Boolean(user);

  const isAdmin = isAuthenticated && user?.role === "ADMIN";

  const value = {
    user,
    session,
    csrfToken,

    authReady,
    isAuthenticated,
    isAdmin,

    loginAdmin,
    logoutUser,

    refreshAuthentication,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider.");
  }

  return context;
}
