import { apiRequest } from "./http.js";

/*
|--------------------------------------------------------------------------
| Create order from authenticated cart
|--------------------------------------------------------------------------
|
| Browser sends:
|
| customerPhone
| Idempotency-Key
|
| Backend determines:
|
| authenticated customer
| authoritative cart
| current prices
| stock
| total amount
| order validity
*/

export const createOrder = async ({
  customerPhone,
  idempotencyKey,
  csrfToken,
}) => {
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw new Error("A secure checkout attempt key is required.");
  }

  return apiRequest("/orders", {
    method: "POST",

    headers: {
      "Idempotency-Key": idempotencyKey.trim(),
    },

    body: {
      customerPhone,
    },

    csrfToken,
  });
};

/*
|--------------------------------------------------------------------------
| Retrieve authenticated customer's order history
|--------------------------------------------------------------------------
*/

export const getCustomerOrders = async ({
  page = 1,
  limit = 10,
  status = null,
  signal,
} = {}) => {
  const searchParams = new URLSearchParams();

  searchParams.set("page", String(page));

  searchParams.set("limit", String(limit));

  if (status) {
    searchParams.set("status", status);
  }

  return apiRequest(`/orders?${searchParams.toString()}`, {
    signal,
  });
};

/*
|--------------------------------------------------------------------------
| Retrieve customer's own order
|--------------------------------------------------------------------------
|
| Backend determines ownership.
|
| A customer cannot retrieve another customer's order
| merely by knowing its ID.
*/

export const getOrderById = async (orderId, { signal } = {}) => {
  if (typeof orderId !== "string" || !orderId.trim()) {
    throw new Error("A valid order ID is required.");
  }

  return apiRequest(`/orders/${encodeURIComponent(orderId.trim())}`, {
    signal,
  });
};
