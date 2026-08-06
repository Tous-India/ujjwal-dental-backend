/**
 * WHATSAPP NOTIFICATION DISPATCH (Tous Connect integration)
 *
 * Centralized entry point for every WhatsApp notification sent by the app.
 * WHATSAPP_ENABLED stays "false" (the default) until real credentials are
 * configured -- until then every call just logs what WOULD have been sent.
 *
 * All messages use type:"template" (never "text") -- these are business-
 * initiated notifications, not replies within a 24h service window, so only
 * a template can (re)open the conversation per Tous Connect's docs.
 *
 * Every call site (account creation, membership purchase, payment recorded,
 * session booked, ...) goes through this one function via `fireWhatsApp` --
 * never call sendWhatsApp() directly and await it inline.
 */

const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === "true";
const TOUS_CONNECT_API_KEY = process.env.TOUS_CONNECT_API_KEY;
const TOUS_CONNECT_URL = "https://connect.thetous.com/api/v1/messages/send";

// Draft copy only -- kept for reference / any future non-template rendering.
// Not used to build the real request below (that's driven by
// TEMPLATE_NAME_MAP + buildBodyParams instead, per Tous Connect's
// template_components shape).
export const WHATSAPP_TEMPLATES = {
  // v2 (approved shape): plaintext password removed entirely -- Meta
  // rejected the original 2-variable version over WhatsApp policy against
  // sending credentials via template messages. Clinic phone is now fixed
  // body text in the template itself, not a variable.
  account_created:
    'Welcome to Ujjwal Dental Clinic! Your patient portal account is ready.\n\nLogin: ujjwaldentalplanet.com/login\nUsername: {phone}\n\nAsk our staff for your password, or use "Forgot Password" on the login page.\n\nFor any help, call us at +91-9467776028.',
  membership_purchased:
    "Your {planName} membership is now active! Valid until {validUntil}. Thank you for choosing Ujjwal Dental Clinic.",
  payment_recorded:
    "Payment received: Rs{amount} for {description} at Ujjwal Dental Clinic. Invoice: {invoiceNumber}. Thank you!",
  session_booked:
    "Your next treatment session is confirmed for {date} at {time}, Ujjwal Dental Clinic. See you soon!",
  payment_link:
    "Hi! Please complete your payment of Rs{amount} for {description} at Ujjwal Dental Clinic using this secure link: {shortUrl}",
  // Amount-free booking confirmations. Every existing booking-related
  // template embeds a payment amount, so a FREE booking (and a postpay
  // booking, where nothing is collected yet) had no template it could
  // legally fill -- those patients received nothing at all.
  appointment_booked_free:
    "Your appointment at Ujjwal Dental Clinic is confirmed.\nDate: {date}\nTime: {time}\nClinic: {clinic}\n\nPlease arrive 10 minutes early. Call +91-9467776028 for any changes.",
  session_booked_free:
    "Your {treatmentName} session at Ujjwal Dental Clinic is confirmed.\nDate: {date}\nTime: {time}\n\nSee you soon!",
};

/**
 * Maps our internal templateType values to the EXACT template_name string
 * registered in Tous Connect's dashboard. Sunny may name these slightly
 * differently than this draft when she submits them for Meta approval --
 * this map is the one place to update, not a deep refactor.
 */
