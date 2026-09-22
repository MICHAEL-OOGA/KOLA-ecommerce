import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../context/AuthContext.jsx";

function RequireAdmin({ children }) {
  const location = useLocation();

  const { authReady, isAuthenticated, isAdmin } = useAuth();

  /*
  |--------------------------------------------------------------------------
  | Session restoration
  |--------------------------------------------------------------------------
  */

  if (!authReady) {
    return (
      <main
        className="
          flex
          min-h-screen
          items-center
          justify-center
          bg-slate-50
          px-4
        "
      >
        <div className="text-center">
          <div
            className="
              mx-auto
              h-10
              w-10
              animate-pulse
              rounded-full
              bg-slate-200
            "
          />

          <p
            className="
              mt-4
              text-sm
              font-bold
              text-slate-500
            "
          >
            Checking administrator session...
          </p>
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | No authenticated session
  |--------------------------------------------------------------------------
  */

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: `${location.pathname}${location.search}`,
        }}
      />
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Authenticated, but not an administrator
  |--------------------------------------------------------------------------
  */

  if (!isAdmin) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          adminAccessDenied: true,
        }}
      />
    );
  }

  return children;
}

export default RequireAdmin;
