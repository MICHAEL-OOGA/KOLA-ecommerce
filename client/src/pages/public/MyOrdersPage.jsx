import { useEffect, useState } from "react";

import { Link, useSearchParams } from "react-router-dom";

import { getCustomerOrders } from "../../api/orders.api.js";

import { formatCurrency } from "../../utils/currency.js";

/*
|--------------------------------------------------------------------------
| Order filters
|--------------------------------------------------------------------------
*/

const ORDER_FILTERS = [
  {
    value: "",
    label: "All",
  },
  {
    value: "PENDING",
    label: "Pending",
  },
  {
    value: "PAID",
    label: "Paid",
  },
  {
    value: "PROCESSING",
    label: "Processing",
  },
  {
    value: "SHIPPED",
    label: "Shipped",
  },
  {
    value: "DELIVERED",
    label: "Delivered",
  },
  {
    value: "CANCELLED",
    label: "Cancelled",
  },
  {
    value: "EXPIRED",
    label: "Expired",
  },
];

const VALID_ORDER_STATUSES = new Set(
  ORDER_FILTERS.map((filter) => filter.value).filter(Boolean),
);

/*
|--------------------------------------------------------------------------
| Order-status styles
|--------------------------------------------------------------------------
*/

const ORDER_STATUS_STYLES = {
  PENDING: "bg-amber-50 text-amber-700",

  PAID: "bg-emerald-50 text-emerald-700",

  PROCESSING: "bg-blue-50 text-blue-700",

  SHIPPED: "bg-indigo-50 text-indigo-700",

  DELIVERED: "bg-emerald-50 text-emerald-700",

  CANCELLED: "bg-red-50 text-red-700",

  EXPIRED: "bg-slate-100 text-slate-600",
};

/*
|--------------------------------------------------------------------------
| Payment-status presentation
|--------------------------------------------------------------------------
|
| Order status and payment status are different concepts.
|
| Example:
|
| Order: PENDING
| Payment: VERIFYING
|
| We keep them separate in the UI.
*/

const PAYMENT_STATUS_CONTENT = {
  PENDING: {
    label: "Pending",
    style: "bg-amber-50 text-amber-700",
  },

  VERIFYING: {
    label: "Verifying",
    style: "bg-blue-50 text-blue-700",
  },

  SUCCESS: {
    label: "Paid",
    style: "bg-emerald-50 text-emerald-700",
  },

  FAILED: {
    label: "Failed",
    style: "bg-red-50 text-red-700",
  },

  CANCELLED: {
    label: "Cancelled",
    style: "bg-slate-100 text-slate-600",
  },
};

const getPaymentPresentation = (paymentStatus) => {
  if (!paymentStatus) {
    return {
      label: "Not started",
      style: "bg-slate-100 text-slate-600",
    };
  }

  return (
    PAYMENT_STATUS_CONTENT[paymentStatus] || {
      label: paymentStatus,
      style: "bg-slate-100 text-slate-700",
    }
  );
};

/*
|--------------------------------------------------------------------------
| Order helper text
|--------------------------------------------------------------------------
*/

const getOrderMessage = (status) => {
  switch (status) {
    case "PENDING":
      return "Payment or confirmation is still pending.";

    case "PAID":
      return "Payment received.";

    case "PROCESSING":
      return "Your order is being prepared.";

    case "SHIPPED":
      return "Your order has been shipped.";

    case "DELIVERED":
      return "Order delivered.";

    case "CANCELLED":
      return "This order was cancelled.";

    case "EXPIRED":
      return "This order expired before completion.";

    default:
      return "View the order for the latest status.";
  }
};

/*
|--------------------------------------------------------------------------
| Date formatting
|--------------------------------------------------------------------------
*/

