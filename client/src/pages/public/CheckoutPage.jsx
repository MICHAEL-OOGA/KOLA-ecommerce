import { useEffect, useRef, useState } from "react";

import { Link, Navigate, useNavigate } from "react-router-dom";

import { createOrder } from "../../api/orders.api.js";

import { useAuth } from "../../context/AuthContext.jsx";

import { useCart } from "../../context/CartContext.jsx";

import { formatCurrency } from "../../utils/currency.js";

const KENYAN_PHONE_PATTERN = /^(?:254|0|\+254)(?:7|1)\d{8}$/;

/*
|--------------------------------------------------------------------------
| Secure idempotency key
|--------------------------------------------------------------------------
*/

const createCheckoutIdempotencyKey = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  throw new Error("Secure checkout is not available in this browser.");
};

/*
|--------------------------------------------------------------------------
| Create comparable cart snapshot
|--------------------------------------------------------------------------
|
| This is NOT used to authorize checkout.
|
| It simply lets the UI determine whether the cart changed between:
|
| what the customer was reviewing
|
| and
|
| the latest cart returned by the backend.
*/

const createCartSnapshot = (items) => {
  const normalized = items
    .map((item) => ({
      productId: item.product.id,

      quantity: item.quantity,

      /*
       * Keep the server price representation
       * comparable without floating-point math.
       */

      price: String(item.product.price),

      active: item.product.isActive !== false,
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));

  return JSON.stringify(normalized);
};

/*
|--------------------------------------------------------------------------
| Detect obvious availability problem
|--------------------------------------------------------------------------
|
| UI protection only.
|
| POST /orders performs the real authoritative validation.
*/

const cartHasAvailabilityProblem = (items) => {
  return items.some((item) => {
    const stock = Number(item.product?.stock);

    if (item.product?.isActive === false) {
      return true;
    }

    if (!Number.isSafeInteger(stock) || stock <= 0) {
      return true;
    }

    return item.quantity > stock;
  });
};

function CheckoutPage() {
  const { authReady, isAuthenticated, user, csrfToken } = useAuth();

  const navigate = useNavigate();

  const {
    cartItems,
    cartCount,
    cartTotal,
    cartReady,
    cartRefreshing,

    refreshCart,

    /*
     * Backend deletes the actual Cart
     * during successful order creation.
     *
     * clearCart() only clears obsolete
     * React state afterward.
     */

    clearCart,
  } = useCart();

  const [customerPhone, setCustomerPhone] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [checkoutError, setCheckoutError] = useState(null);

  /*
   * One actual checkout attempt gets
   * one idempotency key.
   */

  const idempotencyKeyRef = useRef(null);

  /*
  |--------------------------------------------------------------------------
  | Pre-fill phone
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!user?.phone) {
      return;
    }

    setCustomerPhone((currentPhone) => currentPhone || user.phone);
  }, [user?.phone]);

  /*
  |--------------------------------------------------------------------------
  | Submit checkout
  |--------------------------------------------------------------------------
  */

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting || cartRefreshing) {
      return;
    }

    const normalizedInput = customerPhone.trim().replace(/\s+/g, "");

    if (!KENYAN_PHONE_PATTERN.test(normalizedInput)) {
      setCheckoutError("Enter a valid Kenyan M-Pesa phone number.");

      return;
    }

    if (!csrfToken) {
      setCheckoutError("Your secure session is not ready. Please try again.");

      return;
    }

    setCheckoutError(null);

    /*
      |--------------------------------------------------------------------------
      | Cart preflight
      |--------------------------------------------------------------------------
      |
      | IMPORTANT:
      |
      | This improves what the CUSTOMER sees.
      |
      | It does NOT replace backend validation in POST /orders.
      */

    const beforeSnapshot = createCartSnapshot(cartItems);

    const freshItems = await refreshCart();

    if (!freshItems) {
      setCheckoutError("We could not verify your cart. Please try again.");

      return;
    }

    if (freshItems.length === 0) {
      idempotencyKeyRef.current = null;

      setCheckoutError("Your cart is now empty.");

      return;
    }

    if (cartHasAvailabilityProblem(freshItems)) {
      idempotencyKeyRef.current = null;

      setCheckoutError(
        "Your cart has changed because some items are no longer available in the requested quantity. Please review your cart.",
      );

      return;
    }

    const afterSnapshot = createCartSnapshot(freshItems);

    /*
     * Product, quantity or price changed.
     *
     * refreshCart() has already put the
     * latest cart into CartContext.
     *
     * We stop here so the customer gets
     * to review the updated amount.
     */

    if (beforeSnapshot !== afterSnapshot) {
      idempotencyKeyRef.current = null;

      setCheckoutError(
        "Your cart changed while you were checking out. We've refreshed the latest prices and items. Please review the updated order summary, then continue again.",
      );

      return;
    }

    /*
      |--------------------------------------------------------------------------
      | Idempotency
      |--------------------------------------------------------------------------
      |
      | We only create a key after preflight succeeds.
      |
      | If createOrder() has an ambiguous network failure,
      | this key remains available for the retry.
      */

    if (!idempotencyKeyRef.current) {
      try {
        idempotencyKeyRef.current = createCheckoutIdempotencyKey();
      } catch (error) {
        setCheckoutError(error.message);

        return;
      }
    }

    setSubmitting(true);
    setCheckoutError(null);

    try {
      const response = await createOrder({
        customerPhone: normalizedInput,

        idempotencyKey: idempotencyKeyRef.current,

        csrfToken,
      });

      /*
       * The returned Order is authoritative.
       *
       * Server has already converted:
       *
       * Cart → Order
       */

      clearCart();

      navigate(`/checkout/order/${encodeURIComponent(response.order.id)}`, {
        replace: true,
      });
    } catch (error) {
      console.error("Checkout failed:", error);

      /*
       * Do not automatically generate another
       * idempotency key here.
       *
       * The request may have reached the backend
       * even if the browser did not receive the
       * response.
       */

      setCheckoutError(error?.message || "Checkout could not be completed.");
    } finally {
      setSubmitting(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Authentication restoration
  |--------------------------------------------------------------------------
  */

  if (!authReady) {
    return (
      <main
        className="
          mx-auto
          min-h-[70vh]
          max-w-7xl
          px-4
          py-16
          sm:px-6
          lg:px-8
        "
      >
        <div
          className="
            h-10
            w-64
            animate-pulse
            rounded
            bg-slate-200
          "
        />

        <div
          className="
            mt-10
            h-96
            animate-pulse
            rounded-[2rem]
            bg-slate-100
          "
        />
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Authentication required
  |--------------------------------------------------------------------------
  */

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: "/checkout",
        }}
      />
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Cart restoration
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
          py-16
          sm:px-6
          lg:px-8
        "
      >
        <p
          className="
            text-sm
            font-bold
            text-slate-500
          "
        >
          Loading your secure cart...
        </p>
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
        <div className="max-w-lg text-center">
          <p
            className="
              text-sm
              font-black
              uppercase
              tracking-[0.15em]
              text-emerald-600
            "
          >
            Checkout
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
            Your cart is empty.
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-600
            "
          >
            Add something to your cart before starting checkout.
          </p>

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
            Continue shopping
          </Link>
        </div>
      </main>
    );
  }

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
        <p
          className="
            text-sm
            font-black
            uppercase
            tracking-[0.16em]
            text-emerald-600
          "
        >
          Secure checkout
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
          Complete your order
        </h1>

        <p
          className="
            mt-3
            max-w-2xl
            text-slate-500
          "
        >
          Confirm the M-Pesa number you'd like to use for payment.
        </p>
      </div>

      <div
        className="
          mt-10
          grid
          gap-10
          lg:grid-cols-[1fr_360px]
          lg:items-start
        "
      >
        <form
          onSubmit={handleSubmit}
          className="
            rounded-[2rem]
            border
            border-slate-200
            bg-white
            p-6
            sm:p-8
          "
        >
          <h2
            className="
              text-xl
              font-black
              text-slate-950
            "
          >
            Customer details
          </h2>

          <div
            className="
              mt-6
              grid
              gap-5
              sm:grid-cols-2
            "
          >
            <div>
              <p
                className="
                  text-xs
                  font-black
                  uppercase
                  tracking-[0.12em]
                  text-slate-400
                "
              >
                Name
              </p>

              <p
                className="
                  mt-2
                  font-bold
                  text-slate-950
                "
              >
                {user.fullName}
              </p>
            </div>

            <div>
              <p
                className="
                  text-xs
                  font-black
                  uppercase
                  tracking-[0.12em]
                  text-slate-400
                "
              >
                Email
              </p>

              <p
                className="
                  mt-2
                  break-all
                  font-bold
                  text-slate-950
                "
              >
                {user.email}
              </p>
            </div>
          </div>

          <div
            className="
              mt-8
              border-t
              border-slate-200
              pt-8
            "
          >
            <label
              htmlFor="customerPhone"
              className="
                text-sm
                font-black
                text-slate-950
              "
            >
              M-Pesa phone number
            </label>

            <p
              className="
                mt-1
                text-sm
                text-slate-500
              "
            >
              The STK Push will be sent to this number.
            </p>

            <input
              id="customerPhone"
              name="customerPhone"
              type="tel"
              autoComplete="tel"
              value={customerPhone}
              onChange={(event) => {
                setCustomerPhone(event.target.value);

                if (checkoutError) {
                  setCheckoutError(null);
                }
              }}
              placeholder="0712345678"
              disabled={submitting || cartRefreshing}
              className="
                mt-4
                w-full
                rounded-2xl
                border
                border-slate-200
                bg-white
                px-4
                py-3.5
                font-semibold
                text-slate-950
                outline-none
                transition
                placeholder:text-slate-400
                focus:border-emerald-500
                focus:ring-4
                focus:ring-emerald-500/10
                disabled:cursor-not-allowed
                disabled:bg-slate-50
              "
            />

            {checkoutError && (
              <div
                role="alert"
                aria-live="polite"
                className="
                  mt-4
                  rounded-2xl
                  border
                  border-red-200
                  bg-red-50
                  px-4
                  py-3
                  text-sm
                  text-red-700
                "
              >
                {checkoutError}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || cartRefreshing}
            className="
              mt-8
              inline-flex
              w-full
              items-center
              justify-center
              rounded-full
              bg-emerald-600
              px-6
              py-4
              text-sm
              font-black
              text-white
              transition
              hover:bg-emerald-700
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {submitting
              ? "Creating secure order..."
              : cartRefreshing
                ? "Verifying cart..."
                : "Continue to M-Pesa"}
          </button>
        </form>

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
            <span className="text-lg font-bold">Display total</span>

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
            Your final amount is recalculated securely by KOLA using current
            database prices when the order is created.
          </p>
        </aside>
      </div>
    </main>
  );
}

export default CheckoutPage;
