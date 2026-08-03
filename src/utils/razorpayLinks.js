/**
 * RAZORPAY PAYMENT LINKS
 *
 * Generates a shareable Razorpay Payment Link -- distinct from the embedded-
 * checkout Orders API already used elsewhere in payment.controller.js
 * (createRazorpayOrder / verifyRazorpayPayment, the patient-facing "Pay
 * Online" in-app checkout flow). This is the admin-initiated flow: admin
 * books an OPD or Treatment appointment, selects "Razorpay" as the payment
 * method, and a shareable link (short_url) is generated and sent to the
 * patient via WhatsApp, with a manual-copy fallback in the admin UI.
 *
 * Docs: https://razorpay.com/docs/api/payments/payment-links/create/
 */

const RAZORPAY_PAYMENT_LINKS_URL = "https://api.razorpay.com/v1/payment_links";

/**
 * @param {Object} invoice  A saved Invoice document (needs _id, grandTotal, items)
 * @param {Object} patient  A saved Patient document (needs name, phone)
 * @param {Object} [options]
 * @param {number} [options.amount]  Override amount to charge (₹), instead of
 *   invoice.grandTotal. Needed by post-hoc/partial collection call sites
 *   (CollectPaymentModal, per-session collect) where the invoice may already
 *   be partially paid -- the link must be for the SPECIFIC amount being
 *   collected right now, never the full (possibly-already-partly-paid) total.
 * @param {string} [options.referenceAppointmentId]  When collecting against a
 *   specific appointment/session (not just the invoice as a whole), this is
 *   appended to reference_id as `${invoiceId}:${appointmentId}` so the
 *   payment_link.paid webhook can link the resulting Payment to that exact
 *   session -- keeping per-session collected amounts correct (non-cumulative).
 *   Omit for the plain invoice-level case (existing behaviour, unchanged).
 * @returns {Promise<{shortUrl: string, paymentLinkId: string}>}
 */
export async function generateRazorpayPaymentLink(invoice, patient, options = {}) {
  const { amount: amountOverride, referenceAppointmentId } = options;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured");
  }

  const chargeAmount = amountOverride != null ? Number(amountOverride) : Number(invoice?.grandTotal);
  const amountPaise = Math.round(chargeAmount * 100);
  if (!amountPaise || amountPaise <= 0) {
    throw new Error("Invoice amount must be greater than ₹0 to generate a payment link");
  }

  if (!patient?.phone) {
    throw new Error("Patient phone number is required to generate a payment link");
  }

  const description = invoice.items?.[0]?.description || "Payment to Ujjwal Dental Clinic";

  // FRONTEND_URL sometimes carries a trailing slash (as configured in Vercel) --
  // strip it so callback_url never ends up with a double slash.
  const frontendUrl = (process.env.FRONTEND_URL || "https://ujjwaldentalplanet.com").replace(/\/+$/, "");

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const body = {
    amount: amountPaise,
    currency: "INR",
    description,
    customer: {
      name: patient.name,
      contact: patient.phone,
    },
    // We handle notification ourselves via fireWhatsApp -- never let Razorpay
    // send its own SMS/email for this link.
    notify: { sms: false, email: false },
    reference_id: referenceAppointmentId
      ? `${invoice._id}:${referenceAppointmentId}`
      : String(invoice._id),
    callback_url: `${frontendUrl}/payment-callback`,
    callback_method: "get",
  };

  const response = await fetch(RAZORPAY_PAYMENT_LINKS_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON error body -- data stays null, handled by !response.ok below.
  }

  if (!response.ok) {
    const desc = data?.error?.description || `Razorpay payment link creation failed (HTTP ${response.status})`;
    console.error("[RazorpayLinks] Payment link creation failed:", data || response.statusText);
    throw new Error(desc);
  }

  return { shortUrl: data.short_url, paymentLinkId: data.id };
}

export default generateRazorpayPaymentLink;
