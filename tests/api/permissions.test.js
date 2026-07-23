import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import Permission from "../../src/modules/permissions/permission.model.js";
import { checkPermission } from "../../src/middlewares/permission.middleware.js";

describe("Permission Manager Phase 1", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
    // clinic_manager+staff (all false) and clinic_manager+billing (all true)
    // already exist from the global seedTestData() Permission seed -- no
    // need to create them again here.
  });

  it("T2 (HARD GATE): checkPermission middleware allows/denies correctly in isolation (not wired to any route)", async () => {
    const allowed = checkPermission("billing", "view");
    const denied = checkPermission("staff", "view");

    let nextCalled = false;
    let statusCode = null;
    const mockRes = () => ({
      status(c) { statusCode = c; return this; },
      json(p) { this.body = p; },
    });

    // Allowed case
    nextCalled = false;
    await allowed({ user: { role: "clinic_manager" } }, mockRes(), () => { nextCalled = true; });
    expect(nextCalled).toBe(true);

    // Denied case
    nextCalled = false;
    statusCode = null;
    const res2 = mockRes();
    await denied({ user: { role: "clinic_manager" } }, res2, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(403);

    // No req.user at all
    statusCode = null;
    const res3 = mockRes();
    await allowed({ user: undefined }, res3, () => {});
    expect(statusCode).toBe(401);

    // No matching Permission document at all (unknown role/module combo)
    const unknownCheck = checkPermission("nonexistent_module", "view");
    statusCode = null;
    const res4 = mockRes();
    await unknownCheck({ user: { role: "clinic_manager" } }, res4, () => {});
    expect(statusCode).toBe(403);
  });

  it("T3: GET /permissions returns the full matrix, admin-only", async () => {
    const res = await request(app).get("/api/permissions").set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.permissions)).toBe(true);
    expect(res.body.data.permissions.length).toBeGreaterThan(0);

    const unauth = await request(app).get("/api/permissions");
    expect(unauth.status).toBe(401);
  });

  it("T3: PATCH /permissions/:role/:module updates one role+module correctly", async () => {
    const res = await request(app)
      .patch("/api/permissions/clinic_manager/billing")
      .set(authHeader(token))
      .send({ delete: false });

    expect(res.status).toBe(200);
    expect(res.body.data.permission.delete).toBe(false);
    // Untouched fields preserved.
    expect(res.body.data.permission.view).toBe(true);
    expect(res.body.data.permission.create).toBe(true);

    const stored = await Permission.findOne({ role: "clinic_manager", module: "billing" }).lean();
    expect(stored.delete).toBe(false);
  });

});
