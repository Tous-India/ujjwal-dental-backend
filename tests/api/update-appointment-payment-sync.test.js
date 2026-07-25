import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("updateAppointment invoice-sync now creates a linked Payment (4th write-path gap)", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): PATCHing paymentStatus to 'paid' creates a Payment doc, invoice.amountPaid correct (not doubled)", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "opd_fee", description: "OPD Consultation", quantity: 1, unitPrice: 300, amount: 300, total: 300 }],
      amountPaid: 0,
    });
    const appointment = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "10:00",
      visitType: "opd",
      fee: 300,
      opdFee: 300,
      invoice: invoice._id,
      status: "completed",
      paymentStatus: "unpaid",
      paymentMethod: "cash",
      reason: "Dhruv-style repro",
    });

    const res = await request(app)
      .patch(`/api/appointments/${appointment._id}`)
      .set(authHeader(token))
      .send({ paymentStatus: "paid" });

    expect(res.status).toBe(200);

    const updatedInvoice = await Invoice.findById(invoice._id).lean();
    expect(updatedInvoice.amountPaid).toBe(300);
    expect(updatedInvoice.amountPaid).not.toBe(600); // not doubled

    const payment = await Payment.findOne({ patient: testData.patient._id, type: "opd_fee" }).lean();
    expect(payment).toBeTruthy();
    expect(payment.amount).toBe(300);
    expect(payment.status).toBe("paid");
    expect(payment.paymentMode).toBe("cash");
    expect(payment.settledInvoices).toHaveLength(1);
    expect(String(payment.settledInvoices[0].invoiceId)).toBe(String(invoice._id));
    expect(payment.settledInvoices[0].appliedAmount).toBe(300);
    expect(payment.settledInvoices[0].previousAmountPaid).toBe(0);
    expect(payment.invoice).toBeFalsy(); // deliberately unset, per the established pattern

    await Invoice.deleteOne({ _id: invoice._id });
    await Appointment.deleteOne({ _id: appointment._id });
    await Payment.deleteOne({ _id: payment._id });
  });

  it("T1b: a second PATCH that keeps paymentStatus 'paid' does NOT create a duplicate Payment (delta is 0)", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "opd_fee", description: "OPD Consultation", quantity: 1, unitPrice: 300, amount: 300, total: 300 }],
      amountPaid: 300, // already fully paid
    });
    const appointment = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "10:30",
      visitType: "opd",
      fee: 300,
      opdFee: 300,
      invoice: invoice._id,
      status: "completed",
      paymentStatus: "paid",
      paymentMethod: "cash",
      reason: "No-op re-save",
    });

    const before = await Payment.countDocuments({ patient: testData.patient._id });
    const res = await request(app)
      .patch(`/api/appointments/${appointment._id}`)
      .set(authHeader(token))
      .send({ paymentStatus: "paid" }); // re-sending the same status
    expect(res.status).toBe(200);
    const after = await Payment.countDocuments({ patient: testData.patient._id });
    expect(after).toBe(before); // delta was 0 (already fully paid) -- no new Payment

    await Invoice.deleteOne({ _id: invoice._id });
    await Appointment.deleteOne({ _id: appointment._id });
  });

  it("T3: treatment_session pricing guard (added earlier tonight, same function) still works, unaffected by the new Payment.create() logic", async () => {
    const sharedInvoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Root Canal", quantity: 1, unitPrice: 10000, amount: 10000, total: 10000 }],
      amountPaid: 10000,
    });
    const parentAppt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "11:00",
      visitType: "treatment",
      treatmentName: "Root Canal",
      fee: 10000,
      invoice: sharedInvoice._id,
      status: "completed",
      paymentStatus: "paid",
      reason: "Root canal treatment",
    });
    const sessionAppt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "12:00",
      visitType: "treatment_session",
      parentAppointment: parentAppt._id,
      sessionNumber: 2,
      treatmentName: "Root Canal",
      fee: 0,
      invoice: sharedInvoice._id, // shares the SAME invoice as the parent
      status: "scheduled",
      isFree: true,
      paymentStatus: "free",
      reason: "Session 2",
    });

    const beforePaymentCount = await Payment.countDocuments({ patient: testData.patient._id });
    const res = await request(app)
      .patch(`/api/appointments/${sessionAppt._id}`)
      .set(authHeader(token))
      .send({ isFree: true, paymentStatus: "free" });
    expect(res.status).toBe(200);

    // Guard still holds: shared invoice completely untouched by the session update.
    const afterInvoice = await Invoice.findById(sharedInvoice._id).lean();
    expect(afterInvoice.amountPaid).toBe(10000);
    expect(afterInvoice.grandTotal).toBe(10000);

    // And no stray Payment was created for the session either (newPS === "free", not "paid").
    const afterPaymentCount = await Payment.countDocuments({ patient: testData.patient._id });
    expect(afterPaymentCount).toBe(beforePaymentCount);

    await Invoice.deleteOne({ _id: sharedInvoice._id });
    await Appointment.deleteMany({ _id: { $in: [parentAppt._id, sessionAppt._id] } });
  });
});
