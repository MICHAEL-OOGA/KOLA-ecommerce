import { useState } from "react";

import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext.jsx";

function AdminLayout() {
  const navigate = useNavigate();

  const { user, logoutUser } = useAuth();

  const [loggingOut, setLoggingOut] = useState(false);

  const [logoutError, setLogoutError] = useState(null);

  const handleLogout = async () => {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);
    setLogoutError(null);

    try {
      await logoutUser();

      navigate("/login", {
        replace: true,
      });
    } catch (error) {
      setLogoutError(error?.message || "Unable to sign out.");
    } finally {
      setLoggingOut(false);
    }
  };

  const navigation = [
    {
      to: "/",
      label: "Overview",
      end: true,
    },
    {
      to: "/orders",
      label: "Orders",
      end: false,
    },
    {
      to: "/products",
      label: "Products",
      end: false,
    },
    {
      to: "/categories",
      label: "Categories",
      end: false,
    },
  ];

  return (
    <div
      className="
        min-h-screen
        bg-slate-50
        lg:grid
        lg:grid-cols-[260px_1fr]
      "
    >
      <aside
        className="
          border-b
          border-slate-800
          bg-slate-950
          px-5
          py-6
          text-white
          lg:sticky
          lg:top-0
          lg:h-screen
          lg:border-b-0
          lg:border-r
        "
      >
        <div>
          <p
            className="
              text-xs
              font-black
              uppercase
              tracking-[0.18em]
              text-emerald-400
            "
          >
            KOLA
          </p>

          <h1
            className="
              mt-1
              text-2xl
              font-black
              tracking-tight
            "
          >
            Admin
          </h1>
        </div>

        <nav
          className="
            mt-8
            flex
            gap-2
            overflow-x-auto
            lg:flex-col
          "
        >
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `
                  whitespace-nowrap
                  rounded-2xl
                  px-4
                  py-3
                  text-sm
                  font-black
                  transition

                  ${
                    isActive
                      ? "bg-white text-slate-950"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }
                `
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div
          className="
            mt-8
            border-t
            border-white/10
            pt-6
            lg:absolute
            lg:bottom-6
            lg:left-5
            lg:right-5
          "
        >
          <p
            className="
              truncate
              text-sm
              font-black
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

          {logoutError && (
            <p
              className="
                mt-3
                text-xs
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
              mt-4
              w-full
              rounded-xl
              border
              border-white/10
              px-4
              py-2.5
              text-sm
              font-black
              text-slate-300
              transition
              hover:bg-white/5
              hover:text-white
              disabled:opacity-50
            "
          >
            {loggingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export default AdminLayout;