export const TEMPLATE_NAME_MAP = {
  // Resubmitted after Meta rejected the original 2-variable version (see
  // buildBodyParams below). If Tous Connect required registering this as a
  // NEW template name on resubmit (e.g. "account_created_v2") rather than
  // reusing "account_created", update this one line to match whatever name
  // actually shows as approved in the Tous Connect dashboard.
  // OTP-era rewrite: zero variables. The password was already removed in v2
  // (Meta rejects credentials in templates); the username/phone variable is
  // gone too now that patients log in with a WhatsApp OTP rather than a
  // shared password, so the template is entirely static text.
  account_created: "account_created_v1",
  membership_purchased: "membership_purchased",
  payment_recorded: "payment_recorded",
  appointment_reminder_24h: "appointment_reminder_24h",
  appointment_reminder_2h: "appointment_reminder_2h",
  session_booked: "session_booked",
  report_shared: "report_shared",
  // NOT YET APPROVED by Meta as of this writing -- Sunny still needs to submit
  // this draft to Tous Connect for approval (see WHATSAPP_TEMPLATES.payment_link
  // above for the exact draft copy/variable order). Until then, real sends
  // return the same clean 502 "unapproved template" response every other
  // not-yet-approved template already gets -- expected, not a bug. The
  // Razorpay short_url is ALWAYS returned/stored regardless, so the admin UI
  // can show it for manual copy no matter what this send does.
  payment_link: "payment_link",
  // Amount-free booking confirmations (see WHATSAPP_TEMPLATES above).
  // ⚠ These two strings must match EXACTLY what Sunny registered in Tous
  // Connect. If she submitted them under different names, changing these two
  // lines is the ONLY edit required anywhere in the codebase.
  appointment_booked_free: "appointment_booked_free",
  session_booked_free: "session_booked_free",
};

// WhatsApp template body parameters must be non-empty strings.
const textParam = (value) => ({
  type: "text",
  text: value === null || value === undefined || value === "" ? "-" : String(value),
});

/**
 * Ordered {{1}}, {{2}}, ... body parameters per template. Existing call
 * sites don't always pass every field a template drafts for (e.g. no call
 * site currently sends a "date" for payment_recorded, or "clinic"/
 * "treatment" for session_booked) -- rather than touch every call site
 * again here, missing fields fall back to a sensible default so a real send
 * is never malformed by a missing param.
 */
const buildBodyParams = (templateType, phone, data) => {
  switch (templateType) {
    case "account_created":
      // account_created_v1 (OTP era): ZERO variables -- entirely static text
      // pointing the patient at the login page and explaining the OTP flow.
      // The password was already dropped in v2 (Meta rejects credentials in
      // template messages), and the username/phone variable is gone now that
      // login is by WhatsApp OTP. Returning [] means buildComponents omits the
      // body block entirely -- sending parameters for a zero-variable template
      // would itself get the send rejected. Any `data.password` / phone passed
      // by a call site is intentionally ignored.
      return [];
    case "membership_purchased":
      return [textParam(data.planName), textParam(data.validUntil)];
    case "payment_recorded":
      return [
        textParam(data.amount),
        textParam(data.description),
        textParam(data.invoiceNumber),
        textParam(data.date || new Date().toLocaleDateString("en-IN")),
      ];
    case "appointment_reminder_24h":
    case "appointment_reminder_2h":
      return [textParam(data.date), textParam(data.time), textParam(data.clinic || "Ujjwal Dental Clinic")];
    case "session_booked":
      return [
        textParam(data.treatment || "your treatment"),
        textParam(data.date),
        textParam(data.time),
        textParam(data.clinic || "Ujjwal Dental Clinic"),
      ];
    // ---- Amount-free booking confirmations ----
    // {{1}} date, {{2}} time, {{3}} clinic -- confirmed against the templates
    // as submitted to Tous Connect.
    case "appointment_booked_free":
      return [
        textParam(data.date),
        textParam(data.time),
        textParam(data.clinic || "Ujjwal Dental Clinic"),
      ];
    // Unambiguous -- spec named all three in order.
    case "session_booked_free":
      return [
        textParam(data.treatmentName || "your treatment"),
        textParam(data.date),
        textParam(data.time),
      ];
    case "report_shared":
      return [textParam(data.reportTitle || "your report")];
    case "payment_link":
      return [
        textParam(data.amount),
        textParam(data.description || "your treatment"),
        textParam(data.shortUrl),
      ];
    default:
      return [];
  }
};

const buildComponents = (templateType, phone, data) => {
  const bodyParams = buildBodyParams(templateType, phone, data);

  // A zero-variable template (account_created_v1) must NOT carry a body
  // component: sending parameters for a template that declares none is itself
  // grounds for rejection. contact_name is unaffected -- it's a top-level
  // field on the request, not a body variable, so it is still always sent.
  const components = bodyParams.length
    ? [{ type: "body", parameters: bodyParams }]
    : [];

  // Media-template case: report_shared attaches the real report file as a
  // document header, per Tous Connect's docs.
  if (templateType === "report_shared" && data.fileUrl) {
    components.push({
      type: "header",
      parameters: [
        {
          type: "document",
          document: {
            link: data.fileUrl,
            filename: data.fileName || "report.pdf",
          },
        },
      ],
    });
  }

  return components;
};

