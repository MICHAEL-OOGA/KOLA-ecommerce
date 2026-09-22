import { useState } from "react";

import { Link } from "react-router-dom";

import { forgotPassword } from "../../api/auth.api.js";

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState(null);

  const [successMessage, setSuccessMessage] = useState(null);

  const [developmentResetUrl, setDevelopmentResetUrl] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    setDevelopmentResetUrl(null);

    try {
      const response = await forgotPassword(email.trim());

      setSuccessMessage(
        response.message ||
          "If an account exists for that email address, password-reset instructions will be sent.",
      );

      /*
       * Development only.
       *
       * Production must rely exclusively on the emailed reset link.
       */
      if (
        import.meta.env.DEV &&
        response.developmentOnly &&
        response.developmentResetToken
      ) {
        setDevelopmentResetUrl(
          `/reset-password#token=${encodeURIComponent(
            response.developmentResetToken,
          )}`,
        );
      }
    } catch (error) {
      setError(
        error?.message || "The password-reset request could not be completed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

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
            Account recovery
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
            Forgot your password?
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-500
            "
          >
            Enter your email address. If a KOLA account exists for it, we'll
            send secure password-reset instructions.
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

          {successMessage && (
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
              {successMessage}
            </div>
          )}

          <label
            htmlFor="forgotPasswordEmail"
            className="
              text-sm
              font-bold
              text-slate-950
            "
          >
            Email address
          </label>

          <input
            id="forgotPasswordEmail"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={submitting}
            onChange={(event) => {
              setEmail(event.target.value);

              if (error) {
                setError(null);
              }
            }}
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
              disabled:cursor-not-allowed
              disabled:bg-slate-50
            "
          />

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
            {submitting ? "Sending instructions..." : "Send reset instructions"}
          </button>

          {developmentResetUrl && (
            <div
              className="
                mt-6
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
                  leading-6
                  text-amber-800
                "
              >
                The backend exposed the development reset credential so you can
                test this flow without SMTP.
              </p>

              <Link
                to={developmentResetUrl}
                className="
                  mt-4
                  inline-flex
                  rounded-full
                  bg-amber-900
                  px-5
                  py-3
                  text-sm
                  font-black
                  text-white
                "
              >
                Open development reset link
              </Link>
            </div>
          )}

          <p
            className="
              mt-6
              text-center
              text-sm
              text-slate-500
            "
          >
            Remembered your password?{" "}
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

export default ForgotPasswordPage;
