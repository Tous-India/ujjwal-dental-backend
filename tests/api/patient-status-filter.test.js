/**
 * Patients list Status filter.
 *
 * "Status: All" only ever returned ACTIVE patients, so deactivated ones were
 * unreachable from the UI. There was no way to express "all": an absent param
 * fell through to a hardcoded isActive:true, and any value that wasn't the
 * literal string "true" was coerced to false -- so the page's "All" option
 * (isActive=all) actually evaluated to isActive:false.
 *
 * Counts here are asserted against REAL documents created for the test, and
 * cross-checked against direct DB queries rather than trusting the endpoint.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import Patient from "../../src/modules/patients/patient.model.js";

const TAG = "ZZStatusFilter";

describe("Patients Status filter", () => {
  let token;
  let activeIds = [];
  let inactiveIds = [];

  beforeAll(async () => {
    token = await getAdminToken(app);
    await Patient.deleteMany({ name: { $regex: `^${TAG}` } });

    const mk = async (name, isActive, phone) =>
      (await Patient.create({ name, phone, gender: "female", age: 30, isActive }))._id;

    activeIds = [
      await mk(`${TAG} Active One`, true, "9000031001"),
      await mk(`${TAG} Active Two`, true, "9000031002"),
      await mk(`${TAG} Active Three`, true, "9000031003"),
    ];
    inactiveIds = [
      await mk(`${TAG} Inactive One`, false, "9000031101"),
      await mk(`${TAG} Inactive Two`, false, "9000031102"),
    ];
  });

  afterAll(async () => {
    await Patient.deleteMany({ name: { $regex: `^${TAG}` } });
  });

  /** Query the endpoint, scoped by search so unrelated seed data can't skew counts. */
  const list = async (params = {}) => {
    const res = await request(app)
      .get("/api/patients")
      .set(authHeader(token))
      .query({ search: TAG, limit: 100, ...params });
    expect(res.status).toBe(200);
    return res.body.data;
  };

  it("T1 (HARD GATE): Status=All returns BOTH active and inactive, matching real DB counts", async () => {
    // Ground truth straight from the DB.
    const dbAll = await Patient.countDocuments({ name: { $regex: `^${TAG}` } });
    const dbActive = await Patient.countDocuments({ name: { $regex: `^${TAG}` }, isActive: true });
    const dbInactive = await Patient.countDocuments({ name: { $regex: `^${TAG}` }, isActive: false });
    expect(dbAll).toBe(5);
    expect(dbActive).toBe(3);
    expect(dbInactive).toBe(2);

    const rows = await list({ isActive: "all" });
    expect(rows).toHaveLength(dbAll); // 5, not 3

    const returnedActive = rows.filter((p) => p.isActive === true).length;
    const returnedInactive = rows.filter((p) => p.isActive === false).length;
    expect(returnedActive).toBe(dbActive);
    expect(returnedInactive).toBe(dbInactive);

    // Every inactive patient is genuinely present, by id.
    const ids = rows.map((p) => String(p._id));
    for (const id of inactiveIds) expect(ids).toContain(String(id));
  });

  it("T2 (HARD GATE): Status=Inactive returns ONLY inactive patients", async () => {
    const rows = await list({ isActive: "false" });
    expect(rows).toHaveLength(2);
    expect(rows.every((p) => p.isActive === false)).toBe(true);

    const ids = rows.map((p) => String(p._id));
    for (const id of inactiveIds) expect(ids).toContain(String(id));
    for (const id of activeIds) expect(ids).not.toContain(String(id));
  });

  it("T3: Status=Active returns only active (regression)", async () => {
    const rows = await list({ isActive: "true" });
    expect(rows).toHaveLength(3);
    expect(rows.every((p) => p.isActive === true)).toBe(true);
  });

  it("T3b: an ABSENT param still defaults to active-only -- the safe default is preserved", async () => {
    const rows = await list();
    expect(rows).toHaveLength(3);
    expect(rows.every((p) => p.isActive === true)).toBe(true);
  });

  it("T3c: an EMPTY param behaves like absent, not like 'inactive'", async () => {
    const rows = await list({ isActive: "" });
    expect(rows.every((p) => p.isActive === true)).toBe(true);
  });

  it("T5: the separate patient SEARCH endpoint still excludes deactivated patients", async () => {
    // Used by the booking, payment, invoice and lab-order dropdowns -- these
    // must never start offering deactivated patients.
    const res = await request(app)
      .get("/api/patients/search")
      .set(authHeader(token))
      .query({ q: TAG, limit: 50 });
    expect(res.status).toBe(200);

    const rows = res.body.data.patients || res.body.data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => p.isActive !== false)).toBe(true);

    const ids = rows.map((p) => String(p._id));
    for (const id of inactiveIds) expect(ids).not.toContain(String(id));
  });

  it("T4: the Membership filter genuinely filters (active / expired / none)", async () => {
    const withActive = await Patient.create({
      name: `${TAG} Member Active`, phone: "9000031201", gender: "female", age: 30,
      membership: { status: "active", planName: "Premium Dental Health Plan" },
    });
    const withExpired = await Patient.create({
      name: `${TAG} Member Expired`, phone: "9000031202", gender: "female", age: 30,
      membership: { status: "expired", planName: "Premium Dental Health Plan" },
    });

    const active = await list({ membership: "active" });
    expect(active.map((p) => String(p._id))).toContain(String(withActive._id));
    expect(active.map((p) => String(p._id))).not.toContain(String(withExpired._id));

    const expired = await list({ membership: "expired" });
    expect(expired.map((p) => String(p._id))).toContain(String(withExpired._id));
    expect(expired.map((p) => String(p._id))).not.toContain(String(withActive._id));

    // "none" must exclude both members but include the plain active patients.
    const none = await list({ membership: "none" });
    const noneIds = none.map((p) => String(p._id));
    expect(noneIds).not.toContain(String(withActive._id));
    expect(noneIds).not.toContain(String(withExpired._id));
    expect(noneIds).toContain(String(activeIds[0]));

    // Membership + Status=all compose correctly rather than overriding.
    const combo = await list({ membership: "active", isActive: "all" });
    expect(combo.map((p) => String(p._id))).toContain(String(withActive._id));
  });
});
