import { apiRequest } from "./http.js";

/*
|--------------------------------------------------------------------------
| Get authenticated customer's cart
|--------------------------------------------------------------------------
*/

export const getCart = async ({ signal } = {}) => {
  const response = await apiRequest("/cart", {
    signal,
  });

  return response.cart;
};

/*
|--------------------------------------------------------------------------
| Add product to cart
|--------------------------------------------------------------------------
|
| The frontend sends ONLY:
|
| productId
| quantity
|
| Price, stock and ownership remain backend-authoritative.
*/

export const addCartItem = async ({ productId, quantity = 1, csrfToken }) => {
  return apiRequest("/cart/items", {
    method: "POST",

    body: {
      productId,
      quantity,
    },

    csrfToken,
  });
};

/*
|--------------------------------------------------------------------------
| Set exact cart-item quantity
|--------------------------------------------------------------------------
*/

export const updateCartItem = async ({ productId, quantity, csrfToken }) => {
  return apiRequest(`/cart/items/${encodeURIComponent(productId)}`, {
    method: "PATCH",

    body: {
      quantity,
    },

    csrfToken,
  });
};

/*
|--------------------------------------------------------------------------
| Remove product
|--------------------------------------------------------------------------
*/

export const removeCartItem = async ({ productId, csrfToken }) => {
  return apiRequest(`/cart/items/${encodeURIComponent(productId)}`, {
    method: "DELETE",

    csrfToken,
  });
};

/*
|--------------------------------------------------------------------------
| Clear entire cart
|--------------------------------------------------------------------------
*/

export const clearServerCart = async (csrfToken) => {
  return apiRequest("/cart", {
    method: "DELETE",

    csrfToken,
  });
};
