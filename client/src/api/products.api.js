import { apiRequest } from "./http.js";

/*
|--------------------------------------------------------------------------
| Get all active products
|--------------------------------------------------------------------------
|
| Kept for existing parts of the storefront that may still need the
| simple active-product endpoint.
*/

export const getProducts = async ({ signal } = {}) => {
  const response = await apiRequest("/products", {
    signal,
  });

  return response.products;
};

/*
|--------------------------------------------------------------------------
| Get storefront catalogue
|--------------------------------------------------------------------------
|
| Search, category filtering, sorting and pagination are performed by
| the backend.
*/

export const getCatalogProducts = async ({
  page = 1,
  limit = 12,
  search = "",
  category = "",
  sort = "NEWEST",
  signal,
} = {}) => {
  const searchParams = new URLSearchParams();

  searchParams.set("page", String(page));
  searchParams.set("limit", String(limit));
  searchParams.set("sort", sort);

  const normalizedSearch = search.trim();
  const normalizedCategory = category.trim();

  if (normalizedSearch) {
    searchParams.set("search", normalizedSearch);
  }

  if (normalizedCategory) {
    searchParams.set("category", normalizedCategory);
  }

  return apiRequest(`/products/catalog?${searchParams.toString()}`, {
    signal,
  });
};

/*
|--------------------------------------------------------------------------
| Get one active product by ID
|--------------------------------------------------------------------------
*/

export const getProductById = async (productId, { signal } = {}) => {
  const response = await apiRequest(
    `/products/${encodeURIComponent(productId)}`,
    {
      signal,
    },
  );

  return response.product;
};
