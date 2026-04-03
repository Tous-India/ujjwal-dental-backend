import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";

describe("Clinics CRUD", () => {
  let token;
  let createdClinicId;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("GET /api/clinics - lists clinics", async () => {
    const res = await request(app)
      .get("/api/clinics")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("POST /api/clinics - creates a clinic", async () => {
    const res = await request(app)
      .post("/api/clinics")
      .set(authHeader(token))
      .send({
        name: "New Test Clinic",
        phone: "5555555555",
        address: {
          city: "Mumbai",
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const clinic = res.body.data.clinic || res.body.data;
    expect(clinic.name).toBe("New Test Clinic");
    createdClinicId = clinic._id;
  });

  it("PATCH /api/clinics/:id - updates clinic name", async () => {
    const res = await request(app)
      .patch(`/api/clinics/${createdClinicId}`)
      .set(authHeader(token))
      .send({ name: "Updated Clinic Name" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /api/clinics/:id - soft deletes clinic", async () => {
    const res = await request(app)
      .delete(`/api/clinics/${createdClinicId}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
