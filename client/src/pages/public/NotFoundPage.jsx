import { Link } from "react-router-dom";

function NotFoundPage() {
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
          max-w-xl
          text-center
        "
      >
        <p
          className="
            text-sm
            font-black
            uppercase
            tracking-[0.18em]
            text-emerald-600
          "
        >
          Error 404
        </p>

        <h1
          className="
            mt-4
            text-5xl
            font-black
            tracking-[-0.06em]
            text-slate-950
            sm:text-6xl
          "
        >
          Page not found.
        </h1>

        <p
          className="
            mx-auto
            mt-5
            max-w-md
            leading-7
            text-slate-500
          "
        >
          The page you're looking for may have moved, been removed, or never
          existed.
        </p>

        <div
          className="
            mt-8
            flex
            flex-wrap
            justify-center
            gap-3
          "
        >
          <Link
            to="/"
            className="
              rounded-full
              bg-slate-950
              px-7
              py-3.5
              text-sm
              font-black
              text-white
              transition
              hover:bg-slate-800
            "
          >
            Go home
          </Link>

          <Link
            to="/shop"
            className="
              rounded-full
              border
              border-slate-200
              px-7
              py-3.5
              text-sm
              font-black
              text-slate-700
              transition
              hover:border-slate-950
              hover:text-slate-950
            "
          >
            Browse shop
          </Link>
        </div>
      </div>
    </main>
  );
}

export default NotFoundPage;
