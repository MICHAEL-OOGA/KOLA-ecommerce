import { useEffect, useState } from "react";

import { Link, useSearchParams } from "react-router-dom";

import {
  getAdminProducts,
  getAdminProductSummary,
} from "../api/products.api.js";

/*
|--------------------------------------------------------------------------
| Filters
|--------------------------------------------------------------------------
*/

const PRODUCT_FILTERS = [
  {
    value: "ALL",
    label: "All",
  },
  {
    value: "ACTIVE",
    label: "Active",
  },
  {
    value: "INACTIVE",
    label: "Inactive",
  },
];

const VALID_FILTERS = new Set(PRODUCT_FILTERS.map((filter) => filter.value));

/*
|--------------------------------------------------------------------------
| Formatting
|--------------------------------------------------------------------------
*/

const formatCurrency = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "KSh 0.00";
  }

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
  }).format(numericValue);
};

const formatDate = (value) => {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

/*
|--------------------------------------------------------------------------
| Stock presentation
|--------------------------------------------------------------------------
*/

const getStockState = (stock, lowStockThreshold) => {
  if (stock === 0) {
    return {
      label: "Out of stock",
      className: "bg-red-50 text-red-700",
    };
  }

  if (stock <= lowStockThreshold) {
    return {
      label: "Low stock",
      className: "bg-amber-50 text-amber-700",
    };
  }

  return {
    label: "In stock",
    className: "bg-emerald-50 text-emerald-700",
  };
};

function AdminProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [products, setProducts] = useState([]);

  const [summary, setSummary] = useState(null);

  const [pagination, setPagination] = useState(null);

  const [loading, setLoading] = useState(true);

  const [errorMessage, setErrorMessage] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

  /*
  |--------------------------------------------------------------------------
  | URL state
  |--------------------------------------------------------------------------
  */

  const pageFromUrl = Number(searchParams.get("page") || "1");

  const page =
    Number.isSafeInteger(pageFromUrl) && pageFromUrl >= 1 ? pageFromUrl : 1;

  const statusFromUrl =
    searchParams.get("status")?.trim().toUpperCase() || "ALL";

  const selectedStatus = VALID_FILTERS.has(statusFromUrl)
    ? statusFromUrl
    : "ALL";

  const searchFromUrl = searchParams.get("search")?.trim() || "";

  /*
   * Separate input state means typing doesn't fire
   * an API request on every single keystroke.
   */
  const [searchInput, setSearchInput] = useState(searchFromUrl);

  useEffect(() => {
    setSearchInput(searchFromUrl);
  }, [searchFromUrl]);

  /*
  |--------------------------------------------------------------------------
  | Load inventory
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const controller = new AbortController();

    const loadProducts = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        /*
         * These calls are independent, so run them
         * at the same time instead of waiting sequentially.
         */
        const [productsResponse, summaryResponse] = await Promise.all([
          getAdminProducts({
            page,
            limit: 20,

            status: selectedStatus,

            search: searchFromUrl,

            signal: controller.signal,
          }),

          getAdminProductSummary({
            signal: controller.signal,
          }),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        setProducts(
          Array.isArray(productsResponse.products)
            ? productsResponse.products
            : [],
        );

        setPagination(productsResponse.pagination || null);

        setSummary(summaryResponse.summary || null);
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("Admin products retrieval failed:", error);

        setProducts([]);
        setPagination(null);
        setSummary(null);

        setErrorMessage(error?.message || "Products could not be loaded.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadProducts();

    return () => {
      controller.abort();
    };
  }, [page, selectedStatus, searchFromUrl, reloadKey]);

  /*
  |--------------------------------------------------------------------------
  | Filters
  |--------------------------------------------------------------------------
  */

  const handleStatusChange = (status) => {
    const next = new URLSearchParams(searchParams);

    next.set("page", "1");

    if (status === "ALL") {
      next.delete("status");
    } else {
      next.set("status", status);
    }

    setSearchParams(next);
  };

  /*
  |--------------------------------------------------------------------------
  | Search
  |--------------------------------------------------------------------------
  */

  const handleSearchSubmit = (event) => {
    event.preventDefault();

    const normalizedSearch = searchInput.trim();

    const next = new URLSearchParams(searchParams);

    next.set("page", "1");

    if (normalizedSearch) {
      next.set("search", normalizedSearch);
    } else {
      next.delete("search");
    }

    setSearchParams(next);
  };

  const handleClearSearch = () => {
    setSearchInput("");

    const next = new URLSearchParams(searchParams);

    next.delete("search");
    next.set("page", "1");

    setSearchParams(next);
  };

  /*
  |--------------------------------------------------------------------------
  | Pagination
  |--------------------------------------------------------------------------
  */

  const handlePageChange = (nextPage) => {
    const next = new URLSearchParams(searchParams);

    next.set("page", String(nextPage));

    setSearchParams(next);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  /*
  |--------------------------------------------------------------------------
  | Loading
  |--------------------------------------------------------------------------
  */

  if (loading) {
    return (
      <main
        className="
          mx-auto
          max-w-7xl
          px-5
          py-10
          sm:px-8
          lg:py-12
        "
      >
        <div className="animate-pulse">
          <div className="h-5 w-28 rounded bg-slate-200" />

          <div className="mt-4 h-12 w-72 rounded bg-slate-200" />

          <div
            className="
              mt-10
              grid
              gap-4
              sm:grid-cols-2
              xl:grid-cols-4
            "
          >
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="
                    h-32
                    rounded-[2rem]
                    bg-slate-100
                  "
              />
            ))}
          </div>

          <div
            className="
              mt-8
              h-96
              rounded-[2rem]
              bg-slate-100
            "
          />
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Error
  |--------------------------------------------------------------------------
  */

  if (errorMessage) {
    return (
      <main
        className="
          mx-auto
          max-w-7xl
          px-5
          py-10
          sm:px-8
        "
      >
        <div
          className="
            rounded-[2rem]
            border
            border-red-100
            bg-red-50
            p-7
          "
        >
          <h1
            className="
              text-2xl
              font-black
              text-red-800
            "
          >
            Inventory unavailable
          </h1>

          <p
            className="
              mt-2
              text-sm
              text-red-700
            "
          >
            {errorMessage}
          </p>

          <button
            type="button"
            onClick={() => setReloadKey((current) => current + 1)}
            className="
              mt-5
              rounded-full
              bg-red-700
              px-5
              py-3
              text-sm
              font-black
              text-white
            "
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  const lowStockThreshold = summary?.lowStockThreshold ?? 10;

  const summaryCards = [
    {
      label: "Total products",
      value: summary?.totalProducts ?? 0,
    },
    {
      label: "Active",
      value: summary?.activeProducts ?? 0,
    },
    {
      label: "Low stock",
      value: summary?.lowStockProducts ?? 0,
    },
    {
      label: "Out of stock",
      value: summary?.outOfStockProducts ?? 0,
    },
  ];

  return (
    <main
      className="
        mx-auto
        max-w-7xl
        px-5
        py-10
        sm:px-8
        lg:py-12
      "
    >
      {/* Header */}

      <div
        className="
          flex
          flex-col
          gap-5
          sm:flex-row
          sm:items-end
          sm:justify-between
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
            Inventory
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
            Products
          </h1>

          <p
            className="
              mt-3
              max-w-2xl
              text-slate-500
            "
          >
            Manage KOLA's catalogue and monitor inventory levels.
          </p>
        </div>

        <Link
          to="/products/new"
          className="
            self-start
            rounded-full
            bg-slate-950
            px-6
            py-3
            text-sm
            font-black
            text-white
            transition
            hover:bg-slate-800
            sm:self-auto
          "
        >
          + Add product
        </Link>
      </div>

      {/* Summary */}

      <section
        className="
          mt-10
          grid
          gap-4
          sm:grid-cols-2
          xl:grid-cols-4
        "
      >
        {summaryCards.map((card) => (
          <article
            key={card.label}
            className="
                rounded-[2rem]
                border
                border-slate-200
                bg-white
                p-6
              "
          >
            <p
              className="
                  text-sm
                  font-bold
                  text-slate-500
                "
            >
              {card.label}
            </p>

            <p
              className="
                  mt-4
                  text-3xl
                  font-black
                  tracking-tight
                  text-slate-950
                "
            >
              {card.value}
            </p>
          </article>
        ))}
      </section>

      {/* Search + Filters */}

      <section
        className="
          mt-8
          rounded-[2rem]
          border
          border-slate-200
          bg-white
          p-5
          sm:p-6
        "
      >
        <form
          onSubmit={handleSearchSubmit}
          className="
            flex
            flex-col
            gap-3
            sm:flex-row
          "
        >
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name or slug..."
            className="
              min-w-0
              flex-1
              rounded-2xl
              border
              border-slate-200
              px-4
              py-3
              text-sm
              outline-none
              transition
              focus:border-slate-950
            "
          />

          <button
            type="submit"
            className="
              rounded-2xl
              bg-slate-950
              px-6
              py-3
              text-sm
              font-black
              text-white
            "
          >
            Search
          </button>

          {searchFromUrl && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="
                rounded-2xl
                border
                border-slate-200
                px-5
                py-3
                text-sm
                font-black
                text-slate-600
              "
            >
              Clear
            </button>
          )}
        </form>

        <div
          className="
            mt-5
            flex
            gap-2
            overflow-x-auto
            pb-1
          "
        >
          {PRODUCT_FILTERS.map((filter) => {
            const active = selectedStatus === filter.value;

            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => handleStatusChange(filter.value)}
                className={`
                    whitespace-nowrap
                    rounded-full
                    px-5
                    py-2.5
                    text-sm
                    font-black
                    transition

                    ${
                      active
                        ? "bg-slate-950 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }
                  `}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Empty */}

      {products.length === 0 && (
        <section
          className="
            mt-7
            rounded-[2rem]
            border
            border-slate-200
            bg-white
            px-6
            py-16
            text-center
          "
        >
          <p
            className="
              text-xs
              font-black
              uppercase
              tracking-[0.16em]
              text-slate-400
            "
          >
            No products
          </p>

          <h2
            className="
              mt-3
              text-3xl
              font-black
              text-slate-950
            "
          >
            Nothing matched.
          </h2>

          <p
            className="
              mx-auto
              mt-3
              max-w-md
              text-sm
              leading-6
              text-slate-500
            "
          >
            Try changing the filter or search term.
          </p>
        </section>
      )}

      {/* Products */}

      {products.length > 0 && (
        <section
          className="
            mt-7
            overflow-hidden
            rounded-[2rem]
            border
            border-slate-200
            bg-white
          "
        >
          {products.map((product) => {
            const stockState = getStockState(product.stock, lowStockThreshold);

            return (
              <article
                key={product.id}
                className="
                    border-b
                    border-slate-100
                    p-5
                    last:border-b-0
                    sm:p-6
                  "
              >
                <div
                  className="
                      grid
                      gap-5
                      lg:grid-cols-[80px_1.6fr_1fr_1fr_auto]
                      lg:items-center
                    "
                >
                  {/* Image */}

                  <div
                    className="
                        h-20
                        w-20
                        overflow-hidden
                        rounded-2xl
                        bg-slate-100
                      "
                  >
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt=""
                        className="
                            h-full
                            w-full
                            object-cover
                          "
                      />
                    ) : (
                      <div
                        className="
                            flex
                            h-full
                            w-full
                            items-center
                            justify-center
                            text-xs
                            font-black
                            text-slate-400
                          "
                      >
                        KOLA
                      </div>
                    )}
                  </div>

                  {/* Product */}

                  <div>
                    <div
                      className="
                          flex
                          flex-wrap
                          items-center
                          gap-2
                        "
                    >
                      <h2
                        className="
                            font-black
                            text-slate-950
                          "
                      >
                        {product.name}
                      </h2>

                      <span
                        className={`
                            rounded-full
                            px-3
                            py-1
                            text-[10px]
                            font-black
                            uppercase
                            tracking-wider

                            ${
                              product.isActive
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }
                          `}
                      >
                        {product.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <p
                      className="
                          mt-1
                          text-sm
                          text-slate-400
                        "
                    >
                      {product.slug}
                    </p>

                    <p
                      className="
                          mt-2
                          text-xs
                          text-slate-400
                        "
                    >
                      {product.category?.name || "Uncategorized"}
                    </p>
                  </div>

                  {/* Price */}

                  <div>
                    <p
                      className="
                          text-xs
                          font-black
                          uppercase
                          tracking-wider
                          text-slate-400
                        "
                    >
                      Price
                    </p>

                    <p
                      className="
                          mt-2
                          font-black
                          text-slate-950
                        "
                    >
                      {formatCurrency(product.price)}
                    </p>
                  </div>

                  {/* Inventory */}

                  <div>
                    <p
                      className="
                          text-xs
                          font-black
                          uppercase
                          tracking-wider
                          text-slate-400
                        "
                    >
                      Inventory
                    </p>

                    <div
                      className="
                          mt-2
                          flex
                          flex-wrap
                          items-center
                          gap-2
                        "
                    >
                      <p
                        className="
                            font-black
                            text-slate-950
                          "
                      >
                        {product.stock}
                      </p>

                      <span
                        className={`
                            rounded-full
                            px-3
                            py-1
                            text-[10px]
                            font-black
                            uppercase
                            tracking-wider

                            ${stockState.className}
                          `}
                      >
                        {stockState.label}
                      </span>
                    </div>

                    <p
                      className="
                          mt-2
                          text-xs
                          text-slate-400
                        "
                    >
                      Updated {formatDate(product.updatedAt)}
                    </p>
                  </div>

                  {/* Action */}

                  <Link
                    to={`/products/${encodeURIComponent(product.id)}`}
                    className="
                        inline-flex
                        justify-center
                        rounded-full
                        bg-slate-950
                        px-5
                        py-3
                        text-sm
                        font-black
                        text-white
                        transition
                        hover:bg-slate-800
                      "
                  >
                    Manage
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* Pagination */}

      {pagination && pagination.totalPages > 1 && (
        <div
          className="
              mt-8
              flex
              items-center
              justify-between
              gap-4
            "
        >
          <button
            type="button"
            disabled={!pagination.hasPreviousPage}
            onClick={() => handlePageChange(page - 1)}
            className="
                rounded-full
                border
                border-slate-200
                bg-white
                px-5
                py-3
                text-sm
                font-black
                text-slate-700
                disabled:cursor-not-allowed
                disabled:opacity-40
              "
          >
            ← Previous
          </button>

          <p
            className="
                text-sm
                font-bold
                text-slate-500
              "
          >
            Page {pagination.page} of {pagination.totalPages}
          </p>

          <button
            type="button"
            disabled={!pagination.hasNextPage}
            onClick={() => handlePageChange(page + 1)}
            className="
                rounded-full
                border
                border-slate-200
                bg-white
                px-5
                py-3
                text-sm
                font-black
                text-slate-700
                disabled:cursor-not-allowed
                disabled:opacity-40
              "
          >
            Next →
          </button>
        </div>
      )}
    </main>
  );
}

export default AdminProductsPage;
