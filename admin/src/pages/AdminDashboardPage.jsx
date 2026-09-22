import { useEffect, useState } from "react";

import { Link } from "react-router-dom";

import { getAdminDashboardSummary } from "../api/orders.api.js";

import {
  getAdminInventoryAlerts,
  getAdminProductSummary,
} from "../api/products.api.js";

import { getAdminCategories } from "../api/categories.api.js";

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

  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const STATUS_STYLES = {
  PENDING: "bg-amber-50 text-amber-700",

  PAID: "bg-emerald-50 text-emerald-700",

  PROCESSING: "bg-blue-50 text-blue-700",

  SHIPPED: "bg-indigo-50 text-indigo-700",

  DELIVERED: "bg-emerald-50 text-emerald-700",

  CANCELLED: "bg-red-50 text-red-700",

  EXPIRED: "bg-slate-100 text-slate-600",
};

function AdminDashboardPage() {
  const [dashboardData, setDashboardData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [errorMessage, setErrorMessage] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

  /*
  |--------------------------------------------------------------------------
  | Load operational overview
  |--------------------------------------------------------------------------
  |
  | Each endpoint calculates authoritative information server-side.
  |
  | React combines those responses for presentation only.
  */

  useEffect(() => {
    const controller = new AbortController();

    const loadDashboard = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const [
          orderResponse,
          productResponse,
          inventoryResponse,
          categoryResponse,
        ] = await Promise.all([
          getAdminDashboardSummary({
            signal: controller.signal,
          }),

          getAdminProductSummary({
            signal: controller.signal,
          }),

          getAdminInventoryAlerts({
            limit: 5,

            signal: controller.signal,
          }),

          getAdminCategories({
            signal: controller.signal,
          }),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        setDashboardData({
          orders: orderResponse,

          products: productResponse.summary,

          inventoryAlerts: Array.isArray(inventoryResponse.products)
            ? inventoryResponse.products
            : [],

          lowStockThreshold: inventoryResponse.lowStockThreshold,

          categories: Array.isArray(categoryResponse.categories)
            ? categoryResponse.categories
            : [],
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("Admin dashboard failed:", error);

        setDashboardData(null);

        setErrorMessage(
          error?.message || "Dashboard information could not be loaded.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      controller.abort();
    };
  }, [reloadKey]);

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
              w-72
              rounded
              bg-slate-200
            "
          />

          <div
            className="
              mt-10
              grid
              gap-4
              sm:grid-cols-2
              xl:grid-cols-4
            "
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
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
        </div>
      </main>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Error
  |--------------------------------------------------------------------------
  */

  if (errorMessage || !dashboardData) {
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
            Dashboard unavailable
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

  const orderSummary = dashboardData.orders.summary;

  const recentOrders = dashboardData.orders.recentOrders || [];

  const productSummary = dashboardData.products;

  const inventoryAlerts = dashboardData.inventoryAlerts;

  const categoryCount = dashboardData.categories.length;

  /*
   * These values are derived from authoritative
   * server-provided counts.
   */
  const ordersToFulfil =
    orderSummary.statuses.paid +
    orderSummary.statuses.processing +
    orderSummary.statuses.shipped;

  const primaryCards = [
    {
      label: "Verified revenue",

      value: formatCurrency(orderSummary.payments.totalRevenue),

      description: `${orderSummary.payments.successfulPayments} successful payment(s)`,
    },

    {
      label: "Total orders",

      value: orderSummary.totalOrders,

      description: "All recorded orders",
    },

    {
      label: "To fulfil",

      value: ordersToFulfil,

      description: "Paid through shipped",
    },

    {
      label: "Awaiting payment",

      value: orderSummary.statuses.pending,

      description: "Pending orders",
    },
  ];

  const catalogueCards = [
    {
      label: "Active products",

      value: productSummary?.activeProducts ?? 0,

      link: "/products?status=ACTIVE",
    },

    {
      label: "Low stock",

      value: productSummary?.lowStockProducts ?? 0,

      link: "/products",
    },

    {
      label: "Out of stock",

      value: productSummary?.outOfStockProducts ?? 0,

      link: "/products",
    },

    {
      label: "Categories",

      value: categoryCount,

      link: "/categories",
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
            Administration
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
            Overview
          </h1>

          <p
            className="
              mt-3
              max-w-2xl
              text-slate-500
            "
          >
            Orders, payments and inventory requiring your attention.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setReloadKey((current) => current + 1)}
          className="
            self-start
            rounded-full
            border
            border-slate-200
            bg-white
            px-5
            py-3
            text-sm
            font-black
            text-slate-700
            transition
            hover:bg-slate-100
            sm:self-auto
          "
        >
          Refresh
        </button>
      </div>

      {/* Business metrics */}

      <section
        className="
          mt-10
          grid
          gap-4
          sm:grid-cols-2
          xl:grid-cols-4
        "
      >
        {primaryCards.map((card) => (
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

            <p
              className="
                  mt-2
                  text-xs
                  text-slate-400
                "
            >
              {card.description}
            </p>
          </article>
        ))}
      </section>

      {/* Catalogue health */}

      <div
        className="
          mt-10
          flex
          items-end
          justify-between
          gap-4
        "
      >
        <div>
          <p
            className="
              text-xs
              font-black
              uppercase
              tracking-[0.15em]
              text-slate-400
            "
          >
            Catalogue health
          </p>

          <h2
            className="
              mt-2
              text-2xl
              font-black
              text-slate-950
            "
          >
            Inventory
          </h2>
        </div>

        <Link
          to="/products"
          className="
            text-sm
            font-black
            text-slate-500
            hover:text-slate-950
          "
        >
          Products →
        </Link>
      </div>

      <section
        className="
          mt-5
          grid
          gap-4
          sm:grid-cols-2
          xl:grid-cols-4
        "
      >
        {catalogueCards.map((card) => (
          <Link
            key={card.label}
            to={card.link}
            className="
                rounded-[2rem]
                border
                border-slate-200
                bg-white
                p-6
                transition
                hover:-translate-y-0.5
                hover:border-slate-300
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
                  text-slate-950
                "
            >
              {card.value}
            </p>
          </Link>
        ))}
      </section>

      {/* Operational panels */}

      <div
        className="
          mt-8
          grid
          gap-6
          xl:grid-cols-2
        "
      >
        {/* Recent orders */}

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
              items-center
              justify-between
              gap-4
            "
          >
            <div>
              <p
                className="
                  text-xs
                  font-black
                  uppercase
                  tracking-[0.14em]
                  text-slate-400
                "
              >
                Latest activity
              </p>

              <h2
                className="
                  mt-2
                  text-2xl
                  font-black
                  text-slate-950
                "
              >
                Recent orders
              </h2>
            </div>

            <Link
              to="/orders"
              className="
                text-sm
                font-black
                text-slate-500
                hover:text-slate-950
              "
            >
              See all →
            </Link>
          </div>

          <div className="mt-5">
            {recentOrders.length === 0 ? (
              <p
                className="
                  py-10
                  text-center
                  text-slate-500
                "
              >
                No orders yet.
              </p>
            ) : (
              recentOrders.map((order) => (
                <Link
                  key={order.id}
                  to={`/orders/${encodeURIComponent(order.id)}`}
                  className="
                      flex
                      items-center
                      justify-between
                      gap-4
                      border-t
                      border-slate-100
                      py-5
                      first:border-t-0
                    "
                >
                  <div className="min-w-0">
                    <p
                      className="
                          truncate
                          font-black
                          text-slate-950
                        "
                    >
                      {order.customerName}
                    </p>

                    <p
                      className="
                          mt-1
                          text-xs
                          text-slate-400
                        "
                    >
                      {formatDate(order.createdAt)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p
                      className="
                          font-black
                          text-slate-950
                        "
                    >
                      {formatCurrency(order.totalAmount)}
                    </p>

                    <span
                      className={`
                          mt-1
                          inline-flex
                          rounded-full
                          px-2.5
                          py-1
                          text-[10px]
                          font-black
                          uppercase

                          ${
                            STATUS_STYLES[order.status] ||
                            "bg-slate-100 text-slate-600"
                          }
                        `}
                    >
                      {order.status}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Inventory alerts */}

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
              items-center
              justify-between
              gap-4
            "
          >
            <div>
              <p
                className="
                  text-xs
                  font-black
                  uppercase
                  tracking-[0.14em]
                  text-amber-600
                "
              >
                Attention
              </p>

              <h2
                className="
                  mt-2
                  text-2xl
                  font-black
                  text-slate-950
                "
              >
                Inventory alerts
              </h2>
            </div>

            <Link
              to="/products"
              className="
                text-sm
                font-black
                text-slate-500
                hover:text-slate-950
              "
            >
              Manage →
            </Link>
          </div>

          <p
            className="
              mt-2
              text-sm
              text-slate-500
            "
          >
            Active products with {dashboardData.lowStockThreshold ?? 10} units
            or fewer.
          </p>

          <div className="mt-5">
            {inventoryAlerts.length === 0 ? (
              <div
                className="
                  rounded-2xl
                  bg-emerald-50
                  p-5
                "
              >
                <p
                  className="
                    font-black
                    text-emerald-800
                  "
                >
                  Inventory looks healthy.
                </p>

                <p
                  className="
                    mt-1
                    text-sm
                    text-emerald-700
                  "
                >
                  No active products are currently low on stock.
                </p>
              </div>
            ) : (
              inventoryAlerts.map((product) => {
                const outOfStock = product.stock === 0;

                return (
                  <Link
                    key={product.id}
                    to={`/products/${encodeURIComponent(product.id)}`}
                    className="
                        flex
                        items-center
                        justify-between
                        gap-4
                        border-t
                        border-slate-100
                        py-5
                        first:border-t-0
                      "
                  >
                    <div className="min-w-0">
                      <p
                        className="
                            truncate
                            font-black
                            text-slate-950
                          "
                      >
                        {product.name}
                      </p>

                      <p
                        className="
                            mt-1
                            text-xs
                            text-slate-400
                          "
                      >
                        {product.category?.name || "Uncategorized"}
                      </p>
                    </div>

                    <div className="text-right">
                      <p
                        className={`
                            text-xl
                            font-black

                            ${outOfStock ? "text-red-600" : "text-amber-600"}
                          `}
                      >
                        {product.stock}
                      </p>

                      <p
                        className={`
                            mt-1
                            text-[10px]
                            font-black
                            uppercase
                            tracking-wider

                            ${outOfStock ? "text-red-500" : "text-amber-500"}
                          `}
                      >
                        {outOfStock ? "Out of stock" : "Low stock"}
                      </p>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default AdminDashboardPage;
