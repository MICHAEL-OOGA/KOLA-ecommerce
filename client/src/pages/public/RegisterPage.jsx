import { useState } from "react";

import { Link, Navigate, useLocation } from "react-router-dom";

import { register } from "../../api/auth.api.js";

import { useAuth } from "../../context/AuthContext.jsx";

function PasswordVisibilityButton({ visible, onToggle, label }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? `Hide ${label}` : `Show ${label}`}
      aria-pressed={visible}
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
      {visible ? (
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
  );
}

function PasswordCheck({ passed, text }) {
  return (
    <div
      className={`
        flex
        items-center
        gap-2
        ${passed ? "text-emerald-600" : "text-slate-400"}
      `}
    >
      <span
        className={`
          flex
          h-4
          w-4
          shrink-0
          items-center
          justify-center
          rounded-full
          text-[10px]
          font-black
          ${passed ? "bg-emerald-100" : "bg-slate-100"}
        `}
      >
        {passed ? "✓" : "·"}
      </span>

      <span>{text}</span>
    </div>
  );
}

function RegisterPage() {
  const { authReady, isAuthenticated } = useAuth();
  const location = useLocation();

  const returnTo =
    typeof location.state?.from === "string" &&
    location.state.from.startsWith("/") &&
    !location.state.from.startsWith("//")
      ? location.state.from
      : "/shop";
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState(null);

  const [fieldErrors, setFieldErrors] = useState({});

  const [registrationComplete, setRegistrationComplete] = useState(false);

  const [successMessage, setSuccessMessage] = useState("");

  /*
  |--------------------------------------------------------------------------
  | Development-only verification code
  |--------------------------------------------------------------------------
  |
  | The backend may expose the raw OTP while we are
  | developing KOLA.
  |
  | Production must never depend on this.
  */

  const [developmentVerificationCode, setDevelopmentVerificationCode] =
    useState(null);

  /*
  |--------------------------------------------------------------------------
  | Input changes
  |--------------------------------------------------------------------------
  */

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((currentFormData) => ({
      ...currentFormData,
      [name]: value,
    }));

    setFieldErrors((currentErrors) => {
      if (!currentErrors[name]) {
        return currentErrors;
      }

      const nextErrors = {
        ...currentErrors,
      };

      delete nextErrors[name];

      return nextErrors;
    });

    if (error) {
      setError(null);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Password feedback
  |--------------------------------------------------------------------------
  */

  const passwordChecks = {
    length: formData.password.length >= 12,

    lowercase: /[a-z]/.test(formData.password),

    uppercase: /[A-Z]/.test(formData.password),

    number: /\d/.test(formData.password),

    special: /[^A-Za-z0-9]/.test(formData.password),
  };

  /*
  |--------------------------------------------------------------------------
  | Registration
  |--------------------------------------------------------------------------
  */

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await register({
        fullName: formData.fullName,

        email: formData.email,

        phone: formData.phone,

        password: formData.password,

        confirmPassword: formData.confirmPassword,
      });

      setSuccessMessage(
        response.message ||
          "Registration submitted. Please check your email for your verification code.",
      );

      /*
       * Development only.
       */

      if (response.developmentOnly && response.developmentVerificationCode) {
        setDevelopmentVerificationCode(response.developmentVerificationCode);
      } else {
        setDevelopmentVerificationCode(null);
      }

      setRegistrationComplete(true);
    } catch (error) {
      const validationErrors = error?.data?.errors;

      if (Array.isArray(validationErrors)) {
        const nextFieldErrors = {};

        validationErrors.forEach((validationError) => {
          if (validationError?.field && validationError?.message) {
            nextFieldErrors[validationError.field] = validationError.message;
          }
        });

        setFieldErrors(nextFieldErrors);
      }

      setError(
        error?.message || "Unable to create your account. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Authenticated customer
  |--------------------------------------------------------------------------
  */

  if (authReady && isAuthenticated) {
    return <Navigate to="/account" replace />;
  }

  /*
  |--------------------------------------------------------------------------
  | Authentication loading
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
            max-w-lg
            animate-pulse
          "
        >
          <div
            className="
              mx-auto
              h-5
              w-28
              rounded
              bg-slate-200
            "
          />

          <div
            className="
              mx-auto
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
              h-[500px]
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
  | Registration successful
  |--------------------------------------------------------------------------
  */

  if (registrationComplete) {
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
        <div
          className="
            w-full
            max-w-lg
            rounded-[2rem]
            border
            border-slate-200
            bg-white
            p-7
            text-center
            sm:p-10
          "
        >
          <div
            className="
              mx-auto
              flex
              h-14
              w-14
              items-center
              justify-center
              rounded-full
              bg-emerald-100
              text-emerald-700
            "
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              className="h-7 w-7"
              aria-hidden="true"
            >
              <path
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <p
            className="
              mt-6
              text-sm
              font-black
              uppercase
              tracking-[0.16em]
              text-emerald-600
            "
          >
            Almost there
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
            Check your email.
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-600
            "
          >
            {successMessage}
          </p>

          <p
            className="
              mt-3
              text-sm
              text-slate-500
            "
          >
            Verification address:{" "}
            <span
              className="
                font-bold
                text-slate-950
              "
            >
              {formData.email}
            </span>
          </p>

          {developmentVerificationCode && (
            <div
              className="
                mt-7
                rounded-2xl
                border
                border-amber-200
                bg-amber-50
                p-5
              "
            >
              <p
                className="
                  text-xs
                  font-black
                  uppercase
                  tracking-[0.12em]
                  text-amber-700
                "
              >
                Development only
              </p>

              <p
                className="
                  mt-2
                  text-sm
                  text-amber-800
                "
              >
                Your verification code is:
              </p>

              <p
                className="
                  mt-3
                  font-mono
                  text-3xl
                  font-black
                  tracking-[0.3em]
                  text-slate-950
                "
              >
                {developmentVerificationCode}
              </p>
            </div>
          )}

          <Link
            to="/verify-email"
            state={{
              email: formData.email,
              developmentVerificationCode,
              from: returnTo,
            }}
            className="
              mt-8
              inline-flex
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
            "
          >
            Continue to verification
          </Link>
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
      <div className="w-full max-w-lg">
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
            Join KOLA
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
            Create your account.
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-500
            "
          >
            Create a secure customer account before shopping with KOLA.
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
          {error && (
            <div
              role="alert"
              className="
                mb-6
                rounded-2xl
                border
                border-red-200
                bg-red-50
                px-4
                py-3
                text-sm
                leading-6
                text-red-700
              "
            >
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="fullName"
              className="
                text-sm
                font-bold
                text-slate-950
              "
            >
              Full name
            </label>

            <input
              id="fullName"
              name="fullName"
              type="text"
              autoComplete="name"
              required
              value={formData.fullName}
              onChange={handleChange}
              placeholder="Your full name"
              className="
                mt-2
                w-full
                rounded-2xl
                border
                border-slate-200
                px-4
                py-3.5
                text-base
                outline-none
                transition
                focus:border-emerald-500
                focus:ring-4
                focus:ring-emerald-100
              "
            />

            {fieldErrors.fullName && (
              <p className="mt-2 text-sm text-red-600">
                {fieldErrors.fullName}
              </p>
            )}
          </div>

          <div className="mt-5">
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
                px-4
                py-3.5
                text-base
                outline-none
                transition
                focus:border-emerald-500
                focus:ring-4
                focus:ring-emerald-100
              "
            />

            {fieldErrors.email && (
              <p className="mt-2 text-sm text-red-600">{fieldErrors.email}</p>
            )}
          </div>

          <div className="mt-5">
            <label
              htmlFor="phone"
              className="
                text-sm
                font-bold
                text-slate-950
              "
            >
              Phone number
              <span
                className="
                  ml-2
                  font-medium
                  text-slate-400
                "
              >
                Optional
              </span>
            </label>

            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              value={formData.phone}
              onChange={handleChange}
              placeholder="+254712345678"
              className="
                mt-2
                w-full
                rounded-2xl
                border
                border-slate-200
                px-4
                py-3.5
                text-base
                outline-none
                transition
                focus:border-emerald-500
                focus:ring-4
                focus:ring-emerald-100
              "
            />

            <p
              className="
                mt-2
                text-xs
                leading-5
                text-slate-400
              "
            >
              Use international format, for example +254712345678.
            </p>

            {fieldErrors.phone && (
              <p className="mt-2 text-sm text-red-600">{fieldErrors.phone}</p>
            )}
          </div>

          <div className="mt-5">
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

            <div className="relative mt-2">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={formData.password}
                onChange={handleChange}
                placeholder="Create a strong password"
                className="
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  py-3.5
                  pl-4
                  pr-14
                  text-base
                  outline-none
                  transition
                  focus:border-emerald-500
                  focus:ring-4
                  focus:ring-emerald-100
                "
              />

              <PasswordVisibilityButton
                visible={showPassword}
                onToggle={() => {
                  setShowPassword((currentValue) => !currentValue);
                }}
                label="password"
              />
            </div>

            {fieldErrors.password && (
              <p className="mt-2 text-sm text-red-600">
                {fieldErrors.password}
              </p>
            )}

            <div
              className="
                mt-4
                grid
                gap-2
                text-xs
                sm:grid-cols-2
              "
            >
              <PasswordCheck
                passed={passwordChecks.length}
                text="At least 12 characters"
              />

              <PasswordCheck
                passed={passwordChecks.uppercase}
                text="One uppercase letter"
              />

              <PasswordCheck
                passed={passwordChecks.lowercase}
                text="One lowercase letter"
              />

              <PasswordCheck passed={passwordChecks.number} text="One number" />

              <PasswordCheck
                passed={passwordChecks.special}
                text="One special character"
              />
            </div>
          </div>

          <div className="mt-5">
            <label
              htmlFor="confirmPassword"
              className="
                text-sm
                font-bold
                text-slate-950
              "
            >
              Confirm password
            </label>

            <div className="relative mt-2">
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Enter your password again"
                className="
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  py-3.5
                  pl-4
                  pr-14
                  text-base
                  outline-none
                  transition
                  focus:border-emerald-500
                  focus:ring-4
                  focus:ring-emerald-100
                "
              />

              <PasswordVisibilityButton
                visible={showConfirmPassword}
                onToggle={() => {
                  setShowConfirmPassword((currentValue) => !currentValue);
                }}
                label="password confirmation"
              />
            </div>

            {fieldErrors.confirmPassword && (
              <p className="mt-2 text-sm text-red-600">
                {fieldErrors.confirmPassword}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="
              mt-8
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
            {submitting ? "Creating account..." : "Create account"}
          </button>

          <p
            className="
              mt-6
              text-center
              text-sm
              text-slate-500
            "
          >
            Already have an account?{" "}
            <Link
              to="/login"
              className="
                font-bold
                text-slate-950
                underline
                underline-offset-4
                transition
                hover:text-emerald-600
              "
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

export default RegisterPage;
