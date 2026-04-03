import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";

describe("Appointment Lifecycle", () => {
  let token;
  let appointmentId;

  // Use today for check-in tests (check-in only works for today's appointments)
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Use tomorrow for booking/cancel tests
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("POST /api/appointments - books an appointment for today", async () => {
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: todayStr,
        timeSlot: "15:00",
        type: "regular",
        reason: "Dental checkup",
        source: "walk_in",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const apt = res.body.data;
    expect(apt.status).toBe("scheduled");
    appointmentId = apt.appointmentId || apt._id;
  });

  it("POST /api/appointments - rejects double booking same slot", async () => {
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: todayStr,
        timeSlot: "15:00",
        type: "regular",
        reason: "Double book attempt",
      });

    expect([400, 409]).toContain(res.status);
  });

  it("GET /api/appointments - lists appointments", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("POST /api/appointments/:id/check-in - checks in patient", async () => {
    const res = await request(app)
      .post(`/api/appointments/${appointmentId}/check-in`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    const apt = res.body.data.appointment || res.body.data;
    expect(apt.status || apt.toJSON?.()?.status).toBe("checked_in");
  });

  it("POST /api/appointments/:id/complete - completes appointment", async () => {
    const res = await request(app)
      .post(`/api/appointments/${appointmentId}/complete`)
      .set(authHeader(token))
      .send({ clinicalNotes: "Test completed" });

    expect(res.status).toBe(200);
    const apt = res.body.data.appointment || res.body.data;
    expect(apt.status).toBe("completed");
  });

  it("POST /api/appointments/:id/cancel - cancels a new appointment", async () => {
    // Book a second appointment to cancel (use tomorrow so it can be cancelled)
    const bookRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: tomorrowStr,
        timeSlot: "11:00",
        type: "regular",
        reason: "To be cancelled",
      });

    expect(bookRes.status).toBe(201);
    const newAptId = bookRes.body.data.appointmentId || bookRes.body.data._id;

    const res = await request(app)
      .post(`/api/appointments/${newAptId}/cancel`)
      .set(authHeader(token))
      .send({ reason: "Test cancellation" });

    expect(res.status).toBe(200);
    const apt = res.body.data.appointment || res.body.data;
    expect(apt.status).toBe("cancelled");
  });
});
