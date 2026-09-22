import { useState } from "react";

import { Link, Navigate, useLocation } from "react-router-dom";

import { resendVerification, verifyEmail } from "../../api/auth.api.js";

import { useAuth } from "../../context/AuthContext.jsx";

const VERIFICATION_CODE_LENGTH = 8;

const VERIFICATION_CODE_PATTERN = /^[A-HJ-KM-NP-Z2-9]{8}$/;

function VerifyEmailPage() {
  const { authReady, isAuthenticated } = useAuth();

  const location = useLocation();
  const returnTo =
    typeof location.state?.from === "string" &&
    location.state.from.startsWith("/") &&
    !location.state.from.startsWith("//")
      ? location.state.from
      : "/shop";

  /*
  |--------------------------------------------------------------------------
  | Information carried from RegisterPage
  |--------------------------------------------------------------------------
  */

  const registrationEmail =
    typeof location.state?.email === "string" ? location.state.email : "";

  /*
   * The raw development code is accepted
   * only while Vite is running in development.
   */

  const initialDevelopmentCode =
    import.meta.env.DEV &&
    typeof location.state?.developmentVerificationCode === "string"
      ? location.state.developmentVerificationCode
      : "";

  const [email, setEmail] = useState(registrationEmail);

  const [code, setCode] = useState(initialDevelopmentCode);

  const [verifying, setVerifying] = useState(false);

  const [verified, setVerified] = useState(false);

  const [verificationError, setVerificationError] = useState(null);

  const [resending, setResending] = useState(false);

  const [resendMessage, setResendMessage] = useState(null);

  const [resendError, setResendError] = useState(null);

  const [developmentVerificationCode, setDevelopmentVerificationCode] =
    useState(initialDevelopmentCode || null);

  /*
  |--------------------------------------------------------------------------
  | OTP changes
  |--------------------------------------------------------------------------
  |
  | Codes are case-insensitive.
  |
  | If a customer types:
  |
  | k7m4q2p9
  |
  | React converts it to:
  |
  | K7M4Q2P9
  */

  const handleCodeChange = (event) => {
    const nextCode = event.target.value
      .toUpperCase()
      .slice(0, VERIFICATION_CODE_LENGTH);

    setCode(nextCode);

    if (verificationError) {
      setVerificationError(null);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Verify
  |--------------------------------------------------------------------------
  */

  const handleVerify = async (event) => {
    event.preventDefault();

    if (verifying) {
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    const cleanCode = code.trim().toUpperCase();

    if (!cleanEmail) {
      setVerificationError(
        "Enter the email address used to create your account.",
      );

      return;
    }

    if (!VERIFICATION_CODE_PATTERN.test(cleanCode)) {
      setVerificationError("Enter the complete 8-character verification code.");

      return;
    }

    setVerifying(true);
    setVerificationError(null);

    try {
      await verifyEmail({
        email: cleanEmail,
        code: cleanCode,
      });

      setVerified(true);
    } catch (error) {
      setVerificationError(
        error?.message || "Email verification could not be completed.",
      );
    } finally {
      setVerifying(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Resend
  |--------------------------------------------------------------------------
  */

  const handleResend = async (event) => {
    event.preventDefault();

    if (resending) {
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setResendError(
        "Enter your email address before requesting another code.",
      );

      return;
    }

    setResending(true);

    setResendMessage(null);
    setResendError(null);

    setDevelopmentVerificationCode(null);

    try {
      const response = await resendVerification(cleanEmail);

      setResendMessage(response.message);

      /*
       * Development only.
       *
       * A newly issued OTP invalidates
       * the previous OTP.
       */

      if (
        import.meta.env.DEV &&
        response.developmentOnly &&
        response.developmentVerificationCode
      ) {
        const newCode = response.developmentVerificationCode;

        setDevelopmentVerificationCode(newCode);

        setCode(newCode);
      } else {
        setCode("");
      }
    } catch (error) {
      setResendError(
        error?.message || "Unable to resend the verification code.",
      );
    } finally {
      setResending(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Already authenticated
  |--------------------------------------------------------------------------
  */

  if (authReady && isAuthenticated) {
    return <Navigate to="/account" replace />;
  }

  /*
  |--------------------------------------------------------------------------
  | Auth restoration
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
            h-96
            w-full
            max-w-lg
            animate-pulse
            rounded-[2rem]
            bg-slate-100
          "
        />
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Successful verification
  |--------------------------------------------------------------------------
  */

  if (verified) {
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
            p-8
            text-center
            sm:p-10
          "
        >
          <div
            className="
              mx-auto
              flex
              h-16
              w-16
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
              className="h-8 w-8"
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
            Verification complete
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
            Email verified.
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-600
            "
          >
            Your email address has been verified successfully. You can now sign
            in to your KOLA account.
          </p>

          <Link
            to="/login"
            state={{
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
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      className="
        mx-auto
        min-h-[70vh]
        max-w-7xl
        px-4
        py-12
        sm:px-6
        lg:px-8
      "
    >
      <div className="mx-auto max-w-lg">
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
            Account verification
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
            Enter your code.
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-500
            "
          >
            Enter the 8-character verification code sent to your email address.
          </p>
        </div>

        <form
          onSubmit={handleVerify}
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
          {verificationError && (
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
              {verificationError}
            </div>
          )}

          <div>
            <label
              htmlFor="verificationEmail"
              className="
                text-sm
                font-bold
                text-slate-950
              "
            >
              Email address
            </label>

            <input
              id="verificationEmail"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);

                if (verificationError) {
                  setVerificationError(null);
                }
              }}
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
          </div>

          <div className="mt-6">
            <label
              htmlFor="verificationCode"
              className="
                text-sm
                font-bold
                text-slate-950
              "
            >
              Verification code
            </label>

            <input
              id="verificationCode"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck="false"
              maxLength={VERIFICATION_CODE_LENGTH}
              required
              value={code}
              onChange={handleCodeChange}
              placeholder="K7M4Q2P9"
              className="
                mt-2
                w-full
                rounded-2xl
                border
                border-slate-200
                px-4
                py-4
                text-center
                font-mono
                text-2xl
                font-black
                uppercase
                tracking-[0.35em]
                text-slate-950
                outline-none
                transition
                focus:border-emerald-500
                focus:ring-4
                focus:ring-emerald-100
              "
            />

            <p
              className="
                mt-3
                text-center
                text-xs
                leading-5
                text-slate-400
              "
            >
              The code contains 8 letters and numbers and expires after a short
              period.
            </p>
          </div>

          {developmentVerificationCode && (
            <div
              className="
                mt-5
                rounded-2xl
                border
                border-amber-200
                bg-amber-50
                p-4
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
                The backend exposed the development OTP and it has been
                pre-filled above.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={verifying}
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
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {verifying ? "Verifying..." : "Verify email"}
          </button>
        </form>

        <div
          className="
            mt-6
            rounded-[2rem]
            border
            border-slate-200
            bg-slate-50
            p-6
          "
        >
          <h2
            className="
              text-lg
              font-black
              text-slate-950
            "
          >
            Didn't receive your code?
          </h2>

          <p
            className="
              mt-2
              text-sm
              leading-6
              text-slate-500
            "
          >
            Request another verification code. Your previous code will become
            invalid.
          </p>

          {resendError && (
            <p
              role="alert"
              className="
                mt-4
                text-sm
                text-red-600
              "
            >
              {resendError}
            </p>
          )}

          {resendMessage && (
            <p
              className="
                mt-4
                text-sm
                leading-6
                text-emerald-700
              "
            >
              {resendMessage}
            </p>
          )}

          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="
              mt-5
              w-full
              rounded-full
              border
              border-slate-300
              bg-white
              px-6
              py-3.5
              text-sm
              font-black
              text-slate-950
              transition
              hover:border-slate-950
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {resending ? "Sending..." : "Resend code"}
          </button>
        </div>

        <p
          className="
            mt-6
            text-center
            text-sm
            text-slate-500
          "
        >
          Already verified?{" "}
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
      </div>
    </main>
  );
}

export default VerifyEmailPage;
