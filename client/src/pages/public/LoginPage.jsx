import { useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { useAuth } from "../../context/AuthContext.jsx";

function LoginPage() {
  const { loginUser, isAuthenticated, authReady } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();

  const [searchParams] = useSearchParams();

  const passwordResetComplete = searchParams.get("passwordReset") === "1";

  const returnTo =
    typeof location.state?.from === "string" &&
    location.state.from.startsWith("/") &&
    !location.state.from.startsWith("//")
      ? location.state.from
      : "/shop";

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [emailNotVerified, setEmailNotVerified] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Handle form field changes
  |--------------------------------------------------------------------------
  */

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((currentFormData) => ({
      ...currentFormData,
      [name]: value,
    }));

    if (error) {
      setError(null);
    }

    if (emailNotVerified) {
      setEmailNotVerified(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Submit login
  |--------------------------------------------------------------------------
  */

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setEmailNotVerified(false);

    try {
      await loginUser({
        email: formData.email,
        password: formData.password,
      });

      navigate(returnTo, {
        replace: true,
      });
    } catch (error) {
      if (error?.code === "EMAIL_NOT_VERIFIED") {
        setEmailNotVerified(true);

        setError(
          error.message ||
            "Please verify your email address before logging in.",
        );

        return;
      }

      setError(error?.message || "Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Already authenticated
  |--------------------------------------------------------------------------
  */

  if (authReady && isAuthenticated) {
    return <Navigate to={returnTo} replace />;
  }

  /*
  |--------------------------------------------------------------------------
  | Authentication restoration loading state
  |--------------------------------------------------------------------------
  */

  if (!authReady) {
    return (
      <main
        className="
          mx-auto
          flex
          min-h-[70vh]
          max-w-7xl
          items-center
          justify-center
          px-4
          py-16
          sm:px-6
          lg:px-8
        "
      >
        <div
          className="
            w-full
            max-w-md
            animate-pulse
          "
        >
          <div
            className="
              mx-auto
              h-5
              w-24
              rounded
              bg-slate-200
            "
          />

          <div
            className="
              mx-auto
              mt-4
              h-12
              w-64
              max-w-full
              rounded
              bg-slate-200
            "
          />

          <div
            className="
              mt-10
              h-80
              rounded-[2rem]
              bg-slate-100
            "
          />
        </div>
      </main>
    );
  }

  return (
    <main
      className="
        mx-auto
        flex
        min-h-[70vh]
        max-w-7xl
        items-center
        justify-center
        px-4
        py-12
        sm:px-6
        lg:px-8
      "
    >
      <div className="w-full max-w-md">
        <div className="text-center">
          <p
            className="
              text-sm
              font-black
              uppercase
              tracking-[0.16em]
              text-emerald-600
            "
          >
            Welcome back
          </p>

          <h1
            className="
              mt-3
              text-4xl
              font-black
              tracking-[-0.05em]
              text-slate-950
              sm:text-5xl
            "
          >
            Sign in to KOLA.
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-500
            "
          >
            Access your account and continue shopping securely.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="
            mt-10
            rounded-[2rem]
            border
            border-slate-200
            bg-white
            p-6
            sm:p-8
          "
        >
          {passwordResetComplete && !error && (
            <div
              role="status"
              className="
                mb-6
                rounded-2xl
                border
                border-emerald-200
                bg-emerald-50
                px-4
                py-3
                text-sm
                leading-6
                text-emerald-800
              "
            >
              Your password has been reset successfully. Sign in with your new
              password.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className={`
                mb-6
                rounded-2xl
                border
                px-4
                py-3
                text-sm
                leading-6
                ${
                  emailNotVerified
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-red-200 bg-red-50 text-red-700"
                }
              `}
            >
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="
                text-sm
                font-bold
                text-slate-950
              "
            >
              Email address
            </label>

            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              className="
                mt-2
                w-full
                rounded-2xl
                border
                border-slate-200
                bg-white
                px-4
                py-3.5
                text-base
                text-slate-950
                outline-none
                transition
                placeholder:text-slate-400
                focus:border-emerald-500
                focus:ring-4
                focus:ring-emerald-100
              "
            />
          </div>

          <div className="mt-5">
            <div
              className="
                flex
                items-center
                justify-between
                gap-4
              "
            >
              <label
                htmlFor="password"
                className="
                  text-sm
                  font-bold
                  text-slate-950
                "
              >
                Password
              </label>

              <Link
                to="/forgot-password"
                className="
                  text-xs
                  font-bold
                  text-emerald-600
                  transition
                  hover:text-emerald-700
                  hover:underline
                  hover:underline-offset-4
                "
              >
                Forgot password?
              </Link>
            </div>

            <div className="relative mt-2">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={formData.password}
                onChange={handleChange}
                placeholder="Enter your password"
                className="
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  bg-white
                  py-3.5
                  pl-4
                  pr-14
                  text-base
                  text-slate-950
                  outline-none
                  transition
                  placeholder:text-slate-400
                  focus:border-emerald-500
                  focus:ring-4
                  focus:ring-emerald-100
                "
              />

              <button
                type="button"
                onClick={() => {
                  setShowPassword((currentValue) => !currentValue);
                }}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="
                  absolute
                  right-2
                  top-1/2
                  flex
                  h-10
                  w-10
                  -translate-y-1/2
                  items-center
                  justify-center
                  rounded-full
                  text-slate-500
                  transition
                  hover:bg-slate-100
                  hover:text-slate-950
                  focus:outline-none
                  focus:ring-2
                  focus:ring-emerald-500
                "
              >
                {showPassword ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="
                        M3 3l18 18
                        M10.6 10.6a2 2 0 002.8 2.8
                        M9.9 4.2A10.4 10.4 0 0112 4
                        c5 0 8.5 4.4 9.5 6
                        a11.7 11.7 0 01-3.1 3.7
                        M6.2 6.2A12.5 12.5 0 002.5 12
                        c1 1.6 4.5 6 9.5 6
                        a10.6 10.6 0 004.1-.8
                      "
                    />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="
                        M2.5 12
                        S6 6 12 6
                        s9.5 6 9.5 6
                        S18 18 12 18
                        2.5 12 2.5 12z
                      "
                    />

                    <circle cx="12" cy="12" r="2.5" strokeWidth="1.8" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="
              mt-7
              flex
              w-full
              items-center
              justify-center
              rounded-full
              bg-slate-950
              px-6
              py-4
              text-sm
              font-black
              text-white
              transition
              hover:bg-emerald-600
              focus:outline-none
              focus:ring-4
              focus:ring-emerald-200
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>

          <p
            className="
              mt-6
              text-center
              text-sm
              text-slate-500
            "
          >
            Don't have an account?{" "}
            <Link
              to="/register"
              className="
                font-bold
                text-slate-950
                underline
                underline-offset-4
                transition
                hover:text-emerald-600
              "
            >
              Create one
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

export default LoginPage;
