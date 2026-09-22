import { Outlet } from "react-router-dom";

import Navbar from "./Navbar.jsx";

import Footer from "./Footer.jsx";

function StoreLayout() {
  return (
    <div
      className="
        min-h-screen
        bg-[#f8faf9]
        text-slate-950
      "
    >
      <Navbar />

      <Outlet />

      <Footer />
    </div>
  );
}

export default StoreLayout;
