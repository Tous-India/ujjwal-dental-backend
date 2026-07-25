import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";

describe("Bug 2: originatingOpdAppointmentId is mandatory for NEW treatment bookings only", () => {
  let token;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString();

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T2 (HARD GATE): creating a treatment WITHOUT originatingOpdAppointmentId is rejected with a clear 400", async () => {
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "09:00",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Root canal",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Root Canal",
        fee: 5000,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/OPD visit must be linked/i);
  });

  it("T3 (HARD GATE): creating a treatment WITH a valid originatingOpdAppointmentId succeeds and is stored + populated on read", async () => {
    const opdAppt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "08:00",
      visitType: "opd",
      fee: 300,
      reason: "Initial consult",
    });

    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "09:00",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Root canal",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Root Canal",
        fee: 5000,
        originatingOpdAppointmentId: String(opdAppt._id),
      });
    expect(res.status).toBe(201);
    const treatmentId = res.body.data.appointmentId;

    const saved = await Appointment.findById(treatmentId).lean();
    expect(String(saved.originatingOpdAppointment)).toBe(String(opdAppt._id));

    // Confirm the list endpoint populates it (Bug 1 fix)
    const listRes = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ visitType: "treatment", limit: 100 });
    const row = listRes.body.data.find((a) => a._id === treatmentId);
    expect(row).toBeTruthy();
    expect(row.originatingOpdAppointment).toBeTruthy();
    expect(row.originatingOpdAppointment.appointmentNumber).toBeTruthy();

    await Appointment.deleteMany({ _id: { $in: [opdAppt._id, treatmentId] } });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });

  it("T7: an EXISTING treatment created without an OPD link (originatingOpdAppointment: null) still reads/functions normally -- not retroactively broken", async () => {
    // Simulate a pre-Bug-2 treatment by inserting directly (bypassing createAppointment's new validation).
    const legacyTreatment = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "10:00",
      visitType: "treatment",
      treatmentName: "Legacy Crown",
      fee: 3000,
      reason: "Crown",
      // originatingOpdAppointment intentionally omitted -- defaults to null
    });

    const listRes = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ visitType: "treatment", limit: 100 });
    expect(listRes.status).toBe(200);
    const legacyRow = listRes.body.data.find((a) => a._id === String(legacyTreatment._id));
    expect(legacyRow).toBeTruthy();
    expect(legacyRow.originatingOpdAppointment).toBeFalsy();

    // Updating this legacy treatment (e.g. sessionsPlanned) must not be blocked
    // by the new mandatory-OPD-link rule -- that rule only gates CREATE.
    const patchRes = await request(app)
      .patch(`/api/appointments/${legacyTreatment._id}`)
      .set(authHeader(token))
      .send({ sessionsPlanned: 4 });
    expect(patchRes.status).toBe(200);

    await Appointment.deleteOne({ _id: legacyTreatment._id });
  });
});
