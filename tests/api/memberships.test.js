import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import User from "../../src/modules/users/user.model.js";
import Patient from "../../src/modules/patients/patient.model.js";

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

  // The patient-login endpoint is a known pre-existing broken test-infra path
  // (baseline failure, unrelated to this feature) -- generating a real JWT
  // matching patientProtect's exact expected payload instead, so book-free's
  // real auth middleware still gets exercised, not bypassed.
  const patientToken = () =>
    jwt.sign({ id: String(testData.patient._id), type: "patient" }, process.env.JWT_SECRET, { expiresIn: "1h" });

  it("T1 (HARD GATE): pausing a membership requires a reason, persists it, and immediately suspends the free-OPD benefit", async () => {
    // Reason too short is rejected
    const shortRes = await request(app)
      .post(`/api/memberships/pause/${testData.patient._id}`)
      .set(authHeader(token))
      .send({ reason: "short" });
    expect(shortRes.status).toBe(400);

    const pauseRes = await request(app)
      .post(`/api/memberships/pause/${testData.patient._id}`)
      .set(authHeader(token))
      .send({ reason: "Patient travelling abroad for two months" });

    expect(pauseRes.status).toBe(200);
    const paused = pauseRes.body.data.patient.membership;
    expect(paused.status).toBe("paused");
    const entry = paused.statusHistory[paused.statusHistory.length - 1];
    expect(entry.action).toBe("paused");
    expect(entry.reason).toBe("Patient travelling abroad for two months");
    expect(entry.performedBy).toBeTruthy();

    // Real benefit check: book-free must now be blocked (403), same as "no membership".
    const bookRes = await request(app)
      .post("/api/appointments/book-free")
      .set(authHeader(patientToken()))
      .send({
        clinic: testData.clinic._id.toString(),
        date: new Date(Date.now() + 86400000).toISOString().split("T")[0],
        timeSlot: "14:00",
        reason: "Checkup",
      });
    expect(bookRes.status).toBe(403);
  });

  it("T2 (HARD GATE): resuming a paused membership restores the free-OPD benefit", async () => {
    const resumeRes = await request(app)
      .post(`/api/memberships/resume/${testData.patient._id}`)
      .set(authHeader(token))
      .send({});

    expect(resumeRes.status).toBe(200);
    const resumed = resumeRes.body.data.patient.membership;
    expect(resumed.status).toBe("active");
    expect(resumed.pausedAt).toBeFalsy();
    const entry = resumed.statusHistory[resumed.statusHistory.length - 1];
    expect(entry.action).toBe("resumed");

    // Real benefit check: book-free must now succeed again.
    const bookRes = await request(app)
      .post("/api/appointments/book-free")
      .set(authHeader(patientToken()))
      .send({
        clinic: testData.clinic._id.toString(),
        date: new Date(Date.now() + 86400000).toISOString().split("T")[0],
        timeSlot: "15:00",
        reason: "Checkup",
      });
    expect(bookRes.status).toBe(201);
    expect(bookRes.body.data.appointment?.isFree ?? bookRes.body.data.isFree).toBe(true);
  });

  it("T3 (HARD GATE): cancelling a membership requires a reason, persists it, is terminal, and stops the benefit", async () => {
    const shortRes = await request(app)
      .post(`/api/memberships/cancel/${testData.patient._id}`)
      .set(authHeader(token))
      .send({ reason: "short" });
    expect(shortRes.status).toBe(400);

    const cancelRes = await request(app)
      .post(`/api/memberships/cancel/${testData.patient._id}`)
      .set(authHeader(token))
      .send({ reason: "Patient requested cancellation, moving cities" });

    expect(cancelRes.status).toBe(200);
    const cancelled = cancelRes.body.data.patient.membership;
    expect(cancelled.status).toBe("cancelled");
    const entry = cancelled.statusHistory[cancelled.statusHistory.length - 1];
    expect(entry.action).toBe("cancelled");
    expect(entry.reason).toBe("Patient requested cancellation, moving cities");
    expect(cancelRes.body.data.patient.hasMembership).toBe(false);

    // Confirm it's truly persisted, re-fetched from DB (not just the response echo).
    const fresh = await Patient.findById(testData.patient._id);
    expect(fresh.membership.status).toBe("cancelled");
    expect(fresh.membership.statusHistory.at(-1).reason).toBe("Patient requested cancellation, moving cities");

    // Cannot pause a cancelled membership -- terminal, not resumable like pause.
    const pauseAfterCancel = await request(app)
      .post(`/api/memberships/pause/${testData.patient._id}`)
      .set(authHeader(token))
      .send({ reason: "Trying to pause a cancelled membership" });
    expect(pauseAfterCancel.status).toBe(400);
  });

  it("T4 (HARD GATE, security): pause/cancel are blocked for non-admin roles and unauthenticated requests", async () => {
    // Unauthenticated
    const unauth = await request(app)
      .post(`/api/memberships/pause/${testData.patient._id}`)
      .send({ reason: "No auth at all attempted here" });
    expect(unauth.status).toBe(401);

    // Authenticated but non-manager role (blog_editor is not admin/clinic_manager)
    const editor = await User.create({
      name: "Blog Editor Test",
      email: "editor@test.com",
      phone: "9000000001",
      password: "Editor@123",
      role: "blog_editor",
    });
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "editor@test.com", password: "Editor@123" });
    const editorToken = loginRes.body.data?.token || loginRes.body.data?.accessToken;
    expect(editorToken).toBeTruthy();

    const editorAttempt = await request(app)
      .post(`/api/memberships/cancel/${testData.patient._id}`)
      .set(authHeader(editorToken))
      .send({ reason: "Blog editor should not be able to do this" });
    expect(editorAttempt.status).toBe(403);

    // A patient token must never reach these admin-only routes either --
    // patientProtect's cookie/header name differs, but authProtect only
    // trusts User-collection ids, so a patient id can't resolve to a User.
    const patientAttempt = await request(app)
      .post(`/api/memberships/pause/${testData.patient._id}`)
      .set(authHeader(patientToken()))
      .send({ reason: "Patient should never reach this admin route" });
    expect([401, 403]).toContain(patientAttempt.status);

    await User.deleteOne({ _id: editor._id });
  });
});
