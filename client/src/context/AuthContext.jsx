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
   * CSRF token lives only in memory.
   *
   * Never localStorage/sessionStorage.
   */
  const [csrfToken, setCsrfToken] = useState(null);

  /*
   * True after the first backend session check finishes.
   */
  const [authReady, setAuthReady] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Clear local authentication state
  |--------------------------------------------------------------------------
  */

  const clearAuthenticationState = useCallback(() => {
    setUser(null);
    setSession(null);
    setCsrfToken(null);
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Verify session against backend
  |--------------------------------------------------------------------------
  |
  | React is not the authentication authority.
  |
  | /auth/me verifies the HttpOnly-cookie session.
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
         * A valid backend session exists.
         */
        setUser(response.user);

        setSession(response.session);

        /*
         * CSRF lives in memory, so get a
         * fresh session-bound token.
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
          console.error("Authentication verification failed:", error);
        }

        /*
         * Fail closed.
         *
         * If KOLA cannot verify the session,
         * React must not pretend the customer
         * is authenticated.
         */
        clearAuthenticationState();

        return false;
      }
    },
    [clearAuthenticationState],
  );

  /*
  |--------------------------------------------------------------------------
  | Restore existing session when KOLA starts
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
  | Clear local auth when known session expiry is reached
  |--------------------------------------------------------------------------
  |
  | This is UX/state synchronization.
  |
  | The backend remains authoritative and independently
  | rejects an expired session.
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
       * setTimeout has a practical maximum
       * delay of roughly 24.8 days.
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
  | Login
  |--------------------------------------------------------------------------
  */

  const loginUser = async ({ email, password }) => {
    const response = await login({
      email,
      password,
    });

    setUser(response.user);

    setSession({
      expiresAt: response.session.expiresAt,
    });

    setCsrfToken(response.session.csrfToken);

    return response;
  };

  /*
  |--------------------------------------------------------------------------
  | Logout
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
       * Your backend clears the browser
       * cookie even when revocation returns
       * 503.
       */
      if (error?.status === 503 || error?.status === 401) {
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

  const value = {
    user,
    session,
    csrfToken,

    authReady,
    isAuthenticated,

    loginUser,
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
