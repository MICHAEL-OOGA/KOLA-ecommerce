import { Link, useLocation } from "react-router-dom";

function AuthRequiredModal({ open, onClose }) {
  const location = useLocation();

  if (!open) {
    return null;
  }

  /*
   * Remember where the customer was before
   * being asked to authenticate.
   *
   * Example:
   *
   * /products/cmt123
   */
  const returnTo = `${location.pathname}${location.search}`;

  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        flex
        items-center
        justify-center
        bg-slate-950/60
        px-4
        backdrop-blur-sm
      "
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-required-title"
      onMouseDown={(event) => {
        /*
         * Close only when the customer clicks
         * directly on the dark backdrop.
         */
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="
          relative
          w-full
          max-w-md
          rounded-[2rem]
          bg-white
          p-7
          shadow-2xl
          sm:p-9
        "
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sign in dialog"
          className="
            absolute
            right-5
            top-5
            flex
            h-10
            w-10
            items-center
            justify-center
            rounded-full
            bg-slate-100
            text-slate-500
            transition
            hover:bg-slate-200
            hover:text-slate-950
          "
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path
              d="M6 6l12 12M18 6L6 18"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Icon */}
        <div
          className="
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
              d="
                M16 11V8
                a4 4 0 00-8 0
                v3
                M6 11h12
                v9H6z
              "
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <p
          className="
            mt-6
            text-xs
            font-black
            uppercase
            tracking-[0.16em]
            text-emerald-600
          "
        >
          KOLA account
        </p>

        <h2
          id="auth-required-title"
          className="
            mt-2
            text-3xl
            font-black
            tracking-[-0.04em]
            text-slate-950
          "
        >
          Sign in to continue.
        </h2>

        <p
          className="
            mt-3
            leading-7
            text-slate-500
          "
        >
          Sign in or create a KOLA account before adding products to your cart.
        </p>

        {/* Existing customer */}
        <Link
          to="/login"
          state={{
            from: returnTo,
          }}
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
          "
        >
          Sign in
        </Link>

        {/* New customer */}
        <Link
          to="/register"
          state={{
            from: returnTo,
          }}
          className="
            mt-3
            flex
            w-full
            items-center
            justify-center
            rounded-full
            border
            border-slate-300
            bg-white
            px-6
            py-4
            text-sm
            font-black
            text-slate-950
            transition
            hover:border-slate-950
          "
        >
          Create account
        </Link>

        <button
          type="button"
          onClick={onClose}
          className="
            mt-5
            w-full
            text-center
            text-sm
            font-semibold
            text-slate-500
            transition
            hover:text-slate-950
          "
        >
          Continue browsing
        </button>
      </div>
    </div>
  );
}

export default AuthRequiredModal;
