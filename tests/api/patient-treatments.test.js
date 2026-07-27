import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getPatientToken, getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("Patient portal Treatments view -- reconnected to real Appointment-based treatment data", () => {
  let patientToken, adminToken, treatmentId, sessionId;

  beforeAll(async () => {
    patientToken = await getPatientToken(app);
    adminToken = await getAdminToken(app);

    const treatment = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:00",
      visitType: "treatment",
      treatmentName: "Root Canal",
      fee: 5000,
      sessionsPlanned: 3,
      status: "in_progress",
      reason: "Root canal",
    });
    treatmentId = treatment._id;

    const session = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:30",
      visitType: "treatment_session",
      parentAppointment: treatment._id,
      sessionNumber: 2,
      status: "completed",
      reason: "Session 2",
    });
    sessionId = session._id;
  });

  it("T1 (HARD GATE): patient-facing endpoint returns the patient's treatment(s) correctly", async () => {
    const res = await request(app)
      .get(`/api/patients/${testData.patient._id}/treatments`)
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    const found = res.body.data.find((t) => String(t._id) === String(treatmentId));
    expect(found).toBeTruthy();
    expect(found.name).toBe("Root Canal");
    expect(found.status).toBe("in_progress"); // treatmentStatus null -> "in_progress"
  });

  it("T2 (HARD GATE): admin Treatments tab endpoint (getAllAppointments) is completely unaffected -- still one row per treatment", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(adminToken))
      .query({ visitType: "treatment", limit: 100 });
    expect(res.status).toBe(200);
    const rows = res.body.data.filter((a) => String(a._id) === String(treatmentId));
    expect(rows).toHaveLength(1); // exactly one row for this treatment, no session rows
    const sessionRows = res.body.data.filter((a) => a.visitType === "treatment_session");
    expect(sessionRows).toHaveLength(0); // sessions never appear as their own rows
  });

  it("T3: session progress (sessions array) is correct for the patient view", async () => {
    const res = await request(app)
      .get(`/api/patients/${testData.patient._id}/treatments`)
      .set(authHeader(adminToken));
    const found = res.body.data.find((t) => String(t._id) === String(treatmentId));
    // Parent (implicit session 1, status "in_progress") + the one linked session (status "completed")
    expect(found.sessions).toHaveLength(2);
    const completedCount = found.sessions.filter((s) => s.status === "completed").length;
    expect(completedCount).toBe(1);
  });

  it("Bonus: status filter (?status=in_progress) correctly filters and paginates in-memory", async () => {
    const res = await request(app)
      .get(`/api/patients/${testData.patient._id}/treatments`)
      .set(authHeader(adminToken))
      .query({ status: "in_progress" });
    expect(res.status).toBe(200);
    expect(res.body.data.every((t) => t.status === "in_progress")).toBe(true);
  });
});
