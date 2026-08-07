/**
 * payment_recorded's {{2}} must say what the payment was FOR.
 *
 * A real patient received:
 *   Amount Received: Rs300
 *   For: Invoice INV-2608-0008     <- the invoice NUMBER, not a description
 *   Invoice: INV-2608-0008         <- which {{3}} already carries
 *
 * The invoice number has its own slot, so {{2}} repeating it told the patient
 * nothing about what they had paid for.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("payment_recorded description", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Appointment.deleteMany({ patient: testData.patient._id });
    await Invoice.deleteMany({ patient: testData.patient._id });
    await Payment.deleteMany({ patient: testData.patient._id });
  });

  /** Capture the `data` object handed to the WhatsApp stub. */
  const captureWhatsapp = () => {
    const calls = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      if (String(args[0]).includes("[WhatsApp STUB]") && String(args[0]).includes("payment_recorded")) {
        calls.push(args[1]);
      }
    });
    return calls;
  };

  const expectNotInvoiceNumber = (desc) => {
    expect(desc).toBeTruthy();
    expect(desc).not.toMatch(/INV-\d/i);
    expect(desc).not.toMatch(/^invoice\b/i);
  };

  it("T2 (HARD GATE): an OPD payment describes the visit, not the invoice number", async () => {
    const calls = captureWhatsapp();

    const res = await request(app).post("/api/appointments").set(authHeader(token)).send({
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

    expect(calls.length).toBeGreaterThan(0);
    const desc = calls[0].description;
    expectNotInvoiceNumber(desc);
    expect(desc).toMatch(/OPD Consultation|Appointment/i);
  });

  it("T3a: a TREATMENT payment describes the treatment by name", async () => {
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

    const calls = captureWhatsapp();

    const res = await request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 2 * 86400000).toISOString(),
      timeSlot: "13:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Root Canal",
      visitType: "treatment",
      treatmentId: "other",
      treatmentName: "Root Canal Treatment",
      originatingOpdAppointmentId: opd._id.toString(),
      fee: 9000,
      items: [{ description: "Root Canal Treatment", unitPrice: 9000, itemType: "treatment" }],
      paymentMethod: "cash",
      opdFeePaid: true,
      amountPaid: 9000,
    });
    expect(res.status).toBe(201);

    const desc = calls[0].description;
    expectNotInvoiceNumber(desc);
    expect(desc).toMatch(/root canal/i);
  });

  it("T2b (HARD GATE): collecting later against an invoice describes the line item, not the invoice number -- the exact reported bug", async () => {
    // Postpay OPD booking -> unpaid invoice.
    const booking = await request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 3 * 86400000).toISOString(),
      timeSlot: "14:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Checkup",
      visitType: "opd",
      opdFee: 300,
      paymentMethod: "cash",
      opdFeePaid: false,
    });
    expect(booking.status).toBe(201);

    const calls = captureWhatsapp();

    const collect = await request(app)
      .post("/api/payments/admin/collect")
      .set(authHeader(token))
      .send({ invoiceId: booking.body.data.invoiceId, amount: 300, mode: "cash" });
    expect(collect.status).toBe(200);

    // The dispatch is fire-and-forget: it runs AFTER the response is sent.
    await new Promise((r) => setTimeout(r, 150));
    expect(calls.length).toBeGreaterThan(0);
    const desc = calls[0].description;
    expectNotInvoiceNumber(desc);
    expect(desc).toMatch(/OPD Consultation|Appointment/i);
    // {{3}} still carries the invoice number -- it just isn't duplicated here.
    expect(calls[0].invoiceNumber).toMatch(/INV-/);
  });

  it("T3b: recording a payment against a manual invoice describes its item", async () => {
    // Created directly rather than via POST /api/billing/invoices, which
    // currently 400s -- a PRE-EXISTING failure already in the suite baseline
    // (billing.test.js). Building the doc here keeps this test about the
    // description fix instead of depending on that unrelated bug.
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [
        {
          itemType: "treatment",
          description: "Teeth Whitening",
          quantity: 1,
          unitPrice: 4000,
          discount: { percentage: 0, amount: 0 },
          taxRate: 0,
          amount: 4000,
          taxAmount: 0,
          total: 4000,
        },
      ],
      amountPaid: 0,
    });

    const calls = captureWhatsapp();

    const pay = await request(app)
      .post(`/api/billing/invoices/${invoice._id}/payment`)
      .set(authHeader(token))
      .send({ amount: 4000, paymentMode: "cash" });
    expect(pay.status).toBe(200);

    await new Promise((r) => setTimeout(r, 150));
    expect(calls.length).toBeGreaterThan(0);
    const desc = calls[0].description;
    expectNotInvoiceNumber(desc);
    expect(desc).toMatch(/teeth whitening/i);
  });

  it("no call site anywhere can emit an invoice number as the description", async () => {
    // Guards every remaining path at the helper level.
    const { describeInvoice, pickPaymentDescription } = await import(
      "../../src/utils/paymentDescription.js"
    );
    const hostile = [
      "Invoice INV-2608-0008",
      "INV-2608-0008",
      "Invoice payment via Razorpay — INV-2608-0008",
      "invoice payment",
    ];
    for (const h of hostile) {
      expectNotInvoiceNumber(pickPaymentDescription(h));
    }
    expectNotInvoiceNumber(describeInvoice({ items: [] }));
    expectNotInvoiceNumber(describeInvoice(undefined));
  });
});
