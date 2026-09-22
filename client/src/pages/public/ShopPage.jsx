import { useEffect, useState } from "react";

import { useSearchParams } from "react-router-dom";

import { getCatalogProducts } from "../../api/products.api.js";

import { getCategories } from "../../api/categories.api.js";

import ProductCard from "../../components/product/ProductCard.jsx";

const VALID_SORTS = new Set(["NEWEST", "PRICE_ASC", "PRICE_DESC", "NAME_ASC"]);

function ShopPage() {
  const [products, setProducts] = useState([]);

  const [categories, setCategories] = useState([]);

  const [pagination, setPagination] = useState(null);

  const [isLoading, setIsLoading] = useState(true);

  const [errorMessage, setErrorMessage] = useState("");

  const [categoriesError, setCategoriesError] = useState("");

  const [searchParams, setSearchParams] = useSearchParams();

  /*
  |--------------------------------------------------------------------------
  | Read URL state
  |--------------------------------------------------------------------------
  */

  const pageFromUrl = Number(searchParams.get("page") || "1");

  const page =
    Number.isSafeInteger(pageFromUrl) && pageFromUrl >= 1 ? pageFromUrl : 1;

  const searchQuery = searchParams.get("search")?.trim() || "";

  const selectedCategory = searchParams.get("category")?.trim() || "all";

  const sortFromUrl =
    searchParams.get("sort")?.trim().toUpperCase() || "NEWEST";

  const sortOption = VALID_SORTS.has(sortFromUrl) ? sortFromUrl : "NEWEST";

  /*
   * Keep typing separate from the URL.
   *
   * This avoids calling the backend for every individual
   * keystroke.
   */
  const [searchInput, setSearchInput] = useState(searchQuery);

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  /*
  |--------------------------------------------------------------------------
  | Load public categories
  |--------------------------------------------------------------------------
  |
  | Categories are independent of page/search/sort, so they only need
  | to load once.
  */

  useEffect(() => {
    const controller = new AbortController();

    const loadCategories = async () => {
      setCategoriesError("");

      try {
        const categoryData = await getCategories({
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setCategories(Array.isArray(categoryData) ? categoryData : []);
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("Category loading error:", error);

        setCategories([]);

        setCategoriesError("Categories are temporarily unavailable.");
      }
    };

    void loadCategories();

    return () => {
      controller.abort();
    };
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Load authoritative catalogue
  |--------------------------------------------------------------------------
  |
  | Every URL-filter change requests a new backend-generated page.
  */

  useEffect(() => {
    const controller = new AbortController();

    const loadProducts = async () => {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const response = await getCatalogProducts({
          page,
          limit: 12,

          search: searchQuery,

          category: selectedCategory === "all" ? "" : selectedCategory,

          sort: sortOption,

          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        /*
         * If someone manually enters a page larger than
         * the available range, move them to the final
         * valid page rather than showing an unexplained
         * empty result.
         */
        if (
          response.pagination?.totalItems > 0 &&
          page > response.pagination.totalPages
        ) {
          const next = new URLSearchParams(searchParams);

          if (response.pagination.totalPages <= 1) {
            next.delete("page");
          } else {
            next.set("page", String(response.pagination.totalPages));
          }

          setSearchParams(next, {
            replace: true,
          });

          return;
        }

        setProducts(Array.isArray(response.products) ? response.products : []);

        setPagination(response.pagination || null);
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("Shop loading error:", error);

        setProducts([]);
        setPagination(null);

        setErrorMessage(error?.message || "The shop could not be loaded.");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadProducts();

    return () => {
      controller.abort();
    };
  }, [page, searchQuery, selectedCategory, sortOption, setSearchParams]);

  /*
  |--------------------------------------------------------------------------
  | URL helpers
  |--------------------------------------------------------------------------
  */

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);

    /*
     * Every filter/sort change returns to page 1.
     */
    next.delete("page");

    if (!value || value === "all" || (key === "sort" && value === "NEWEST")) {
      next.delete(key);
    } else {
      next.set(key, value);
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

    setFilter("search", searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput("");

    setFilter("search", "");
  };

  /*
  |--------------------------------------------------------------------------
  | Pagination
  |--------------------------------------------------------------------------
  */

  const handlePageChange = (nextPage) => {
    const next = new URLSearchParams(searchParams);

    if (nextPage <= 1) {
      next.delete("page");
    } else {
      next.set("page", String(nextPage));
    }

    setSearchParams(next);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  /*
  |--------------------------------------------------------------------------
  | Reset
  |--------------------------------------------------------------------------
  */

  const clearFilters = () => {
    setSearchInput("");
    setSearchParams({});
  };

  const hasActiveFilters =
    Boolean(searchQuery) ||
    selectedCategory !== "all" ||
    sortOption !== "NEWEST";

  return (
    <main
      className="
        min-h-screen
        bg-white
      "
    >
      {/* Page heading */}

      <section
        className="
          mx-auto
          max-w-7xl
          px-4
          pb-8
          pt-12
          sm:px-6
          lg:px-8
          lg:pb-12
          lg:pt-16
        "
      >
        <div className="max-w-2xl">
          <p
            className="
              text-sm
              font-bold
              uppercase
              tracking-[0.2em]
              text-emerald-600
            "
          >
            Shop
          </p>

          <h1
            className="
              mt-3
              text-4xl
              font-black
              tracking-[-0.05em]
              text-slate-950
              sm:text-5xl
              lg:text-6xl
            "
          >
            Find something you’ll love.
          </h1>

          <p
            className="
              mt-5
              max-w-xl
              text-base
              leading-7
              text-slate-500
              sm:text-lg
            "
          >
            Browse our collection, search by product and narrow things down by
            category.
          </p>
        </div>
      </section>

      {/* Search + sorting */}

      <section
        className="
          mx-auto
          max-w-7xl
          px-4
          sm:px-6
          lg:px-8
        "
      >
        <div
          className="
            flex
            flex-col
            gap-4
            rounded-[1.75rem]
            border
            border-slate-200
            bg-white
            p-4
            shadow-sm
            md:flex-row
            md:items-center
          "
        >
          <form
            onSubmit={handleSearchSubmit}
            className="
              flex
              min-w-0
              flex-1
              gap-2
            "
          >
            <div
              className="
                relative
                min-w-0
                flex-1
              "
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
                className="
                  absolute
                  left-4
                  top-1/2
                  h-5
                  w-5
                  -translate-y-1/2
                  text-slate-400
                "
              >
                <circle cx="11" cy="11" r="7" strokeWidth="2" />

                <path
                  d="m20 20-3.5-3.5"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>

              <input
                type="search"
                maxLength={100}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search products..."
                className="
                  h-12
                  w-full
                  rounded-full
                  border
                  border-slate-200
                  bg-slate-50
                  pl-12
                  pr-5
                  text-sm
                  text-slate-950
                  outline-none
                  transition
                  placeholder:text-slate-400
                  focus:border-slate-950
                  focus:bg-white
                "
              />
            </div>

            <button
              type="submit"
              className="
                h-12
                shrink-0
                rounded-full
                bg-slate-950
                px-5
                text-sm
                font-bold
                text-white
                transition
                hover:bg-slate-800
              "
            >
              Search
            </button>
          </form>

          <select
            value={sortOption}
            onChange={(event) => setFilter("sort", event.target.value)}
            className="
              h-12
              rounded-full
              border
              border-slate-200
              bg-white
              px-5
              text-sm
              font-semibold
              text-slate-700
              outline-none
              transition
              focus:border-slate-950
            "
          >
            <option value="NEWEST">Newest</option>

            <option value="PRICE_ASC">Price: Low to high</option>

            <option value="PRICE_DESC">Price: High to low</option>

            <option value="NAME_ASC">Name: A–Z</option>
          </select>
        </div>

        {categoriesError && (
          <p
            className="
              mt-3
              text-sm
              text-amber-700
            "
          >
            {categoriesError}
          </p>
        )}
      </section>

      {/* Categories */}

      {categories.length > 0 && (
        <section
          className="
            mx-auto
            max-w-7xl
            px-4
            py-8
            sm:px-6
            lg:px-8
          "
        >
          <div
            className="
              flex
              gap-3
              overflow-x-auto
              pb-2
            "
          >
            <button
              type="button"
              onClick={() => setFilter("category", "all")}
              className={`
                shrink-0
                rounded-full
                px-5
                py-2.5
                text-sm
                font-semibold
                transition

                ${
                  selectedCategory === "all"
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-slate-950 hover:text-slate-950"
                }
              `}
            >
              All products
            </button>

            {categories.map((category) => {
              const isActive = selectedCategory === category.slug;

              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setFilter("category", category.slug)}
                  className={`
                      shrink-0
                      rounded-full
                      px-5
                      py-2.5
                      text-sm
                      font-semibold
                      transition

                      ${
                        isActive
                          ? "bg-slate-950 text-white"
                          : "border border-slate-200 bg-white text-slate-600 hover:border-slate-950 hover:text-slate-950"
                      }
                    `}
                >
                  {category.name}

                  {Number.isFinite(Number(category._count?.products)) && (
                    <span
                      className="
                          ml-1
                          opacity-60
                        "
                    >
                      ({category._count.products})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Products */}

      <section
        className="
          mx-auto
          max-w-7xl
          px-4
          pb-24
          sm:px-6
          lg:px-8
        "
      >
        {!isLoading && !errorMessage && (
          <div
            className="
                mb-6
                flex
                flex-wrap
                items-center
                justify-between
                gap-4
              "
          >
            <p
              className="
                  text-sm
                  text-slate-500
                "
            >
              Showing{" "}
              <span
                className="
                    font-bold
                    text-slate-950
                  "
              >
                {products.length}
              </span>
              {pagination && (
                <>
                  {" "}
                  of{" "}
                  <span
                    className="
                        font-bold
                        text-slate-950
                      "
                  >
                    {pagination.totalItems}
                  </span>
                </>
              )}{" "}
              product
              {pagination?.totalItems === 1 ? "" : "s"}
            </p>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="
                    text-sm
                    font-semibold
                    text-slate-500
                    transition
                    hover:text-slate-950
                  "
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Loading */}

        {isLoading && (
          <div
            className="
              grid
              gap-6
              sm:grid-cols-2
              lg:grid-cols-3
              xl:grid-cols-4
            "
          >
            {Array.from({
              length: 8,
            }).map((_, index) => (
              <div
                key={index}
                className="
                    h-[430px]
                    animate-pulse
                    rounded-[1.75rem]
                    bg-slate-200
                  "
              />
            ))}
          </div>
        )}

        {/* Error */}

        {!isLoading && errorMessage && (
          <div
            className="
                rounded-[1.5rem]
                border
                border-red-200
                bg-red-50
                p-8
              "
          >
            <h2
              className="
                  font-bold
                  text-red-800
                "
            >
              We couldn't load the shop.
            </h2>

            <p
              className="
                  mt-2
                  text-sm
                  text-red-700
                "
            >
              {errorMessage}
            </p>
          </div>
        )}

        {/* Grid */}

        {!isLoading && !errorMessage && products.length > 0 && (
          <div
            className="
                grid
                gap-6
                sm:grid-cols-2
                lg:grid-cols-3
                xl:grid-cols-4
              "
          >
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}

        {/* Empty */}

        {!isLoading && !errorMessage && products.length === 0 && (
          <div
            className="
                flex
                min-h-[360px]
                flex-col
                items-center
                justify-center
                rounded-[2rem]
                border
                border-dashed
                border-slate-300
                bg-white
                px-6
                text-center
              "
          >
            <div
              className="
                  flex
                  h-14
                  w-14
                  items-center
                  justify-center
                  rounded-full
                  bg-slate-100
                  text-2xl
                "
            >
              🔎
            </div>

            <h2
              className="
                  mt-5
                  text-xl
                  font-black
                  text-slate-950
                "
            >
              No products found
            </h2>

            <p
              className="
                  mt-2
                  max-w-sm
                  text-sm
                  leading-6
                  text-slate-500
                "
            >
              Try another search or remove some of your filters.
            </p>

            <button
              type="button"
              onClick={clearFilters}
              className="
                  mt-6
                  rounded-full
                  bg-slate-950
                  px-6
                  py-3
                  text-sm
                  font-bold
                  text-white
                  transition
                  hover:bg-slate-800
                "
            >
              Reset shop
            </button>
          </div>
        )}

        {/* Pagination */}

        {!isLoading &&
          !errorMessage &&
          pagination &&
          pagination.totalPages > 1 && (
            <div
              className="
                mt-10
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
                  font-bold
                  text-slate-700
                  transition
                  hover:border-slate-950
                  disabled:cursor-not-allowed
                  disabled:opacity-40
                "
              >
                ← Previous
              </button>

              <p
                className="
                  text-sm
                  font-semibold
                  text-slate-500
                "
              >
                Page <span className="text-slate-950">{pagination.page}</span>{" "}
                of{" "}
                <span className="text-slate-950">{pagination.totalPages}</span>
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
                  font-bold
                  text-slate-700
                  transition
                  hover:border-slate-950
                  disabled:cursor-not-allowed
                  disabled:opacity-40
                "
              >
                Next →
              </button>
            </div>
          )}

        {/* Clear just search */}

        {!isLoading && !errorMessage && searchQuery && (
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={handleClearSearch}
              className="
                  text-sm
                  font-semibold
                  text-slate-400
                  transition
                  hover:text-slate-950
                "
            >
              Clear search only
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

export default ShopPage;
