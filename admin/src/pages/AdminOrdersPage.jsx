import { useEffect, useState } from "react";

import { Link, useSearchParams } from "react-router-dom";

import { getAdminOrders } from "../api/orders.api.js";

/*
|--------------------------------------------------------------------------
| Filters
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

const VALID_STATUSES = new Set(
  ORDER_FILTERS.map((filter) => filter.value).filter(Boolean),
);

const STATUS_STYLES = {
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

const shortOrderId = (orderId) => {
  if (!orderId) {
    return "Unknown";
  }

  return orderId.slice(-10).toUpperCase();
};

function AdminOrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [orders, setOrders] = useState([]);

  const [pagination, setPagination] = useState(null);

  const [loading, setLoading] = useState(true);

  const [errorMessage, setErrorMessage] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

  const pageFromUrl = Number(searchParams.get("page") || "1");

  const page =
    Number.isSafeInteger(pageFromUrl) && pageFromUrl >= 1 ? pageFromUrl : 1;

  const statusFromUrl = searchParams.get("status")?.trim().toUpperCase() || "";

  const selectedStatus = VALID_STATUSES.has(statusFromUrl) ? statusFromUrl : "";

  /*
  |--------------------------------------------------------------------------
  | Retrieve orders
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const controller = new AbortController();

    const loadOrders = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const response = await getAdminOrders({
          page,
          limit: 10,

          status: selectedStatus || null,

          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setOrders(Array.isArray(response.orders) ? response.orders : []);

        setPagination(response.pagination || null);
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("Admin orders failed:", error);

        setOrders([]);

        setPagination(null);

        setErrorMessage(error?.message || "Orders could not be loaded.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadOrders();

    return () => {
      controller.abort();
    };
  }, [page, selectedStatus, reloadKey]);

  /*
  |--------------------------------------------------------------------------
  | Navigation
  |--------------------------------------------------------------------------
  */

  const handleStatusChange = (status) => {
    const next = new URLSearchParams();

    next.set("page", "1");

    if (status) {
      next.set("status", status);
    }

    setSearchParams(next);
  };

  const handlePageChange = (nextPage) => {
    const next = new URLSearchParams(searchParams);

    next.set("page", String(nextPage));

    setSearchParams(next);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

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
          Operations
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
          Orders
        </h1>

        <p
          className="
            mt-3
            text-slate-500
          "
        >
          Review customer orders, payments and fulfilment progress.
        </p>
      </div>

      {/* Filters */}

      <div
        className="
          mt-9
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
                        : "bg-white text-slate-600 hover:bg-slate-100"
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

      {loading && (
        <div
          className="
            mt-7
            space-y-4
          "
        >
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="
                  h-32
                  animate-pulse
                  rounded-[2rem]
                  bg-slate-100
                "
            />
          ))}
        </div>
      )}

      {/* Error */}

      {!loading && errorMessage && (
        <div
          className="
              mt-7
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
                text-red-800
              "
          >
            Orders unavailable
          </p>

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
      )}

      {/* Empty */}

      {!loading && !errorMessage && orders.length === 0 && (
        <div
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
                text-sm
                font-black
                uppercase
                tracking-wider
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
                text-slate-950
              "
          >
            Nothing to show.
          </h2>
        </div>
      )}

      {/* Orders */}

      {!loading && !errorMessage && orders.length > 0 && (
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
          {orders.map((order) => (
            <article
              key={order.id}
              className="
                    border-b
                    border-slate-100
                    p-6
                    last:border-b-0
                  "
            >
              <div
                className="
                      grid
                      gap-5
                      md:grid-cols-[1.4fr_1fr_1fr_auto]
                      md:items-center
                    "
              >
                {/* Customer */}

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
                    Order #{shortOrderId(order.id)}
                  </p>

                  <p
                    className="
                          mt-2
                          font-black
                          text-slate-950
                        "
                  >
                    {order.customerName}
                  </p>

                  <p
                    className="
                          mt-1
                          text-sm
                          text-slate-500
                        "
                  >
                    {order.customerEmail || order.customerPhone}
                  </p>
                </div>

                {/* Amount */}

                <div>
                  <p
                    className="
                          text-xs
                          font-bold
                          uppercase
                          tracking-wider
                          text-slate-400
                        "
                  >
                    Total
                  </p>

                  <p
                    className="
                          mt-2
                          font-black
                          text-slate-950
                        "
                  >
                    {formatCurrency(order.totalAmount)}
                  </p>

                  <p
                    className="
                          mt-1
                          text-xs
                          text-slate-400
                        "
                  >
                    {order.items?.length || 0} item(s)
                  </p>
                </div>

                {/* Status */}

                <div>
                  <span
                    className={`
                          inline-flex
                          rounded-full
                          px-3.5
                          py-2
                          text-xs
                          font-black
                          uppercase
                          tracking-wider

                          ${
                            STATUS_STYLES[order.status] ||
                            "bg-slate-100 text-slate-600"
                          }
                        `}
                  >
                    {order.status}
                  </span>

                  <p
                    className="
                          mt-2
                          text-xs
                          text-slate-400
                        "
                  >
                    {formatDate(order.createdAt)}
                  </p>
                </div>

                {/* View */}

                <Link
                  to={`/orders/${encodeURIComponent(order.id)}`}
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
                  View
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* Pagination */}

      {!loading && !errorMessage && pagination && pagination.totalPages > 1 && (
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

export default AdminOrdersPage;
