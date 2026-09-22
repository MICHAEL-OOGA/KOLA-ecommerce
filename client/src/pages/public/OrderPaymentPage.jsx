import { useEffect, useRef, useState } from "react";

import { Link, useParams } from "react-router-dom";

import { getOrderById } from "../../api/orders.api.js";

import { initiateMpesaPayment } from "../../api/mpesa.api.js";

import { useAuth } from "../../context/AuthContext.jsx";

import { formatCurrency } from "../../utils/currency.js";

/*
|--------------------------------------------------------------------------
| Polling configuration
|--------------------------------------------------------------------------
*/

const PAYMENT_POLL_INTERVAL_MS = 3000;

const PAYMENT_AUTO_POLL_MAX_MS = 90_000;

/*
|--------------------------------------------------------------------------
| Payment state groups
|--------------------------------------------------------------------------
|
| PENDING:
| Safaricom/payment confirmation has not completed.
|
| VERIFYING:
| KOLA is confirming an ambiguous payment.
|
| SUCCESS:
| Money has been confirmed.
|
| All three MUST block a second STK request while
| the Order itself remains PENDING.
*/

const PAYMENT_STATES_REQUIRING_RECOVERY = new Set([
  "PENDING",
  "VERIFYING",
  "SUCCESS",
]);

const RETRYABLE_PAYMENT_STATUSES = new Set(["FAILED", "CANCELLED"]);

/*
|--------------------------------------------------------------------------
| Order status content
|--------------------------------------------------------------------------
*/

const ORDER_STATUS_CONTENT = {
  PENDING: {
    eyebrow: "Payment pending",

    title: "Ready for M-Pesa.",

    description:
      "Your products are reserved while this order waits for payment.",
  },

  PAID: {
    eyebrow: "Payment received",

    title: "Payment successful.",

    description:
      "Your M-Pesa payment has been verified and your order is ready for processing.",
  },

  PROCESSING: {
    eyebrow: "Order processing",

    title: "We're preparing your order.",

    description:
      "Your payment has been verified and your order is being processed.",
  },

  SHIPPED: {
    eyebrow: "Order shipped",

    title: "Your order is on the way.",

    description: "Your order has been dispatched.",
  },

  DELIVERED: {
    eyebrow: "Order delivered",

    title: "Order completed.",

    description: "This order has been successfully delivered.",
  },

  CANCELLED: {
    eyebrow: "Order cancelled",

    title: "This order was cancelled.",

    description: "The order is no longer awaiting payment or fulfilment.",
  },

  EXPIRED: {
    eyebrow: "Order expired",

    title: "The payment window expired.",

    description:
      "The reserved stock has been released. Add the products to your cart again if you still want to purchase them.",
  },
};

/*
|--------------------------------------------------------------------------
| Payment display
|--------------------------------------------------------------------------
*/

const PAYMENT_STATUS_LABELS = {
  PENDING: "Pending",

  VERIFYING: "Verifying",

  SUCCESS: "Paid",

  FAILED: "Failed",

  CANCELLED: "Cancelled",
};

const getPaymentStatusLabel = (status) => {
  if (!status) {
    return "Not started";
  }

  return PAYMENT_STATUS_LABELS[status] || status;
};

/*
|--------------------------------------------------------------------------
| Safe date formatter
|--------------------------------------------------------------------------
*/

const formatDateTime = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString();
};