/**
 * Send a WhatsApp message via Tous Connect.
 *
 * `patientName` is a REQUIRED, explicit parameter (not buried in `data`) --
 * Tous Connect treats contact_name as optional and, when omitted, "guesses"
 * a display name from the template's first body variable. Since {{1}} is
 * often an amount or plan name (payment_recorded, membership_purchased),
 * omitting contact_name showed conversations in the Tous Connect Inbox
 * labeled "920" or "Premium Dental Health Plan" instead of the patient's
 * name. contact_name is now ALWAYS sent, falling back to the phone number
 * only in the (should-never-happen) case no name is available -- never
 * undefined/omitted.
 *
 * In stub mode (WHATSAPP_ENABLED !== "true", the default), this never
 * throws and never makes a network call -- it just logs and resolves.
 */
export async function sendWhatsApp(phone, templateType, data = {}, patientName) {
  const contactName = patientName || phone;

  if (!WHATSAPP_ENABLED) {
    console.log(`[WhatsApp STUB] Would send "${templateType}" to ${phone} (contact_name: ${contactName}):`, data);
    return { success: true, stubbed: true };
  }

  const templateName = TEMPLATE_NAME_MAP[templateType];
  if (!templateName) {
    console.error(`[WhatsApp] Unknown templateType "${templateType}" -- no template name mapped`);
    return { success: false, error: "Unknown template type" };
  }

  try {
    const response = await fetch(TOUS_CONNECT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOUS_CONNECT_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "template",
        to: phone,
        template_name: templateName,
        template_language: "en",
        contact_name: contactName,
        template_components: buildComponents(templateType, phone, data),
      }),
    });

    let result = null;
    try {
      result = await response.json();
    } catch {
      // Non-JSON error body -- fall through with result=null, status/ok still handled below.
    }

    if (!response.ok) {
      // 502 is the EXPECTED state while templates await Meta approval --
      // logged as a warning, not an error, and never treated as a code bug.
      if (response.status === 502) {
        console.warn(
          `[WhatsApp] Meta rejected send (likely unapproved template "${templateName}"), expected during approval wait:`,
          result?.error || result
        );
      } else if (response.status === 401) {
        console.error("[WhatsApp] 401 bad API key -- check TOUS_CONNECT_API_KEY config:", result?.error || result);
      } else if (response.status === 402) {
        console.error("[WhatsApp] 402 insufficient Meta credits -- needs funds added:", result?.error || result);
      } else if (response.status === 400) {
        console.error("[WhatsApp] 400 validation error, not retrying:", result?.error || result);
      } else {
        console.error(`[WhatsApp] Send failed (${response.status}):`, result?.error || result);
      }
      return { success: false, status: response.status, error: result?.error || result };
    }

    return { success: true, ...result };
  } catch (err) {
    console.error("[WhatsApp] Unexpected error:", err.message);
    return { success: false, error: err.message };
  }
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
 *
 * `patientName` is required (not optional) so every call site is forced to
 * supply it -- see sendWhatsApp's doc comment for why (Tous Connect Inbox
 * showed amounts/plan names as the contact name when this was omitted).
 */
export function fireWhatsApp(phone, templateType, data, patientName) {
  if (!phone) {
    console.error(`[WhatsApp] Skipped "${templateType}" -- no phone number available`);
    return;
  }
  try {
    sendWhatsApp(phone, templateType, data, patientName).catch((err) => {
      console.error(`[WhatsApp] Failed to send "${templateType}" to ${phone}:`, err.message);
    });
  } catch (err) {
    // Defensive -- sendWhatsApp is async and shouldn't throw synchronously,
    // but never let a WhatsApp dispatch bug escape to the caller.
    console.error(`[WhatsApp] Failed to dispatch "${templateType}" to ${phone}:`, err.message);
  }
}

export default sendWhatsApp;
