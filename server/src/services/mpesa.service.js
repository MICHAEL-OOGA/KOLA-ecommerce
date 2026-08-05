/*
|--------------------------------------------------------------------------
| M-Pesa service configuration
|--------------------------------------------------------------------------
*/

const MPESA_REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;
const MPESA_MAX_RESPONSE_BYTES = 64 * 1024;

const allowedMpesaEnvironments = new Set(["sandbox", "production"]);

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;
let activeTokenRequest = null;

/*
|--------------------------------------------------------------------------
| Environment validation
|--------------------------------------------------------------------------
*/

const getRequiredEnvironmentVariable = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Required environment variable ${name} is missing.`);
  }

  return value;
};

const getMpesaEnvironment = () => {
  const environment = getRequiredEnvironmentVariable("MPESA_ENV").toLowerCase();

  if (!allowedMpesaEnvironments.has(environment)) {
    throw new Error('MPESA_ENV must be either "sandbox" or "production".');
  }

  return environment;
};

const getMpesaBaseUrl = () => {
  return getMpesaEnvironment() === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
};

/*
|--------------------------------------------------------------------------
| Safe response handling
|--------------------------------------------------------------------------
*/

const getProviderErrorMessage = (data, fallbackMessage) => {
  if (!data || typeof data !== "object") {
    return fallbackMessage;
  }

  return (
    data.errorMessage ||
    data.error_description ||
    data.ResponseDescription ||
    data.ResultDesc ||
    fallbackMessage
  );
};

const parseJsonResponse = async (response) => {
  const contentLength = Number(response.headers.get("content-length"));

  if (
    Number.isFinite(contentLength) &&
    contentLength > MPESA_MAX_RESPONSE_BYTES
  ) {
    throw new Error("M-Pesa returned an unexpectedly large response.");
  }

  const responseText = await response.text();

  if (Buffer.byteLength(responseText, "utf8") > MPESA_MAX_RESPONSE_BYTES) {
    throw new Error("M-Pesa returned an unexpectedly large response.");
  }

  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error("M-Pesa returned an invalid response.");
  }
};

/*
|--------------------------------------------------------------------------
| Fetch with timeout
|--------------------------------------------------------------------------
*/

const fetchMpesaJson = async (
  url,
  options,
  timeoutMilliseconds = MPESA_REQUEST_TIMEOUT_MS,
) => {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMilliseconds);

  try {
    const response = await fetch(url, {
      ...options,

      signal: controller.signal,

      redirect: "error",
    });

    const data = await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        getProviderErrorMessage(
          data,
          `M-Pesa request failed with HTTP status ${response.status}.`,
        ),
      );
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("M-Pesa request timed out. Please try again.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

/*
|--------------------------------------------------------------------------
| Access-token management
|--------------------------------------------------------------------------
|
| We cache the token in memory until shortly before it expires.
|
| activeTokenRequest prevents several simultaneous requests from all
| requesting separate access tokens at the same time.
*/

export const getMpesaAccessToken = async () => {
  const currentTime = Date.now();

  if (cachedAccessToken && currentTime < cachedAccessTokenExpiresAt) {
    const remainingExpiresInSeconds = Math.max(
      1,
      Math.floor((cachedAccessTokenExpiresAt - currentTime) / 1000),
    );

    return {
      accessToken: cachedAccessToken,
      expiresIn: remainingExpiresInSeconds,
      cached: true,
    };
  }

  if (activeTokenRequest) {
    return activeTokenRequest;
  }

  activeTokenRequest = (async () => {
    const consumerKey = getRequiredEnvironmentVariable("MPESA_CONSUMER_KEY");

    const consumerSecret = getRequiredEnvironmentVariable(
      "MPESA_CONSUMER_SECRET",
    );

    const credentials = Buffer.from(
      `${consumerKey}:${consumerSecret}`,
    ).toString("base64");

    const data = await fetchMpesaJson(
      `${getMpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: "application/json",
        },
      },
    );

    if (!data.access_token) {
      throw new Error(
        getProviderErrorMessage(
          data,
          "M-Pesa authentication did not return an access token.",
        ),
      );
    }

    const expiresInSeconds = Number(data.expires_in);

    const safeExpiresInSeconds =
      Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? expiresInSeconds
        : 3_599;

    cachedAccessToken = data.access_token;

    cachedAccessTokenExpiresAt =
      Date.now() + safeExpiresInSeconds * 1000 - TOKEN_EXPIRY_SAFETY_MARGIN_MS;

    return {
      accessToken: cachedAccessToken,
      expiresIn: safeExpiresInSeconds,
      cached: false,
    };
  })();

  try {
    return await activeTokenRequest;
  } finally {
    activeTokenRequest = null;
  }
};

