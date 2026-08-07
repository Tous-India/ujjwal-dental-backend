/**
 * Shared reconciliation for a PAID Razorpay Payment Link.
 *
 * Two independent paths reach this:
 *   1. the payment_link.paid webhook (Razorpay tells us), and
 *   2. the manual "Verify Payment" action (we ask Razorpay).
 *
 * They MUST apply money identically, so the logic lives here once rather than
 * being duplicated -- a webhook and a manual check that drift apart would
 * produce two different financial truths for the same payment.
 *
 * IDEMPOTENCY IS THE CRITICAL PROPERTY. Both paths can legitimately fire for
 * the same link: the webhook arrives, and an admin also clicks Verify because
 * the patient said they had paid. Double-counting money is worse than the
 * missed webhook this exists to catch, so reconciliation is guarded twice --
 * by the invoice's own link status AND by the existence of a Payment carrying
 * this link id. The second guard is the real one: it survives even if the
 * invoice's paymentLink sub-document is stale or was never written.
 */
import Invoice from "../modules/billing/invoice.model.js";
import Payment from "../modules/payments/payment.model.js";
import Appointment from "../modules/appointments/appointment.model.js";
import Patient from "../modules/patients/patient.model.js";
import { fireWhatsApp } from "./whatsapp.js";
import { describeInvoice } from "./paymentDescription.js";

/**
 * @param {Object}  opts
 * @param {Object}  opts.invoice             loaded Invoice document
 * @param {Object}  opts.linkEntity          { id, amount_paid?, amount?, short_url?, status? }
 * @param {Object} [opts.paidPaymentEntity]  underlying razorpay payment, when known
 * @param {string} [opts.sessionAppointmentId] per-session attribution
 * @param {string} [opts.source="webhook"]   "webhook" | "manual-verify" (audit only)
 * @returns {Promise<{reconciled:boolean, alreadyReconciled:boolean, payment?:Object, appliedAmount?:number, reason?:string}>}
 */
export const reconcilePaidPaymentLink = async ({
  invoice,
  linkEntity,
  paidPaymentEntity,
  sessionAppointmentId,
  source = "webhook",
}) => {
  if (!invoice) return { reconciled: false, alreadyReconciled: false, reason: "no-invoice" };
  if (!linkEntity?.id) return { reconciled: false, alreadyReconciled: false, reason: "no-link" };

  // Guard 1 -- the invoice already records this link as paid.
  if (invoice.paymentLink?.status === "paid") {
    return { reconciled: false, alreadyReconciled: true, reason: "invoice-already-paid" };
  }

  // Guard 2 -- a Payment already exists for this link id. Authoritative: it
  // holds regardless of the invoice's own link state, so a webhook and a
  // manual Verify racing each other still produce exactly ONE Payment.
  const existing = await Payment.findOne({ razorpayPaymentLinkId: linkEntity.id });
  if (existing) {
    return {
      reconciled: false,
      alreadyReconciled: true,
      payment: existing,
      reason: "payment-already-exists",
    };
  }

  const capturedAmount = Math.max(
    0,
    Number(linkEntity.amount_paid ?? linkEntity.amount ?? 0) / 100
  );
  const previousAmountPaid = invoice.amountPaid || 0;
  const applyAmount =
    capturedAmount > 0 ? capturedAmount : Math.max(0, invoice.grandTotal - previousAmountPaid);

  invoice.amountPaid = previousAmountPaid + applyAmount;
  invoice.paymentLink = {
    id: invoice.paymentLink?.id || linkEntity.id,
    shortUrl: invoice.paymentLink?.shortUrl || linkEntity.short_url,
    status: "paid",
    createdAt: invoice.paymentLink?.createdAt || new Date(),
    paidAt: new Date(),
  };
  await invoice.save(); // pre-save hook recalculates grandTotal/paymentStatus/balanceDue

  const payment = await Payment.createSafe({
    patient: invoice.patient,
    clinic: invoice.clinic,
    // A per-session collection links the Payment to that SPECIFIC session,
    // not the parent invoice.appointment -- otherwise a session's "collected"
    // total double-counts into the wrong session.
    appointment: sessionAppointmentId || invoice.appointment,
    amount: applyAmount,
    paymentMode: "razorpay",
    type: invoice.items?.[0]?.itemType === "opd_fee" ? "opd_fee" : "treatment",
    status: "paid",
    paidAt: new Date(),
    razorpayPaymentId: paidPaymentEntity?.id,
    razorpayPaymentLinkId: linkEntity.id,
    razorpayDetails: paidPaymentEntity
      ? {
          method: paidPaymentEntity.method,
          bank: paidPaymentEntity.bank,
          wallet: paidPaymentEntity.wallet,
          vpa: paidPaymentEntity.vpa,
        }
      : undefined,
    notes:
      source === "manual-verify"
        ? `Paid via Razorpay Payment Link (${linkEntity.id}) — reconciled manually via Verify Payment`
        : `Paid via Razorpay Payment Link (${linkEntity.id})`,
    settledInvoices: [
      {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        appliedAmount: applyAmount,
        previousAmountPaid,
      },
    ],
  });

  // Keep the appointment's denormalized payment state in sync, if linked.
  if (invoice.appointment) {
    const linkedAppointment = await Appointment.findById(invoice.appointment);
    if (linkedAppointment) {
      linkedAppointment.opdFeePaid = true;
      if (invoice.paymentStatus === "paid") linkedAppointment.paymentStatus = "paid";
      linkedAppointment.paymentLinkStatus = "paid";
      await linkedAppointment.save();
    }
  }

  console.log(
    `[${source}] payment_link reconciled for invoice ${invoice.invoiceNumber}, payment ${payment.paymentNumber}, amount ₹${applyAmount}`
  );

  // Fire-and-forget notification -- mirrors the other payment-recorded sites.
  (async () => {
    try {
      const payer = await Patient.findById(invoice.patient).select("phone name");
      fireWhatsApp(
        payer?.phone,
        "payment_recorded",
        {
          amount: applyAmount,
          description: describeInvoice(invoice),
          invoiceNumber: invoice.invoiceNumber,
        },
        payer?.name
      );
    } catch (err) {
      console.error(`[${source}] payment_recorded notify lookup failed:`, err.message);
    }
  })();

  return { reconciled: true, alreadyReconciled: false, payment, appliedAmount: applyAmount };
};

/**
 * Ask Razorpay for a payment link's REAL current status.
 * GET /v1/payment_links/{id}, Basic auth with the same credentials used to
 * create links.
 */
export const fetchRazorpayPaymentLink = async (linkId) => {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    const err = new Error("Razorpay is not configured on the server");
    err.statusCode = 500;
    throw err;
  }

  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/payment_links/${linkId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.error?.description || `Razorpay returned ${res.status}`);
    err.statusCode = res.status === 400 ? 404 : 502;
    throw err;
  }
  return body;
};

export default reconcilePaidPaymentLink;
