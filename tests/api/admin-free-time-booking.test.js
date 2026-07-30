import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Patient from "../../src/modules/patients/patient.model.js";

describe("Admin free-time booking -- backend accepts arbitrary non-30-min-aligned HH:MM (Appointment + Treatment)", () => {
  let token;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString();

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): admin books an OPD appointment at a non-slot-aligned time (15:15)", async () => {
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "15:15",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Free-time OPD booking",
        visitType: "opd",
      });
    expect(res.status).toBe(201);
    const saved = await Appointment.findById(res.body.data.appointmentId).lean();
    expect(saved.timeSlot).toBe("15:15");

    await Appointment.deleteOne({ _id: res.body.data.appointmentId });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });

  it("T2 (HARD GATE): admin books a Treatment at an arbitrary time (16:10)", async () => {
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
        timeSlot: "16:10",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Free-time treatment booking",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Whitening",
        fee: 2000,
        originatingOpdAppointmentId: String(opdAppt._id),
      });
    expect(res.status).toBe(201);
    const saved = await Appointment.findById(res.body.data.appointmentId).lean();
    expect(saved.timeSlot).toBe("16:10");

    await Appointment.deleteMany({ _id: { $in: [opdAppt._id, res.body.data.appointmentId] } });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });

  it("T4: capacity still blocks a genuine duplicate at the EXACT same custom time (15:15, 3 different patients, capacity 2)", async () => {
    const patients = await Patient.create([
      { name: "FreeTime A", phone: "9111111101" },
      { name: "FreeTime B", phone: "9111111102" },
      { name: "FreeTime C", phone: "9111111103" },
    ]);
    const book = (p) =>
      request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          clinic: testData.clinic._id,
          date: tomorrowStr,
          timeSlot: "15:15",
          phone: p.phone,
          patientId: p._id,
          reason: "Capacity test at custom time",
          visitType: "opd",
        });

    const r1 = await book(patients[0]);
    const r2 = await book(patients[1]);
    const r3 = await book(patients[2]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r3.status).toBe(409);

    await Appointment.deleteMany({ _id: { $in: [r1.body.data.appointmentId, r2.body.data.appointmentId] } });
    await Invoice.deleteMany({ patient: { $in: patients.map((p) => p._id) } });
    await Patient.deleteMany({ _id: { $in: patients.map((p) => p._id) } });
  });
});
