const getMpesaBaseUrl = () => {
  return process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
};

export const getMpesaAccessToken = async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      "M-Pesa Consumer Key or Consumer Secret is missing in .env.",
    );
  }

  // Safaricom expects the key and secret in Base64 Basic Auth format.
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
    "base64",
  );

  const response = await fetch(
    `${getMpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    },
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    console.error("M-Pesa OAuth response:", data);

    throw new Error(
      data.errorMessage ||
        data.error_description ||
        "Failed to authenticate with M-Pesa.",
    );
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
};

/**
 * Generates an M-Pesa timestamp in the format:
 * YYYYMMDDHHmmss
 *
 * Example:
 * 20260716104530
 *
 * Kenya uses UTC+3 throughout the year.
 */
const generateMpesaTimestamp = () => {
  const kenyaTime = new Date(Date.now() + 3 * 60 * 60 * 1000);

  return kenyaTime
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
};

/**
 * Initiates an M-Pesa Express STK Push request.
 */
export const initiateMpesaStkPush = async ({
  phoneNumber,
  amount,
  accountReference,
}) => {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.MPESA_CALLBACK_URL;

  if (!shortcode || !passkey || !callbackUrl) {
    throw new Error(
      "M-Pesa shortcode, passkey, or callback URL is missing in .env.",
    );
  }

  const { accessToken } = await getMpesaAccessToken();

  const timestamp = generateMpesaTimestamp();

  /*
   * M-Pesa requires a dynamically generated password:
   *
   * shortcode + passkey + timestamp
   *
   * The combined value is then converted to Base64.
   */
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString(
    "base64",
  );

  const response = await fetch(
    `${getMpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`,
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
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
        TransactionDesc: "Mini ecommerce order payment",
      }),
    },
  );

  const data = await response.json();

  if (!response.ok || String(data.ResponseCode) !== "0") {
    console.error("M-Pesa STK Push response:", data);

    throw new Error(
      data.errorMessage ||
        data.ResponseDescription ||
        "M-Pesa STK Push request failed.",
    );
  }

  return data;
};
