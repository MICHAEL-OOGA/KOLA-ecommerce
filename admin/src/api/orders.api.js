import { apiRequest } from "./http.js";

/*
|--------------------------------------------------------------------------
| Retrieve admin order list
|--------------------------------------------------------------------------
*/

export const getAdminOrders = async ({
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

  return apiRequest(`/orders/admin/all?${searchParams.toString()}`, {
    signal,
  });
};

/*
|--------------------------------------------------------------------------
| Retrieve admin dashboard summary
|--------------------------------------------------------------------------
*/

export const getAdminDashboardSummary = async ({ signal } = {}) => {
  return apiRequest("/orders/admin/summary", {
    signal,
  });
};

/*
|--------------------------------------------------------------------------
| Retrieve one order as administrator
|--------------------------------------------------------------------------
*/

export const getAdminOrderById = async (orderId, { signal } = {}) => {
  return apiRequest(`/orders/admin/${encodeURIComponent(orderId)}`, {
    signal,
  });
};

/*
|--------------------------------------------------------------------------
| Update order fulfilment status
|--------------------------------------------------------------------------
|
| This is a state-changing request, therefore a session-bound
| CSRF token is required.
|
| The backend still determines whether the requested transition
| is actually allowed.
*/

export const updateAdminOrderStatus = async ({
  orderId,
  status,
  csrfToken,
}) => {
  return apiRequest(`/orders/admin/${encodeURIComponent(orderId)}/status`, {
    method: "PATCH",

    body: {
      status,
    },

    csrfToken,
  });
};
