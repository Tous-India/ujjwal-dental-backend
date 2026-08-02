/**
 * Razorpay Payment Links -- admin booking flow (OPD + Treatment), payment
 * method editability, and the payment_link.paid webhook.
 *
 * This suite runs against the in-memory test DB (see tests/setup.js) with NO
 * real Razorpay/WhatsApp credentials, matching every other test file in this
 * repo -- it verifies the code's BEHAVIOR (graceful degradation when
 * Razorpay is unreachable/unconfigured, correct gating, correct webhook
 * processing) deterministically, without depending on network access or
 * live third-party credentials. The genuine "real Razorpay API" verification
 * (short_url actually returned by Razorpay's live API) was performed
 * separately via a throwaway script using real pulled credentials -- see the
 * task report; that call is NOT re-run here on every `vitest run`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "crypto";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("Razorpay payment method -- graceful handling when unconfigured (regression safety)", () => {
  let token;
  const savedKeyId = process.env.RAZORPAY_KEY_ID;
  const savedKeySecret = process.env.RAZORPAY_KEY_SECRET;

  beforeAll(async () => {
    token = await getAdminToken(app);
    // Deterministic offline behaviour -- no network call, no dependency on
    // whatever real/placeholder value happens to be in the environment.
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  afterAll(() => {
    if (savedKeyId !== undefined) process.env.RAZORPAY_KEY_ID = savedKeyId;
    if (savedKeySecret !== undefined) process.env.RAZORPAY_KEY_SECRET = savedKeySecret;
  });

  it("T2 (OPD): booking with paymentMethod=razorpay still succeeds; link generation failure never blocks the booking or hides intent", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrow.toISOString(),
        timeSlot: "10:00",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Tooth pain",
        visitType: "opd",
        opdFee: 300,
        paymentMethod: "razorpay",
      });

    expect(res.status).toBe(201);
    expect(res.body.data.paymentLink).toBeTruthy();
    expect(res.body.data.paymentLink.error).toBeTruthy(); // Razorpay unconfigured -- graceful, not a crash
    expect(res.body.data.paymentLink.shortUrl).toBeUndefined();

    const appointment = await Appointment.findById(res.body.data.appointmentId);
    expect(appointment.paymentMethod).toBe("razorpay");
    expect(appointment.fee).toBe(300); // OPD fee used, not a hardcoded/wrong total

    await Appointment.deleteOne({ _id: appointment._id });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });

  it("T2 (Treatment): booking with paymentMethod=razorpay uses the treatment's post-discount fee-items total, not the OPD fee", async () => {
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

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrow.toISOString(),
        timeSlot: "11:00",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Root Canal",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Root Canal",
        paymentMethod: "razorpay",
        originatingOpdAppointmentId: opd._id.toString(),
        fee: 4500, // client-computed post-discount total, mirrors AddAppointmentModal's treatmentTotal
        items: [{ description: "Root Canal", unitPrice: 5000, itemType: "treatment" }],
        discountPercent: 10, // -> post-discount total 4500
      });

    expect(res.status).toBe(201);
    expect(res.body.data.paymentLink.error).toBeTruthy();

    const invoice = await Invoice.findById(res.body.data.invoiceId);
    expect(invoice.grandTotal).toBe(4500); // post-discount total, NOT the raw 5000 or the OPD fee

    await Appointment.deleteMany({ patient: testData.patient._id });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });
});

describe("Payment method stays editable until completed (Part 3)", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T3: switching razorpay -> cash on a non-completed appointment succeeds", async () => {
    const appt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:00",
      visitType: "opd",
      reason: "Checkup",
      opdFee: 300,
      fee: 300,
      isFree: false,
      opdFeePaid: false,
      paymentMethod: "razorpay",
      paymentStatus: "unpaid",
      status: "scheduled",
    });

    const res = await request(app)
      .patch(`/api/appointments/${appt._id}`)
      .set(authHeader(token))
      .send({ paymentMethod: "cash" });

    expect(res.status).toBe(200);
    const updated = await Appointment.findById(appt._id);
    expect(updated.paymentMethod).toBe("cash");

    await Appointment.deleteOne({ _id: appt._id });
  });

  it("T3: the same change is blocked (400) once the appointment is completed", async () => {
    const appt = await Appointment.create({
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
      status: "completed",
    });

    const res = await request(app)
      .patch(`/api/appointments/${appt._id}`)
      .set(authHeader(token))
      .send({ paymentMethod: "razorpay" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/completed/i);

    const unchanged = await Appointment.findById(appt._id);
    expect(unchanged.paymentMethod).toBe("cash"); // never touched

    await Appointment.deleteOne({ _id: appt._id });
  });

  it("T3: blocked (400) on a treatment whose treatmentStatus is already closed", async () => {
    const appt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:00",
      visitType: "treatment",
      treatmentName: "Root Canal",
      reason: "Root Canal",
      fee: 5000,
      opdFee: 5000,
      isFree: false,
      opdFeePaid: true,
      paymentMethod: "cash",
      paymentStatus: "paid",
      status: "scheduled", // NOT completed -- isolates the treatmentStatus gate specifically
      treatmentStatus: "completed",
    });

    const res = await request(app)
      .patch(`/api/appointments/${appt._id}`)
      .set(authHeader(token))
      .send({ paymentMethod: "upi" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/closed/i);

    await Appointment.deleteOne({ _id: appt._id });
  });
});

describe("payment_link.paid webhook (T4 -- simulated payload, structure matches Razorpay's documented shape)", () => {
  const WEBHOOK_SECRET = "test_webhook_secret_payment_links";
  const savedSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  beforeAll(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterAll(() => {
    if (savedSecret !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = savedSecret;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  const sendWebhook = async (body) => {
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
    return request(app)
      .post("/api/payments/razorpay/webhook")
      .set("x-razorpay-signature", signature)
      .send(body);
  };

  it("marks the invoice paid and creates a proper Payment document, reference_id-keyed", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "opd_fee", description: "OPD Consultation", unitPrice: 500, amount: 500, total: 500 }],
      paymentMethod: "pay-at-clinic",
    });
    invoice.paymentLink = {
      id: "plink_test_abc123",
      shortUrl: "https://rzp.io/rzp/testlink",
      status: "created",
      createdAt: new Date(),
      paidAt: null,
    };
    await invoice.save();
    expect(invoice.grandTotal).toBe(500);

    // Realistic payload structure (per Razorpay's documented payment_link.paid
    // webhook shape: payload.payment_link.entity + payload.payment.entity).
    const webhookBody = {
      entity: "event",
      account_id: "acc_test",
      event: "payment_link.paid",
      contains: ["payment_link", "payment"],
      payload: {
        payment_link: {
          entity: {
            id: "plink_test_abc123",
            entity: "payment_link",
            amount: 50000,
            amount_paid: 50000,
            currency: "INR",
            reference_id: String(invoice._id),
            short_url: "https://rzp.io/rzp/testlink",
            status: "paid",
          },
        },
        payment: {
          entity: {
            id: "pay_test_xyz789",
            entity: "payment",
            amount: 50000,
            currency: "INR",
            status: "captured",
            method: "upi",
            order_id: null,
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };

    const res = await sendWebhook(webhookBody);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const updatedInvoice = await Invoice.findById(invoice._id);
    expect(updatedInvoice.amountPaid).toBe(500);
    expect(updatedInvoice.paymentStatus).toBe("paid");
    expect(updatedInvoice.paymentLink.status).toBe("paid");
    expect(updatedInvoice.paymentLink.paidAt).toBeTruthy();

    const payment = await Payment.findOne({ razorpayPaymentLinkId: "plink_test_abc123" });
    expect(payment).toBeTruthy();
    expect(payment.status).toBe("paid");
    expect(payment.paymentMode).toBe("razorpay");
    expect(payment.amount).toBe(500);
    expect(payment.razorpayPaymentId).toBe("pay_test_xyz789");
    expect(payment.settledInvoices).toHaveLength(1);
    expect(payment.settledInvoices[0].invoiceId.toString()).toBe(String(invoice._id));
    expect(payment.settledInvoices[0].appliedAmount).toBe(500);
    expect(payment.invoice).toBeFalsy(); // never set .invoice -- avoids double-applying via the post-save hook

    // Idempotency -- Razorpay may retry delivery; must never double-apply.
    const retryRes = await sendWebhook(webhookBody);
    expect(retryRes.status).toBe(200);
    const paymentsAfterRetry = await Payment.find({ razorpayPaymentLinkId: "plink_test_abc123" });
    expect(paymentsAfterRetry).toHaveLength(1);
    const invoiceAfterRetry = await Invoice.findById(invoice._id);
    expect(invoiceAfterRetry.amountPaid).toBe(500); // unchanged, not doubled

    await Payment.deleteMany({ razorpayPaymentLinkId: "plink_test_abc123" });
    await Invoice.deleteOne({ _id: invoice._id });
  });
});

describe("T5 regression: plain OPD cash booking (the original, pre-existing flow) still works", () => {
  it("books a cash OPD appointment exactly as before", async () => {
    const token = await getAdminToken(app);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);

    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrow.toISOString(),
        timeSlot: "14:00",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Regular checkup",
        visitType: "opd",
        opdFee: 300,
        paymentMethod: "cash",
        opdFeePaid: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.paymentLink).toBeNull();

    const appointment = await Appointment.findById(res.body.data.appointmentId);
    expect(appointment.paymentMethod).toBe("cash");
    expect(appointment.paymentStatus).toBe("paid");

    const payment = await Payment.findOne({ appointment: appointment._id });
    expect(payment).toBeTruthy();
    expect(payment.paymentMode).toBe("cash");

    await Appointment.deleteOne({ _id: appointment._id });
    await Invoice.deleteMany({ patient: testData.patient._id });
    await Payment.deleteMany({ appointment: appointment._id });
  });
});
