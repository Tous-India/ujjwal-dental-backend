import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("GET /api/appointments -- treatmentStatus filter (Treatments tab Active/All/Completed)", () => {
  let token, activeId, completedId;

  beforeAll(async () => {
    token = await getAdminToken(app);

    const active = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:00",
      visitType: "treatment",
      treatmentName: "Active Treatment",
      fee: 1000,
      reason: "Ongoing",
    });
    const completed = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:15",
      visitType: "treatment",
      treatmentName: "Closed Treatment",
      fee: 1000,
      reason: "Done",
      treatmentStatus: "completed",
      treatmentClosedAt: new Date(),
    });
    activeId = String(active._id);
    completedId = String(completed._id);
  });

  it("T2 (HARD GATE): treatmentStatus=active returns only treatments with treatmentStatus unset", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ visitType: "treatment", treatmentStatus: "active", limit: 100 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a._id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(completedId);
  });

  it("T3 (HARD GATE): treatmentStatus=completed returns only closed treatments", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ visitType: "treatment", treatmentStatus: "completed", limit: 100 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a._id);
    expect(ids).toContain(completedId);
    expect(ids).not.toContain(activeId);
  });

  it("T4: no treatmentStatus param (or 'all') returns every treatment regardless of status", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ visitType: "treatment", limit: 100 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a._id);
    expect(ids).toContain(activeId);
    expect(ids).toContain(completedId);
  });
});
