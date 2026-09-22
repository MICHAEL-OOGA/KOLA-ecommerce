import { useEffect, useState } from "react";

import { Link, useParams } from "react-router-dom";

import {
  getAdminOrderById,
  updateAdminOrderStatus,
} from "../api/orders.api.js";

import { useAuth } from "../context/AuthContext.jsx";

/*
|--------------------------------------------------------------------------
| Status configuration
|--------------------------------------------------------------------------
*/

const STATUS_STYLES = {
  PENDING: "bg-amber-50 text-amber-700",

  PAID: "bg-emerald-50 text-emerald-700",

  PROCESSING: "bg-blue-50 text-blue-700",

  SHIPPED: "bg-indigo-50 text-indigo-700",

  DELIVERED: "bg-emerald-50 text-emerald-700",

  CANCELLED: "bg-red-50 text-red-700",

  EXPIRED: "bg-slate-100 text-slate-600",
};

const STATUS_ACTIONS = {
  PENDING: {
    status: "CANCELLED",
    label: "Cancel order",
    description: "Cancel this unpaid order and restore its reserved inventory.",
  },

  PAID: {
    status: "PROCESSING",
    label: "Start processing",
    description: "Confirm that fulfilment work has started.",
  },

  PROCESSING: {
    status: "SHIPPED",
    label: "Mark as shipped",
    description: "Confirm that the order has been dispatched.",
  },

  SHIPPED: {
    status: "DELIVERED",
    label: "Mark as delivered",
    description: "Confirm successful delivery to the customer.",
  },
};

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

  return date.toLocaleString();
};

