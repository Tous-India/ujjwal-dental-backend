import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";

describe("Users (Staff Management)", () => {
  let token;
  let createdUserId;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("POST /api/users - creates a staff user (admin auth)", async () => {
    const res = await request(app)
      .post("/api/users")
      .set(authHeader(token))
      .send({
        name: "Dr. Test",
        email: "doctor@test.com",
        phone: "6666666666",
        password: "Doctor@123",
        role: "admin",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const user = res.body.data.user || res.body.data;
    expect(user.name).toBe("Dr. Test");
    expect(user.email).toBe("doctor@test.com");
    expect(user.role).toBe("admin");
    createdUserId = user._id;
  });

  it("GET /api/users - lists users (admin auth)", async () => {
    const res = await request(app)
      .get("/api/users")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("PATCH /api/users/:id - updates user name (admin auth)", async () => {
    const res = await request(app)
      .patch(`/api/users/${createdUserId}`)
      .set(authHeader(token))
      .send({ name: "Dr. Updated" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const user = res.body.data.user || res.body.data;
    expect(user.name).toBe("Dr. Updated");
  });

  it("DELETE /api/users/:id - deactivates user (admin auth)", async () => {
    const res = await request(app)
      .delete(`/api/users/${createdUserId}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
