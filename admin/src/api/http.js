const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

export class ApiError extends Error {
  constructor(
    message,
    { status = null, code = null, errors = null, data = null } = {},
  ) {
    super(message);

    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.data = data;
  }
}

export const apiRequest = async (
  path,
  { method = "GET", body, headers = {}, csrfToken = null, signal } = {},
) => {
  const requestHeaders = {
    Accept: "application/json",
    ...headers,
  };

  if (body !== undefined && body !== null) {
    requestHeaders["Content-Type"] = "application/json";
  }

  if (csrfToken) {
    requestHeaders["X-CSRF-Token"] = csrfToken;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,

      credentials: "include",

      headers: requestHeaders,

      body:
        body !== undefined && body !== null ? JSON.stringify(body) : undefined,

      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }

    throw new ApiError("Unable to connect to the server.");
  }

  let data = null;

  const contentType = response.headers.get("content-type");

  if (contentType?.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(data?.message || "The request could not be completed.", {
      status: response.status,
      code: data?.code || null,
      errors: data?.errors || null,
      data,
    });
  }

  return data;
};
