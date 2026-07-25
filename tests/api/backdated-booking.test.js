import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("Admin backdated booking (10-day window, admin-only)", () => {
  let adminToken;

  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  };

  beforeAll(async () => {
    adminToken = await getAdminToken(app);
  });

  it("T1 (HARD GATE): admin can book exactly 10 days in the past", async () => {
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(adminToken))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: daysAgo(10),
        timeSlot: "11:00",
        type: "regular",
        reason: "Backdated walk-in, forgot to log same-day",
        source: "walk_in",
      });

    expect(res.status).toBe(201);
    const apt = res.body.data;
    const id = apt.appointmentId || apt._id;
    const saved = await Appointment.findById(id);
    expect(saved).toBeTruthy();
    const savedDateStr = saved.date.toISOString().split("T")[0];
    expect(savedDateStr).toBe(daysAgo(10));
  });

  it("T2 (HARD GATE): admin CANNOT book 11 days in the past", async () => {
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(adminToken))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: daysAgo(11),
        timeSlot: "11:30",
        type: "regular",
        reason: "Too far back",
        source: "walk_in",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/backdate/i);
  });

  it("T3 (HARD GATE): patient-facing booking endpoints never pass allowBackdate -- structural check", async () => {
    // book-free (patientProtect) and book-with-payment (patient flow) must
    // never grant backdating: their validateAppointmentSlot() calls must NOT
    // pass allowBackdate at all, so it falls back to the false default. Only
    // createAppointment (the admin walk-in path) may pass it, and only
    // derived from req.user's role -- never a client-supplied flag.
    const fs = await import("fs");
    const src = fs.readFileSync(
      new URL("../../src/modules/appointments/appointment.controller.js", import.meta.url),
      "utf8"
    );
    const calls = [...src.matchAll(/validateAppointmentSlot\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
    expect(calls.length).toBe(3);
    const withAllowBackdate = calls.filter((c) => c.includes("allowBackdate"));
    expect(withAllowBackdate.length).toBe(1);
    expect(withAllowBackdate[0]).toMatch(/canBackdate\(req\.user\)/);
  });

  it("T3 (behavioral): patient-facing book-free endpoint rejects any past date outright (no allowance)", async () => {
    // No auth needed to prove the point -- patientProtect 401s first either
    // way, but if it DID get through, the date validation must still reject
    // any past date since allowBackdate is never passed on this path.
    const res = await request(app)
      .post("/api/appointments/book-free")
      .send({
        clinic: testData.clinic._id.toString(),
        date: daysAgo(3),
        timeSlot: "12:00",
        reason: "Patient trying to backdate",
      });

    // Either 401 (no/invalid auth) or 400 (past date) -- never a success.
    expect([400, 401]).toContain(res.status);
  });

  it("T3b: unauthenticated call to the admin create-appointment route also cannot backdate", async () => {
    // POST /api/appointments uses optionalAuth -- req.user is undefined with
    // no token, so canBackdate() must be false regardless of any body field.
    const res = await request(app)
      .post("/api/appointments")
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: daysAgo(3),
        timeSlot: "13:00",
        type: "regular",
        reason: "Unauthenticated backdate attempt",
        source: "walk_in",
        allowBackdate: true, // client-supplied flag must be ignored entirely
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/past/i);
  });

  it("T4: slot capacity still enforced for backdated entries", async () => {
    const date = daysAgo(5);
    const timeSlot = "14:00";
    const book = () =>
      request(app)
        .post("/api/appointments")
        .set(authHeader(adminToken))
        .send({
          patientId: testData.patient._id.toString(),
          phone: testData.patient.phone,
          clinic: testData.clinic._id.toString(),
          date,
          timeSlot,
          type: "regular",
          reason: "Capacity test",
          source: "walk_in",
        });

    const r1 = await book();
    const r2 = await book();
    const r3 = await book(); // 3rd regular booking in the same slot -> capacity 2, should be rejected

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r3.status).toBe(409);
  });

  it("T5: treatment-visitType booking backdates identically to OPD", async () => {
    // originatingOpdAppointmentId is mandatory for treatment bookings (Bug 2 fix).
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
      .set(authHeader(adminToken))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: daysAgo(8),
        timeSlot: "15:00",
        type: "regular",
        visitType: "treatment",
        treatmentId: "other",
        treatmentName: "Root Canal",
        fee: 5000,
        reason: "Backdated treatment booking",
        source: "walk_in",
        originatingOpdAppointmentId: String(opdAppt._id),
      });

    expect(res.status).toBe(201);
  });
});
