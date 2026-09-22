import { apiRequest } from "./http.js";

/*
|--------------------------------------------------------------------------
| Initiate M-Pesa STK Push
|--------------------------------------------------------------------------
|
| The frontend sends ONLY:
|
| orderId
|
| The backend determines:
|
| - authenticated customer
| - order ownership
| - customer phone
| - authoritative order amount
| - whether the order is payable
| - whether another payment attempt is already active
|
| Frontend validation below is only developer/UX protection.
| The backend remains authoritative.
*/

export const initiateMpesaPayment = async ({ orderId, csrfToken }) => {
  if (typeof orderId !== "string" || !orderId.trim()) {
    throw new Error("A valid order ID is required to start payment.");
  }

  return apiRequest("/mpesa/stk-push", {
    method: "POST",

    body: {
      orderId: orderId.trim(),
    },

    csrfToken,
  });
};
