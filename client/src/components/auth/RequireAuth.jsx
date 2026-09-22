import { useEffect, useState } from "react";

import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../context/AuthContext.jsx";

function RequireAuth() {
  const location = useLocation();

  const { authReady, isAuthenticated, refreshAuthentication } = useAuth();

  const [verifying, setVerifying] = useState(true);

  const [verified, setVerified] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Revalidate protected access
  |--------------------------------------------------------------------------
  |
  | React authentication state is useful for UI.
  |
  | Backend session verification determines whether
  | protected navigation continues.
  */

  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (!isAuthenticated) {
      setVerified(false);
      setVerifying(false);

      return;
    }

    const controller = new AbortController();

    const verify = async () => {
      setVerifying(true);

      const valid = await refreshAuthentication({
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return;
      }

      setVerified(valid);
      setVerifying(false);
    };

    void verify();

    return () => {
      controller.abort();
    };
  }, [authReady, isAuthenticated, refreshAuthentication, location.pathname]);

  /*
  |--------------------------------------------------------------------------
  | Initial authentication restoration
  |--------------------------------------------------------------------------
  */

  if (!authReady || verifying) {
    return (
      <main
        className="
          mx-auto
          min-h-[70vh]
          max-w-7xl
          px-4
          py-16
          sm:px-6
          lg:px-8
        "
      >
        <div className="animate-pulse">
          <div
            className="
              h-4
              w-24
              rounded
              bg-slate-200
            "
          />

          <div
            className="
              mt-4
              h-12
              w-72
              max-w-full
              rounded
              bg-slate-200
            "
          />

          <div
            className="
              mt-10
              h-64
              rounded-[2rem]
              bg-slate-100
            "
          />
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | No valid session
  |--------------------------------------------------------------------------
  */

  if (!isAuthenticated || !verified) {
    const returnTo = `${location.pathname}${location.search}`;

    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: returnTo,
        }}
      />
    );
  }

  return <Outlet />;
}

export default RequireAuth;
