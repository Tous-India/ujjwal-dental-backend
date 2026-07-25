import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("GET /api/appointments -- status filter supports comma-separated grouping", () => {
  let token, scheduledId, inProgressId, completedId, cancelledId;

  beforeAll(async () => {
    token = await getAdminToken(app);

    const base = {
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      visitType: "opd",
      fee: 300,
      reason: "Status filter test",
    };
    const scheduled = await Appointment.create({ ...base, timeSlot: "08:00", status: "scheduled" });
    const inProgress = await Appointment.create({ ...base, timeSlot: "08:15", status: "in_progress" });
    const completed = await Appointment.create({ ...base, timeSlot: "08:30", status: "completed" });
    const cancelled = await Appointment.create({ ...base, timeSlot: "08:45", status: "cancelled" });
    scheduledId = String(scheduled._id);
    inProgressId = String(inProgress._id);
    completedId = String(completed._id);
    cancelledId = String(cancelled._id);
  });

  it("T1 (HARD GATE): status=scheduled,in_progress (Active default) returns both, excludes completed/cancelled", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ status: "scheduled,in_progress", limit: 100 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a._id);
    expect(ids).toContain(scheduledId);
    expect(ids).toContain(inProgressId);
    expect(ids).not.toContain(completedId);
    expect(ids).not.toContain(cancelledId);
  });

  it("T2 (HARD GATE): status=all returns every status, no filter applied", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ status: "all", limit: 100 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a._id);
    expect(ids).toContain(scheduledId);
    expect(ids).toContain(inProgressId);
    expect(ids).toContain(completedId);
    expect(ids).toContain(cancelledId);
  });

  it("T3 (HARD GATE): status=completed returns only completed appointments", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ status: "completed", limit: 100 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a._id);
    expect(ids).toContain(completedId);
    expect(ids).not.toContain(scheduledId);
    expect(ids).not.toContain(inProgressId);
    expect(ids).not.toContain(cancelledId);
  });
});