function AdminOrderDetailsPage() {
  const { orderId } = useParams();

  const { csrfToken } = useAuth();

  const [order, setOrder] = useState(null);

  const [loading, setLoading] = useState(true);

  const [errorMessage, setErrorMessage] = useState(null);

  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [statusError, setStatusError] = useState(null);

  const [statusMessage, setStatusMessage] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

  /*
  |--------------------------------------------------------------------------
  | Load order
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!orderId) {
      return;
    }

    const controller = new AbortController();

    const loadOrder = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const response = await getAdminOrderById(orderId, {
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

        console.error("Admin order retrieval failed:", error);

        setOrder(null);

        if (error?.status === 404) {
          setErrorMessage("This order could not be found.");
        } else {
          setErrorMessage(error?.message || "The order could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
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
  | Status transition
  |--------------------------------------------------------------------------
  */

  const handleStatusUpdate = async () => {
    if (updatingStatus || !order) {
      return;
    }

    const action = STATUS_ACTIONS[order.status];

    if (!action) {
      return;
    }

    if (!csrfToken) {
      setStatusError(
        "Your secure admin session is not ready. Please refresh and try again.",
      );

      return;
    }

    /*
     * Cancellation can restore stock, so make the admin
     * deliberately confirm this destructive transition.
     */
    if (action.status === "CANCELLED") {
      const confirmed = window.confirm(
        "Cancel this order? If eligible, its reserved stock will be restored.",
      );

      if (!confirmed) {
        return;
      }
    }

    setUpdatingStatus(true);
    setStatusError(null);
    setStatusMessage(null);

    try {
      const response = await updateAdminOrderStatus({
        orderId: order.id,

        status: action.status,

        csrfToken,
      });

      setOrder(response.order);

      setStatusMessage(
        response.message || "Order status updated successfully.",
      );
    } catch (error) {
      console.error("Admin status update failed:", error);

      setStatusError(
        error?.message || "The order status could not be updated.",
      );

      /*
       * Something may have changed concurrently,
       * so refresh the authoritative order state.
       */
      if ([409, 404].includes(error?.status)) {
        setReloadKey((current) => current + 1);
      }
    } finally {
      setUpdatingStatus(false);
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
          max-w-7xl
          px-5
          py-10
          sm:px-8
        "
      >
        <div className="animate-pulse">
          <div
            className="
              h-5
              w-28
              rounded
              bg-slate-200
            "
          />

          <div
            className="
              mt-4
              h-12
              w-80
              max-w-full
              rounded
              bg-slate-200
            "
          />

          <div
            className="
              mt-10
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

  if (errorMessage || !order) {
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
        <Link
          to="/orders"
          className="
            text-sm
            font-black
            text-slate-500
          "
        >
          ← Orders
        </Link>

        <div
          className="
            mt-8
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
            Order unavailable
          </h1>

          <p
            className="
              mt-2
              text-red-700
            "
          >
            {errorMessage}
          </p>
        </div>
      </main>
    );
  }

  const action = STATUS_ACTIONS[order.status];

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
      <Link
        to="/orders"
        className="
          text-sm
          font-black
          text-slate-500
          transition
          hover:text-slate-950
        "
      >
        ← All orders
      </Link>

      {/* Header */}

      <div
        className="
          mt-7
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
            Order details
          </p>

          <h1
            className="
              mt-2
              break-all
              text-3xl
              font-black
              tracking-[-0.04em]
              text-slate-950
              sm:text-4xl
            "
          >
            {order.id}
          </h1>

          <p
            className="
              mt-3
              text-sm
              text-slate-500
            "
          >
            Created {formatDate(order.createdAt)}
          </p>
        </div>

        <span
          className={`
            self-start
            rounded-full
            px-4
            py-2.5
            text-xs
            font-black
            uppercase
            tracking-wider

            ${STATUS_STYLES[order.status] || "bg-slate-100 text-slate-600"}
          `}
        >
          {order.status}
        </span>
      </div>

      <div
        className="
          mt-9
          grid
          gap-6
          xl:grid-cols-[1fr_340px]
          xl:items-start
        "
      >
        <div className="space-y-6">
          {/* Customer */}

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
            <p
              className="
                text-xs
                font-black
                uppercase
                tracking-[0.14em]
                text-slate-400
              "
            >
              Customer
            </p>

            <h2
              className="
                mt-3
                text-2xl
                font-black
                text-slate-950
              "
            >
              {order.customerName}
            </h2>

            <div
              className="
                mt-5
                grid
                gap-5
                sm:grid-cols-2
              "
            >
              <div>
                <p
                  className="
                    text-xs
                    font-bold
                    uppercase
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
                    text-slate-700
                  "
                >
                  {order.customerEmail || "Not provided"}
                </p>
              </div>

              <div>
                <p
                  className="
                    text-xs
                    font-bold
                    uppercase
                    text-slate-400
                  "
                >
                  Phone
                </p>

                <p
                  className="
                    mt-2
                    font-bold
                    text-slate-700
                  "
                >
                  {order.customerPhone}
                </p>
              </div>
            </div>
          </section>

          {/* Items */}

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
            <h2
              className="
                text-2xl
                font-black
                text-slate-950
              "
            >
              Items
            </h2>

            <div className="mt-5">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="
                      flex
                      items-start
                      justify-between
                      gap-5
                      border-t
                      border-slate-100
                      py-5
                      first:border-t-0
                    "
                >
                  <div>
                    <p
                      className="
                          font-black
                          text-slate-950
                        "
                    >
                      {item.product?.name}
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

            <div
              className="
                mt-5
                flex
                items-center
                justify-between
                border-t
                border-slate-200
                pt-5
              "
            >
              <p
                className="
                  font-bold
                  text-slate-500
                "
              >
                Order total
              </p>

              <p
                className="
                  text-xl
                  font-black
                  text-slate-950
                "
              >
                {formatCurrency(order.totalAmount)}
              </p>
            </div>
          </section>

          {/* Timeline */}

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
            <h2
              className="
                text-2xl
                font-black
                text-slate-950
              "
            >
              Timeline
            </h2>

            <div
              className="
                mt-5
                grid
                gap-4
                sm:grid-cols-2
              "
            >
              {[
                ["Created", order.createdAt],
                ["Processing", order.processingStartedAt],
                ["Shipped", order.shippedAt],
                ["Delivered", order.deliveredAt],
                ["Cancelled", order.cancelledAt],
                ["Expired", order.expiredAt],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="
                      rounded-2xl
                      bg-slate-50
                      p-4
                    "
                >
                  <p
                    className="
                        text-xs
                        font-black
                        uppercase
                        tracking-wider
                        text-slate-400
                      "
                  >
                    {label}
                  </p>

                  <p
                    className="
                        mt-2
                        text-sm
                        font-bold
                        text-slate-700
                      "
                  >
                    {formatDate(value)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right sidebar */}

        <aside className="space-y-6">
          {/* Payment */}

          <section
            className="
              rounded-[2rem]
              bg-slate-950
              p-6
              text-white
            "
          >
            <p
              className="
                text-xs
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
                mt-5
                text-sm
                text-slate-400
              "
            >
              Status
            </p>

            <p
              className="
                mt-1
                text-xl
                font-black
              "
            >
              {order.payment?.status || "Not started"}
            </p>

            <p
              className="
                mt-5
                text-sm
                text-slate-400
              "
            >
              Amount
            </p>

            <p
              className="
                mt-1
                text-2xl
                font-black
              "
            >
              {formatCurrency(order.payment?.amount || order.totalAmount)}
            </p>

            {order.payment?.mpesaReceiptNumber && (
              <>
                <p
                  className="
                    mt-5
                    text-sm
                    text-slate-400
                  "
                >
                  M-Pesa receipt
                </p>

                <p
                  className="
                    mt-1
                    break-all
                    font-black
                  "
                >
                  {order.payment.mpesaReceiptNumber}
                </p>
              </>
            )}

            {order.payment?.paidAt && (
              <>
                <p
                  className="
                    mt-5
                    text-sm
                    text-slate-400
                  "
                >
                  Paid
                </p>

                <p
                  className="
                    mt-1
                    text-sm
                    font-bold
                  "
                >
                  {formatDate(order.payment.paidAt)}
                </p>
              </>
            )}
          </section>

          {/* Fulfilment action */}

          <section
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
                text-xs
                font-black
                uppercase
                tracking-[0.14em]
                text-slate-400
              "
            >
              Fulfilment
            </p>

            {action ? (
              <>
                <h2
                  className="
                    mt-3
                    text-xl
                    font-black
                    text-slate-950
                  "
                >
                  {action.label}
                </h2>

                <p
                  className="
                    mt-2
                    text-sm
                    leading-6
                    text-slate-500
                  "
                >
                  {action.description}
                </p>

                {statusMessage && (
                  <p
                    className="
                      mt-5
                      rounded-2xl
                      bg-emerald-50
                      p-4
                      text-sm
                      text-emerald-700
                    "
                  >
                    {statusMessage}
                  </p>
                )}

                {statusError && (
                  <p
                    role="alert"
                    className="
                      mt-5
                      rounded-2xl
                      bg-red-50
                      p-4
                      text-sm
                      text-red-700
                    "
                  >
                    {statusError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleStatusUpdate}
                  disabled={updatingStatus}
                  className={`
                    mt-6
                    w-full
                    rounded-full
                    px-5
                    py-3.5
                    text-sm
                    font-black
                    text-white
                    transition
                    disabled:cursor-not-allowed
                    disabled:opacity-60

                    ${
                      action.status === "CANCELLED"
                        ? "bg-red-600 hover:bg-red-500"
                        : "bg-slate-950 hover:bg-slate-800"
                    }
                  `}
                >
                  {updatingStatus ? "Updating..." : action.label}
                </button>
              </>
            ) : (
              <>
                <h2
                  className="
                    mt-3
                    text-xl
                    font-black
                    text-slate-950
                  "
                >
                  No action required.
                </h2>

                <p
                  className="
                    mt-2
                    text-sm
                    leading-6
                    text-slate-500
                  "
                >
                  This order has no further admin fulfilment transition.
                </p>
              </>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

export default AdminOrderDetailsPage;
