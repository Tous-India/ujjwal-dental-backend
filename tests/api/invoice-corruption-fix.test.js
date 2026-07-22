import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("treatment_session invoice-corruption guard", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): updating a treatment_session's isFree does NOT touch the shared invoice", async () => {
    // A real, paid invoice shared by a treatment and its follow-up session.
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [
        {
          itemType: "treatment",
          description: "Root Canal",
          quantity: 1,
          unitPrice: 10000,
          amount: 10000,
          total: 10000,
        },
      ],
      amountPaid: 10000,
      paymentMethod: "cash",
    });
    expect(invoice.grandTotal).toBe(10000);

    const parentAppt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "10:00",
      visitType: "treatment",
      treatmentName: "Root Canal",
      fee: 10000,
      opdFee: 10000,
      invoice: invoice._id,
      status: "completed",
      paymentStatus: "paid",
      reason: "RCT",
    });

    const sessionAppt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "11:00",
      visitType: "treatment_session",
      parentAppointment: parentAppt._id,
      sessionNumber: 2,
      treatmentName: "Root Canal",
      fee: 0,
      invoice: invoice._id, // shares the SAME invoice as the parent
      status: "scheduled",
      isFree: true,
      paymentStatus: "free",
      reason: "Session 2",
    });

    const before = await Invoice.findById(invoice._id).lean();
    expect(before.grandTotal).toBe(10000);
    expect(before.amountPaid).toBe(10000);

    // Trigger the exact condition from the forensic report: PATCH the session
    // appointment with isFree (and paymentStatus), which used to zero the
    // shared invoice.
    const res = await request(app)
      .patch(`/api/appointments/${sessionAppt._id}`)
      .set(authHeader(token))
      .send({ isFree: true, paymentStatus: "free" });

    expect(res.status).toBe(200);

    const after = await Invoice.findById(invoice._id).lean();
    expect(after.grandTotal).toBe(10000);
    expect(after.amountPaid).toBe(10000);
    expect(after.items[0].unitPrice).toBe(10000);
  });

  it("T2 (regression): updating a treatment (parent) appointment's fee still syncs its invoice", async () => {
    const invoice = await Invoice.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      items: [
        {
          itemType: "opd_fee",
          description: "OPD Consultation",
          quantity: 1,
          unitPrice: 500,
          amount: 500,
          total: 500,
        },
      ],
      amountPaid: 500,
      paymentMethod: "cash",
    });

    const appt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "12:00",
      visitType: "opd",
      fee: 500,
      opdFee: 500,
      invoice: invoice._id,
      status: "completed",
      paymentStatus: "paid",
      reason: "OPD visit",
    });

    const res = await request(app)
      .patch(`/api/appointments/${appt._id}`)
      .set(authHeader(token))
      .send({ fee: 800, paymentStatus: "paid" });

    expect(res.status).toBe(200);

    const after = await Invoice.findById(invoice._id).lean();
    expect(after.items[0].unitPrice).toBe(800);
    expect(after.grandTotal).toBe(800);
    expect(after.amountPaid).toBe(800);
  });
});
