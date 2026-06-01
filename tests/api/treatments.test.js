import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";

describe("Treatments CRUD", () => {
  let token;
  let createdMasterId;
  let createdTreatmentId;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("GET /api/treatments/master - lists treatment types", async () => {
    const res = await request(app)
      .get("/api/treatments/master")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("POST /api/treatments/master - creates a treatment type", async () => {
    const res = await request(app)
      .post("/api/treatments/master")
      .set(authHeader(token))
      .send({
        name: "Root Canal",
        code: "RC001",
        price: 5000,
        duration: 60,
        category: "endodontic",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const treatmentType = res.body.data.treatmentType || res.body.data;
    expect(treatmentType.name).toBe("Root Canal");
    createdMasterId = treatmentType._id;
  });

  it("GET /api/treatments - lists patient treatments", async () => {
    const res = await request(app)
      .get("/api/treatments")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("POST /api/treatments - creates a patient treatment", async () => {
    const res = await request(app)
      .post("/api/treatments")
      .set(authHeader(token))
      .send({
        patient: testData.patient._id.toString(),
        treatmentType: createdMasterId,
        clinic: testData.clinic._id.toString(),
        status: "planned",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const treatment = res.body.data.treatment || res.body.data;
    createdTreatmentId = treatment._id;
  });

  it("GET /api/treatments/master - rejects unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/treatments/master");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("POST /api/treatments/master - rejects unauthenticated create with 401", async () => {
    const res = await request(app)
      .post("/api/treatments/master")
      .send({ name: "Rogue", code: "RG001", price: 1, duration: 1, category: "endodontic" });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
