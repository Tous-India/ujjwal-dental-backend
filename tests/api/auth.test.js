import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, getPatientToken, authHeader } from "../helpers/auth.js";

describe("Admin Auth", () => {
  it("POST /api/auth/login - succeeds with valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@test.com", password: "Admin@123" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe("admin@test.com");
  });

  it("POST /api/auth/login - fails with wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@test.com", password: "WrongPass" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("POST /api/auth/login - fails with missing fields", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@test.com" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/auth/me - returns current admin with valid token", async () => {
    const token = await getAdminToken(app);
    const res = await request(app)
      .get("/api/auth/me")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe("admin@test.com");
  });
});

describe("Patient Auth", () => {
  it("POST /api/auth/patient/login-password - succeeds with valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/patient/login-password")
      .send({ email: "patient@test.com", password: "Patient@123" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.patient.email).toBe("patient@test.com");
  });

  it("GET /api/auth/patient/me - returns current patient with valid token", async () => {
    const token = await getPatientToken(app);
    const res = await request(app)
      .get("/api/auth/patient/me")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.patient.email).toBe("patient@test.com");
  });
});
