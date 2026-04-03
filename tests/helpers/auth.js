/**
 * Auth Test Helpers
 *
 * Helper functions to get JWT tokens for API tests.
 */
import request from "supertest";

export async function getAdminToken(app) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@test.com", password: "Admin@123" });
  return res.body.data?.token || res.body.data?.accessToken;
}

export async function getPatientToken(app) {
  const res = await request(app)
    .post("/api/auth/patient/login-password")
    .send({ email: "patient@test.com", password: "Patient@123" });
  return res.body.data?.token || res.body.data?.accessToken;
}

export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}
