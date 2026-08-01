/**
 * WHATSAPP NOTIFICATION DISPATCH (Tous Connect integration -- STUBBED)
 *
 * Centralized entry point for every WhatsApp notification sent by the app.
 * The real Tous Connect API call is intentionally NOT implemented yet --
 * credentials aren't available. Until then, WHATSAPP_ENABLED stays "false"
 * (the default) and every call just logs what WOULD have been sent.
 *
 * When real credentials arrive, only `sendWhatsApp()` below needs to change --
 * every call site (account creation, membership purchase, payment recorded,
 * session booked) already calls through this one function via `fireWhatsApp`.
 */

const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === "true"; // default OFF until real credentials exist

// Draft copy only -- not yet Meta-approved WhatsApp templates. Kept here for
// reference / future rendering; sendWhatsApp() does not render these in stub
// mode, it just logs the template type + data.
export const WHATSAPP_TEMPLATES = {
  account_created:
    "Welcome to Ujjwal Dental Clinic! Your patient portal is ready. Login: https://ujjwaldentalplanet.com/login | Username: {phone} | Password: {password}",
  membership_purchased:
    "Your {planName} membership is now active! Valid until {validUntil}. Thank you for choosing Ujjwal Dental Clinic.",
  payment_recorded:
    "Payment received: Rs{amount} for {description} at Ujjwal Dental Clinic. Invoice: {invoiceNumber}. Thank you!",
  session_booked:
    "Your next treatment session is confirmed for {date} at {time}, Ujjwal Dental Clinic. See you soon!",
};

/**
 * Send a WhatsApp message via Tous Connect.
 *
 * In stub mode (WHATSAPP_ENABLED !== "true", the default), this never
 * throws and never makes a network call -- it just logs and resolves.
 *
 * Once WHATSAPP_ENABLED="true", this throws until the real integration
 * below is implemented -- callers MUST use `fireWhatsApp` (never call this
 * directly and await it inline in a way that could block/fail the caller).
 */
export async function sendWhatsApp(phone, templateType, data) {
  if (!WHATSAPP_ENABLED) {
    console.log(`[WhatsApp STUB] Would send "${templateType}" to ${phone}:`, data);
    return { success: true, stubbed: true };
  }
  // TODO: real Tous Connect API call goes here once credentials are available.
  // Expected shape (placeholder, will be corrected once real API docs are in hand):
  //   POST https://api.tousconnect.com/send (or whatever the real endpoint is)
  //   headers: { Authorization: `Bearer ${process.env.TOUS_CONNECT_API_KEY}` }
  //   body: { to: phone, template: templateType, variables: data }
  throw new Error("WHATSAPP_ENABLED is true but real Tous Connect integration not yet implemented");
}

/**
 * Fire-and-forget wrapper -- the ONLY way call sites should invoke
 * sendWhatsApp(). Never awaited by callers, never throws, never blocks or
 * delays the underlying action (patient creation, membership purchase,
 * payment recording, session booking). Mirrors the established
 * dispatchBookingNotifications / notifyHelper.notify() pattern used
 * elsewhere in this codebase for exactly this "don't block the request"
 * requirement: the async work is kicked off and its promise is caught
 * internally, but never returned/awaited by the caller.
 */
export function fireWhatsApp(phone, templateType, data) {
  if (!phone) {
    console.error(`[WhatsApp] Skipped "${templateType}" -- no phone number available`);
    return;
  }
  try {
    sendWhatsApp(phone, templateType, data).catch((err) => {
      console.error(`[WhatsApp] Failed to send "${templateType}" to ${phone}:`, err.message);
    });
  } catch (err) {
    // Defensive -- sendWhatsApp is async and shouldn't throw synchronously,
    // but never let a WhatsApp dispatch bug escape to the caller.
    console.error(`[WhatsApp] Failed to dispatch "${templateType}" to ${phone}:`, err.message);
  }
}

export default sendWhatsApp;
