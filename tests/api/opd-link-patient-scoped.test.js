import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Patient from "../../src/modules/patients/patient.model.js";

describe("OPD-link dropdown data source -- GET /api/appointments?patient=X&visitType=opd is exactly scoped", () => {
  let token, otherPatient, ownOpd, otherOpd;

  beforeAll(async () => {
    token = await getAdminToken(app);
    otherPatient = await Patient.create({ name: "Other Patient", phone: "9998887776" });

    ownOpd = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "08:00",
      visitType: "opd",
      fee: 300,
      reason: "Own OPD visit",
    });
    otherOpd = await Appointment.create({
      patient: otherPatient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "08:30",
      visitType: "opd",
      fee: 300,
      reason: "Other patient's OPD visit",
    });
  });

  it("T1 (HARD GATE): querying with patient=<selected patient> returns ONLY that patient's OPD visits", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ visitType: "opd", patient: String(testData.patient._id), limit: 25 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a._id);
    expect(ids).toContain(String(ownOpd._id));
    expect(ids).not.toContain(String(otherOpd._id));
  });

  it("T2 (HARD GATE): switching to a different patient returns ONLY the new patient's visits, none of the previous patient's", async () => {
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ visitType: "opd", patient: String(otherPatient._id), limit: 25 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((a) => a._id);
    expect(ids).toContain(String(otherOpd._id));
    expect(ids).not.toContain(String(ownOpd._id));
  });

  it("T3: a patient with zero OPD visits returns an empty array, not an error or other patients' data", async () => {
    const emptyPatient = await Patient.create({ name: "No Visits Patient", phone: "9997776665" });
    const res = await request(app)
      .get("/api/appointments")
      .set(authHeader(token))
      .query({ visitType: "opd", patient: String(emptyPatient._id), limit: 25 });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    await Patient.deleteOne({ _id: emptyPatient._id });
  });

  afterAll(async () => {
    await Appointment.deleteMany({ _id: { $in: [ownOpd._id, otherOpd._id] } });
    await Patient.deleteOne({ _id: otherPatient._id });
  });
});
