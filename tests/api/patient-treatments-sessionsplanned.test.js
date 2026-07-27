import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";

describe("Patient portal Treatments -- sessionsPlanned correctly shown, not miscounted from sessions-booked-so-far", () => {
  let adminToken, treatmentId;

  beforeAll(async () => {
    adminToken = await getAdminToken(app);

    const treatment = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "15:00",
      visitType: "treatment",
      treatmentName: "Whitening",
      fee: 5000,
      sessionsPlanned: 3,
      status: "completed",
      reason: "Whitening treatment",
    });
    treatmentId = treatment._id;
    // Deliberately NO treatment_session children yet -- matches Sunny's
    // "freshly booked, only the booking session so far" repro scenario.
  });

  it("T1 (HARD GATE): a freshly-booked treatment (no additional sessions yet) still returns sessionsPlanned=3, not miscounted as 1", async () => {
    const res = await request(app)
      .get(`/api/patients/${testData.patient._id}/treatments`)
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    const found = res.body.data.find((t) => String(t._id) === String(treatmentId));
    expect(found).toBeTruthy();
    expect(found.sessionsPlanned).toBe(3);
    // sessions array itself is just the booking session so far (length 1) --
    // this is what the OLD frontend logic incorrectly fell back to as "total".
    expect(found.sessions).toHaveLength(1);
  });
});
