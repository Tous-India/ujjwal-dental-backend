import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("GET /api/billing/stats -- Today filter no longer returns zero for real same-day payments", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  it("T1 (HARD GATE): 3 payments made today (Rs2000+Rs300+Rs300) are correctly included when from=to=today", async () => {
    const p1 = await Payment.create({ patient: testData.patient._id, amount: 2000, paymentMode: "cash", type: "treatment", status: "paid" });
    const p2 = await Payment.create({ patient: testData.patient._id, amount: 300, paymentMode: "cash", type: "opd_fee", status: "paid" });
    const p3 = await Payment.create({ patient: testData.patient._id, amount: 300, paymentMode: "cash", type: "opd_fee", status: "paid" });

    const todayStr = new Date().toISOString().split("T")[0];
    const res = await request(app)
      .get("/api/billing/stats")
      .set(authHeader(token))
      .query({ from: todayStr, to: todayStr });

    expect(res.status).toBe(200);
    // totalPaid derives from real Payment docs in this exact range (getBillingStats)
    expect(res.body.data.stats.totalPaid).toBeGreaterThanOrEqual(2600);

    await Payment.deleteMany({ _id: { $in: [p1._id, p2._id, p3._id] } });
  });
});
