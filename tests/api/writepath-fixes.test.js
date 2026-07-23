import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";
import Patient from "../../src/modules/patients/patient.model.js";
import MembershipPlan from "../../src/modules/memberships/membership.model.js";

describe("Write-path fixes: Payment doc creation on every money-recording endpoint", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): recordPayment now creates a linked Payment document", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Filling", quantity: 1, unitPrice: 3000, amount: 3000, total: 3000 }],
    });

    const beforeCount = await Payment.countDocuments({ patient: testData.patient._id });

    const res = await request(app)
      .post(`/api/billing/invoices/${invoice._id}/payment`)
      .set(authHeader(token))
      .send({ amount: 3000 });

    expect(res.status).toBe(200);

    const afterCount = await Payment.countDocuments({ patient: testData.patient._id });
    expect(afterCount).toBe(beforeCount + 1);

    const payment = await Payment.findOne({ patient: testData.patient._id }).sort({ createdAt: -1 }).lean();
    expect(payment.amount).toBe(3000);
    expect(payment.status).toBe("paid");
    expect(payment.type).toBe("invoice_payment");
    expect(payment.settledInvoices).toHaveLength(1);
    expect(String(payment.settledInvoices[0].invoiceId)).toBe(String(invoice._id));
    expect(payment.settledInvoices[0].appliedAmount).toBe(3000);
    expect(payment.settledInvoices[0].previousAmountPaid).toBe(0);

    const updated = await Invoice.findById(invoice._id).lean();
    expect(updated.amountPaid).toBe(3000);
    expect(updated.grandTotal).toBe(3000);
    expect(updated.paymentStatus).toBe("paid");

    // No double-count: amountPaid should equal the single Payment's amount exactly.
    expect(updated.amountPaid).toBe(payment.settledInvoices[0].appliedAmount);

    await Invoice.deleteOne({ _id: invoice._id });
    await Payment.deleteOne({ _id: payment._id });
  });

  it("T2 (HARD GATE): bookAppointmentWithPayment links the payment via settledInvoices, no double-apply", async () => {
    // Simulate an already-Razorpay-verified payment, as verifyRazorpayPayment
    // would have produced before this endpoint is called.
    const prePayment = await Payment.create({
      patient: testData.patient._id,
      amount: 500,
      paymentMode: "razorpay",
      type: "opd_fee",
      status: "paid",
      paidAt: new Date(),
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split("T")[0];

    const res = await request(app)
      .post("/api/appointments/book-with-payment")
      .send({
        paymentId: prePayment._id.toString(),
        name: testData.patient.name,
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: dateStr,
        timeSlot: "16:00",
        type: "regular",
        reason: "OPD via Razorpay",
      });

    expect(res.status).toBe(201);
    const invoiceId = res.body.data.invoiceId;
    expect(invoiceId).toBeTruthy();

    const invoice = await Invoice.findById(invoiceId).lean();
    expect(invoice.amountPaid).toBe(500);
    expect(invoice.grandTotal).toBe(500);
    // Not double-applied: exactly one payment's worth, not 1000.
    expect(invoice.amountPaid).not.toBe(1000);

    const updatedPayment = await Payment.findById(prePayment._id).lean();
    expect(updatedPayment.invoice).toBeFalsy(); // deliberately NOT set, per the fix
    expect(updatedPayment.settledInvoices).toHaveLength(1);
    expect(String(updatedPayment.settledInvoices[0].invoiceId)).toBe(String(invoiceId));
    expect(updatedPayment.settledInvoices[0].appliedAmount).toBe(500);

    const Appointment = (await import("../../src/modules/appointments/appointment.model.js")).default;
    await Appointment.deleteOne({ invoice: invoiceId });
    await Invoice.deleteOne({ _id: invoiceId });
    await Payment.deleteOne({ _id: prePayment._id });
  });

  it("T3 (HARD GATE): assignManualMembership creates a linked Payment document", async () => {
    const testPatient = await Patient.create({ name: "Membership Test Patient", phone: "9991112222" });

    const res = await request(app)
      .post("/api/memberships/assign-manual")
      .set(authHeader(token))
      .send({
        patientId: testPatient._id.toString(),
        planName: "Custom Test Plan",
        amountPaid: 1200,
        paymentMethod: "cash",
        notes: "Write-path fix test",
      });

    expect(res.status).toBe(200);

    const payment = await Payment.findOne({ patient: testPatient._id }).lean();
    expect(payment).toBeTruthy();
    expect(payment.amount).toBe(1200);
    expect(payment.type).toBe("membership");
    expect(payment.status).toBe("paid");
    expect(payment.settledInvoices).toHaveLength(1);
    expect(payment.settledInvoices[0].appliedAmount).toBe(1200);

    const invoice = await Invoice.findOne({ patient: testPatient._id }).lean();
    expect(invoice.amountPaid).toBe(1200);

    await Invoice.deleteOne({ _id: invoice._id });
    await Payment.deleteOne({ _id: payment._id });
    await Patient.deleteOne({ _id: testPatient._id });
  });

  it("T4 (HARD GATE): purchaseMembership creates a linked Payment document", async () => {
    const testPatient = await Patient.create({ name: "Self Purchase Test Patient", phone: "9993334444" });
    const plan = await MembershipPlan.create({
      name: "Write-Path Test Plan",
      code: "WPTEST01",
      type: "individual",
      tier: "silver",
      price: 999,
      discountPercentage: 10,
    });

    const res = await request(app)
      .post("/api/memberships/purchase")
      .send({ planId: plan._id.toString(), phone: testPatient.phone });

    expect(res.status).toBe(200);

    const payment = await Payment.findOne({ patient: testPatient._id }).lean();
    expect(payment).toBeTruthy();
    expect(payment.amount).toBe(999);
    expect(payment.type).toBe("membership");
    expect(payment.status).toBe("paid");
    expect(payment.settledInvoices).toHaveLength(1);

    const invoice = await Invoice.findOne({ patient: testPatient._id }).lean();
    expect(invoice.amountPaid).toBe(999);

    await Invoice.deleteOne({ _id: invoice._id });
    await Payment.deleteOne({ _id: payment._id });
    await MembershipPlan.deleteOne({ _id: plan._id });
    await Patient.deleteOne({ _id: testPatient._id });
  });
});
