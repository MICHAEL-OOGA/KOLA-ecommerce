import { apiRequest } from "./http.js";

export const getAdminCategories = async ({ signal } = {}) => {
  return apiRequest("/categories/admin/all", {
    signal,
  });
};

export const createAdminCategory = async ({ category, csrfToken }) => {
  return apiRequest("/categories", {
    method: "POST",
    body: category,
    csrfToken,
  });
};

export const updateAdminCategory = async ({
  categoryId,
  updates,
  csrfToken,
}) => {
  return apiRequest(`/categories/${encodeURIComponent(categoryId)}`, {
    method: "PATCH",
    body: updates,
    csrfToken,
  });
};

export const deleteAdminCategory = async ({ categoryId, csrfToken }) => {
  return apiRequest(`/categories/${encodeURIComponent(categoryId)}`, {
    method: "DELETE",
    csrfToken,
  });
};
