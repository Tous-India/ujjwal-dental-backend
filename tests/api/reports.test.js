import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";

describe("Reports", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("GET /api/reports - lists reports", async () => {
    const res = await request(app)
      .get("/api/reports");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /api/reports/patient/:patientId - gets patient reports", async () => {
    const res = await request(app)
      .get(`/api/reports/patient/${testData.patient._id.toString()}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
