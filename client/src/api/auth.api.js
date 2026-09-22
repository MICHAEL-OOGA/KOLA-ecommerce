import { apiRequest } from "./http.js";

export const register = async ({
  fullName,
  email,
  phone,
  password,
  confirmPassword,
}) => {
  return apiRequest("/auth/register", {
    method: "POST",

    body: {
      fullName,
      email,
      phone: phone || null,
      password,
      confirmPassword,
    },
  });
};

export const verifyEmail = async ({ email, code }) => {
  return apiRequest("/auth/verify-email", {
    method: "POST",

    body: {
      email,
      code,
    },
  });
};

export const resendVerification = async (email) => {
  return apiRequest("/auth/resend-verification", {
    method: "POST",

    body: {
      email,
    },
  });
};

export const login = async ({ email, password }) => {
  return apiRequest("/auth/login", {
    method: "POST",

    body: {
      email,
      password,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Forgot password
|--------------------------------------------------------------------------
*/

export const forgotPassword = async (email) => {
  return apiRequest("/auth/forgot-password", {
    method: "POST",

    body: {
      email,
    },
  });
};

/*
|--------------------------------------------------------------------------
| Reset password
|--------------------------------------------------------------------------
*/

export const resetPassword = async ({ token, password, confirmPassword }) => {
  return apiRequest("/auth/reset-password", {
    method: "POST",

    body: {
      token,
      password,
      confirmPassword,
    },
  });
};

export const getCurrentUser = async ({ signal } = {}) => {
  const response = await apiRequest("/auth/me", {
    signal,
  });

  return response;
};

export const getCsrfToken = async ({ signal } = {}) => {
  const response = await apiRequest("/auth/csrf-token", {
    signal,
  });

  return response.csrfToken;
};

export const logout = async (csrfToken) => {
  return apiRequest("/auth/logout", {
    method: "POST",
    csrfToken,
  });
};
