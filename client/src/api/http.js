const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

/*
|--------------------------------------------------------------------------
| API request error
|--------------------------------------------------------------------------
*/

export class ApiError extends Error {
  constructor(message, { status = 500, code = null, data = null } = {}) {
    super(message);

    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/*
|--------------------------------------------------------------------------
| Central API request helper
|--------------------------------------------------------------------------
|
| Important:
|
| credentials: "include"
|
| allows the browser to send our secure HttpOnly authentication cookie.
|
| React itself never reads the JWT.
*/

export const apiRequest = async (
  path,
  { method = "GET", body, headers = {}, csrfToken = null, signal } = {},
) => {
  const requestHeaders = {
    Accept: "application/json",
    ...headers,
  };

  /*
   * Only add Content-Type when a body actually exists.
   */
  if (body !== undefined && body !== null) {
    requestHeaders["Content-Type"] = "application/json";
  }

  /*
   * CSRF tokens are only supplied for protected mutations.
   */
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

    throw new ApiError("Unable to connect to the server.", {
      status: 0,
      code: "NETWORK_ERROR",
    });
  }

  const contentType = response.headers.get("content-type") || "";

  let data = null;

  if (contentType.includes("application/json")) {
    data = await response.json();
  }

  if (!response.ok) {
    throw new ApiError(data?.message || "The request could not be completed.", {
      status: response.status,

      code: data?.code || null,

      data,
    });
  }

  return data;
};

export { API_BASE_URL };
