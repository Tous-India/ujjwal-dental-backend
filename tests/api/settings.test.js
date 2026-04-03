import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";

describe("Settings - Profile", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("GET /api/settings/profile - gets admin profile (admin auth)", async () => {
    const res = await request(app)
      .get("/api/settings/profile")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const user = res.body.data.user || res.body.data;
    expect(user.email).toBe("admin@test.com");
    expect(user.name).toBeDefined();
  });

  it("PATCH /api/settings/profile - updates profile name (admin auth)", async () => {
    const res = await request(app)
      .patch("/api/settings/profile")
      .set(authHeader(token))
      .send({ name: "Updated Admin" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const user = res.body.data.user || res.body.data;
    expect(user.name).toBe("Updated Admin");
  });
});
