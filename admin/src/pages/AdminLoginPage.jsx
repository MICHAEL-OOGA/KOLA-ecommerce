import { useState } from "react";

import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext.jsx";

function AdminLoginPage() {
  const navigate = useNavigate();

  const location = useLocation();

  const { authReady, isAdmin, loginAdmin } = useAuth();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [errorMessage, setErrorMessage] = useState(null);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,

      [name]: value,
    }));
  };

  /*
  |--------------------------------------------------------------------------
  | Administrator login
  |--------------------------------------------------------------------------
  */

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setSubmitting(true);

    setErrorMessage(null);

    try {
      await loginAdmin({
        email: formData.email.trim(),

        password: formData.password,
      });

      const requestedDestination = location.state?.from;

      navigate(
        typeof requestedDestination === "string" ? requestedDestination : "/",

        {
          replace: true,
        },
      );
    } catch (error) {
      setErrorMessage(error?.message || "Administrator sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Restoring administrator session
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
        "
      >
        <p className="font-bold text-slate-500">
          Checking administrator session...
        </p>
      </main>
    );
  }

  /*
   * A valid ADMIN session already exists.
   */
  if (isAdmin) {
    return <Navigate to="/" replace />;
  }

  /*
  |--------------------------------------------------------------------------
  | Administrator login form
  |--------------------------------------------------------------------------
  */

  return (
    <main
      className="
        flex
        min-h-screen
        items-center
        justify-center
        bg-slate-950
        px-4
        py-12
      "
    >
      <div
        className="
          w-full
          max-w-md
          rounded-[2rem]
          bg-white
          p-7
          shadow-2xl
          sm:p-9
        "
      >
        <p
          className="
            text-sm
            font-black
            uppercase
            tracking-[0.16em]
            text-emerald-600
          "
        >
          KOLA Admin
        </p>

        <h1
          className="
            mt-3
            text-4xl
            font-black
            tracking-[-0.05em]
            text-slate-950
          "
        >
          Welcome back.
        </h1>

        <p
          className="
            mt-3
            text-sm
            leading-6
            text-slate-500
          "
        >
          Sign in with an authorised administrator account.
        </p>

        <form onSubmit={handleSubmit} className="mt-8">
          <div>
            <label
              htmlFor="email"
              className="
                text-sm
                font-bold
                text-slate-700
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
              className="
                mt-2
                w-full
                rounded-2xl
                border
                border-slate-200
                px-4
                py-3.5
                outline-none
                transition
                focus:border-slate-950
              "
            />
          </div>

          <div className="mt-5">
            <label
              htmlFor="password"
              className="
                text-sm
                font-bold
                text-slate-700
              "
            >
              Password
            </label>

            <div className="relative mt-2">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={formData.password}
                onChange={handleChange}
                className="
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  px-4
                  py-3.5
                  pr-20
                  outline-none
                  transition
                  focus:border-slate-950
                "
              />

              <button
                type="button"
                onClick={() => {
                  setShowPassword((current) => !current);
                }}
                aria-pressed={showPassword}
                className="
                  absolute
                  right-4
                  top-1/2
                  -translate-y-1/2
                  text-xs
                  font-black
                  text-slate-500
                "
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {errorMessage && (
            <p
              role="alert"
              className="
                mt-5
                rounded-2xl
                bg-red-50
                px-4
                py-3
                text-sm
                leading-6
                text-red-700
              "
            >
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="
              mt-7
              w-full
              rounded-full
              bg-slate-950
              px-6
              py-4
              text-sm
              font-black
              text-white
              transition
              hover:bg-slate-800
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {submitting ? "Signing in..." : "Sign in to Admin"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default AdminLoginPage;
