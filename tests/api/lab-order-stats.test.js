import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Lab from "../../src/modules/labs/lab.model.js";
import LabOrder from "../../src/modules/labs/labOrder.model.js";

describe("GET /api/lab-orders/stats", () => {
  let token;
  let lab;

  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };
  const daysFromNow = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
  };

  beforeAll(async () => {
    token = await getAdminToken(app);
    lab = await Lab.create({ name: "Stats Test Lab", phone: "9000000000" });

    // Two orders inside the "this month" range (today), one delivered, one overdue.
    await LabOrder.create({
      lab: lab._id,
      patient: testData.patient._id,
      items: [{ procedure: "Crown", quantity: 1, unitPrice: 2000, pricingType: "per_unit" }],
      orderDate: new Date(),
      expectedDelivery: daysAgo(2), // already passed -> overdue
      deliveryStatus: "in_progress",
    });
    await LabOrder.create({
      lab: lab._id,
      patient: testData.patient._id,
      items: [{ procedure: "Bridge", quantity: 1, unitPrice: 3000, pricingType: "per_unit" }],
      orderDate: new Date(),
      expectedDelivery: daysFromNow(2), // future -> not overdue
      deliveryStatus: "delivered",
    });
    // One order far outside range (60 days ago) -- must NOT be counted for "this month".
    await LabOrder.create({
      lab: lab._id,
      patient: testData.patient._id,
      items: [{ procedure: "Denture", quantity: 1, unitPrice: 9999, pricingType: "per_unit" }],
      orderDate: daysAgo(60),
      deliveryStatus: "pending",
    });
  });

  it("T1 (HARD GATE): stats for an explicit range match real DB state", async () => {
    const from = daysAgo(5).toISOString().slice(0, 10);
    const to = daysFromNow(1).toISOString().slice(0, 10);

    const res = await request(app)
      .get("/api/lab-orders/stats")
      .query({ from, to })
      .set(authHeader(token));

    expect(res.status).toBe(200);
    const { totalSpent, undelivered, totalOrders, overdue } = res.body.data;

    // Only the 2 in-range orders count; the 60-days-ago one is excluded.
    expect(totalOrders).toBe(2);
    expect(totalSpent).toBe(5000); // 2000 + 3000
    expect(undelivered).toBe(1); // the in_progress one (delivered one excluded)
    expect(overdue).toBe(1); // in_progress + expectedDelivery in the past
  });

  it("T2 (HARD GATE): narrowing the range recomputes correctly (excludes both in-range orders)", async () => {
    const from = daysAgo(3).toISOString().slice(0, 10);
    const to = daysAgo(1).toISOString().slice(0, 10);

    const res = await request(app)
      .get("/api/lab-orders/stats")
      .query({ from, to })
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.data.totalOrders).toBe(0);
    expect(res.body.data.totalSpent).toBe(0);
  });

  it("T3: overdue only counts orders with expectedDelivery in the past AND not delivered", async () => {
    const from = daysAgo(5).toISOString().slice(0, 10);
    const to = daysFromNow(1).toISOString().slice(0, 10);

    const res = await request(app)
      .get("/api/lab-orders/stats")
      .query({ from, to })
      .set(authHeader(token));

    expect(res.status).toBe(200);
    // Exactly the one in_progress order with a past expectedDelivery.
    expect(res.body.data.overdue).toBe(1);
  });
});
