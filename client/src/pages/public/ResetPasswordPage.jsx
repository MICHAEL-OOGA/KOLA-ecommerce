import { useMemo, useState } from "react";

import { Link, useLocation } from "react-router-dom";

import { resetPassword } from "../../api/auth.api.js";

const RESET_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

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
      {visible ? "Hide" : "Show"}
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

function ResetPasswordPage() {
  const location = useLocation();

  const token = useMemo(() => {
    const fragment = location.hash.startsWith("#")
      ? location.hash.slice(1)
      : location.hash;

    const params = new URLSearchParams(fragment);

    const value = params.get("token")?.trim() || "";

    return RESET_TOKEN_PATTERN.test(value) ? value.toLowerCase() : "";
  }, [location.hash]);

  const [formData, setFormData] = useState({
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState(null);

  const [fieldErrors, setFieldErrors] = useState({});

  const passwordByteLength = new TextEncoder().encode(formData.password).length;

  const passwordChecks = {
    length: formData.password.length >= 12,
    lowercase: /[a-z]/.test(formData.password),
    uppercase: /[A-Z]/.test(formData.password),
    number: /\d/.test(formData.password),
    special: /[^A-Za-z0-9]/.test(formData.password),
    byteLength: passwordByteLength <= 72,
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));

    setFieldErrors((current) => {
      if (!current[name]) {
        return current;
      }

      const next = {
        ...current,
      };

      delete next[name];

      return next;
    });

    if (error) {
      setError(null);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting || !token) {
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setFieldErrors((current) => ({
        ...current,
        confirmPassword: "Password confirmation does not match.",
      }));

      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await resetPassword({
        token,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      });

      /*
       * Password reset revokes every server session and clears the auth cookie.
       *
       * A full navigation guarantees AuthContext starts again from the backend
       * instead of retaining stale in-memory authentication state.
       */
      window.location.replace("/login?passwordReset=1");
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

      if (error?.code === "INVALID_OR_EXPIRED_RESET_TOKEN") {
        setError(
          "This password-reset link is invalid, expired, or has already been used.",
        );

        return;
      }

      setError(error?.message || "Your password could not be reset.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
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
        <div className="w-full max-w-md text-center">
          <p
            className="
              text-sm
              font-black
              uppercase
              tracking-[0.15em]
              text-red-500
            "
          >
            Invalid reset link
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
            Request a new link.
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-500
            "
          >
            This password-reset link is missing or invalid.
          </p>

          <Link
            to="/forgot-password"
            className="
              mt-8
              inline-flex
              rounded-full
              bg-slate-950
              px-7
              py-3.5
              text-sm
              font-black
              text-white
              transition
              hover:bg-emerald-600
            "
          >
            Request new reset link
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
            Secure reset
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
            Choose a new password.
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-500
            "
          >
            Your new password must meet the same security rules used when
            creating a KOLA account.
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
              htmlFor="password"
              className="
                text-sm
                font-bold
                text-slate-950
              "
            >
              New password
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
                  pr-20
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
                  setShowPassword((current) => !current);
                }}
                label="new password"
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

              <PasswordCheck
                passed={passwordChecks.byteLength}
                text="Within bcrypt byte limit"
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
              Confirm new password
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
                placeholder="Enter your new password again"
                className="
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  py-3.5
                  pl-4
                  pr-20
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
                  setShowConfirmPassword((current) => !current);
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
            {submitting ? "Resetting password..." : "Reset password"}
          </button>

          <p
            className="
              mt-6
              text-center
              text-sm
              text-slate-500
            "
          >
            Need another link?{" "}
            <Link
              to="/forgot-password"
              className="
                font-bold
                text-slate-950
                underline
                underline-offset-4
                transition
                hover:text-emerald-600
              "
            >
              Request one
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

export default ResetPasswordPage;
