import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { testData } from "../helpers/seed.js";

describe("Available Slots", () => {
  // Use tomorrow's date to avoid "today" filtering of past slots
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  it("GET /api/appointments/available-slots - returns available slots for a clinic and date", async () => {
    const res = await request(app)
      .get("/api/appointments/available-slots")
      .query({
        clinic: testData.clinic._id.toString(),
        date: tomorrowStr,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(Array.isArray(data.availableSlots)).toBe(true);
    // 9AM-10PM with 30-min slots = 26 total slots
    expect(data.totalSlots).toBe(26);
    // No bookings yet, so all slots should be available
    expect(data.availableSlots.length).toBe(26);
  });

  it("GET /api/appointments/available-slots - returns 400 without query params", async () => {
    const res = await request(app).get("/api/appointments/available-slots");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/appointments/available-slots - returns 400 for invalid clinic ID", async () => {
    const res = await request(app)
      .get("/api/appointments/available-slots")
      .query({
        clinic: "invalid",
        date: "2026-04-02",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
