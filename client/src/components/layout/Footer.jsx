import { Link } from "react-router-dom";

function Footer() {
  return (
    <footer
      className="
        border-t
        border-slate-200
        bg-white
      "
    >
      <div
        className="
          mx-auto
          grid
          max-w-7xl
          gap-10
          px-4
          py-14
          sm:px-6
          md:grid-cols-2
          lg:grid-cols-4
          lg:px-8
        "
      >
        <div
          className="
            lg:col-span-2
          "
        >
          <Link
            to="/"
            className="
              text-xl
              font-black
              tracking-[-0.04em]
            "
          >
            KOLA
            <span className="text-emerald-600">.</span>
          </Link>

          <p
            className="
              mt-4
              max-w-md
              text-sm
              leading-6
              text-slate-500
            "
          >
            Simple shopping, carefully selected products and a checkout
            experience designed to stay effortless.
          </p>
        </div>

        <div>
          <h3
            className="
              text-sm
              font-bold
              text-slate-950
            "
          >
            Shop
          </h3>

          <div
            className="
              mt-4
              flex
              flex-col
              gap-3
              text-sm
              text-slate-500
            "
          >
            <Link to="/shop">All products</Link>

            <Link to="/cart">Cart</Link>
          </div>
        </div>

        <div>
          <h3
            className="
              text-sm
              font-bold
              text-slate-950
            "
          >
            Account
          </h3>

          <div
            className="
              mt-4
              flex
              flex-col
              gap-3
              text-sm
              text-slate-500
            "
          >
            <Link to="/login">Sign in</Link>

            <Link to="/register">Create account</Link>
          </div>
        </div>
      </div>

      <div
        className="
          border-t
          border-slate-200
        "
      >
        <div
          className="
            mx-auto
            max-w-7xl
            px-4
            py-6
            text-sm
            text-slate-400
            sm:px-6
            lg:px-8
          "
        >
          © 2026 KOLA Store. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

export default Footer;
