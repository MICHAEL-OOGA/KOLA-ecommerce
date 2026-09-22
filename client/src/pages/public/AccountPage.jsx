import { useState } from "react";

import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext.jsx";

import { useCart } from "../../context/CartContext.jsx";

function AccountPage() {
  const navigate = useNavigate();

  const { user, session, logoutUser } = useAuth();

  const { clearCart } = useCart();

  const [loggingOut, setLoggingOut] = useState(false);

  const [logoutError, setLogoutError] = useState(null);

  /*
  |--------------------------------------------------------------------------
  | Logout
  |--------------------------------------------------------------------------
  */

  const handleLogout = async () => {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);
    setLogoutError(null);

    try {
      await logoutUser();

      clearCart();

      navigate("/", {
        replace: true,
      });
    } catch (error) {
      /*
       * Authentication state may already have
       * been cleared for an expired session or
       * backend revocation failure.
       */

      if (error?.status === 401 || error?.status === 503) {
        clearCart();

        navigate("/", {
          replace: true,
        });

        return;
      }

      setLogoutError(
        error?.message || "Unable to sign out completely. Please try again.",
      );
    } finally {
      setLoggingOut(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Account details
  |--------------------------------------------------------------------------
  */

  const accountDetails = [
    {
      label: "Full name",

      value: user?.fullName || "Not provided",
    },

    {
      label: "Email address",

      value: user?.email || "Not provided",
    },

    {
      label: "Phone number",

      value: user?.phone || "Not provided",
    },

    {
      label: "Account type",

      value: user?.role === "CUSTOMER" ? "Customer" : user?.role || "User",
    },
  ];

  const expiryDate = session?.expiresAt ? new Date(session.expiresAt) : null;

  const hasValidExpiry = expiryDate && !Number.isNaN(expiryDate.getTime());

  return (
    <main
      className="
        mx-auto
        min-h-[70vh]
        max-w-5xl
        px-4
        py-10
        sm:px-6
        sm:py-14
        lg:px-8
        lg:py-16
      "
    >
      <div>
        <p
          className="
            text-sm
            font-black
            uppercase
            tracking-[0.16em]
            text-emerald-600
          "
        >
          Your account
        </p>

        <h1
          className="
            mt-2
            text-4xl
            font-black
            tracking-[-0.05em]
            text-slate-950
            sm:text-5xl
          "
        >
          Welcome, {user?.fullName?.split(" ")[0] || "there"}.
        </h1>

        <p
          className="
            mt-4
            max-w-2xl
            leading-7
            text-slate-500
          "
        >
          Manage your KOLA account and review your orders and account
          information.
        </p>
      </div>

      <div
        className="
          mt-10
          grid
          gap-6
          lg:grid-cols-[1fr_300px]
          lg:items-start
        "
      >
        <section
          className="
            rounded-[2rem]
            border
            border-slate-200
            bg-white
            p-6
            sm:p-8
          "
        >
          <div
            className="
              flex
              items-center
              gap-4
              border-b
              border-slate-100
              pb-6
            "
          >
            <div
              className="
                flex
                h-14
                w-14
                shrink-0
                items-center
                justify-center
                rounded-full
                bg-emerald-100
                text-xl
                font-black
                text-emerald-700
              "
            >
              {user?.fullName?.charAt(0).toUpperCase() || "U"}
            </div>

            <div className="min-w-0">
              <h2
                className="
                  truncate
                  text-xl
                  font-black
                  text-slate-950
                "
              >
                {user?.fullName}
              </h2>

              <p
                className="
                  mt-1
                  truncate
                  text-sm
                  text-slate-500
                "
              >
                {user?.email}
              </p>
            </div>
          </div>

          <div
            className="
              mt-6
              divide-y
              divide-slate-100
            "
          >
            {accountDetails.map((detail) => (
              <div
                key={detail.label}
                className="
                    grid
                    gap-2
                    py-5
                    sm:grid-cols-[170px_1fr]
                    sm:items-center
                  "
              >
                <p
                  className="
                      text-sm
                      font-semibold
                      text-slate-500
                    "
                >
                  {detail.label}
                </p>

                <p
                  className="
                      break-words
                      font-bold
                      text-slate-950
                    "
                >
                  {detail.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        <aside
          className="
            rounded-[2rem]
            bg-slate-950
            p-6
            text-white
          "
        >
          <p
            className="
              text-xs
              font-black
              uppercase
              tracking-[0.15em]
              text-emerald-400
            "
          >
            Purchases
          </p>

          <Link
            to="/account/orders"
            className="
              mt-4
              block
              rounded-2xl
              border
              border-white/10
              bg-white/5
              p-5
              transition
              hover:bg-white/10
            "
          >
            <div
              className="
                flex
                items-center
                justify-between
                gap-4
              "
            >
              <div>
                <h2
                  className="
                    text-xl
                    font-black
                    text-white
                  "
                >
                  My Orders
                </h2>

                <p
                  className="
                    mt-1
                    text-sm
                    leading-6
                    text-slate-400
                  "
                >
                  Review purchases and payment status.
                </p>
              </div>

              <span
                className="
                  text-xl
                  text-white
                "
                aria-hidden="true"
              >
                →
              </span>
            </div>
          </Link>

          <Link
            to="/cart"
            className="
              mt-3
              block
              rounded-2xl
              border
              border-white/10
              bg-white/5
              p-5
              transition
              hover:bg-white/10
            "
          >
            <div
              className="
                flex
                items-center
                justify-between
                gap-4
              "
            >
              <div>
                <h2
                  className="
                    text-xl
                    font-black
                    text-white
                  "
                >
                  Shopping Cart
                </h2>

                <p
                  className="
                    mt-1
                    text-sm
                    leading-6
                    text-slate-400
                  "
                >
                  Continue your current shopping session.
                </p>
              </div>

              <span
                className="
                  text-xl
                  text-white
                "
                aria-hidden="true"
              >
                →
              </span>
            </div>
          </Link>

          <div
            className="
              my-6
              border-t
              border-white/10
            "
          />

          <p
            className="
              text-xs
              font-black
              uppercase
              tracking-[0.15em]
              text-emerald-400
            "
          >
            Account session
          </p>

          <h2
            className="
              mt-3
              text-2xl
              font-black
              tracking-tight
            "
          >
            You're signed in.
          </h2>

          <p
            className="
              mt-3
              text-sm
              leading-6
              text-slate-400
            "
          >
            Your session is protected using KOLA's HttpOnly cookie
            authentication system.
          </p>

          {hasValidExpiry && (
            <div
              className="
                mt-6
                rounded-2xl
                bg-white/5
                p-4
              "
            >
              <p
                className="
                  text-xs
                  font-semibold
                  uppercase
                  tracking-wider
                  text-slate-400
                "
              >
                Session expiry
              </p>

              <p
                className="
                  mt-2
                  text-sm
                  font-bold
                  text-white
                "
              >
                {expiryDate.toLocaleString()}
              </p>
            </div>
          )}

          {logoutError && (
            <p
              role="alert"
              className="
                mt-5
                rounded-xl
                bg-red-500/10
                px-4
                py-3
                text-sm
                leading-6
                text-red-300
              "
            >
              {logoutError}
            </p>
          )}

          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="
              mt-6
              w-full
              rounded-full
              bg-white
              px-6
              py-3.5
              text-sm
              font-black
              text-slate-950
              transition
              hover:bg-red-50
              hover:text-red-600
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {loggingOut ? "Signing out..." : "Sign out"}
          </button>
        </aside>
      </div>

      <div className="mt-8">
        <Link
          to="/shop"
          className="
            text-sm
            font-bold
            text-slate-500
            transition
            hover:text-slate-950
          "
        >
          ← Continue shopping
        </Link>
      </div>
    </main>
  );
}

export default AccountPage;
