import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";

describe("Notifications", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("POST /api/notifications/send - sends a notification", async () => {
    const res = await request(app)
      .post("/api/notifications/send")
      .set(authHeader(token))
      .send({
        recipientType: "user",
        recipientId: undefined,
        type: "general",
        title: "Test Notification",
        message: "This is a test notification",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("GET /api/notifications - lists notifications", async () => {
    const res = await request(app)
      .get("/api/notifications")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /api/notifications/unread-count - gets unread count", async () => {
    const res = await request(app)
      .get("/api/notifications/unread-count")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
