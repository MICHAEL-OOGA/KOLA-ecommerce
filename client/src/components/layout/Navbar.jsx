import { useState } from "react";

import { Link, NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext.jsx";

import { useCart } from "../../context/CartContext.jsx";

function Navbar() {
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const [loggingOut, setLoggingOut] = useState(false);

  const { user, authReady, isAuthenticated, logoutUser } = useAuth();

  const { cartCount, clearCart } = useCart();

  const navigation = [
    {
      label: "Home",
      to: "/",
    },
    {
      label: "Shop",
      to: "/shop",
    },
  ];

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

    try {
      await logoutUser();

      /*
       * Remove this customer's cart
       * representation from React.
       *
       * Server cart remains stored for
       * their next authenticated session.
       */
      clearCart();

      setAccountMenuOpen(false);

      setMobileMenuOpen(false);

      navigate("/", {
        replace: true,
      });
    } catch (error) {
      console.error("Logout failed:", error);

      /*
       * A 401/503 may already have cleared
       * authentication state.
       */
      if (error?.status === 401 || error?.status === 503) {
        clearCart();

        navigate("/", {
          replace: true,
        });
      }
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header
      className="
        sticky
        top-0
        z-50
        border-b
        border-slate-200/80
        bg-white/90
        backdrop-blur-xl
      "
    >
      <div
        className="
          mx-auto
          flex
          h-20
          max-w-7xl
          items-center
          justify-between
          px-4
          sm:px-6
          lg:px-8
        "
      >
        <Link
          to="/"
          className="
            text-xl
            font-black
            tracking-[-0.04em]
            text-slate-950
          "
        >
          KOLA
          <span className="text-emerald-600">.</span>
        </Link>

        {/* Desktop navigation */}

        <nav
          className="
            hidden
            items-center
            gap-8
            md:flex
          "
        >
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "text-sm font-medium transition-colors",

                  isActive
                    ? "text-slate-950"
                    : "text-slate-500 hover:text-slate-950",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Desktop account/cart */}

        <div
          className="
            hidden
            items-center
            gap-3
            md:flex
          "
        >
          {!authReady ? (
            <div
              className="
                h-10
                w-24
                animate-pulse
                rounded-full
                bg-slate-100
              "
            />
          ) : isAuthenticated ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setAccountMenuOpen((current) => !current);
                }}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                className="
                  flex
                  items-center
                  gap-2
                  rounded-full
                  px-4
                  py-2.5
                  text-sm
                  font-semibold
                  text-slate-700
                  transition
                  hover:bg-slate-100
                "
              >
                <span
                  className="
                    flex
                    h-8
                    w-8
                    items-center
                    justify-center
                    rounded-full
                    bg-emerald-100
                    font-black
                    text-emerald-700
                  "
                >
                  {user?.fullName?.charAt(0).toUpperCase() || "U"}
                </span>

                <span className="max-w-32 truncate">
                  {user?.fullName || "Account"}
                </span>

                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  className={`
                    h-4
                    w-4
                    transition-transform

                    ${accountMenuOpen ? "rotate-180" : ""}
                  `}
                  aria-hidden="true"
                >
                  <path
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 9l6 6 6-6"
                  />
                </svg>
              </button>

              {accountMenuOpen && (
                <div
                  role="menu"
                  className="
                    absolute
                    right-0
                    mt-2
                    w-64
                    overflow-hidden
                    rounded-2xl
                    border
                    border-slate-200
                    bg-white
                    p-2
                    shadow-xl
                    shadow-slate-200/60
                  "
                >
                  <div
                    className="
                      border-b
                      border-slate-100
                      px-3
                      py-3
                    "
                  >
                    <p
                      className="
                        truncate
                        text-sm
                        font-bold
                        text-slate-950
                      "
                    >
                      {user?.fullName}
                    </p>

                    <p
                      className="
                        mt-1
                        truncate
                        text-xs
                        text-slate-500
                      "
                    >
                      {user?.email}
                    </p>
                  </div>

                  <Link
                    to="/account"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                    }}
                    className="
                      mt-1
                      block
                      rounded-xl
                      px-3
                      py-2.5
                      text-sm
                      font-semibold
                      text-slate-700
                      transition
                      hover:bg-slate-100
                    "
                  >
                    My account
                  </Link>

                  <Link
                    to="/account/orders"
                    role="menuitem"
                    onClick={() => {
                      setAccountMenuOpen(false);
                    }}
                    className="
                      mt-1
                      block
                      rounded-xl
                      px-3
                      py-2.5
                      text-sm
                      font-semibold
                      text-slate-700
                      transition
                      hover:bg-slate-100
                    "
                  >
                    My orders
                  </Link>

                  <button
                    type="button"
                    role="menuitem"
                    disabled={loggingOut}
                    onClick={handleLogout}
                    className="
                      mt-1
                      w-full
                      rounded-xl
                      px-3
                      py-2.5
                      text-left
                      text-sm
                      font-semibold
                      text-red-600
                      transition
                      hover:bg-red-50
                      disabled:cursor-not-allowed
                      disabled:opacity-60
                    "
                  >
                    {loggingOut ? "Signing out..." : "Sign out"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link
                to="/login"
                className="
                  rounded-full
                  px-5
                  py-2.5
                  text-sm
                  font-semibold
                  text-slate-700
                  transition
                  hover:bg-slate-100
                "
              >
                Sign in
              </Link>

              <Link
                to="/register"
                className="
                  rounded-full
                  border
                  border-slate-200
                  px-5
                  py-2.5
                  text-sm
                  font-semibold
                  text-slate-700
                  transition
                  hover:border-slate-950
                  hover:text-slate-950
                "
              >
                Create account
              </Link>
            </>
          )}

          <Link
            to="/cart"
            className="
              flex
              items-center
              gap-2
              rounded-full
              bg-slate-950
              px-5
              py-2.5
              text-sm
              font-semibold
              text-white
              transition
              hover:bg-slate-800
            "
          >
            Cart
            <span
              className="
                flex
                h-5
                min-w-5
                items-center
                justify-center
                rounded-full
                bg-white
                px-1.5
                text-xs
                font-bold
                text-slate-950
              "
            >
              {cartCount}
            </span>
          </Link>
        </div>

        {/* Mobile toggle */}

        <button
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={mobileMenuOpen}
          onClick={() => {
            setMobileMenuOpen((current) => !current);

            setAccountMenuOpen(false);
          }}
          className="
            flex
            h-11
            w-11
            items-center
            justify-center
            rounded-full
            border
            border-slate-200
            md:hidden
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
              strokeLinecap="round"
              strokeWidth="2"
              d={
                mobileMenuOpen
                  ? "M6 6l12 12M18 6L6 18"
                  : "M4 7h16M4 12h16M4 17h16"
              }
            />
          </svg>
        </button>
      </div>

      {/* Mobile menu */}

      {mobileMenuOpen && (
        <div
          className="
            border-t
            border-slate-200
            bg-white
            px-4
            py-5
            md:hidden
          "
        >
          <nav
            className="
              mx-auto
              flex
              max-w-7xl
              flex-col
              gap-2
            "
          >
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => {
                  setMobileMenuOpen(false);
                }}
                className="
                    rounded-xl
                    px-4
                    py-3
                    font-medium
                    text-slate-700
                    hover:bg-slate-100
                  "
              >
                {item.label}
              </NavLink>
            ))}

            {authReady && isAuthenticated ? (
              <>
                <div
                  className="
                    mt-2
                    rounded-2xl
                    bg-slate-50
                    px-4
                    py-3
                  "
                >
                  <p
                    className="
                      font-bold
                      text-slate-950
                    "
                  >
                    {user?.fullName}
                  </p>

                  <p
                    className="
                      mt-1
                      break-all
                      text-sm
                      text-slate-500
                    "
                  >
                    {user?.email}
                  </p>
                </div>

                <Link
                  to="/account"
                  onClick={() => {
                    setMobileMenuOpen(false);
                  }}
                  className="
                    rounded-xl
                    px-4
                    py-3
                    font-medium
                    text-slate-700
                    hover:bg-slate-100
                  "
                >
                  My account
                </Link>

                <Link
                  to="/account/orders"
                  onClick={() => {
                    setMobileMenuOpen(false);
                  }}
                  className="
                    rounded-xl
                    px-4
                    py-3
                    font-medium
                    text-slate-700
                    hover:bg-slate-100
                  "
                >
                  My orders
                </Link>

                <button
                  type="button"
                  disabled={loggingOut}
                  onClick={handleLogout}
                  className="
                    rounded-xl
                    px-4
                    py-3
                    text-left
                    font-semibold
                    text-red-600
                    hover:bg-red-50
                    disabled:cursor-not-allowed
                    disabled:opacity-60
                  "
                >
                  {loggingOut ? "Signing out..." : "Sign out"}
                </button>
              </>
            ) : authReady ? (
              <>
                <Link
                  to="/login"
                  onClick={() => {
                    setMobileMenuOpen(false);
                  }}
                  className="
                    rounded-xl
                    px-4
                    py-3
                    font-medium
                    text-slate-700
                    hover:bg-slate-100
                  "
                >
                  Sign in
                </Link>

                <Link
                  to="/register"
                  onClick={() => {
                    setMobileMenuOpen(false);
                  }}
                  className="
                    rounded-xl
                    px-4
                    py-3
                    font-medium
                    text-slate-700
                    hover:bg-slate-100
                  "
                >
                  Create account
                </Link>
              </>
            ) : null}

            <Link
              to="/cart"
              onClick={() => {
                setMobileMenuOpen(false);
              }}
              className="
                mt-2
                rounded-xl
                bg-slate-950
                px-4
                py-3
                text-center
                font-semibold
                text-white
              "
            >
              Cart · {cartCount}
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

export default Navbar;
