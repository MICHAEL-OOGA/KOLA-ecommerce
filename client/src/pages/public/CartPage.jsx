import { useEffect, useRef, useState } from "react";

import { Link } from "react-router-dom";

import { useCart } from "../../context/CartContext.jsx";

import { formatCurrency } from "../../utils/currency.js";

/*
|--------------------------------------------------------------------------
| Cart item
|--------------------------------------------------------------------------
*/

function CartItem({ item, onIncrease, onDecrease, onRemove }) {
  const [imageFailed, setImageFailed] = useState(false);

  const { product, quantity } = item;

  const stock = Number(product.stock);

  const validStock = Number.isSafeInteger(stock) && stock >= 0;

  const unavailable = product.isActive === false || !validStock || stock === 0;

  const exceedsStock = validStock && quantity > stock;

  const reachedStockLimit = validStock && quantity >= stock;

  const hasUsableImage = Boolean(product.imageUrl) && !imageFailed;

  const unitPrice = Number(product.price);

  const subtotal = Number.isFinite(unitPrice) ? unitPrice * quantity : 0;

  return (
    <article
      className="
        grid
        gap-5
        border-b
        border-slate-200
        py-6
        last:border-b-0
        sm:grid-cols-[140px_1fr]
      "
    >
      <Link
        to={`/products/${encodeURIComponent(product.id)}`}
        className="
          aspect-[4/5]
          overflow-hidden
          rounded-[1.5rem]
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

              ${unavailable ? "opacity-60" : ""}
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
              gap-2
              text-slate-400
            "
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              className="h-7 w-7"
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

            <span className="text-xs font-semibold">No image</span>
          </div>
        )}
      </Link>

      <div
        className="
          flex
          flex-col
          justify-between
          gap-5
        "
      >
        <div
          className="
            flex
            flex-col
            gap-3
            sm:flex-row
            sm:items-start
            sm:justify-between
          "
        >
          <div>
            {product.category && (
              <p
                className="
                  text-xs
                  font-black
                  uppercase
                  tracking-[0.14em]
                  text-emerald-600
                "
              >
                {product.category.name}
              </p>
            )}

            <Link
              to={`/products/${encodeURIComponent(product.id)}`}
              className="
                mt-1
                block
                text-xl
                font-black
                tracking-tight
                text-slate-950
                transition
                hover:text-emerald-600
              "
            >
              {product.name}
            </Link>

            <p
              className="
                mt-2
                text-sm
                text-slate-500
              "
            >
              {formatCurrency(product.price)} each
            </p>
          </div>

          <p
            className="
              text-xl
              font-black
              text-slate-950
            "
          >
            {formatCurrency(subtotal)}
          </p>
        </div>

        <div
          className="
            flex
            flex-wrap
            items-center
            justify-between
            gap-4
          "
        >
          <div>
            <div
              className="
                inline-flex
                items-center
                rounded-full
                border
                border-slate-200
                bg-white
                p-1
              "
            >
              <button
                type="button"
                onClick={onDecrease}
                aria-label={`Decrease quantity of ${product.name}`}
                className="
                  flex
                  h-10
                  w-10
                  items-center
                  justify-center
                  rounded-full
                  text-xl
                  font-bold
                  text-slate-700
                  transition
                  hover:bg-slate-100
                  active:scale-95
                "
              >
                −
              </button>

              <span
                className="
                  min-w-10
                  text-center
                  text-sm
                  font-black
                  text-slate-950
                "
              >
                {quantity}
              </span>

              <button
                type="button"
                onClick={onIncrease}
                disabled={unavailable || reachedStockLimit}
                aria-label={`Increase quantity of ${product.name}`}
                className="
                  flex
                  h-10
                  w-10
                  items-center
                  justify-center
                  rounded-full
                  text-xl
                  font-bold
                  text-slate-700
                  transition
                  hover:bg-slate-100
                  active:scale-95
                  disabled:cursor-not-allowed
                  disabled:text-slate-300
                  disabled:hover:bg-transparent
                  disabled:active:scale-100
                "
              >
                +
              </button>
            </div>

            {unavailable ? (
              <p
                className="
                  mt-2
                  max-w-sm
                  text-xs
                  font-semibold
                  text-red-600
                "
              >
                This product is currently unavailable. Remove it before
                checkout.
              </p>
            ) : exceedsStock ? (
              <p
                className="
                  mt-2
                  max-w-sm
                  text-xs
                  font-semibold
                  text-red-600
                "
              >
                Only {stock} currently available. Reduce the quantity before
                checkout.
              </p>
            ) : reachedStockLimit ? (
              <p
                className="
                  mt-2
                  text-xs
                  font-semibold
                  text-amber-600
                "
              >
                Maximum available quantity reached.
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onRemove}
            className="
              text-sm
              font-semibold
              text-slate-500
              underline
              underline-offset-4
              transition
              hover:text-red-600
            "
          >
            Remove
          </button>
        </div>
      </div>
    </article>
  );
}

