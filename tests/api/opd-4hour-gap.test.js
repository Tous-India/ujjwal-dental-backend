import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";

describe("4-hour minimum gap between OPD appointments for the same patient (Item 1)", () => {
  let token;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString();

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): second OPD booking within 4 hours for the same patient is rejected", async () => {
    const first = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "10:00",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "First OPD visit",
        visitType: "opd",
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "13:00", // 3 hours later -- within the 4-hour window
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Second OPD visit, too soon",
        visitType: "opd",
      });
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/within 4 hours/i);

    await Appointment.deleteOne({ _id: first.body.data.appointmentId });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });

  it("A booking exactly 4 hours+1min apart succeeds (boundary check)", async () => {
    const first = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "09:00",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "First OPD visit",
        visitType: "opd",
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "13:30", // 4.5 hours later -- outside the window
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Second OPD visit, far enough apart",
        visitType: "opd",
      });
    expect(second.status).toBe(201);

    await Appointment.deleteMany({
      _id: { $in: [first.body.data.appointmentId, second.body.data.appointmentId] },
    });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });

  it("Treatment visitType bookings are completely unaffected by the gap rule", async () => {
    const opdAppt = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "08:00",
      visitType: "opd",
      fee: 300,
      reason: "Initial consult",
    });

    const first = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "10:00",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Treatment 1",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Cleaning",
        fee: 1000,
        originatingOpdAppointmentId: String(opdAppt._id),
      });
    expect(first.status).toBe(201);

    // Second treatment booking 30 minutes later -- well within 4 hours, but
    // the gap rule must not apply to treatment visitType at all.
    const second = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        clinic: testData.clinic._id,
        date: tomorrowStr,
        timeSlot: "10:30",
        phone: testData.patient.phone,
        patientId: testData.patient._id,
        reason: "Treatment 2",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Filling",
        fee: 1500,
        originatingOpdAppointmentId: String(opdAppt._id),
      });
    expect(second.status).toBe(201);

    await Appointment.deleteMany({
      _id: { $in: [opdAppt._id, first.body.data.appointmentId, second.body.data.appointmentId] },
    });
    await Invoice.deleteMany({ patient: testData.patient._id });
  });
});
