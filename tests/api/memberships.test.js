import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";

describe("Memberships", () => {
  let token;
  let createdPlanId;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("POST /api/memberships/plans - creates a membership plan", async () => {
    const res = await request(app)
      .post("/api/memberships/plans")
      .set(authHeader(token))
      .send({
        name: "Silver Plan",
        code: "SILVER",
        type: "individual",
        tier: "silver",
        price: 999,
        durationMonths: 12,
        discountPercentage: 10,
        benefits: [{ type: "discount", description: "10% discount", discountPercentage: 10 }],
        isActive: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const plan = res.body.data.plan || res.body.data;
    expect(plan.name).toBe("Silver Plan");
    expect(plan.price).toBe(999);
    createdPlanId = plan._id;
  });

  it("GET /api/memberships/plans - lists membership plans", async () => {
    const res = await request(app)
      .get("/api/memberships/plans")
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const plans = res.body.data.plans || res.body.data;
    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/memberships/assign - assigns membership to patient", async () => {
    const res = await request(app)
      .post("/api/memberships/assign")
      .set(authHeader(token))
      .send({
        patientId: testData.patient._id.toString(),
        planId: createdPlanId,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const patient = res.body.data.patient || res.body.data;
    expect(patient.hasMembership).toBe(true);
  });
});
