import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";

describe("Enquiries / Leads", () => {
  let token;
  let enquiryId;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("POST /api/enquiries - creates enquiry (public, no auth)", async () => {
    const res = await request(app)
      .post("/api/enquiries")
      .send({
        name: "Test Lead",
        phone: "7777777777",
        email: "lead@test.com",
        source: { page: "website" },
        treatmentName: "Teeth cleaning",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const enquiry = res.body.data.enquiry || res.body.data;
    expect(enquiry.name).toBe("Test Lead");
    expect(enquiry._id).toBeDefined();
    enquiryId = enquiry._id;
  });

  it("GET /api/enquiries - lists enquiries (admin auth)", async () => {
    const res = await request(app)
      .get("/api/enquiries")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.enquiries).toBeDefined();
    expect(Array.isArray(data.enquiries)).toBe(true);
    expect(data.pagination).toBeDefined();
    expect(data.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/enquiries/stats - gets statistics (admin auth)", async () => {
    const res = await request(app)
      .get("/api/enquiries/stats")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stats).toBeDefined();
  });

  it("PATCH /api/enquiries/:id/status - updates status to contacted (admin auth)", async () => {
    const res = await request(app)
      .patch(`/api/enquiries/${enquiryId}/status`)
      .set(authHeader(token))
      .send({ status: "contacted", note: "Called the lead" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const enquiry = res.body.data.enquiry || res.body.data;
    expect(enquiry.status).toBe("contacted");
  });
});
