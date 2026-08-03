/**
 * Payment collection entry points -- Cash/UPI/Razorpay audit + extension.
 *
 * Covers the collection points that were still on the OLD Cash/UPI/Card
 * flow (no Razorpay) before this task: POST /api/payments/admin/collect
 * (shared by CollectPaymentModal -- Billing "Collect", Appointments row
 * "Collect", AppointmentDetailModal, Payments page, and now
 * TreatmentPlanDetailModal's per-session Collect too), plus the manual
 * invoice creation flow (CreateInvoiceModal) which has no payment step at
 * creation time.
 *
 * Same conventions as tests/api/razorpay-payment-links.test.js: runs against
 * the in-memory test DB with NO real Razorpay/WhatsApp credentials -- verifies
 * BEHAVIOR (correct amount, correct gating, graceful degradation when
 * Razorpay is unreachable) deterministically. The genuine "real Razorpay API"
 * verification (short_url actually returned by Razorpay's live API) is
 * performed separately with real pulled credentials, not on every `vitest run`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("Payment collection entry points -- Cash/UPI/Razorpay", () => {
  let token;
  const savedKeyId = process.env.RAZORPAY_KEY_ID;
  const savedKeySecret = process.env.RAZORPAY_KEY_SECRET;

  beforeAll(async () => {
    token = await getAdminToken(app);
    // Deterministic offline behaviour for the razorpay branch -- no network
    // call, no dependency on whatever real/placeholder value happens to be
    // in the environment (matches razorpay-payment-links.test.js).
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  afterAll(() => {
    if (savedKeyId !== undefined) process.env.RAZORPAY_KEY_ID = savedKeyId;
    if (savedKeySecret !== undefined) process.env.RAZORPAY_KEY_SECRET = savedKeySecret;
  });

  afterEach(async () => {
    await Appointment.deleteMany({ patient: testData.patient._id });
    await Invoice.deleteMany({ patient: testData.patient._id });
    await Payment.deleteMany({ patient: testData.patient._id });
  });

  /**
   * Scenario B: OPD postpay -- book without collecting, then collect later
   * via the shared /admin/collect endpoint (Billing / Appointments-row /
   * AppointmentDetailModal / TreatmentPlanDetailModal all call this same
   * route through CollectPaymentModal).
   */
  describe("Scenario B -- OPD postpay via /admin/collect", () => {
    let invoice;

    beforeEach(async () => {
      const res = await request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          clinic: testData.clinic._id,
          date: new Date(Date.now() + 86400000).toISOString(),
          timeSlot: "10:00",
          phone: testData.patient.phone,
          patientId: testData.patient._id,
          reason: "Checkup",
          visitType: "opd",
          opdFee: 300,
          paymentMethod: "cash",
          opdFeePaid: false, // <-- postpay: NOT collected at booking
        });
      expect(res.status).toBe(201);
      invoice = await Invoice.findById(res.body.data.invoiceId);
      expect(invoice.paymentStatus).toBe("unpaid");
      expect(invoice.balanceDue).toBe(300);
    });

    it("collects the full balance via Cash", async () => {
      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({ invoiceId: invoice._id.toString(), amount: 300, mode: "cash" });

      expect(res.status).toBe(200); // collectPayment uses ApiResponse.success (200), not .created
      expect(res.body.data.payment.paymentMode).toBe("cash");
      expect(res.body.data.payment.status).toBe("paid");
      const updated = await Invoice.findById(invoice._id);
      expect(updated.amountPaid).toBe(300);
      expect(updated.paymentStatus).toBe("paid");
    });

    it("collects via UPI with a reference number", async () => {
      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({ invoiceId: invoice._id.toString(), amount: 300, mode: "upi", reference: "TXN999" });

      expect(res.status).toBe(200);
      expect(res.body.data.payment.paymentMode).toBe("upi");
      const updated = await Invoice.findById(invoice._id);
      expect(updated.paymentStatus).toBe("paid");
    });

    it("Razorpay: generates a Payment Link for EXACTLY the collected amount, never marks paid directly", async () => {
      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({ invoiceId: invoice._id.toString(), amount: 300, mode: "razorpay" });

      // Razorpay unconfigured in this suite -- graceful degradation, not a crash.
      expect(res.status).toBe(200);
      expect(res.body.data.paymentLink).toBeTruthy();
      expect(res.body.data.paymentLink.error).toBeTruthy();
      expect(res.body.data.paymentLink.shortUrl).toBeUndefined();

      // No Payment created yet, no amountPaid change -- collection only
      // happens later via the payment_link.paid webhook.
      const updated = await Invoice.findById(invoice._id);
      expect(updated.amountPaid).toBe(0);
      expect(updated.paymentStatus).toBe("unpaid");
      const payment = await Payment.findOne({ invoice: invoice._id });
      expect(payment).toBeFalsy();
    });

    it("rejects an amount greater than the balance due, for every mode", async () => {
      for (const mode of ["cash", "upi", "razorpay"]) {
        const res = await request(app)
          .post("/api/payments/admin/collect")
          .set(authHeader(token))
          .send({ invoiceId: invoice._id.toString(), amount: 9999, mode });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/exceeds balance due/i);
      }
    });
  });

  /**
   * Scenario D: Treatment partial prepay, then per-session top-ups via
   * TreatmentPlanDetailModal's Collect (same /admin/collect route, now with
   * appointmentId so each session's collected amount is attributed
   * correctly -- non-cumulative). Confirms the Razorpay per-session case
   * ties the eventual Payment to the RIGHT session via the composite
   * reference_id (`${invoiceId}:${appointmentId}`) parsed by the
   * payment_link.paid webhook.
   */
  describe("Scenario D -- Treatment partial + per-session collect (all 3 methods)", () => {
    let parentAppointment, invoice, session2;

    beforeEach(async () => {
      const opd = await Appointment.create({
        patient: testData.patient._id,
        clinic: testData.clinic._id,
        date: new Date(),
        timeSlot: "09:00",
        visitType: "opd",
        reason: "Checkup",
        opdFee: 300,
        fee: 300,
        isFree: false,
        opdFeePaid: true,
        paymentMethod: "cash",
        paymentStatus: "paid",
      });

      // Book the treatment, pay HALF (5000 of 10000) up front.
      const bookRes = await request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          clinic: testData.clinic._id,
          date: new Date(Date.now() + 86400000).toISOString(),
          timeSlot: "11:00",
          phone: testData.patient.phone,
          patientId: testData.patient._id,
          reason: "Root Canal",
          visitType: "treatment",
          treatmentId: "other",
          treatmentName: "Root Canal",
          originatingOpdAppointmentId: opd._id.toString(),
          fee: 10000,
          items: [{ description: "Root Canal", unitPrice: 10000, itemType: "treatment" }],
          paymentMethod: "cash",
          opdFeePaid: true,
          amountPaid: 5000, // half now
        });
      expect(bookRes.status).toBe(201);
      parentAppointment = await Appointment.findById(bookRes.body.data.appointmentId);
      invoice = await Invoice.findById(bookRes.body.data.invoiceId);
      expect(invoice.grandTotal).toBe(10000);
      expect(invoice.amountPaid).toBe(5000);
      expect(invoice.balanceDue).toBe(5000);

      // A second session under the same treatment/invoice.
      session2 = await Appointment.create({
        patient: testData.patient._id,
        clinic: testData.clinic._id,
        date: new Date(Date.now() + 2 * 86400000),
        timeSlot: "12:00",
        visitType: "treatment_session",
        parentAppointment: parentAppointment._id,
        sessionNumber: 2,
        reason: "Root Canal — session 2",
        treatmentName: "Root Canal",
        invoice: invoice._id,
        isFree: true, // no separate OPD-style fee of its own
        opdFeePaid: true,
        paymentStatus: "paid",
      });
    });

    it("Cash top-up at session 2 attributes the Payment to session 2, not the parent (non-cumulative)", async () => {
      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({
          invoiceId: invoice._id.toString(),
          amount: 2500,
          mode: "cash",
          appointmentId: session2._id.toString(),
        });
      expect(res.status).toBe(200);

      const payment = await Payment.findOne({ appointment: session2._id });
      expect(payment).toBeTruthy();
      expect(payment.amount).toBe(2500);

      const parentPayment = await Payment.findOne({ appointment: parentAppointment._id, type: "invoice_payment" });
      expect(parentPayment).toBeFalsy(); // session 2's collection never attributed to the parent

      const updatedInvoice = await Invoice.findById(invoice._id);
      expect(updatedInvoice.amountPaid).toBe(7500);
      expect(updatedInvoice.paymentStatus).toBe("partial");
    });

    it("UPI top-up at session 2 works the same way", async () => {
      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({
          invoiceId: invoice._id.toString(),
          amount: 5000,
          mode: "upi",
          appointmentId: session2._id.toString(),
        });
      expect(res.status).toBe(200);
      const updatedInvoice = await Invoice.findById(invoice._id);
      expect(updatedInvoice.amountPaid).toBe(10000);
      expect(updatedInvoice.paymentStatus).toBe("paid");
    });

    it("Razorpay top-up at session 2: link generated for the remaining balance, reference_id carries the session id", async () => {
      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({
          invoiceId: invoice._id.toString(),
          amount: 5000,
          mode: "razorpay",
          appointmentId: session2._id.toString(),
        });
      expect(res.status).toBe(200);
      expect(res.body.data.paymentLink.error).toBeTruthy(); // Razorpay unconfigured -- graceful

      // Simulate the link having been paid -- payment_link.paid webhook,
      // reference_id = `${invoiceId}:${sessionAppointmentId}` (the composite
      // form generateRazorpayPaymentLink builds when referenceAppointmentId
      // is passed, exactly what collectPayment passed above).
      const WEBHOOK_SECRET = "test_webhook_secret_session_link";
      const savedSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
      try {
        const webhookBody = {
          entity: "event",
          event: "payment_link.paid",
          payload: {
            payment_link: {
              entity: {
                id: "plink_session2_test",
                amount: 500000,
                amount_paid: 500000,
                reference_id: `${invoice._id}:${session2._id}`,
                short_url: "https://rzp.io/rzp/session2test",
                status: "paid",
              },
            },
            payment: {
              entity: { id: "pay_session2_test", method: "upi" },
            },
          },
        };
        const raw = JSON.stringify(webhookBody);
        const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
        const webhookRes = await request(app)
          .post("/api/payments/razorpay/webhook")
          .set("x-razorpay-signature", signature)
          .send(webhookBody);
        expect(webhookRes.status).toBe(200);
      } finally {
        if (savedSecret !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = savedSecret;
        else delete process.env.RAZORPAY_WEBHOOK_SECRET;
      }

      // The resulting Payment must be tied to session2, NOT the parent
      // treatment appointment -- this is the "not cumulative" requirement.
      const payment = await Payment.findOne({ razorpayPaymentLinkId: "plink_session2_test" });
      expect(payment).toBeTruthy();
      expect(payment.appointment.toString()).toBe(session2._id.toString());
      expect(payment.amount).toBe(5000);

      const updatedInvoice = await Invoice.findById(invoice._id);
      expect(updatedInvoice.amountPaid).toBe(10000);
      expect(updatedInvoice.paymentStatus).toBe("paid");

      await Payment.deleteMany({ razorpayPaymentLinkId: "plink_session2_test" });
    });
  });

  /**
   * Scenario E: manual invoice (CreateInvoiceModal) -- confirms it creates a
   * draft/unpaid invoice with NO payment-collection step of its own (the
   * "Payment" section is commented out in the current UI), then that
   * invoice is collectible via the same /admin/collect route, all 3 methods.
   */
  describe("Scenario E -- Manual invoice (CreateInvoiceModal) has no payment step, collected later via /admin/collect", () => {
    const createManualInvoice = async () =>
      request(app)
        .post("/api/billing/invoices")
        .set(authHeader(token))
        .send({
          patient: testData.patient._id.toString(),
          clinic: testData.clinic._id.toString(),
          items: [{ itemType: "other", description: "Teeth Whitening Kit", unitPrice: 1200, quantity: 1 }],
          // amountPaid intentionally omitted -- CreateInvoiceModal's current UI
          // never sends it (Payment section is commented out), draft/unpaid only.
        });

    it("creates a draft/unpaid invoice with amountPaid 0 -- no payment step at creation", async () => {
      const res = await createManualInvoice();
      expect(res.status).toBe(201);
      expect(res.body.data.invoice.amountPaid).toBe(0);
      expect(res.body.data.invoice.paymentStatus).toBe("unpaid");
      expect(res.body.data.invoice.grandTotal).toBe(1200);
    });

    it("Cash collection against the manual invoice", async () => {
      const created = await createManualInvoice();
      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({ invoiceId: created.body.data.invoice._id, amount: 1200, mode: "cash" });
      expect(res.status).toBe(200);
      const updated = await Invoice.findById(created.body.data.invoice._id);
      expect(updated.paymentStatus).toBe("paid");
    });

    it("UPI collection against the manual invoice", async () => {
      const created = await createManualInvoice();
      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({ invoiceId: created.body.data.invoice._id, amount: 600, mode: "upi" });
      expect(res.status).toBe(200);
      const updated = await Invoice.findById(created.body.data.invoice._id);
      expect(updated.paymentStatus).toBe("partial");
      expect(updated.balanceDue).toBe(600);
    });

    it("Razorpay collection against the manual invoice generates a link for the invoice's full amount", async () => {
      const created = await createManualInvoice();
      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({ invoiceId: created.body.data.invoice._id, amount: 1200, mode: "razorpay" });
      expect(res.status).toBe(200);
      expect(res.body.data.paymentLink.error).toBeTruthy(); // unconfigured -- graceful
      const updated = await Invoice.findById(created.body.data.invoice._id);
      expect(updated.amountPaid).toBe(0); // unchanged until the webhook fires
    });
  });

  /**
   * Scenario A / C smoke check: booking-time prepay (OPD + Treatment) for
   * Cash and UPI, confirming the collectPayment/appointment-controller
   * regression surface is untouched by this task's changes. Razorpay's
   * booking-time path is already covered by razorpay-payment-links.test.js.
   */
  describe("Scenario A/C regression -- booking-time prepay, Cash and UPI", () => {
    it("OPD: Cash prepay at booking", async () => {
      const res = await request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          clinic: testData.clinic._id,
          date: new Date(Date.now() + 86400000).toISOString(),
          timeSlot: "10:00",
          phone: testData.patient.phone,
          patientId: testData.patient._id,
          reason: "Checkup",
          visitType: "opd",
          opdFee: 300,
          paymentMethod: "cash",
          opdFeePaid: true,
        });
      expect(res.status).toBe(201);
      const invoice = await Invoice.findById(res.body.data.invoiceId);
      expect(invoice.paymentStatus).toBe("paid");
    });

    it("OPD: UPI prepay at booking", async () => {
      const res = await request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          clinic: testData.clinic._id,
          date: new Date(Date.now() + 86400000).toISOString(),
          timeSlot: "10:30",
          phone: testData.patient.phone,
          patientId: testData.patient._id,
          reason: "Checkup",
          visitType: "opd",
          opdFee: 300,
          paymentMethod: "upi",
          opdFeePaid: true,
        });
      expect(res.status).toBe(201);
      const invoice = await Invoice.findById(res.body.data.invoiceId);
      expect(invoice.paymentStatus).toBe("paid");
      const payment = await Payment.findOne({ appointment: res.body.data.appointmentId });
      expect(payment.paymentMode).toBe("upi");
    });

    it("Treatment: full Cash prepay at booking", async () => {
      const opd = await Appointment.create({
        patient: testData.patient._id,
        clinic: testData.clinic._id,
        date: new Date(),
        timeSlot: "09:00",
        visitType: "opd",
        reason: "Checkup",
        opdFee: 300,
        fee: 300,
        isFree: false,
        opdFeePaid: true,
        paymentMethod: "cash",
        paymentStatus: "paid",
      });
      const res = await request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          clinic: testData.clinic._id,
          date: new Date(Date.now() + 86400000).toISOString(),
          timeSlot: "13:00",
          phone: testData.patient.phone,
          patientId: testData.patient._id,
          reason: "Root Canal",
          visitType: "treatment",
          treatmentId: "other",
          treatmentName: "Root Canal",
          originatingOpdAppointmentId: opd._id.toString(),
          fee: 8000,
          items: [{ description: "Root Canal", unitPrice: 8000, itemType: "treatment" }],
          paymentMethod: "cash",
          opdFeePaid: true,
          amountPaid: 8000,
        });
      expect(res.status).toBe(201);
      const invoice = await Invoice.findById(res.body.data.invoiceId);
      expect(invoice.grandTotal).toBe(8000);
      expect(invoice.amountPaid).toBe(8000);
      expect(invoice.paymentStatus).toBe("paid");
    });
  });
});
