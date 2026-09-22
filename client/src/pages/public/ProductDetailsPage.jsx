import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getProductById } from "../../api/products.api.js";

import AuthRequiredModal from "../../components/auth/AuthRequiredModal.jsx";

import { useAuth } from "../../context/AuthContext.jsx";
import { useCart } from "../../context/CartContext.jsx";

import { formatCurrency } from "../../utils/currency.js";

function ProductDetailsPage() {
  const { productId } = useParams();

  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  const { authReady, isAuthenticated } = useAuth();

  /*
  |--------------------------------------------------------------------------
  | Cart
  |--------------------------------------------------------------------------
  */

  const { addToCart, cartReady, cartError, clearCartError, getCartQuantity } =
    useCart();

  /*
  |--------------------------------------------------------------------------
  | Product state
  |--------------------------------------------------------------------------
  */

  const [product, setProduct] = useState(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState(null);

  const [imageFailed, setImageFailed] = useState(false);

  const [addedToCart, setAddedToCart] = useState(false);

  const [addingToCart, setAddingToCart] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Authentication modal
  |--------------------------------------------------------------------------
  */

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [refreshingAvailability, setRefreshingAvailability] = useState(false);
  /*
  |--------------------------------------------------------------------------
  | Load product
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const controller = new AbortController();

    const loadProduct = async () => {
      try {
        setLoading(true);
        setError(null);
        setImageFailed(false);
        setAddedToCart(false);

        const productData = await getProductById(productId, {
          signal: controller.signal,
        });

        setProduct(productData);
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setError(error.message || "Unable to load product.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    loadProduct();

    return () => {
      controller.abort();
    };
  }, [productId]);

  const refreshAvailability = async () => {
    if (refreshingAvailability || !product?.id) {
      return;
    }

    setRefreshingAvailability(true);

    try {
      const freshProduct = await getProductById(product.id);

      setProduct(freshProduct);
      setImageFailed(false);

      return freshProduct;
    } catch (error) {
      /*
       * If the product was deactivated while this page
       * was open, the public endpoint will now return 404.
       */
      if (error?.status === 404) {
        setError("This product is no longer available.");

        return null;
      }

      console.error("Product availability refresh failed:", error);

      return null;
    } finally {
      setRefreshingAvailability(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Add to cart
  |--------------------------------------------------------------------------
  |
  | IMPORTANT:
  |
  | We do not allow a logged-out customer to reach
  | addToCart().
  |
  | Instead:
  |
  | logged out
  |    ↓
  | open authentication modal
  |
  | logged in
  |    ↓
  | addToCart(product)
  */

  const handleAddToCart = async () => {
    if (!authReady) {
      return;
    }

    /*
     * Product availability shown here is a UX check.
     * The server will independently validate inventory.
     */

    const stock = Number(product?.stock);

    const safeStock = Number.isSafeInteger(stock) && stock >= 0 ? stock : 0;

    if (safeStock <= 0) {
      return;
    }

    if (!isAuthenticated) {
      setAddedToCart(false);

      setAuthModalOpen(true);

      return;
    }

    if (!cartReady || addingToCart) {
      return;
    }

    const currentCartQuantity = getCartQuantity(product.id);

    if (currentCartQuantity >= safeStock) {
      /*
       * Availability may have changed since this page loaded,
       * so recheck the public product endpoint.
       */
      await refreshAvailability();

      return;
    }

    clearCartError();

    setAddingToCart(true);
    setAddedToCart(false);

    try {
      const added = await addToCart(product);

      if (added) {
        setAddedToCart(true);

        return;
      }

      /*
       * The browser thought the operation might be possible,
       * but the authoritative cart mutation rejected it.
       *
       * CartContext has already reconciled the server cart.
       * Now refresh this product as well.
       */
      await refreshAvailability();
    } finally {
      setAddingToCart(false);
    }
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
          min-h-[70vh]
          max-w-7xl
          px-4
          py-12
          sm:px-6
          lg:px-8
        "
      >
        <div
          className="
            grid
            gap-10
            lg:grid-cols-2
            lg:gap-16
          "
        >
          <div
            className="
              aspect-[4/5]
              animate-pulse
              rounded-[2rem]
              bg-slate-200
            "
          />

          <div className="flex flex-col justify-center">
            <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />

            <div className="mt-5 h-12 w-3/4 animate-pulse rounded bg-slate-200" />

            <div className="mt-5 h-8 w-32 animate-pulse rounded bg-slate-200" />

            <div className="mt-8 space-y-3">
              <div className="h-4 w-full animate-pulse rounded bg-slate-200" />

              <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200" />

              <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Error
  |--------------------------------------------------------------------------
  */

  if (error) {
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
          py-12
          sm:px-6
          lg:px-8
        "
      >
        <div className="max-w-lg text-center">
          <p
            className="
              text-sm
              font-bold
              uppercase
              tracking-[0.14em]
              text-red-500
            "
          >
            Something went wrong
          </p>

          <h1
            className="
              mt-3
              text-3xl
              font-black
              tracking-[-0.04em]
              text-slate-950
            "
          >
            Unable to load product
          </h1>

          <p className="mt-4 text-slate-600">{error}</p>

          <Link
            to="/shop"
            className="
              mt-8
              inline-flex
              items-center
              justify-center
              rounded-full
              bg-slate-950
              px-6
              py-3
              text-sm
              font-bold
              text-white
              transition
              hover:bg-emerald-600
            "
          >
            Back to shop
          </Link>
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Product not found
  |--------------------------------------------------------------------------
  */

  if (!product) {
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
          py-12
          sm:px-6
          lg:px-8
        "
      >
        <div className="text-center">
          <h1
            className="
              text-3xl
              font-black
              tracking-[-0.04em]
              text-slate-950
            "
          >
            Product not found
          </h1>

          <p className="mt-3 text-slate-600">
            This product may no longer be available.
          </p>

          <Link
            to="/shop"
            className="
              mt-8
              inline-flex
              rounded-full
              bg-slate-950
              px-6
              py-3
              text-sm
              font-bold
              text-white
              transition
              hover:bg-emerald-600
            "
          >
            Back to shop
          </Link>
        </div>
      </main>
    );
  }

  const hasUsableImage = Boolean(product.imageUrl) && !imageFailed;
  const stock = Number(product.stock);

  const safeStock = Number.isSafeInteger(stock) && stock >= 0 ? stock : 0;

  const soldOut = safeStock === 0;

  const lowStock = safeStock > 0 && safeStock <= 5;

  const cartQuantity =
    isAuthenticated && cartReady ? getCartQuantity(product.id) : 0;

  const reachedStockLimit = safeStock > 0 && cartQuantity >= safeStock;
  return (
    <>
      <main
        className="
          mx-auto
          min-h-[70vh]
          max-w-7xl
          px-4
          py-8
          sm:px-6
          sm:py-12
          lg:px-8
          lg:py-16
        "
      >
        <Link
          to="/shop"
          className="
            inline-flex
            items-center
            gap-2
            text-sm
            font-semibold
            text-slate-500
            transition
            hover:text-slate-950
          "
        >
          <span aria-hidden="true">←</span>
          Back to shop
        </Link>

        <div
          className="
            mt-8
            grid
            gap-10
            lg:grid-cols-2
            lg:items-center
            lg:gap-16
          "
        >
          {/* Product image */}

          <section>
            <div
              className="
                aspect-[4/5]
                overflow-hidden
                rounded-[2rem]
                bg-slate-100
              "
            >
              {hasUsableImage ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  onError={() => {
                    setImageFailed(true);
                  }}
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
                    flex-col
                    items-center
                    justify-center
                    gap-4
                    text-slate-400
                  "
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    className="h-12 w-12"
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

                  <span className="text-sm font-semibold">
                    Image unavailable
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Product information */}

          <section>
            {product.category && (
              <p
                className="
                  text-xs
                  font-black
                  uppercase
                  tracking-[0.18em]
                  text-emerald-600
                "
              >
                {product.category.name}
              </p>
            )}

            <h1
              className="
                mt-3
                max-w-xl
                text-4xl
                font-black
                leading-[0.95]
                tracking-[-0.05em]
                text-slate-950
                sm:text-5xl
                lg:text-6xl
              "
            >
              {product.name}
            </h1>

            <p
              className="
                mt-6
                text-3xl
                font-black
                tracking-tight
                text-slate-950
              "
            >
              {formatCurrency(product.price)}
              <div className="mt-4">
                {soldOut ? (
                  <p
                    className="
        inline-flex
        rounded-full
        bg-red-50
        px-4
        py-2
        text-sm
        font-black
        text-red-700
      "
                  >
                    Sold out
                  </p>
                ) : lowStock ? (
                  <p
                    className="
        inline-flex
        rounded-full
        bg-amber-50
        px-4
        py-2
        text-sm
        font-black
        text-amber-700
      "
                  >
                    Only {safeStock} left
                  </p>
                ) : (
                  <p
                    className="
        inline-flex
        rounded-full
        bg-emerald-50
        px-4
        py-2
        text-sm
        font-black
        text-emerald-700
      "
                  >
                    In stock
                  </p>
                )}

                {cartQuantity > 0 && (
                  <p
                    className="
        mt-3
        text-sm
        font-semibold
        text-slate-500
      "
                  >
                    {cartQuantity} currently in your cart.
                  </p>
                )}
              </div>
            </p>

            <div
              className="
                my-8
                h-px
                w-full
                bg-slate-200
              "
            />

            {/* Description */}

            <div>
              <h2
                className="
                  text-sm
                  font-black
                  uppercase
                  tracking-[0.14em]
                  text-slate-950
                "
              >
                Description
              </h2>

              {product.description ? (
                <p
                  className="
                    mt-4
                    max-w-xl
                    text-base
                    leading-7
                    text-slate-600
                    sm:text-lg
                    sm:leading-8
                  "
                >
                  {product.description}
                </p>
              ) : (
                <p
                  className="
                    mt-4
                    text-base
                    leading-7
                    text-slate-500
                  "
                >
                  No description is available for this product.
                </p>
              )}
            </div>

            {/* Add to cart */}

            <div className="mt-10">
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={
                  soldOut ||
                  reachedStockLimit ||
                  refreshingAvailability ||
                  !authReady ||
                  (isAuthenticated && !cartReady) ||
                  addingToCart
                }
                className="
    w-full
    rounded-full
    bg-emerald-600
    px-8
    py-4
    text-base
    font-black
    text-white
    transition
    hover:bg-emerald-700
    focus:outline-none
    focus:ring-4
    focus:ring-emerald-200
    disabled:cursor-not-allowed
    disabled:opacity-60
    sm:w-auto
  "
              >
                {soldOut
                  ? "Sold out"
                  : reachedStockLimit
                    ? "Maximum in cart"
                    : refreshingAvailability
                      ? "Checking availability..."
                      : !authReady
                        ? "Checking account..."
                        : isAuthenticated && !cartReady
                          ? "Loading cart..."
                          : addingToCart
                            ? "Adding..."
                            : "Add to cart"}

                {soldOut && (
                  <button
                    type="button"
                    onClick={refreshAvailability}
                    disabled={refreshingAvailability}
                    className="
      ml-0
      mt-3
      block
      text-sm
      font-bold
      text-slate-500
      underline
      underline-offset-4
      hover:text-slate-950
      disabled:opacity-50
      sm:ml-4
      sm:inline
    "
                  >
                    {refreshingAvailability
                      ? "Checking..."
                      : "Check availability"}
                  </button>
                )}
              </button>

              {addedToCart && (
                <p
                  className="
                    mt-3
                    text-sm
                    font-semibold
                    text-emerald-600
                  "
                  aria-live="polite"
                >
                  Added to cart.
                </p>
              )}

              {reachedStockLimit && !soldOut && (
                <p
                  className="
        mt-3
        text-sm
        font-semibold
        text-amber-600
      "
                >
                  You currently have all available units in your cart.
                </p>
              )}

              {cartError && (
                <p
                  role="alert"
                  aria-live="polite"
                  className="
      mt-3
      max-w-md
      text-sm
      font-semibold
      text-red-600
    "
                >
                  {cartError}
                </p>
              )}
            </div>

            {/* Secure shopping */}

            <div
              className="
                mt-10
                rounded-[1.5rem]
                border
                border-slate-200
                bg-white
                p-5
              "
            >
              <div className="flex items-start gap-4">
                <div
                  className="
                    flex
                    h-10
                    w-10
                    shrink-0
                    items-center
                    justify-center
                    rounded-full
                    bg-emerald-50
                    text-emerald-600
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
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>

                <div>
                  <p className="font-bold text-slate-950">Secure shopping</p>

                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Your checkout and payment information will be handled
                    securely through KOLA.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Authentication modal */}

      <AuthRequiredModal
        open={authModalOpen}
        onClose={() => {
          setAuthModalOpen(false);
        }}
      />
    </>
  );
}

export default ProductDetailsPage;