/*
|--------------------------------------------------------------------------
| Cart error
|--------------------------------------------------------------------------
*/

function CartErrorMessage({ message, onDismiss }) {
  if (!message) {
    return null;
  }

  return (
    <div
      role="alert"
      className="
        mt-6
        flex
        items-start
        justify-between
        gap-5
        rounded-2xl
        border
        border-red-200
        bg-red-50
        px-5
        py-4
        text-sm
        text-red-700
      "
    >
      <p>{message}</p>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss cart error"
        className="
          shrink-0
          font-black
          text-red-500
          transition
          hover:text-red-700
        "
      >
        ×
      </button>
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| Cart page
|--------------------------------------------------------------------------
*/

function CartPage() {
  const {
    cartItems,
    cartCount,
    cartTotal,
    cartReady,
    cartRefreshing,
    cartError,

    refreshCart,

    addToCart,
    decreaseCartQuantity,
    removeFromCart,

    clearCartOnServer,
    clearCartError,
  } = useCart();

  const [clearingCart, setClearingCart] = useState(false);

  const refreshedOnMountRef = useRef(false);

  /*
  |--------------------------------------------------------------------------
  | Refresh cart once when this page becomes ready
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!cartReady || refreshedOnMountRef.current) {
      return;
    }

    refreshedOnMountRef.current = true;

    void refreshCart();
  }, [cartReady, refreshCart]);

  /*
  |--------------------------------------------------------------------------
  | Availability issues
  |--------------------------------------------------------------------------
  */

  const cartHasAvailabilityIssues = cartItems.some((item) => {
    const stock = Number(item.product?.stock);

    if (item.product?.isActive === false) {
      return true;
    }

    if (!Number.isSafeInteger(stock) || stock <= 0) {
      return true;
    }

    return item.quantity > stock;
  });

  /*
  |--------------------------------------------------------------------------
  | Clear cart
  |--------------------------------------------------------------------------
  */

  const handleClearCart = async () => {
    if (clearingCart || cartItems.length === 0) {
      return;
    }

    setClearingCart(true);

    try {
      await clearCartOnServer();
    } finally {
      setClearingCart(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Loading
  |--------------------------------------------------------------------------
  */

  if (!cartReady) {
    return (
      <main
        className="
          mx-auto
          min-h-[70vh]
          max-w-7xl
          px-4
          py-10
          sm:px-6
          sm:py-14
          lg:px-8
          lg:py-16
        "
      >
        <div>
          <div
            className="
              h-4
              w-24
              animate-pulse
              rounded
              bg-slate-200
            "
          />

          <div
            className="
              mt-4
              h-12
              w-64
              max-w-full
              animate-pulse
              rounded
              bg-slate-200
            "
          />
        </div>

        <div
          className="
            mt-10
            grid
            gap-10
            lg:grid-cols-[1fr_360px]
          "
        >
          <div
            className="
              h-64
              animate-pulse
              rounded-[2rem]
              bg-slate-100
            "
          />

          <div
            className="
              h-64
              animate-pulse
              rounded-[2rem]
              bg-slate-200
            "
          />
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Empty cart
  |--------------------------------------------------------------------------
  */

  if (cartItems.length === 0) {
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
            w-full
            max-w-lg
            text-center
          "
        >
          <p
            className="
              text-sm
              font-black
              uppercase
              tracking-[0.16em]
              text-emerald-600
            "
          >
            Your cart
          </p>

          <h1
            className="
              mt-3
              text-4xl
              font-black
              tracking-[-0.05em]
              text-slate-950
            "
          >
            {clearingCart ? "Clearing your cart..." : "Your cart is empty."}
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-600
            "
          >
            {clearingCart
              ? "We're securely updating your saved cart."
              : "Browse the KOLA store and add something you like."}
          </p>

          <CartErrorMessage message={cartError} onDismiss={clearCartError} />

          {!clearingCart && (
            <Link
              to="/shop"
              className="
                mt-8
                inline-flex
                rounded-full
                bg-emerald-600
                px-7
                py-3.5
                text-sm
                font-black
                text-white
                transition
                hover:bg-emerald-700
              "
            >
              Start shopping
            </Link>
          )}
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Filled cart
  |--------------------------------------------------------------------------
  */

  return (
    <main
      className="
        mx-auto
        min-h-[70vh]
        max-w-7xl
        px-4
        py-10
        sm:px-6
        sm:py-14
        lg:px-8
        lg:py-16
      "
    >
      <div
        className="
          flex
          flex-col
          gap-4
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
            Your cart
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
            Shopping cart
          </h1>

          <p className="mt-3 text-slate-500">
            {cartCount} {cartCount === 1 ? "item" : "items"} in your cart
          </p>
        </div>

        <div
          className="
            flex
            flex-wrap
            items-center
            gap-5
          "
        >
          <button
            type="button"
            onClick={handleClearCart}
            disabled={clearingCart}
            className="
              text-sm
              font-bold
              text-red-500
              transition
              hover:text-red-700
              disabled:cursor-not-allowed
              disabled:opacity-50
            "
          >
            {clearingCart ? "Clearing..." : "Clear cart"}
          </button>

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
      </div>

      <CartErrorMessage message={cartError} onDismiss={clearCartError} />

      {cartRefreshing && (
        <div
          className="
            mt-5
            rounded-2xl
            bg-slate-50
            px-5
            py-4
            text-sm
            font-semibold
            text-slate-500
          "
        >
          Checking current prices and availability...
        </div>
      )}

      <div
        className="
          mt-10
          grid
          gap-10
          lg:grid-cols-[1fr_360px]
          lg:items-start
        "
      >
        <section
          className="
            rounded-[2rem]
            border
            border-slate-200
            bg-white
            px-5
            sm:px-7
          "
        >
          {cartItems.map((item) => (
            <CartItem
              key={item.product.id}
              item={item}
              onIncrease={() => {
                void addToCart(item.product);
              }}
              onDecrease={() => {
                void decreaseCartQuantity(item.product.id);
              }}
              onRemove={() => {
                void removeFromCart(item.product.id);
              }}
            />
          ))}
        </section>

        <aside
          className="
            rounded-[2rem]
            bg-slate-950
            p-7
            text-white
            lg:sticky
            lg:top-28
          "
        >
          <p
            className="
              text-sm
              font-black
              uppercase
              tracking-[0.14em]
              text-emerald-400
            "
          >
            Order summary
          </p>

          <div
            className="
              mt-6
              flex
              items-center
              justify-between
              gap-5
              border-b
              border-white/10
              pb-5
            "
          >
            <span className="text-slate-300">Items ({cartCount})</span>

            <span className="font-bold">{formatCurrency(cartTotal)}</span>
          </div>

          <div
            className="
              mt-6
              flex
              items-end
              justify-between
              gap-5
            "
          >
            <span className="text-lg font-bold">Total</span>

            <span
              className="
                text-3xl
                font-black
                tracking-tight
              "
            >
              {formatCurrency(cartTotal)}
            </span>
          </div>

          <p
            className="
              mt-6
              text-sm
              leading-6
              text-slate-400
            "
          >
            Final prices and stock will be verified securely before an order is
            created.
          </p>

          {cartHasAvailabilityIssues ? (
            <div>
              <button
                type="button"
                disabled
                className="
                  mt-7
                  inline-flex
                  w-full
                  cursor-not-allowed
                  items-center
                  justify-center
                  rounded-full
                  bg-slate-700
                  px-6
                  py-4
                  text-sm
                  font-black
                  text-slate-300
                "
              >
                Resolve cart issues
              </button>

              <p
                className="
                  mt-3
                  text-xs
                  leading-5
                  text-red-300
                "
              >
                Update or remove unavailable items before checkout.
              </p>
            </div>
          ) : cartRefreshing ? (
            <button
              type="button"
              disabled
              className="
                mt-7
                inline-flex
                w-full
                cursor-wait
                items-center
                justify-center
                rounded-full
                bg-emerald-500
                px-6
                py-4
                text-sm
                font-black
                text-white
                opacity-60
              "
            >
              Refreshing cart...
            </button>
          ) : (
            <Link
              to="/checkout"
              className="
                mt-7
                inline-flex
                w-full
                items-center
                justify-center
                rounded-full
                bg-emerald-500
                px-6
                py-4
                text-sm
                font-black
                text-white
                transition
                hover:bg-emerald-400
              "
            >
              Proceed to checkout
            </Link>
          )}
        </aside>
      </div>
    </main>
  );
}

export default CartPage;
