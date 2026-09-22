import { apiRequest } from "./http.js";

/*
|--------------------------------------------------------------------------
| Admin product list
|--------------------------------------------------------------------------
*/

export const getAdminProducts = async ({
  page = 1,
  limit = 20,
  status = "ALL",
  search = "",
  signal,
} = {}) => {
  const searchParams = new URLSearchParams();

  searchParams.set("page", String(page));
  searchParams.set("limit", String(limit));
  searchParams.set("status", status);

  const normalizedSearch = search.trim();

  if (normalizedSearch) {
    searchParams.set("search", normalizedSearch);
  }

  return apiRequest(`/products/admin/all?${searchParams.toString()}`, {
    signal,
  });
};

/*
|--------------------------------------------------------------------------
| Inventory summary
|--------------------------------------------------------------------------
*/

export const getAdminProductSummary = async ({ signal } = {}) => {
  return apiRequest("/products/admin/summary", {
    signal,
  });
};

/*
|--------------------------------------------------------------------------
| One product
|--------------------------------------------------------------------------
*/

export const getAdminProductById = async (productId, { signal } = {}) => {
  return apiRequest(`/products/admin/${encodeURIComponent(productId)}`, {
    signal,
  });
};

/*
|--------------------------------------------------------------------------
| Create product
|--------------------------------------------------------------------------
*/

export const createAdminProduct = async ({ product, csrfToken }) => {
  return apiRequest("/products", {
    method: "POST",
    body: product,
    csrfToken,
  });
};

/*
|--------------------------------------------------------------------------
| Update normal product information
|--------------------------------------------------------------------------
|
| Stock deliberately does NOT belong here.
*/

export const updateAdminProduct = async ({ productId, updates, csrfToken }) => {
  return apiRequest(`/products/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    body: updates,
    csrfToken,
  });
};

/*
|--------------------------------------------------------------------------
| Update stock safely
|--------------------------------------------------------------------------
*/

export const updateAdminProductStock = async ({
  productId,
  expectedCurrentStock,
  stock,
  csrfToken,
}) => {
  return apiRequest(`/products/admin/${encodeURIComponent(productId)}/stock`, {
    method: "PATCH",

    body: {
      expectedCurrentStock,
      stock,
    },

    csrfToken,
  });
};

/*
|--------------------------------------------------------------------------
| Deactivate product
|--------------------------------------------------------------------------
*/

export const deactivateAdminProduct = async ({ productId, csrfToken }) => {
  return apiRequest(`/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    csrfToken,
  });
};

/*
|--------------------------------------------------------------------------
| Inventory alerts
|--------------------------------------------------------------------------
*/

export const getAdminInventoryAlerts = async ({ limit = 5, signal } = {}) => {
  const searchParams = new URLSearchParams();

  searchParams.set("limit", String(limit));

  return apiRequest(
    `/products/admin/inventory-alerts?${searchParams.toString()}`,
    {
      signal,
    },
  );
};
