import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";

describe("Health Check", () => {
  it("GET /health returns 200 with success", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Server is running");
  });
});