function OrderPaymentPage() {
  const { orderId } = useParams();

  const { csrfToken } = useAuth();

  const [order, setOrder] = useState(null);

  const [orderLoading, setOrderLoading] = useState(true);

  const [orderError, setOrderError] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

  const [startingPayment, setStartingPayment] = useState(false);

  const [paymentError, setPaymentError] = useState(null);

  const [paymentMessage, setPaymentMessage] = useState(null);

  const [paymentPollingTimedOut, setPaymentPollingTimedOut] = useState(false);

  const [checkingPaymentStatus, setCheckingPaymentStatus] = useState(false);

  /*
   * Browser-local timer bookkeeping only.
   *
   * Payment authority remains backend-side.
   */

  const paymentPollingStartedAtRef = useRef(null);

  /*
  |--------------------------------------------------------------------------
  | Initial / recovery order load
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!orderId) {
      setOrder(null);

      setOrderError("This order could not be found.");

      setOrderLoading(false);

      return undefined;
    }

    const controller = new AbortController();

    const loadOrder = async () => {
      setOrderLoading(true);
      setOrderError(null);

      try {
        const response = await getOrderById(orderId, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setOrder(response.order);
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("Order retrieval failed:", error);

        setOrder(null);

        if (error?.status === 404) {
          setOrderError("This order could not be found.");
        } else if (error?.status === 401) {
          setOrderError("Your session has expired. Please sign in again.");
        } else {
          setOrderError(error?.message || "The order could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setOrderLoading(false);
        }
      }
    };

    void loadOrder();

    return () => {
      controller.abort();
    };
  }, [orderId, reloadKey]);

  /*
  |--------------------------------------------------------------------------
  | Derived payment state
  |--------------------------------------------------------------------------
  */

  const paymentStatus = order?.payment?.status || null;

  /*
   * NEW:
   *
   * SUCCESS is deliberately included.
   *
   * If payment is confirmed but Order still says PENDING,
   * we block another STK Push and let the backend finish
   * reconciling the Order state.
   */

  const paymentRequiresRecovery =
    Boolean(order) &&
    order.status === "PENDING" &&
    PAYMENT_STATES_REQUIRING_RECOVERY.has(paymentStatus);

  /*
  |--------------------------------------------------------------------------
  | Automatic payment-status polling
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!orderId || !order || !paymentRequiresRecovery) {
      paymentPollingStartedAtRef.current = null;

      setPaymentPollingTimedOut(false);

      return undefined;
    }

    if (paymentPollingTimedOut) {
      return undefined;
    }

    if (!paymentPollingStartedAtRef.current) {
      paymentPollingStartedAtRef.current = Date.now();
    }

    let cancelled = false;

    let timerId = null;

    let requestController = null;

    const stopPolling = () => {
      if (cancelled) {
        return;
      }

      setPaymentPollingTimedOut(true);
    };

    const scheduleNext = () => {
      if (cancelled) {
        return;
      }

      const startedAt = paymentPollingStartedAtRef.current;

      if (!startedAt) {
        return;
      }

      const elapsed = Date.now() - startedAt;

      const remaining = PAYMENT_AUTO_POLL_MAX_MS - elapsed;

      if (remaining <= 0) {
        stopPolling();

        return;
      }

      timerId = window.setTimeout(
        pollOrder,

        Math.min(PAYMENT_POLL_INTERVAL_MS, remaining),
      );
    };

    const pollOrder = async () => {
      requestController = new AbortController();

      try {
        const response = await getOrderById(orderId, {
          signal: requestController.signal,
        });

        if (cancelled) {
          return;
        }

        const refreshedOrder = response.order;

        setOrder(refreshedOrder);

        const refreshedPaymentStatus = refreshedOrder.payment?.status || null;

        const stillNeedsRecovery =
          refreshedOrder.status === "PENDING" &&
          PAYMENT_STATES_REQUIRING_RECOVERY.has(refreshedPaymentStatus);

        if (!stillNeedsRecovery) {
          paymentPollingStartedAtRef.current = null;

          setPaymentPollingTimedOut(false);

          setPaymentMessage(null);

          return;
        }

        scheduleNext();
      } catch (error) {
        if (cancelled || error?.name === "AbortError") {
          return;
        }

        console.error("Payment status refresh failed:", error);

        if (error?.status === 401) {
          paymentPollingStartedAtRef.current = null;

          setPaymentError("Your session has expired. Please sign in again.");

          return;
        }

        if (error?.status === 404) {
          paymentPollingStartedAtRef.current = null;

          setOrderError("This order could not be found.");

          return;
        }

        /*
         * Temporary errors do not mean
         * payment failed.
         *
         * Retry until our 90-second browser
         * polling window expires.
         */

        scheduleNext();
      }
    };

    scheduleNext();

    return () => {
      cancelled = true;

      if (timerId) {
        window.clearTimeout(timerId);
      }

      requestController?.abort();
    };
  }, [
    orderId,
    order?.id,
    order?.status,
    paymentStatus,
    paymentRequiresRecovery,
    paymentPollingTimedOut,
  ]);

  /*
  |--------------------------------------------------------------------------
  | Manual payment-status refresh
  |--------------------------------------------------------------------------
  |
  | Used after aggressive polling stops.
  |
  | This still reads OUR backend.
  |
  | It never asks Safaricom directly.
  */

  const handleCheckPaymentStatus = async () => {
    if (checkingPaymentStatus || !order || !orderId) {
      return;
    }

    setCheckingPaymentStatus(true);

    setPaymentError(null);

    try {
      const response = await getOrderById(orderId);

      const refreshedOrder = response.order;

      setOrder(refreshedOrder);

      const refreshedPaymentStatus = refreshedOrder.payment?.status || null;

      const stillNeedsRecovery =
        refreshedOrder.status === "PENDING" &&
        PAYMENT_STATES_REQUIRING_RECOVERY.has(refreshedPaymentStatus);

      if (stillNeedsRecovery) {
        /*
         * Stay in manual recovery mode.
         *
         * Do not restart automatic aggressive
         * polling after the 90-second window.
         */

        setPaymentPollingTimedOut(true);

        return;
      }

      paymentPollingStartedAtRef.current = null;

      setPaymentPollingTimedOut(false);

      setPaymentMessage(null);
    } catch (error) {
      console.error("Manual payment status refresh failed:", error);

      if (error?.status === 401) {
        setPaymentError("Your session has expired. Please sign in again.");

        return;
      }

      if (error?.status === 404) {
        setOrderError("This order could not be found.");

        return;
      }

      setPaymentError(
        error?.message || "The payment status could not be refreshed.",
      );
    } finally {
      setCheckingPaymentStatus(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Start M-Pesa payment
  |--------------------------------------------------------------------------
  */

  const handleMpesaPayment = async () => {
    if (startingPayment || !order || order.status !== "PENDING") {
      return;
    }

    /*
     * Never initiate another STK request
     * while payment is pending, verifying,
     * successful-but-finalizing, or otherwise
     * not explicitly retryable.
     */

    const currentPaymentStatus = order.payment?.status || null;

    const paymentCanRetry =
      !currentPaymentStatus ||
      RETRYABLE_PAYMENT_STATUSES.has(currentPaymentStatus);

    if (!paymentCanRetry) {
      setPaymentError(
        "This payment is already being processed or confirmed. Check the payment status instead of starting another payment.",
      );

      return;
    }

    if (!csrfToken) {
      setPaymentError("Your secure session is not ready. Please try again.");

      return;
    }

    paymentPollingStartedAtRef.current = null;

    setPaymentPollingTimedOut(false);

    setStartingPayment(true);

    setPaymentError(null);
    setPaymentMessage(null);

    try {
      const response = await initiateMpesaPayment({
        orderId: order.id,

        csrfToken,
      });

      /*
       * HTTP success here means STK initiation
       * succeeded.
       *
       * It does NOT mean payment succeeded.
       */

      setPaymentMessage(
        response.message || "M-Pesa payment request sent. Check your phone.",
      );

      /*
       * Refresh immediately so the backend's
       * authoritative Payment record appears.
       */

      try {
        const refreshed = await getOrderById(order.id);

        setOrder(refreshed.order);
      } catch (refreshError) {
        console.error("Immediate payment refresh failed:", refreshError);

        /*
         * Do not invite another payment.
         *
         * Reload the authoritative order instead.
         */

        setReloadKey((current) => current + 1);
      }
    } catch (error) {
      console.error("M-Pesa initiation failed:", error);

      const recoveryCodes = new Set([
        "PAYMENT_ATTEMPT_ACTIVE",
        "PAYMENT_VERIFICATION_REQUIRED",
        "ORDER_ALREADY_PAID",
        "ORDER_EXPIRED",
      ]);

      if (recoveryCodes.has(error?.code)) {
        try {
          const refreshed = await getOrderById(order.id);

          const refreshedOrder = refreshed.order;

          setOrder(refreshedOrder);

          /*
           * If the backend now tells us a payment
           * is active/verified or the order reached
           * a terminal state, prefer that state over
           * a frightening stale error.
           */

          if (
            refreshedOrder.status !== "PENDING" ||
            PAYMENT_STATES_REQUIRING_RECOVERY.has(
              refreshedOrder.payment?.status,
            )
          ) {
            setPaymentError(null);

            if (refreshedOrder.status === "PENDING") {
              setPaymentMessage(
                "KOLA found an existing payment attempt. Do not make another payment while confirmation is in progress.",
              );
            }

            return;
          }
        } catch (refreshError) {
          console.error("Payment recovery refresh failed:", refreshError);
        }
      }

      setPaymentError(
        error?.message || "The M-Pesa payment request could not be started.",
      );
    } finally {
      setStartingPayment(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Loading
  |--------------------------------------------------------------------------
  */

  if (orderLoading) {
    return (
      <main
        className="
          mx-auto
          min-h-[70vh]
          max-w-5xl
          px-4
          py-16
          sm:px-6
          lg:px-8
        "
      >
        <p
          className="
            text-sm
            font-black
            uppercase
            tracking-[0.15em]
            text-emerald-600
          "
        >
          Secure order
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
          Loading your order...
        </h1>

        <div
          className="
            mt-10
            h-80
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
  | Failed order load
  |--------------------------------------------------------------------------
  */

  if (orderError || !order) {
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
              tracking-[0.15em]
              text-red-500
            "
          >
            Order unavailable
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
            We couldn't load this order.
          </h1>

          <p
            className="
              mt-4
              leading-7
              text-slate-600
            "
          >
            {orderError || "The order could not be found."}
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
            <button
              type="button"
              onClick={() => {
                setReloadKey((current) => current + 1);
              }}
              className="
                rounded-full
                bg-slate-950
                px-6
                py-3
                text-sm
                font-black
                text-white
                transition
                hover:bg-slate-800
              "
            >
              Try again
            </button>

            <Link
              to="/account/orders"
              className="
                rounded-full
                border
                border-slate-200
                px-6
                py-3
                text-sm
                font-black
                text-slate-700
                transition
                hover:bg-slate-50
              "
            >
              My orders
            </Link>
          </div>
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Current authoritative display state
  |--------------------------------------------------------------------------
  */

  const statusContent =
    ORDER_STATUS_CONTENT[order.status] || ORDER_STATUS_CONTENT.PENDING;

  const currentPaymentStatus = order.payment?.status || null;

  const paymentFailed = currentPaymentStatus === "FAILED";

  const paymentCancelled = currentPaymentStatus === "CANCELLED";

  const paymentSucceededButOrderPending =
    order.status === "PENDING" && currentPaymentStatus === "SUCCESS";

  /*
   * Only these states explicitly allow
   * a new STK payment:
   *
   * no Payment record
   * FAILED
   * CANCELLED
   */

  const canInitiatePayment =
    order.status === "PENDING" &&
    (!currentPaymentStatus ||
      RETRYABLE_PAYMENT_STATUSES.has(currentPaymentStatus));

  let paymentButtonText = "Pay with M-Pesa";

  if (startingPayment) {
    paymentButtonText = "Sending M-Pesa prompt...";
  } else if (currentPaymentStatus === "VERIFYING") {
    paymentButtonText = "Verifying payment...";
  } else if (currentPaymentStatus === "PENDING") {
    paymentButtonText = "Waiting for M-Pesa...";
  } else if (currentPaymentStatus === "SUCCESS") {
    paymentButtonText = "Finalizing order...";
  } else if (paymentFailed || paymentCancelled) {
    paymentButtonText = "Try M-Pesa again";
  }

  const paymentWindowText = formatDateTime(order.expiresAt);

  const orderItems = Array.isArray(order.items) ? order.items : [];

  return (
    <main
      className="
        mx-auto
        min-h-[70vh]
        max-w-5xl
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
          {statusContent.eyebrow}
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
          {statusContent.title}
        </h1>

        <p
          className="
            mt-4
            max-w-2xl
            leading-7
            text-slate-600
          "
        >
          {statusContent.description}
        </p>
      </div>

      <div
        className="
          mt-10
          grid
          gap-8
          lg:grid-cols-[1fr_340px]
          lg:items-start
        "
      >
        <section
          className="
            rounded-[2rem]
            border
            border-slate-200
            bg-white
            p-6
            sm:p-8
          "
        >
          <div
            className="
              flex
              flex-col
              gap-4
              border-b
              border-slate-200
              pb-7
              sm:flex-row
              sm:items-start
              sm:justify-between
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
                Order ID
              </p>

              <p
                className="
                  mt-2
                  break-all
                  font-bold
                  text-slate-950
                "
              >
                {order.id}
              </p>
            </div>

            <span
              className="
                self-start
                rounded-full
                bg-slate-100
                px-4
                py-2
                text-xs
                font-black
                uppercase
                tracking-[0.1em]
                text-slate-700
              "
            >
              {order.status}
            </span>
          </div>

          <div className="mt-7">
            <h2
              className="
                text-xl
                font-black
                text-slate-950
              "
            >
              Order items
            </h2>

            {orderItems.length > 0 ? (
              <div className="mt-5">
                {orderItems.map((item) => (
                  <div
                    key={item.id}
                    className="
                        flex
                        items-start
                        justify-between
                        gap-5
                        border-b
                        border-slate-100
                        py-4
                        last:border-b-0
                      "
                  >
                    <div>
                      <p
                        className="
                            font-black
                            text-slate-950
                          "
                      >
                        {item.product.name}
                      </p>

                      <p
                        className="
                            mt-1
                            text-sm
                            text-slate-500
                          "
                      >
                        {item.quantity} × {formatCurrency(item.price)}
                      </p>
                    </div>

                    <p
                      className="
                          shrink-0
                          font-black
                          text-slate-950
                        "
                    >
                      {formatCurrency(Number(item.price) * item.quantity)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p
                className="
                  mt-5
                  text-sm
                  text-slate-500
                "
              >
                Order-item details are unavailable.
              </p>
            )}
          </div>

          <div
            className="
              mt-7
              grid
              gap-5
              border-t
              border-slate-200
              pt-7
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
                Customer
              </p>

              <p
                className="
                  mt-2
                  font-bold
                  text-slate-950
                "
              >
                {order.customerName}
              </p>

              {order.customerEmail && (
                <p
                  className="
                    mt-1
                    break-all
                    text-sm
                    text-slate-500
                  "
                >
                  {order.customerEmail}
                </p>
              )}
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
                M-Pesa number
              </p>

              <p
                className="
                  mt-2
                  font-bold
                  text-slate-950
                "
              >
                {order.customerPhone}
              </p>
            </div>
          </div>
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
            Payment
          </p>

          <p
            className="
              mt-6
              text-sm
              text-slate-400
            "
          >
            Amount due
          </p>

          <p
            className="
              mt-1
              text-3xl
              font-black
              tracking-tight
            "
          >
            {formatCurrency(order.totalAmount)}
          </p>

          <div
            className="
              mt-6
              border-t
              border-white/10
              pt-5
            "
          >
            <p className="text-sm text-slate-400">Payment status</p>

            <p
              className="
                mt-1
                font-black
              "
            >
              {getPaymentStatusLabel(currentPaymentStatus)}
            </p>
          </div>

          {paymentWindowText && order.status === "PENDING" && (
            <div
              className="
                  mt-6
                  border-t
                  border-white/10
                  pt-5
                "
            >
              <p className="text-sm text-slate-400">Payment window ends</p>

              <p
                className="
                    mt-1
                    text-sm
                    font-bold
                  "
              >
                {paymentWindowText}
              </p>
            </div>
          )}

          {paymentMessage && order.status === "PENDING" && (
            <div
              className="
                  mt-6
                  rounded-2xl
                  bg-emerald-500/10
                  px-4
                  py-3
                  text-sm
                  leading-6
                  text-emerald-300
                "
            >
              {paymentMessage}
            </div>
          )}

          {paymentError && (
            <div
              role="alert"
              className="
                mt-6
                rounded-2xl
                bg-red-500/10
                px-4
                py-3
                text-sm
                leading-6
                text-red-300
              "
            >
              {paymentError}
            </div>
          )}

          {paymentFailed && (
            <p
              className="
                mt-5
                text-sm
                leading-6
                text-amber-300
              "
            >
              The previous M-Pesa attempt did not complete. You may try again
              while the order remains payable.
            </p>
          )}

          {paymentCancelled && (
            <p
              className="
                mt-5
                text-sm
                leading-6
                text-amber-300
              "
            >
              The previous M-Pesa request was cancelled. You may try again while
              the order remains payable.
            </p>
          )}

          {paymentSucceededButOrderPending && (
            <div
              className="
                mt-5
                rounded-2xl
                border
                border-emerald-400/20
                bg-emerald-400/10
                p-4
              "
            >
              <p
                className="
                  text-sm
                  font-bold
                  text-emerald-200
                "
              >
                Payment received.
              </p>

              <p
                className="
                  mt-2
                  text-xs
                  leading-5
                  text-slate-300
                "
              >
                KOLA is finalizing the order. Do not make another payment.
              </p>
            </div>
          )}

          {order.status === "PENDING" ? (
            <>
              {canInitiatePayment ? (
                <button
                  type="button"
                  onClick={handleMpesaPayment}
                  disabled={startingPayment}
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
                    disabled:cursor-not-allowed
                    disabled:opacity-60
                  "
                >
                  {paymentButtonText}
                </button>
              ) : (
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
                    bg-emerald-500
                    px-6
                    py-4
                    text-sm
                    font-black
                    text-white
                    opacity-60
                  "
                >
                  {paymentButtonText}
                </button>
              )}

              {paymentRequiresRecovery && !paymentPollingTimedOut && (
                <p
                  className="
                      mt-3
                      text-center
                      text-xs
                      leading-5
                      text-slate-400
                    "
                >
                  KOLA is checking the authoritative payment state
                  automatically. Please do not initiate another payment.
                </p>
              )}

              {paymentRequiresRecovery && paymentPollingTimedOut && (
                <div
                  className="
                      mt-5
                      rounded-2xl
                      border
                      border-amber-400/20
                      bg-amber-400/10
                      p-4
                    "
                >
                  <p
                    className="
                        text-sm
                        font-bold
                        text-amber-200
                      "
                  >
                    We're still confirming your payment.
                  </p>

                  <p
                    className="
                        mt-2
                        text-xs
                        leading-5
                        text-slate-300
                      "
                  >
                    Automatic browser checking has paused, but that does not
                    mean your payment failed. KOLA's backend can still reconcile
                    the transaction.
                  </p>

                  <button
                    type="button"
                    onClick={handleCheckPaymentStatus}
                    disabled={checkingPaymentStatus}
                    className="
                        mt-4
                        inline-flex
                        w-full
                        items-center
                        justify-center
                        rounded-full
                        border
                        border-white/15
                        px-4
                        py-3
                        text-xs
                        font-black
                        text-white
                        transition
                        hover:bg-white/10
                        disabled:cursor-not-allowed
                        disabled:opacity-60
                      "
                  >
                    {checkingPaymentStatus
                      ? "Checking payment..."
                      : "Check payment status"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div
              className="
                mt-7
                grid
                gap-3
              "
            >
              <Link
                to="/account/orders"
                className="
                  inline-flex
                  w-full
                  items-center
                  justify-center
                  rounded-full
                  bg-white
                  px-6
                  py-4
                  text-sm
                  font-black
                  text-slate-950
                  transition
                  hover:bg-slate-100
                "
              >
                My orders
              </Link>

              <Link
                to="/shop"
                className="
                  inline-flex
                  w-full
                  items-center
                  justify-center
                  rounded-full
                  border
                  border-white/10
                  px-6
                  py-4
                  text-sm
                  font-black
                  text-white
                  transition
                  hover:bg-white/10
                "
              >
                Continue shopping
              </Link>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

export default OrderPaymentPage;
