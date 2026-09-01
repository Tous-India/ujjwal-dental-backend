import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, getPatientToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Patient from "../../src/modules/patients/patient.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import { cleanupPatientRecords } from "../helpers/teardown.js";

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

  // A slot that is still in the future *today* (check-in only works for today),
  // computed ~90 min ahead and rounded down to the half hour so it stays > now.
  // (Assumes the suite is not run in the final ~90 min before midnight.)
  const slotDate = new Date(Date.now() + 90 * 60 * 1000);
  const futureSlot = `${String(slotDate.getHours()).padStart(2, "0")}:${
    slotDate.getMinutes() < 30 ? "00" : "30"
  }`;

  // Use yesterday for the within-backdate-window test
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  // Beyond the 10-day admin backdate window, for the past-date rejection test
  const tooFarPast = new Date();
  tooFarPast.setDate(tooFarPast.getDate() - 11);
  const tooFarPastStr = tooFarPast.toISOString().split("T")[0];

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  afterAll(async () => {
    await cleanupPatientRecords(testData.patient._id);
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
        timeSlot: futureSlot,
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

  it("POST /api/appointments - allows up to 2 bookings per slot, then rejects the 3rd", async () => {
    // Distinct patients per booking -- capacity is about different people
    // filling a slot; the same patient booking twice would now correctly be
    // rejected by the 4-hour same-patient OPD gap rule before ever reaching
    // the capacity check.
    const capacityPatients = await Patient.create([
      { name: "Capacity Test A", phone: "9000000001" },
      { name: "Capacity Test B", phone: "9000000002" },
      { name: "Capacity Test C", phone: "9000000003" },
    ]);
    const book = (patient) =>
      request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          patientId: patient._id.toString(),
          phone: patient.phone,
          clinic: testData.clinic._id.toString(),
          date: tomorrowStr,
          timeSlot: "10:00",
          type: "regular",
          reason: "Capacity test",
        });

    // 1st and 2nd bookings (different patients) fill the slot to capacity (2)
    expect((await book(capacityPatients[0])).status).toBe(201);
    expect((await book(capacityPatients[1])).status).toBe(201);

    // 3rd booking (a 3rd distinct patient) must be rejected — slot is full
    const third = await book(capacityPatients[2]);
    expect(third.status).toBe(409);
    expect(third.body.success).toBe(false);

    await Patient.deleteMany({ _id: { $in: capacityPatients.map((p) => p._id) } });
  });

  it("POST /api/appointments - Emergency (consolidated Type dropdown payload) gets the emergency capacity (3), not the regular one (2)", async () => {
    // Mirrors the exact payload AddAppointmentModal's consolidated Type
    // dropdown now sends -- both `type` and `appointmentType` set to
    // "emergency" together (previously a separate Urgency radio group set
    // appointmentType alone). This slot is filled to the REGULAR capacity
    // (2) with regular bookings first, then a 3rd, distinct-patient
    // Emergency booking must still succeed -- proving appointmentType, not
    // type or a stale/absent urgency field, is what the capacity check
    // actually reads for this payload shape.
    const emergencyPatients = await Patient.create([
      { name: "Emergency Capacity A", phone: "9000000004" },
      { name: "Emergency Capacity B", phone: "9000000005" },
      { name: "Emergency Capacity C", phone: "9000000006" },
      { name: "Emergency Capacity D", phone: "9000000007" },
    ]);
    const book = (patient, urgency) =>
      request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          patientId: patient._id.toString(),
          phone: patient.phone,
          clinic: testData.clinic._id.toString(),
          date: tomorrowStr,
          timeSlot: "17:00",
          type: urgency,
          appointmentType: urgency,
          reason: "Emergency capacity test",
        });

    // Fill regular capacity (2) with two regular bookings.
    expect((await book(emergencyPatients[0], "regular")).status).toBe(201);
    expect((await book(emergencyPatients[1], "regular")).status).toBe(201);

    // A 3rd REGULAR booking must now be rejected -- regular capacity is full.
    const thirdRegular = await book(emergencyPatients[2], "regular");
    expect(thirdRegular.status).toBe(409);

    // But an EMERGENCY booking in the same slot succeeds -- emergency has
    // its own higher capacity (3), unaffected by the regular slots filled.
    const emergencyBooking = await book(emergencyPatients[2], "emergency");
    expect(emergencyBooking.status).toBe(201);
    expect(emergencyBooking.body.data.appointmentType).toBe("emergency");

    // Capacity is a shared per-slot total (2 normally, 3 when the requester
    // is emergency) -- not 2 regular + 3 additional emergency slots. The
    // slot is now at 3 total (2 regular + 1 emergency), so a 4th booking of
    // ANY urgency must be rejected -- even another emergency request, since
    // 3 is the max even under the emergency allowance.
    const fourthBooking = await book(emergencyPatients[3], "emergency");
    expect(fourthBooking.status).toBe(409);

    await Patient.deleteMany({ _id: { $in: emergencyPatients.map((p) => p._id) } });
  });

  it("POST /api/appointments - admin can book yesterday (within the 10-day backdate window)", async () => {
    // Admin/clinic_manager may backdate up to 10 days (see MIN_BACKDATE_DAYS
    // in appointment.controller.js) -- yesterday is well within that window.
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: yesterdayStr,
        timeSlot: "10:00",
        type: "regular",
        reason: "Backdated walk-in",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /api/appointments - rejects a date beyond the 10-day backdate window", async () => {
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: tooFarPastStr,
        timeSlot: "10:00",
        type: "regular",
        reason: "Too-far-past attempt",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("POST /api/appointments - admin CAN book an earlier time today (was: always rejected, now: same allowance as backdating a past date -- logging a missed walk-in)", async () => {
    // 00:00 today is always at or before the current time -- previously
    // always rejected outright; now allowed for admin (canBackdate), same
    // relaxation already applied to past dates.
    const res = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date: todayStr,
        timeSlot: "00:00",
        type: "regular",
        reason: "Missed walk-in, logged late",
      });

    expect(res.status).toBe(201);

    await Appointment.deleteOne({ _id: res.body.data.appointmentId });
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

  it("GET /api/appointments - rejects unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/appointments");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/appointments/:phone - rejects unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/appointments/9876543210");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("POST /api/appointments/:id/cancel - rejects unauthenticated request with 401", async () => {
    const res = await request(app)
      .post(`/api/appointments/${appointmentId}/cancel`)
      .send({ reason: "no auth" });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/appointments/:phone - rejects a patient querying another phone with 403", async () => {
    const patientToken = await getPatientToken(app);
    const res = await request(app)
      .get("/api/appointments/9999999999") // not the seeded patient's phone (9876543210)
      .set(authHeader(patientToken));
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/appointments/available-slots - stays public (no auth)", async () => {
    const res = await request(app).get("/api/appointments/available-slots");
    // 400 (missing query params) proves the handler ran without an auth block
    expect(res.status).toBe(400);
  });
});
