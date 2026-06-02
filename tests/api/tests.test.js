import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";

describe("Test Master Catalog", () => {
  let token;
  let createdMasterId;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("POST /api/tests/master - creates a test type", async () => {
    const res = await request(app)
      .post("/api/tests/master")
      .set(authHeader(token))
      .send({
        name: "Dental X-Ray",
        code: "XR001",
        price: 500,
        category: "imaging",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const testType = res.body.data.testType || res.body.data;
    createdMasterId = testType._id;
  });

  it("GET /api/tests/master - lists test types (authenticated)", async () => {
    const res = await request(app)
      .get("/api/tests/master")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /api/tests/master - rejects unauthenticated request with 401", async () => {
    const res = await request(app).get("/api/tests/master");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/tests/master/:id - rejects unauthenticated request with 401", async () => {
    const res = await request(app).get(`/api/tests/master/${createdMasterId}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
