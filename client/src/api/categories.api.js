import { apiRequest } from "./http.js";

export const getCategories = async ({ signal } = {}) => {
  const response = await apiRequest("/categories", {
    signal,
  });

  return response.categories;
};
