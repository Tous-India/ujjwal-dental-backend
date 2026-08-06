/**
 * Backend permission enforcement (the real security fix).
 *
 * Phase 2 of the Permission Manager only gated the highest-risk DELETE
 * buttons; full create/edit gating was deferred to "Phase 3". The result was a
 * live, exploitable hole: staff granted VIEW-only could still EDIT and DELETE
 * by calling the API directly with their valid JWT. A hidden frontend button
 * stops nobody.
 *
 * These tests use a REAL staff account with a REAL JWT against the in-memory
 * test DB -- never real patient data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import User from "../../src/modules/users/user.model.js";
import Patient from "../../src/modules/patients/patient.model.js";
import Permission from "../../src/modules/permissions/permission.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";

const VIEW_ONLY = { view: true, create: false, edit: false, delete: false };

describe("Permission enforcement -- view-only staff cannot mutate", () => {
  let adminToken, staffToken, testPatient, testAppointment, testInvoice;
  const savedPerms = [];
  const STAFF_EMAIL = "viewonly.staff@test.com";
  const STAFF_PASS = "Staff@1234";

  beforeAll(async () => {
    adminToken = await getAdminToken(app);

    // Dedicated test staff account on the vestigial "user" role.
    await User.deleteOne({ email: STAFF_EMAIL });
    await User.create({
      name: "View Only Staff",
      email: STAFF_EMAIL,
      phone: "9000000123",
      password: STAFF_PASS,
      role: "user",
    });

    // Downgrade the "user" role to VIEW-ONLY on the modules under test.
    for (const mod of ["patients", "appointments", "billing", "treatments", "payments"]) {
      const existing = await Permission.findOne({ role: "user", module: mod });
      savedPerms.push({ mod, doc: existing ? existing.toObject() : null });
      await Permission.findOneAndUpdate(
        { role: "user", module: mod },
        { $set: VIEW_ONLY },
        { upsert: true }
      );
    }

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: STAFF_EMAIL, password: STAFF_PASS });
    staffToken = login.body.data?.token || login.body.data?.accessToken;
    expect(staffToken).toBeTruthy(); // real JWT from a real login

    // Dedicated TEST records -- never a real patient.
    testPatient = await Patient.create({
      name: "ZZ Permission Test Patient",
      phone: "9000000999",
      gender: "female",
      age: 30,
    });
    testAppointment = await Appointment.create({
      patient: testPatient._id,
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 86400000),
      timeSlot: "19:00",
      visitType: "opd",
      reason: "Perm test",
      opdFee: 300,
      fee: 300,
      isFree: false,
      opdFeePaid: false,
    });
    testInvoice = await Invoice.create({
      patient: testPatient._id,
      clinic: testData.clinic._id,
      items: [
        {
          itemType: "opd_fee",
          description: "OPD Consultation",
          quantity: 1,
          unitPrice: 300,
          discount: { percentage: 0, amount: 0 },
          taxRate: 0,
          amount: 300,
          taxAmount: 0,
          total: 300,
        },
      ],
      amountPaid: 0,
    });
  });

  afterAll(async () => {
    await User.deleteOne({ email: STAFF_EMAIL });
    await Patient.deleteOne({ _id: testPatient._id });
    await Appointment.deleteOne({ _id: testAppointment._id });
    await Invoice.deleteOne({ _id: testInvoice._id });
    for (const { mod, doc } of savedPerms) {
      if (doc) await Permission.findOneAndUpdate({ role: "user", module: mod }, { $set: doc });
      else await Permission.deleteOne({ role: "user", module: mod });
    }
  });

  it("T1: view-only staff CAN read a patient (200)", async () => {
    const res = await request(app)
      .get("/api/patients/" + testPatient._id)
      .set(authHeader(staffToken));
    expect(res.status).toBe(200);
  });

  it("T2: view-only staff CANNOT edit a patient (403), record genuinely unchanged", async () => {
    const before = await Patient.findById(testPatient._id).lean();

    const res = await request(app)
      .patch("/api/patients/" + testPatient._id)
      .set(authHeader(staffToken))
      .send({ name: "HACKED NAME" });

    expect(res.status).toBe(403);

    const after = await Patient.findById(testPatient._id).lean();
    expect(after.name).toBe(before.name);
    expect(after.name).not.toBe("HACKED NAME");
  });

  it("T3: view-only staff CANNOT delete a patient (403), record still exists", async () => {
    const res = await request(app)
      .delete("/api/patients/" + testPatient._id)
      .set(authHeader(staffToken));
    expect(res.status).toBe(403);

    const still = await Patient.findById(testPatient._id);
    expect(still).toBeTruthy();
    expect(still.isActive).not.toBe(false); // the soft-delete didn't fire either
  });

  it("T4a: appointments -- edit/status/delete all blocked (403), record unchanged", async () => {
    const before = await Appointment.findById(testAppointment._id).lean();

    const edit = await request(app)
      .patch("/api/appointments/" + testAppointment._id)
      .set(authHeader(staffToken))
      .send({ reason: "HACKED REASON" });
    expect(edit.status).toBe(403);

    const status = await request(app)
      .patch("/api/appointments/" + testAppointment._id + "/status")
      .set(authHeader(staffToken))
      .send({ status: "completed" });
    expect(status.status).toBe(403);

    const del = await request(app)
      .delete("/api/appointments/" + testAppointment._id)
      .set(authHeader(staffToken));
    expect(del.status).toBe(403);

    const after = await Appointment.findById(testAppointment._id).lean();
    expect(after).toBeTruthy();
    expect(after.reason).toBe(before.reason);
    expect(after.status).toBe(before.status);
  });

  it("T4b: billing -- create/edit/delete all blocked (403), invoice unchanged", async () => {
    const before = await Invoice.findById(testInvoice._id).lean();

    const create = await request(app)
      .post("/api/billing/invoices")
      .set(authHeader(staffToken))
      .send({
        patient: testPatient._id.toString(),
        clinic: testData.clinic._id.toString(),
        items: [{ itemType: "other", description: "X", unitPrice: 100, quantity: 1 }],
      });
    expect(create.status).toBe(403);

    const edit = await request(app)
      .patch("/api/billing/invoices/" + testInvoice._id)
      .set(authHeader(staffToken))
      .send({ notes: "HACKED" });
    expect(edit.status).toBe(403);

    const del = await request(app)
      .delete("/api/billing/invoices/" + testInvoice._id)
      .set(authHeader(staffToken));
    expect(del.status).toBe(403);

    const after = await Invoice.findById(testInvoice._id).lean();
    expect(after).toBeTruthy();
    expect(after.notes).toBe(before.notes);
  });

  it("T4c: treatments + payments -- mutations blocked (403), no money moved", async () => {
    const createTreat = await request(app)
      .post("/api/treatments")
      .set(authHeader(staffToken))
      .send({ patient: testPatient._id.toString(), name: "X" });
    expect(createTreat.status).toBe(403);

    const collect = await request(app)
      .post("/api/payments/admin/collect")
      .set(authHeader(staffToken))
      .send({ invoiceId: testInvoice._id.toString(), amount: 100, mode: "cash" });
    expect(collect.status).toBe(403);

    const after = await Invoice.findById(testInvoice._id).lean();
    expect(after.amountPaid).toBe(0);
  });

  it("T5: ADMIN can still edit normally -- no over-correction", async () => {
    const res = await request(app)
      .patch("/api/patients/" + testPatient._id)
      .set(authHeader(adminToken))
      .send({ name: "ZZ Permission Test Patient EDITED" });
    expect(res.status).toBe(200);

    const after = await Patient.findById(testPatient._id).lean();
    expect(after.name).toBe("ZZ Permission Test Patient EDITED");
  });

  it("T6: permissions management stays admin-only -- no privilege escalation", async () => {
    // View-only staff tries to grant themselves full patient access.
    const escalate = await request(app)
      .patch("/api/permissions/user/patients")
      .set(authHeader(staffToken))
      .send({ view: true, create: true, edit: true, delete: true });
    expect(escalate.status).toBe(403);

    // The matrix genuinely did NOT change.
    const perm = await Permission.findOne({ role: "user", module: "patients" });
    expect(perm.edit).toBe(false);
    expect(perm.delete).toBe(false);

    // And they still cannot edit afterwards.
    const retry = await request(app)
      .patch("/api/patients/" + testPatient._id)
      .set(authHeader(staffToken))
      .send({ name: "HACKED AGAIN" });
    expect(retry.status).toBe(403);

    // Admin CAN manage permissions.
    const asAdmin = await request(app)
      .patch("/api/permissions/user/patients")
      .set(authHeader(adminToken))
      .send({ view: true, create: false, edit: false, delete: false });
    expect(asAdmin.status).toBe(200);
  });
});
