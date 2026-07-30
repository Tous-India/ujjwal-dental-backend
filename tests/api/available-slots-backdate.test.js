import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("GET /api/appointments/available-slots -- backdated dates now show slots (not empty)", () => {
  let token;

  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  };
  const daysAhead = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split("T")[0];
  };
  const todayStr = () => new Date().toISOString().split("T")[0];

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): admin requesting slots for a date 3 days in the past gets a full range, not empty", async () => {
    const res = await request(app)
      .get("/api/appointments/available-slots")
      .set(authHeader(token))
      .query({ clinic: testData.clinic._id.toString(), date: daysAgo(3) });
    expect(res.status).toBe(200);
    expect(res.body.data.availableSlots.length).toBeGreaterThan(0);
    expect(res.body.data.availableSlots).toContain("09:00");
  });

  it("T2 (HARD GATE): TODAY still correctly filters out already-passed slots for a caller WITHOUT backdating rights (patient/unauthenticated)", async () => {
    // Unauthenticated -- canBackdate(undefined) is false, same as any
    // patient-facing call. Admin is now deliberately EXEMPT from this
    // filter for today (see the new test below) -- same allowance as
    // backdating a past date, so this regression check must use a
    // non-admin caller to still be testing the right thing.
    const res = await request(app)
      .get("/api/appointments/available-slots")
      .query({ clinic: testData.clinic._id.toString(), date: todayStr() });
    expect(res.status).toBe(200);
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (const slot of res.body.data.availableSlots) {
      const [h, m] = slot.split(":").map(Number);
      expect(h * 60 + m).toBeGreaterThan(currentMinutes);
    }
  });

  it("Admin (backdating rights) sees ALL of today's slots, including already-passed ones -- same allowance as past dates", async () => {
    const res = await request(app)
      .get("/api/appointments/available-slots")
      .set(authHeader(token))
      .query({ clinic: testData.clinic._id.toString(), date: todayStr() });
    expect(res.status).toBe(200);
    expect(res.body.data.availableSlots).toContain("09:00"); // always in the past by the time tests run
  });

  it("T3 (HARD GATE): a FUTURE date still returns the full slot range (regression)", async () => {
    const res = await request(app)
      .get("/api/appointments/available-slots")
      .set(authHeader(token))
      .query({ clinic: testData.clinic._id.toString(), date: daysAhead(5) });
    expect(res.status).toBe(200);
    expect(res.body.data.availableSlots).toContain("09:00");
    expect(res.body.data.availableSlots).toContain("21:30");
  });

  it("T4: on a backdated date, slots at capacity are excluded while others remain available", async () => {
    const date = daysAgo(4);
    const bookOne = () =>
      Appointment.create({
        patient: testData.patient._id,
        clinic: testData.clinic._id,
        date: new Date(date),
        timeSlot: "10:00",
        visitType: "opd",
        fee: 300,
        reason: "Capacity filler",
        appointmentType: "regular",
      });
    await bookOne();
    await bookOne(); // capacity 2 for regular -> 10:00 now full

    const res = await request(app)
      .get("/api/appointments/available-slots")
      .set(authHeader(token))
      .query({ clinic: testData.clinic._id.toString(), date });
    expect(res.status).toBe(200);
    expect(res.body.data.availableSlots).not.toContain("10:00");
    expect(res.body.data.availableSlots).toContain("09:00");

    await Appointment.deleteMany({ clinic: testData.clinic._id, timeSlot: "10:00", reason: "Capacity filler" });
  });

  it("T5: a real booking on a backdated date + now-available slot succeeds end to end", async () => {
    const date = daysAgo(6);
    const slotsRes = await request(app)
      .get("/api/appointments/available-slots")
      .set(authHeader(token))
      .query({ clinic: testData.clinic._id.toString(), date });
    expect(slotsRes.body.data.availableSlots.length).toBeGreaterThan(0);
    const chosenSlot = slotsRes.body.data.availableSlots[0];

    const bookRes = await request(app)
      .post("/api/appointments")
      .set(authHeader(token))
      .send({
        patientId: testData.patient._id.toString(),
        phone: testData.patient.phone,
        clinic: testData.clinic._id.toString(),
        date,
        timeSlot: chosenSlot,
        type: "regular",
        reason: "Backdated booking via real available slot",
        source: "walk_in",
      });
    expect(bookRes.status).toBe(201);

    await Appointment.deleteOne({ _id: bookRes.body.data.appointmentId });
  });

  it("Unauthenticated (patient-facing) request for a backdated date still gets zero slots", async () => {
    const res = await request(app)
      .get("/api/appointments/available-slots")
      .query({ clinic: testData.clinic._id.toString(), date: daysAgo(2) });
    expect(res.status).toBe(200);
    expect(res.body.data.availableSlots).toHaveLength(0);
  });
});