const formatOrderDate = (dateValue) => {
  if (!dateValue) {
    return "Date unavailable";
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

/*
|--------------------------------------------------------------------------
| Short customer-facing order ID
|--------------------------------------------------------------------------
*/

const getShortOrderId = (orderId) => {
  if (!orderId) {
    return "Unknown";
  }

  return orderId.slice(-10).toUpperCase();
};

function MyOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [orders, setOrders] = useState([]);

  const [pagination, setPagination] = useState(null);

  const [ordersLoading, setOrdersLoading] = useState(true);

  const [ordersError, setOrdersError] = useState(null);

  /*
   * NEW:
   *
   * Incrementing this explicitly re-runs
   * the order-loading effect.
   */
  const [reloadKey, setReloadKey] = useState(0);

  /*
  |--------------------------------------------------------------------------
  | URL state
  |--------------------------------------------------------------------------
  */

  const pageFromUrl = Number(searchParams.get("page") || "1");

  const page =
    Number.isSafeInteger(pageFromUrl) && pageFromUrl >= 1 ? pageFromUrl : 1;

  const statusFromUrl = searchParams.get("status")?.trim().toUpperCase() || "";

  const selectedStatus = VALID_ORDER_STATUSES.has(statusFromUrl)
    ? statusFromUrl
    : "";

  /*
  |--------------------------------------------------------------------------
  | Load orders
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const controller = new AbortController();

    const loadOrders = async () => {
      setOrdersLoading(true);
      setOrdersError(null);

      try {
        const response = await getCustomerOrders({
          page,
          limit: 10,

          status: selectedStatus || null,

          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        const nextPagination = response.pagination || null;

        /*
         * NEW:
         *
         * If somebody manually enters an
         * out-of-range page, move them back
         * to the last real page.
         */

        if (
          nextPagination &&
          nextPagination.totalPages > 0 &&
          page > nextPagination.totalPages
        ) {
          const nextParams = new URLSearchParams(searchParams);

          nextParams.set("page", String(nextPagination.totalPages));

          setSearchParams(nextParams, {
            replace: true,
          });

          return;
        }

        setOrders(Array.isArray(response.orders) ? response.orders : []);

        setPagination(nextPagination);
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("Customer order history failed:", error);

        setOrders([]);

        setPagination(null);

        setOrdersError(
          error?.message || "Your order history could not be loaded.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setOrdersLoading(false);
        }
      }
    };

    void loadOrders();

    return () => {
      controller.abort();
    };
  }, [page, selectedStatus, reloadKey, searchParams, setSearchParams]);

  /*
  |--------------------------------------------------------------------------
  | Retry / refresh
  |--------------------------------------------------------------------------
  */

  const handleRefresh = () => {
    setReloadKey((current) => current + 1);
  };

  /*
  |--------------------------------------------------------------------------
  | Status filter
  |--------------------------------------------------------------------------
  */

  const handleStatusChange = (status) => {
    const nextSearchParams = new URLSearchParams();

    if (status) {
      nextSearchParams.set("status", status);
    }

    nextSearchParams.set("page", "1");

    setSearchParams(nextSearchParams);
  };

  /*
  |--------------------------------------------------------------------------
  | Pagination
  |--------------------------------------------------------------------------
  */

  const handlePageChange = (nextPage) => {
    const nextSearchParams = new URLSearchParams(searchParams);

    nextSearchParams.set("page", String(nextPage));

    setSearchParams(nextSearchParams);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  return (
    <main
      className="
        mx-auto
        min-h-[70vh]
        max-w-6xl
        px-4
        py-10
        sm:px-6
        sm:py-14
        lg:px-8
        lg:py-16
      "
    >
      {/* Header */}

      <div
        className="
          flex
          flex-col
          gap-6
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
            Your purchases
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
            My Orders
          </h1>

          <p
            className="
              mt-4
              max-w-2xl
              leading-7
              text-slate-500
            "
          >
            Review your purchases, payment status and order progress.
          </p>
        </div>

        <div
          className="
            flex
            flex-wrap
            gap-3
          "
        >
          <button
            type="button"
            onClick={handleRefresh}
            disabled={ordersLoading}
            className="
              rounded-full
              border
              border-slate-200
              px-5
              py-3
              text-sm
              font-black
              text-slate-700
              transition
              hover:bg-slate-50
              disabled:cursor-not-allowed
              disabled:opacity-50
            "
          >
            {ordersLoading ? "Refreshing..." : "Refresh orders"}
          </button>

          <Link
            to="/account"
            className="
              rounded-full
              border
              border-slate-200
              px-5
              py-3
              text-sm
              font-black
              text-slate-700
              transition
              hover:bg-slate-50
            "
          >
            ← Account
          </Link>
        </div>
      </div>

      {/* Filters */}

      <div
        className="
          mt-10
          overflow-x-auto
          border-b
          border-slate-200
          pb-4
        "
      >
        <div
          className="
            flex
            min-w-max
            gap-2
          "
        >
          {ORDER_FILTERS.map((filter) => {
            const active = selectedStatus === filter.value;

            return (
              <button
                key={filter.label}
                type="button"
                onClick={() => handleStatusChange(filter.value)}
                className={`
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
      </div>

      {/* Loading */}

      {ordersLoading && (
        <div
          className="
            mt-8
            space-y-5
          "
        >
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="
                  h-48
                  animate-pulse
                  rounded-[2rem]
                  bg-slate-100
                "
            />
          ))}
        </div>
      )}

      {/* Error */}

      {!ordersLoading && ordersError && (
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
          <p
            className="
                font-black
                text-red-700
              "
          >
            Your orders could not be loaded.
          </p>

          <p
            className="
                mt-2
                text-sm
                leading-6
                text-red-600
              "
          >
            {ordersError}
          </p>

          <button
            type="button"
            onClick={handleRefresh}
            className="
                mt-5
                rounded-full
                bg-red-600
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
      )}

      {/* Empty */}

      {!ordersLoading && !ordersError && orders.length === 0 && (
        <div
          className="
              mt-8
              rounded-[2rem]
              border
              border-slate-200
              bg-slate-50
              px-6
              py-16
              text-center
            "
        >
          <p
            className="
                text-sm
                font-black
                uppercase
                tracking-[0.14em]
                text-slate-400
              "
          >
            No orders
          </p>

          <h2
            className="
                mt-3
                text-3xl
                font-black
                tracking-tight
                text-slate-950
              "
          >
            Nothing here yet.
          </h2>

          <p
            className="
                mx-auto
                mt-3
                max-w-md
                leading-7
                text-slate-500
              "
          >
            {selectedStatus
              ? `You don't currently have any ${selectedStatus.toLowerCase()} orders.`
              : "Orders you place with KOLA will appear here."}
          </p>

          {!selectedStatus && (
            <Link
              to="/shop"
              className="
                  mt-7
                  inline-flex
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
              Start shopping
            </Link>
          )}
        </div>
      )}

      {/* Orders */}

      {!ordersLoading && !ordersError && orders.length > 0 && (
        <div
          className="
              mt-8
              space-y-5
            "
        >
          {orders.map((order) => {
            const itemCount = order._count?.items || 0;

            const payment = getPaymentPresentation(
              order.payment?.status || null,
            );

            return (
              <article
                key={order.id}
                className="
                      rounded-[2rem]
                      border
                      border-slate-200
                      bg-white
                      p-6
                      transition
                      hover:border-slate-300
                      sm:p-7
                    "
              >
                <div
                  className="
                        flex
                        flex-col
                        gap-5
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
                            tracking-[0.13em]
                            text-slate-400
                          "
                    >
                      Order
                    </p>

                    <p
                      className="
                            mt-1
                            font-black
                            text-slate-950
                          "
                    >
                      #{getShortOrderId(order.id)}
                    </p>

                    <p
                      className="
                            mt-2
                            text-sm
                            text-slate-500
                          "
                    >
                      {formatOrderDate(order.createdAt)}
                    </p>
                  </div>

                  <span
                    className={`
                          self-start
                          rounded-full
                          px-4
                          py-2
                          text-xs
                          font-black
                          uppercase
                          tracking-[0.08em]

                          ${
                            ORDER_STATUS_STYLES[order.status] ||
                            "bg-slate-100 text-slate-700"
                          }
                        `}
                  >
                    {order.status}
                  </span>
                </div>

                <div
                  className="
                        mt-6
                        grid
                        gap-5
                        border-y
                        border-slate-100
                        py-5
                        sm:grid-cols-3
                      "
                >
                  <div>
                    <p
                      className="
                            text-xs
                            font-semibold
                            uppercase
                            tracking-wider
                            text-slate-400
                          "
                    >
                      Total
                    </p>

                    <p
                      className="
                            mt-1
                            font-black
                            text-slate-950
                          "
                    >
                      {formatCurrency(order.totalAmount)}
                    </p>
                  </div>

                  <div>
                    <p
                      className="
                            text-xs
                            font-semibold
                            uppercase
                            tracking-wider
                            text-slate-400
                          "
                    >
                      Items
                    </p>

                    <p
                      className="
                            mt-1
                            font-black
                            text-slate-950
                          "
                    >
                      {itemCount} {itemCount === 1 ? "item" : "items"}
                    </p>
                  </div>

                  <div>
                    <p
                      className="
                            text-xs
                            font-semibold
                            uppercase
                            tracking-wider
                            text-slate-400
                          "
                    >
                      Payment
                    </p>

                    <span
                      className={`
                            mt-2
                            inline-flex
                            rounded-full
                            px-3
                            py-1.5
                            text-xs
                            font-black

                            ${payment.style}
                          `}
                    >
                      {payment.label}
                    </span>
                  </div>
                </div>

                <div
                  className="
                        mt-6
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
                    {getOrderMessage(order.status)}
                  </p>

                  <Link
                    to={`/checkout/order/${encodeURIComponent(order.id)}`}
                    className="
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
                    View order
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination */}

      {!ordersLoading &&
        !ordersError &&
        pagination &&
        pagination.totalPages > 1 && (
          <div
            className="
              mt-10
              flex
              items-center
              justify-between
              gap-4
              border-t
              border-slate-200
              pt-7
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
                px-5
                py-3
                text-sm
                font-black
                text-slate-700
                transition
                hover:bg-slate-50
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
                px-5
                py-3
                text-sm
                font-black
                text-slate-700
                transition
                hover:bg-slate-50
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

export default MyOrdersPage;
