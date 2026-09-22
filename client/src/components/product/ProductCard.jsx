import { useState } from "react";
import { Link } from "react-router-dom";

import { formatCurrency } from "../../utils/currency.js";

const LOW_STOCK_DISPLAY_THRESHOLD = 5;

function ProductCard({ product }) {
  const [imageFailed, setImageFailed] = useState(false);

  const hasUsableImage = Boolean(product.imageUrl) && !imageFailed;

  const stock = Number(product.stock);

  const safeStock = Number.isSafeInteger(stock) && stock >= 0 ? stock : 0;

  const soldOut = safeStock === 0;

  const lowStock = safeStock > 0 && safeStock <= LOW_STOCK_DISPLAY_THRESHOLD;

  return (
    <article
      className="
        group
        overflow-hidden
        rounded-[1.75rem]
        border-[5px]
        border-green-900
        bg-green-800
        transition
        duration-300
        hover:-translate-y-1
        hover:shadow-xl
        hover:shadow-slate-200/60
      "
    >
      <Link
        to={`/products/${encodeURIComponent(product.id)}`}
        className="block"
      >
        <div
          className="
            relative
            aspect-[4/5]
            overflow-hidden
            bg-slate-100
          "
        >
          {hasUsableImage ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => {
                setImageFailed(true);
              }}
              className={`
                h-full
                w-full
                object-cover
                transition
                duration-500
                group-hover:scale-105

                ${soldOut ? "opacity-60" : ""}
              `}
            />
          ) : (
            <div
              className="
                flex
                h-full
                flex-col
                items-center
                justify-center
                gap-3
                bg-slate-100
                text-slate-400
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
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="
                    M4 16l4.586-4.586a2 2 0 012.828 0L16 16
                    m-2-2 1.586-1.586a2 2 0 012.828 0L20 14
                    M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2
                    2 0 00-2 2v12a2 2 0 002 2z
                  "
                />
              </svg>

              <span className="text-sm font-medium">Image unavailable</span>
            </div>
          )}

          {soldOut && (
            <span
              className="
                absolute
                left-4
                top-4
                rounded-full
                bg-slate-950
                px-4
                py-2
                text-xs
                font-black
                uppercase
                tracking-wider
                text-white
              "
            >
              Sold out
            </span>
          )}

          {!soldOut && lowStock && (
            <span
              className="
                  absolute
                  left-4
                  top-4
                  rounded-full
                  bg-amber-50
                  px-4
                  py-2
                  text-xs
                  font-black
                  text-amber-700
                "
            >
              Only {safeStock} left
            </span>
          )}
        </div>

        <div className="p-5">
          {product.category && (
            <p
              className="
                text-xs
                font-bold
                uppercase
                tracking-[0.14em]
                text-emerald-600
              "
            >
              {product.category.name}
            </p>
          )}

          <h3
            className="
              mt-2
              text-lg
              font-bold
              tracking-tight
              text-slate-950
            "
          >
            {product.name}
          </h3>

          <div
            className="
              mt-4
              flex
              items-end
              justify-between
              gap-4
            "
          >
            <p
              className="
                text-lg
                font-black
                text-slate-950
              "
            >
              {formatCurrency(product.price)}
            </p>

            <span
              className="
                text-sm
                font-semibold
                text-slate-500
                transition
                group-hover:text-slate-950
              "
            >
              View →
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

export default ProductCard;
