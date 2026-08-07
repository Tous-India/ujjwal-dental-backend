/**
 * Human-readable "what was this payment FOR" text.
 *
 * Feeds {{2}} of the payment_recorded WhatsApp template. That slot was being
 * handed the invoice NUMBER at several call sites, producing messages like:
 *
 *   Amount Received: Rs300
 *   For: Invoice INV-2608-0008      <- useless, and
 *   Invoice: INV-2608-0008          <- already shown here in {{3}}
 *
 * The patient learned nothing about what they paid for. The invoice number has
 * its own slot, so this one must never repeat it.
 */

/** itemType -> patient-facing label, when a line item has no description. */
const ITEM_TYPE_LABELS = {
  opd_fee: "Appointment",
  consultation: "Appointment",
  treatment: "Treatment",
  surgery: "Surgery",
  test: "Diagnostic Test",
  lab: "Lab Work",
  medicine: "Medicines",
  membership: "Membership",
  other: "Dental Services",
};

/** Last-resort label -- never an invoice number. */
export const DEFAULT_PAYMENT_DESCRIPTION = "Dental Services";

/**
 * Derive a description from an invoice's own line items.
 *
 * Prefers the first item's real description (already meaningful: "OPD
 * Consultation", "Root Canal", a plan name), falls back to a label for its
 * itemType, and appends a count when several distinct items are covered so a
 * multi-item invoice doesn't misrepresent itself as only its first line.
 *
 * @param {Object} invoice - an Invoice doc or lean object
 * @returns {string}
 */
export const describeInvoice = (invoice) => {
  const items = invoice?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return DEFAULT_PAYMENT_DESCRIPTION;
  }

  const first = items[0];
  const base =
    (typeof first?.description === "string" && first.description.trim()) ||
    ITEM_TYPE_LABELS[first?.itemType] ||
    DEFAULT_PAYMENT_DESCRIPTION;

  return items.length > 1 ? `${base} + ${items.length - 1} more` : base;
};

/**
 * Pick the best available description, discarding anything that is really an
 * invoice number.
 *
 * Call sites historically passed `notes` here, which is often internal text
 * like "Invoice payment via Razorpay — INV-2608-0008". Anything that looks
 * like an invoice reference is rejected rather than shown to the patient.
 *
 * @param {...(string|undefined)} candidates - in preference order
 * @returns {string}
 */
export const pickPaymentDescription = (...candidates) => {
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const trimmed = c.trim();
    if (!trimmed) continue;
    // Reject invoice-number-ish text: our numbers look like INV-2608-0008, and
    // "Invoice <something>" reads as a reference, not a description.
    if (/\bINV-\d/i.test(trimmed)) continue;
    if (/^invoice\b/i.test(trimmed)) continue;
    return trimmed;
  }
  return DEFAULT_PAYMENT_DESCRIPTION;
};

export default describeInvoice;