/*
|--------------------------------------------------------------------------
| Timestamp and password
|--------------------------------------------------------------------------
*/

const generateMpesaTimestamp = () => {
  const kenyaTime = new Date(Date.now() + 3 * 60 * 60 * 1000);

  return kenyaTime
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
};

const generateMpesaPassword = ({ shortcode, passkey, timestamp }) => {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
};

/*
|--------------------------------------------------------------------------
| Shared payment configuration
|--------------------------------------------------------------------------
*/

const getMpesaPaymentConfiguration = () => {
  const shortcode = getRequiredEnvironmentVariable("MPESA_SHORTCODE");
  const passkey = getRequiredEnvironmentVariable("MPESA_PASSKEY");

  if (!/^\d{5,7}$/.test(shortcode)) {
    throw new Error("MPESA_SHORTCODE has an invalid format.");
  }

  return {
    shortcode,
    passkey,
  };
};

const validateCallbackUrl = (callbackUrl) => {
  let parsedUrl;

  try {
    parsedUrl = new URL(callbackUrl);
  } catch {
    throw new Error("MPESA_CALLBACK_URL is not a valid URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("MPESA_CALLBACK_URL must use HTTPS.");
  }

  return parsedUrl.toString();
};

/*
|--------------------------------------------------------------------------
| STK Push validation
|--------------------------------------------------------------------------
*/

const validateStkPushInput = ({ phoneNumber, amount, accountReference }) => {
  if (!/^254(?:7|1)\d{8}$/.test(phoneNumber)) {
    throw new Error(
      "The M-Pesa phone number must use the 254XXXXXXXXX format.",
    );
  }

  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new Error("The M-Pesa amount must be a positive whole number.");
  }

  if (
    typeof accountReference !== "string" ||
    accountReference.length < 1 ||
    accountReference.length > 12 ||
    !/^[A-Za-z0-9]+$/.test(accountReference)
  ) {
    throw new Error(
      "The M-Pesa account reference must contain 1–12 letters or numbers.",
    );
  }
};

/*
|--------------------------------------------------------------------------
| Initiate STK Push
|--------------------------------------------------------------------------
*/

export const initiateMpesaStkPush = async ({
  phoneNumber,
  amount,
  accountReference,
}) => {
  validateStkPushInput({
    phoneNumber,
    amount,
    accountReference,
  });

  const { shortcode, passkey } = getMpesaPaymentConfiguration();

  const callbackUrl = validateCallbackUrl(
    getRequiredEnvironmentVariable("MPESA_CALLBACK_URL"),
  );

  const { accessToken } = await getMpesaAccessToken();

  const timestamp = generateMpesaTimestamp();

  const password = generateMpesaPassword({
    shortcode,
    passkey,
    timestamp,
  });

  const data = await fetchMpesaJson(
    `${getMpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`,
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: "Ecommerce order",
      }),
    },
  );

  if (String(data.ResponseCode) !== "0") {
    throw new Error(
      getProviderErrorMessage(data, "M-Pesa rejected the STK Push request."),
    );
  }

  if (!data.MerchantRequestID || !data.CheckoutRequestID) {
    throw new Error(
      "M-Pesa accepted the request but did not return the required request identifiers.",
    );
  }

  return data;
};

/*
|--------------------------------------------------------------------------
| Query STK Push status
|--------------------------------------------------------------------------
|
| This asks Safaricom for the current status of a CheckoutRequestID.
|
| A successful HTTP response does not automatically mean that the customer
| paid. The callback route must inspect ResultCode and the verified database
| records before changing an order to PAID.
*/

export const queryMpesaStkPushStatus = async (checkoutRequestId) => {
  if (
    typeof checkoutRequestId !== "string" ||
    checkoutRequestId.trim().length < 5 ||
    checkoutRequestId.length > 150
  ) {
    throw new Error("A valid CheckoutRequestID is required.");
  }

  const normalizedCheckoutRequestId = checkoutRequestId.trim();

  const { shortcode, passkey } = getMpesaPaymentConfiguration();
  const { accessToken } = await getMpesaAccessToken();

  const timestamp = generateMpesaTimestamp();

  const password = generateMpesaPassword({
    shortcode,
    passkey,
    timestamp,
  });

  const data = await fetchMpesaJson(
    `${getMpesaBaseUrl()}/mpesa/stkpushquery/v1/query`,
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },

      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: normalizedCheckoutRequestId,
      }),
    },
  );

  if (String(data.ResponseCode) !== "0") {
    throw new Error(
      getProviderErrorMessage(
        data,
        "M-Pesa could not verify the transaction status.",
      ),
    );
  }

  return data;
};
