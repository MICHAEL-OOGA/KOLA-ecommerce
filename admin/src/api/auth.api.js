import { apiRequest } from "./http.js";

/*
|--------------------------------------------------------------------------
| Administrator authentication API
|--------------------------------------------------------------------------
|
| The admin application has its own authentication endpoints and its own
| HttpOnly authentication cookie.
|
| Customer:
|   /api/auth/*
|
| Administrator:
|   /api/admin/auth/*
|
| The browser never reads either authentication cookie directly.
*/

export const login = async ({ email, password }) => {
  return apiRequest("/admin/auth/login", {
    method: "POST",

    body: {
      email,
      password,
    },
  });
};

export const getCurrentUser = async ({ signal } = {}) => {
  return apiRequest("/admin/auth/me", {
    signal,
  });
};

export const getCsrfToken = async ({ signal } = {}) => {
  const response = await apiRequest("/admin/auth/csrf-token", {
    signal,
  });

  return response.csrfToken;
};

export const logout = async (csrfToken) => {
  return apiRequest("/admin/auth/logout", {
    method: "POST",

    csrfToken,
  });
};
