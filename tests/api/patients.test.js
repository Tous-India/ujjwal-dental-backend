import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";

describe("Patients CRUD", () => {
  let token;
  let createdPatientId;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("POST /api/patients - creates a new patient", async () => {
    const res = await request(app)
      .post("/api/patients")
      .set(authHeader(token))
      .send({
        name: "New Test Patient",
        phone: "8888888888",
        email: "newpatient@test.com",
        gender: "male",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.patient || res.body.data).toBeDefined();

    const patient = res.body.data.patient || res.body.data;
    expect(patient.name).toBe("New Test Patient");
    createdPatientId = patient._id;
  });

  it("POST /api/patients - rejects duplicate phone", async () => {
    const res = await request(app)
      .post("/api/patients")
      .set(authHeader(token))
      .send({
        name: "Duplicate Phone",
        phone: "8888888888",
        email: "dup@test.com",
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/patients - lists patients with pagination", async () => {
    const res = await request(app)
      .get("/api/patients")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/patients?search=New - searches patients", async () => {
    const res = await request(app)
      .get("/api/patients?search=New")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    const patients = res.body.data;
    expect(Array.isArray(patients)).toBe(true);
  });

  it("GET /api/patients/:id - gets single patient", async () => {
    const res = await request(app)
      .get(`/api/patients/${createdPatientId}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("PATCH /api/patients/:id - updates patient", async () => {
    const res = await request(app)
      .patch(`/api/patients/${createdPatientId}`)
      .set(authHeader(token))
      .send({ bloodGroup: "O+" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /api/patients/:id - deactivates patient", async () => {
    const res = await request(app)
      .delete(`/api/patients/${createdPatientId}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("PATCH /api/patients/:id/reactivate - admin/staff flips isActive back to true", async () => {
    const res = await request(app)
      .patch(`/api/patients/${createdPatientId}/reactivate`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const patient = res.body.data.patient || res.body.data;
    expect(patient.isActive).toBe(true);
  });

  it("PATCH /api/patients/:id/reactivate - rejects unauthenticated request with 401", async () => {
    const res = await request(app).patch(`/api/patients/${createdPatientId}/reactivate`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
