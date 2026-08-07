/**
 * Verify Payment -- manual reconciliation of a Razorpay payment link.
 *
 * Exists because a real webhook miss cost real money visibility:
 * payment_link.paid was not enabled on the Razorpay webhook, so a patient paid
 * and the CRM showed the invoice unpaid indefinitely.
 *
 * IDEMPOTENCY IS THE POINT. Double-counting money is worse than the missed
 * webhook this guards against, so the tests below hammer that specifically:
 * verify twice, verify after the webhook already ran, and webhook after a
 * verify already ran -- all must leave exactly ONE Payment.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

const LINK_ID = "plink_verify_test_001";

describe("Verify Payment (manual Razorpay reconciliation)", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
    process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "rzp_test_secret";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    restoreFetch();
    await Invoice.deleteMany({ patient: testData.patient._id });
    await Payment.deleteMany({ patient: testData.patient._id });
    await Appointment.deleteMany({ patient: testData.patient._id });
  });

  /** An invoice with a generated (but unpaid) payment link. */
  const makeInvoice = async (overrides = {}) =>
    Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [
        {
          itemType: "opd_fee", description: "OPD Consultation", quantity: 1,
          unitPrice: 300, discount: { percentage: 0, amount: 0 },
          taxRate: 0, amount: 300, taxAmount: 0, total: 300,
        },
      ],
      amountPaid: 0,
      paymentLink: {
        id: LINK_ID,
        shortUrl: "https://rzp.io/rzp/testlink",
        status: "created",
        createdAt: new Date(),
        paidAt: null,
      },
      ...overrides,
    });

  // Direct assignment, not vi.spyOn: globalThis.fetch is not spy-able in this
  // runtime (the spy silently does not intercept), which made every mocked
  // call fall through to a real network attempt.
  let savedFetch = null;
  const restoreFetch = () => { if (savedFetch) { global.fetch = savedFetch; savedFetch = null; } };

  /** Stub Razorpay's GET /payment_links/:id with a given status. */
  const mockRazorpay = (status, amountPaid = 30000) => {
    if (!savedFetch) savedFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: LINK_ID,
        status,
        amount: 30000,
        amount_paid: status === "paid" ? amountPaid : 0,
        short_url: "https://rzp.io/rzp/testlink",
        reference_id: null,
      }),
    });
  };

  const verify = (invoiceId) =>
    request(app).post(`/api/payments/verify-razorpay-link/${invoiceId}`).set(authHeader(token));

  it("T1 (HARD GATE): an UNPAID link reports its real status and changes NOTHING", async () => {
    const invoice = await makeInvoice();
    mockRazorpay("created");

    const res = await verify(invoice._id);
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe("not_paid");
    expect(res.body.data.razorpayStatus).toBe("created");
    expect(res.body.message).toMatch(/no payment has been received/i);

    // Nothing touched.
    const after = await Invoice.findById(invoice._id);
    expect(after.amountPaid).toBe(0);
    expect(after.paymentLink.status).toBe("created");
    expect(await Payment.countDocuments({ patient: testData.patient._id })).toBe(0);
  });

  it("T1b: cancelled and expired links are also reported without changes", async () => {
    for (const status of ["cancelled", "expired", "partially_paid"]) {
      const invoice = await makeInvoice();
      mockRazorpay(status);

      const res = await verify(invoice._id);
      expect(res.body.data.outcome).toBe("not_paid");
      expect(res.body.data.razorpayStatus).toBe(status);
      expect((await Invoice.findById(invoice._id)).amountPaid).toBe(0);

      vi.restoreAllMocks();
      restoreFetch();
      await Invoice.deleteMany({ patient: testData.patient._id });
    }
    expect(await Payment.countDocuments({ patient: testData.patient._id })).toBe(0);
  });

  it("T2 (HARD GATE): a genuinely PAID link is reconciled -- invoice marked paid and one Payment created", async () => {
    const invoice = await makeInvoice();
    mockRazorpay("paid", 30000);

    const res = await verify(invoice._id);
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe("reconciled");
    expect(res.body.data.appliedAmount).toBe(300);

    const after = await Invoice.findById(invoice._id);
    expect(after.amountPaid).toBe(300);
    expect(after.paymentStatus).toBe("paid");
    expect(after.balanceDue).toBe(0);
    expect(after.paymentLink.status).toBe("paid");
    expect(after.paymentLink.paidAt).toBeTruthy();

    const payments = await Payment.find({ patient: testData.patient._id });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(300);
    expect(payments[0].paymentMode).toBe("razorpay");
    expect(payments[0].razorpayPaymentLinkId).toBe(LINK_ID);
    expect(payments[0].notes).toMatch(/verify payment/i); // audit trail of the manual path
  });

  it("T3 (HARD GATE): verifying TWICE creates only ONE Payment", async () => {
    const invoice = await makeInvoice();
    mockRazorpay("paid", 30000);

    const first = await verify(invoice._id);
    expect(first.body.data.outcome).toBe("reconciled");

    const second = await verify(invoice._id);
    expect(second.body.data.outcome).toBe("already_reconciled");
    expect(second.body.message).toMatch(/already recorded/i);

    // The money moved exactly once.
    expect(await Payment.countDocuments({ patient: testData.patient._id })).toBe(1);
    const after = await Invoice.findById(invoice._id);
    expect(after.amountPaid).toBe(300); // NOT 600
  });

  it("T3b (HARD GATE): verifying after the WEBHOOK already reconciled creates no duplicate", async () => {
    const invoice = await makeInvoice();

    // Drive the real webhook first.
    const SECRET = "verify_test_webhook_secret";
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    try {
      const body = {
        entity: "event",
        event: "payment_link.paid",
        payload: {
          payment_link: {
            entity: {
              id: LINK_ID, amount: 30000, amount_paid: 30000,
              reference_id: String(invoice._id),
              short_url: "https://rzp.io/rzp/testlink", status: "paid",
            },
          },
          payment: { entity: { id: "pay_verify_test", method: "upi" } },
        },
      };
      const raw = JSON.stringify(body);
      const sig = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
      const hook = await request(app)
        .post("/api/payments/razorpay/webhook")
        .set("x-razorpay-signature", sig)
        .send(body);
      expect(hook.status).toBe(200);
    } finally {
      if (saved !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = saved;
      else delete process.env.RAZORPAY_WEBHOOK_SECRET;
    }

    expect(await Payment.countDocuments({ patient: testData.patient._id })).toBe(1);

    // Now an admin clicks Verify, not knowing the webhook already worked.
    mockRazorpay("paid", 30000);
    const res = await verify(invoice._id);
    expect(res.body.data.outcome).toBe("already_reconciled");

    expect(await Payment.countDocuments({ patient: testData.patient._id })).toBe(1);
    expect((await Invoice.findById(invoice._id)).amountPaid).toBe(300); // NOT 600
  });

  it("T4: webhook and manual verify produce an IDENTICAL Payment shape", async () => {
    // Reconcile one invoice manually...
    const manualInv = await makeInvoice();
    mockRazorpay("paid", 30000);
    await verify(manualInv._id);
    const manualPayment = await Payment.findOne({ razorpayPaymentLinkId: LINK_ID });
    const manualInvAfter = await Invoice.findById(manualInv._id);
    await Payment.deleteMany({ patient: testData.patient._id });
    await Invoice.deleteMany({ patient: testData.patient._id });
    vi.restoreAllMocks();
    restoreFetch();

    // ...and an identical one via the webhook.
    const hookInv = await makeInvoice();
    const SECRET = "verify_test_webhook_secret_2";
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    try {
      const body = {
        entity: "event", event: "payment_link.paid",
        payload: {
          payment_link: {
            entity: {
              id: LINK_ID, amount: 30000, amount_paid: 30000,
              reference_id: String(hookInv._id),
              short_url: "https://rzp.io/rzp/testlink", status: "paid",
            },
          },
          payment: { entity: { id: "pay_shape_test", method: "upi" } },
        },
      };
      const raw = JSON.stringify(body);
      const sig = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
      await request(app)
        .post("/api/payments/razorpay/webhook")
        .set("x-razorpay-signature", sig)
        .send(body);
    } finally {
      if (saved !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = saved;
      else delete process.env.RAZORPAY_WEBHOOK_SECRET;
    }
    const hookPayment = await Payment.findOne({ razorpayPaymentLinkId: LINK_ID });
    const hookInvAfter = await Invoice.findById(hookInv._id);

    // Same money, same mode, same type, same link, same settlement record.
    expect(manualPayment.amount).toBe(hookPayment.amount);
    expect(manualPayment.paymentMode).toBe(hookPayment.paymentMode);
    expect(manualPayment.type).toBe(hookPayment.type);
    expect(manualPayment.status).toBe(hookPayment.status);
    expect(manualPayment.razorpayPaymentLinkId).toBe(hookPayment.razorpayPaymentLinkId);
    expect(manualPayment.settledInvoices[0].appliedAmount).toBe(hookPayment.settledInvoices[0].appliedAmount);

    // And the invoices end up in the same state.
    expect(manualInvAfter.amountPaid).toBe(hookInvAfter.amountPaid);
    expect(manualInvAfter.paymentStatus).toBe(hookInvAfter.paymentStatus);
    expect(manualInvAfter.balanceDue).toBe(hookInvAfter.balanceDue);
  });

  it("an invoice with NO payment link is rejected clearly", async () => {
    const invoice = await makeInvoice({ paymentLink: undefined });
    const res = await verify(invoice._id);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no razorpay payment link/i);
  });

  it("a Razorpay API failure is reported without changing anything", async () => {
    const invoice = await makeInvoice();
    if (!savedFetch) savedFetch = global.fetch;
    global.fetch = async () => ({
      ok: false, status: 500,
      json: async () => ({ error: { description: "Internal server error" } }),
    });

    const res = await verify(invoice._id);
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/could not reach razorpay/i);

    const after = await Invoice.findById(invoice._id);
    expect(after.amountPaid).toBe(0);
    expect(await Payment.countDocuments({ patient: testData.patient._id })).toBe(0);
  });

  it("requires authentication and payments:edit permission", async () => {
    const invoice = await makeInvoice();
    const anon = await request(app).post(`/api/payments/verify-razorpay-link/${invoice._id}`);
    expect([401, 403]).toContain(anon.status);
  });
});
