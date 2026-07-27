import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("Session-level payment linkage (Bug 1) and post-hoc collect (Bug 2)", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): each session's Payment is linked via appointment field, sums correctly per session (not cumulative)", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Root Canal", quantity: 1, unitPrice: 12000, amount: 12000, total: 12000 }],
      amountPaid: 0,
    });
    const parent = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:00",
      visitType: "treatment",
      treatmentName: "Root Canal",
      fee: 12000,
      invoice: invoice._id,
      reason: "Root canal",
    });
    const session1 = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:30",
      visitType: "treatment_session",
      parentAppointment: parent._id,
      sessionNumber: 2,
      invoice: invoice._id,
      reason: "Session 2",
    });
    const session2 = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "10:00",
      visitType: "treatment_session",
      parentAppointment: parent._id,
      sessionNumber: 3,
      invoice: invoice._id,
      reason: "Session 3",
    });

    // Collect Rs10,000 for session1
    const res1 = await request(app)
      .post("/api/payments/admin/collect")
      .set(authHeader(token))
      .send({ invoiceId: invoice._id, amount: 10000, mode: "cash", appointmentId: session1._id });
    expect(res1.status).toBe(200);

    // Collect Rs2,000 for session2
    const res2 = await request(app)
      .post("/api/payments/admin/collect")
      .set(authHeader(token))
      .send({ invoiceId: invoice._id, amount: 2000, mode: "cash", appointmentId: session2._id });
    expect(res2.status).toBe(200);

    // Confirm Payment docs are linked to their specific session, not each other
    const paymentsForSession1 = await Payment.find({ appointment: session1._id }).lean();
    const paymentsForSession2 = await Payment.find({ appointment: session2._id }).lean();
    expect(paymentsForSession1).toHaveLength(1);
    expect(paymentsForSession1[0].amount).toBe(10000);
    expect(paymentsForSession2).toHaveLength(1);
    expect(paymentsForSession2[0].amount).toBe(2000);

    // Overall invoice reconciles to the sum (Rs12,000)
    const updatedInvoice = await Invoice.findById(invoice._id).lean();
    expect(updatedInvoice.amountPaid).toBe(12000);

    // Confirm the payments list endpoint's `appointment` filter returns only the matching session's payment
    const listRes = await request(app)
      .get("/api/payments")
      .set(authHeader(token))
      .query({ appointment: String(session1._id) });
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].amount).toBe(10000);

    await Appointment.deleteMany({ _id: { $in: [parent._id, session1._id, session2._id] } });
    await Invoice.deleteOne({ _id: invoice._id });
    await Payment.deleteMany({ appointment: { $in: [session1._id, session2._id] } });
  });

  it("T3 (HARD GATE): post-hoc collect on an already-booked session succeeds and correctly reduces balanceDue", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [{ itemType: "treatment", description: "Filling", quantity: 1, unitPrice: 3000, amount: 3000, total: 3000 }],
      amountPaid: 0,
    });
    const parent = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "10:45",
      visitType: "treatment",
      treatmentName: "Filling",
      fee: 3000,
      invoice: invoice._id,
      reason: "Filling",
    });
    const session = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "11:00",
      visitType: "treatment_session",
      parentAppointment: parent._id,
      sessionNumber: 2,
      invoice: invoice._id,
      reason: "Post-hoc collection test",
      status: "completed",
    });

    const beforeInvoice = await Invoice.findById(invoice._id).lean();
    expect(beforeInvoice.balanceDue).toBe(3000);

    const res = await request(app)
      .post("/api/payments/admin/collect")
      .set(authHeader(token))
      .send({ invoiceId: invoice._id, amount: 3000, mode: "upi", appointmentId: session._id });
    expect(res.status).toBe(200);

    const afterInvoice = await Invoice.findById(invoice._id).lean();
    expect(afterInvoice.balanceDue).toBe(0);
    expect(afterInvoice.amountPaid).toBe(3000);

    const payment = await Payment.findOne({ appointment: session._id }).lean();
    expect(payment).toBeTruthy();
    expect(String(payment.appointment)).toBe(String(session._id));

    await Appointment.deleteMany({ _id: { $in: [parent._id, session._id] } });
    await Invoice.deleteOne({ _id: invoice._id });
    await Payment.deleteMany({ appointment: session._id });
  });

  it("T2: marking a session complete via PATCH status works (reuses existing updateAppointment)", async () => {
    const parent = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "11:45",
      visitType: "treatment",
      treatmentName: "Cleaning",
      fee: 500,
      reason: "Cleaning",
    });
    const session = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "12:00",
      visitType: "treatment_session",
      parentAppointment: parent._id,
      sessionNumber: 2,
      reason: "Mark complete test",
      status: "scheduled",
    });

    const res = await request(app)
      .patch(`/api/appointments/${session._id}`)
      .set(authHeader(token))
      .send({ status: "completed" });
    expect(res.status).toBe(200);

    const updated = await Appointment.findById(session._id).lean();
    expect(updated.status).toBe("completed");

    await Appointment.deleteMany({ _id: { $in: [parent._id, session._id] } });
  });
});
