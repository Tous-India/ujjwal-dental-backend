/**
 * COMPREHENSIVE END-TO-END REGRESSION SWEEP
 *
 * Composition testing: every piece below was tested in isolation as it was
 * built. This exercises them TOGETHER, which is where the remaining risk is.
 *
 * Runs through the real API surface (real routes -> real controllers -> real
 * models) against the ephemeral in-memory DB. Deliberately NOT against
 * production: creating dozens of appointments there would collide with real
 * slot capacity, and with WhatsApp enabled, test patients carrying invented
 * phone numbers would send real messages to strangers.
 *
 * All records are prefixed ZZTEST- and removed in cleanup.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Patient from "../../src/modules/patients/patient.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";
import User from "../../src/modules/users/user.model.js";
import Permission from "../../src/modules/permissions/permission.model.js";

const TAG = "ZZTEST-";
const findings = [];
const note = (scenario, msg) => {
  findings.push(`[${scenario}] ${msg}`);
  console.log(`\n*** FINDING ${scenario}: ${msg}\n`);
};

/** Baseline counts, so cleanup can prove it removed only test data. */
const baseline = {};

describe("ZZ Comprehensive regression sweep", () => {
  let token;
  let patientA, patientB;

  beforeAll(async () => {
    token = await getAdminToken(app);
    for (const [k, M] of Object.entries({
      patients: Patient, appointments: Appointment,
      invoices: Invoice, payments: Payment, users: User,
    })) {
      baseline[k] = await M.countDocuments();
    }
  });

  afterAll(async () => {
    // ---- MANDATORY CLEANUP ----
    const testPatients = await Patient.find({ name: { $regex: `^${TAG}` } }).select("_id");
    const ids = testPatients.map((p) => p._id);

    await Payment.deleteMany({ patient: { $in: ids } });
    await Invoice.deleteMany({ patient: { $in: ids } });
    await Appointment.deleteMany({ patient: { $in: ids } });
    await Patient.deleteMany({ _id: { $in: ids } });
    await User.deleteMany({ name: { $regex: `^${TAG}` } });

    const after = {};
    for (const [k, M] of Object.entries({
      patients: Patient, appointments: Appointment,
      invoices: Invoice, payments: Payment, users: User,
    })) {
      after[k] = await M.countDocuments();
    }

    console.log("\n================ CLEANUP VERIFICATION ================");
    for (const k of Object.keys(baseline)) {
      const ok = after[k] === baseline[k];
      console.log(`${k}: baseline ${baseline[k]} -> after ${after[k]}  ${ok ? "OK" : "MISMATCH"}`);
    }
    const leftovers = await Patient.countDocuments({ name: { $regex: `^${TAG}` } });
    console.log(`ZZTEST- patients remaining: ${leftovers}`);

    console.log("\n================ FINDINGS ================");
    if (!findings.length) console.log("(none)");
    findings.forEach((f) => console.log(" - " + f));
    console.log("==========================================\n");
  });

  const mkPatient = async (suffix, phone) => {
    const res = await request(app).post("/api/patients").set(authHeader(token)).send({
      name: `${TAG}Patient ${suffix}`, phone, gender: "female", age: 33,
    });
    expect(res.status).toBe(201);
    return res.body.data.patient || res.body.data;
  };

  const book = (over = {}) =>
    request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 86400000).toISOString(),
      phone: over.phone, patientId: over.patientId,
      reason: "ZZTEST checkup", visitType: "opd",
      ...over,
    });

  // ================= SCENARIO 1 =================
  it("S1: appointment number's HHMM matches current IST within 1 minute", async () => {
    patientA = await mkPatient("A", "9000070001");
    const res = await book({
      patientId: patientA._id, phone: patientA.phone, timeSlot: "10:00", opdFee: 300,
    });
    expect(res.status).toBe(201);

    const num = res.body.data.appointmentNumber; // e.g. UD-2608-1201
    const hhmm = num.split("-").pop();

    // Normalise to IST regardless of the host timezone. (An earlier version of
    // this test double-counted the offset on an IST host and mis-reported a
    // 330-minute drift -- the app was correct.)
    const istMs = Date.now() + (330 + new Date().getTimezoneOffset()) * 60000;
    const ist = new Date(istMs);
    const expected =
      String(ist.getHours()).padStart(2, "0") + String(ist.getMinutes()).padStart(2, "0");

    const diff = Math.abs(
      (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2))) -
      (Number(expected.slice(0, 2)) * 60 + Number(expected.slice(2)))
    );
    console.log(`S1: appointmentNumber=${num} hhmm=${hhmm} expectedIST=${expected} diffMin=${diff}`);
    if (diff > 1) note("S1", `appointment number HHMM ${hhmm} is ${diff} min from IST ${expected}`);
    expect(diff).toBeLessThanOrEqual(1);
  });

  // ================= SCENARIO 2 =================
  it("S2: OPD lifecycle -- quick-add, 4h gap rule, collect, consistency, completion gating, WhatsApp payload", async () => {
    // (a) quick-add stores AGE, and does not invent a DOB
    const fresh = await Patient.findById(patientA._id);
    expect(fresh.age).toBe(33);
    if (fresh.dateOfBirth) note("S2", "quick-add invented a dateOfBirth from age");
    expect(fresh.dateOfBirth).toBeFalsy();

    // (b) 4-hour gap rule -- a second OPD close to the first must be blocked
    const sameDay = new Date(Date.now() + 86400000).toISOString();
    const second = await book({
      patientId: patientA._id, phone: patientA.phone, date: sameDay, timeSlot: "11:00", opdFee: 300,
    });
    console.log(`S2 gap-rule second booking -> ${second.status}: ${second.body.message}`);
    if (second.status === 201) note("S2", "4-hour gap rule did NOT block a second OPD 1h later");
    expect(second.status).not.toBe(201);

    // (c) collect payment (cash) against the first appointment's invoice
    const first = await Appointment.findOne({ patient: patientA._id }).sort({ createdAt: 1 });
    expect(first.invoice).toBeTruthy();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const collect = await request(app).post("/api/payments/admin/collect")
      .set(authHeader(token))
      .send({ invoiceId: String(first.invoice), amount: 300, mode: "cash" });
    await new Promise((r) => setTimeout(r, 150));
    const waCalls = logSpy.mock.calls.filter((a) => String(a[0]).includes("payment_recorded"));
    logSpy.mockRestore();

    expect(collect.status).toBe(200);

    // (d) a real Payment doc exists
    const payments = await Payment.find({ patient: patientA._id });
    expect(payments.length).toBeGreaterThanOrEqual(1);
    expect(payments[0].amount).toBe(300);

    // (e) WhatsApp payload: real name, meaningful description, not an invoice number
    if (!waCalls.length) {
      note("S2", "no payment_recorded WhatsApp dispatch observed on collect");
    } else {
      const data = waCalls[0][1];
      console.log("S2 payment_recorded payload:", JSON.stringify(data));
      expect(data.description).not.toMatch(/INV-\d/i);
      expect(data.description).not.toMatch(/^invoice\b/i);
      expect(String(waCalls[0][0])).toContain(patientA.name); // contact_name is the patient
    }

    // (f) consistency: invoice vs billing stats vs patient portal
    const inv = await Invoice.findById(first.invoice);
    expect(inv.amountPaid).toBe(300);
    expect(inv.balanceDue).toBe(0);
    expect(inv.paymentStatus).toBe("paid");

    // (g) mark completed, then confirm edit is refused
    // The state machine requires scheduled -> in_progress -> completed; jumping
    // straight to completed is correctly rejected.
    // The state machine enforces the full chain:
    // scheduled -> confirmed -> checked_in -> in_progress -> completed.
    // Skipping a step is correctly rejected with 400.
    for (const step of ["confirmed", "checked_in", "in_progress", "completed"]) {
      const r = await request(app)
        .patch(`/api/appointments/${first._id}/status`)
        .set(authHeader(token)).send({ status: step });
      expect(r.status, `transition to ${step}`).toBe(200);
    }
    expect((await Appointment.findById(first._id)).status).toBe("completed");
    expect((await Appointment.findById(first._id)).status).toBe("completed");
    const editAfter = await request(app).patch(`/api/appointments/${first._id}`)
      .set(authHeader(token)).send({ paymentMethod: "upi" });
    console.log(`S2 edit-after-complete -> ${editAfter.status}: ${editAfter.body.message}`);
    if (editAfter.status === 200) note("S2", "payment method still editable AFTER completion");
    expect(editAfter.status).toBe(400);
  });

  // ================= SCENARIO 4 (financial) =================
  it("S4: billing totals reconcile exactly, and a voided invoice is excluded everywhere", async () => {
    patientB = await mkPatient("B", "9000070002");

    // Two invoices: one paid, one partially paid.
    const a1 = await book({ patientId: patientB._id, phone: patientB.phone, timeSlot: "09:00", opdFee: 500 });
    expect(a1.status).toBe(201);
    await request(app).post("/api/payments/admin/collect").set(authHeader(token))
      .send({ invoiceId: a1.body.data.invoiceId, amount: 200, mode: "cash" });

    const stats = await request(app).get("/api/billing/stats").set(authHeader(token));
    expect(stats.status).toBe(200);
    const s = stats.body.data;
    console.log("S4 billing stats:", JSON.stringify({
      totalAmount: s.totalAmount, totalPaid: s.totalPaid, totalDue: s.totalDue,
    }));

    // The invariant that keeps breaking: per-invoice clamped, never naive.
    const drift = Math.abs((s.totalAmount - s.totalPaid) - s.totalDue);
    if (drift > 0.01) {
      note("S4", `Billing totals do not reconcile: amount ${s.totalAmount} - paid ${s.totalPaid} != due ${s.totalDue} (drift ${drift})`);
    }

    // Void the invoice -> excluded from totals.
    const beforeVoid = await request(app).get("/api/billing/stats").set(authHeader(token));
    const voided = await request(app)
      .post(`/api/billing/invoices/${a1.body.data.invoiceId}/void`)
      .set(authHeader(token)).send({ reason: "ZZTEST void" });
    console.log(`S4 void -> ${voided.status}`);

    if (voided.status === 200) {
      const afterVoid = await request(app).get("/api/billing/stats").set(authHeader(token));
      console.log("S4 totals before void:", beforeVoid.body.data.totalAmount,
        "| after:", afterVoid.body.data.totalAmount);
      if (afterVoid.body.data.totalAmount >= beforeVoid.body.data.totalAmount) {
        note("S4", "voided invoice still counted in billing totals");
      }

      // And it must not appear in the active list.
      const list = await request(app).get("/api/billing/invoices")
        .set(authHeader(token)).query({ patient: String(patientB._id), limit: 50 });
      const ids = (list.body.data || []).map((i) => String(i._id));
      if (ids.includes(String(a1.body.data.invoiceId))) {
        note("S4", "voided invoice still listed in the default Billing view");
      }
    } else {
      note("S4", `could not void invoice (${voided.status}: ${voided.body.message}) -- void exclusion unverified`);
    }
  });

  // ================= SCENARIO 3 (treatment) =================
  it("S3: treatment lifecycle -- OPD link, session 2, per-session payment, mid-procedure fee edit, overpaid edge, complete/reopen", async () => {
    const p = await mkPatient("C", "9000070003");

    // Parent treatment requires an originating OPD visit.
    const opd = await Appointment.create({
      patient: p._id, clinic: testData.clinic._id, date: new Date(), timeSlot: "09:00",
      visitType: "opd", reason: "ZZTEST", opdFee: 300, fee: 300, isFree: false,
      opdFeePaid: true, paymentMethod: "cash", paymentStatus: "paid",
    });

    const noLink = await book({
      patientId: p._id, phone: p.phone, timeSlot: "11:00", visitType: "treatment",
      treatmentId: "other", treatmentName: "ZZTEST Root Canal", fee: 9000,
      items: [{ description: "ZZTEST Root Canal", unitPrice: 9000, itemType: "treatment" }],
      paymentMethod: "cash", opdFeePaid: true, amountPaid: 3000, sessionsPlanned: 3,
    });
    if (noLink.status === 201) {
      note("S3", "treatment booked WITHOUT the mandatory originating OPD link");
    }

    const parent = await book({
      patientId: p._id, phone: p.phone, timeSlot: "13:00", visitType: "treatment",
      treatmentId: "other", treatmentName: "ZZTEST Root Canal", fee: 9000,
      originatingOpdAppointmentId: String(opd._id),
      items: [{ description: "ZZTEST Root Canal", unitPrice: 9000, itemType: "treatment" }],
      paymentMethod: "cash", opdFeePaid: true, amountPaid: 3000, sessionsPlanned: 3,
    });
    expect(parent.status).toBe(201);
    const parentId = parent.body.data.appointmentId;
    const invoiceId = parent.body.data.invoiceId;

    let inv = await Invoice.findById(invoiceId);
    expect(inv.grandTotal).toBe(9000);
    expect(inv.amountPaid).toBe(3000);

    // Session 2
    const s2 = await book({
      patientId: p._id, phone: p.phone, date: new Date(Date.now() + 5 * 86400000).toISOString(),
      timeSlot: "15:00", visitType: "treatment_session", parentAppointment: parentId,
      reason: "ZZTEST session 2",
    });
    expect(s2.status).toBe(201);
    const session2Id = s2.body.data._id;

    // Post-hoc per-session collection, attributed to THIS session
    const coll = await request(app).post("/api/payments/admin/collect").set(authHeader(token))
      .send({ invoiceId: String(invoiceId), amount: 2000, mode: "cash", appointmentId: session2Id });
    expect(coll.status).toBe(200);

    const sessionPayment = await Payment.findOne({ appointment: session2Id });
    if (!sessionPayment) note("S3", "per-session payment was not attributed to the session appointment");
    else {
      expect(sessionPayment.amount).toBe(2000); // the session's own amount, NOT cumulative 5000
      if (sessionPayment.amount === 5000) note("S3", "per-session amount is CUMULATIVE, not per-session");
    }

    // Mid-procedure fee edit with sessions delivered AND payment collected
    inv = await Invoice.findById(invoiceId);
    const paidBefore = inv.amountPaid; // 5000
    const edit = await request(app).patch(`/api/appointments/${parentId}/treatment-items`)
      .set(authHeader(token))
      .send({ items: [{ description: "ZZTEST Root Canal", unitPrice: 7000, itemType: "treatment" }] });
    console.log(`S3 mid-procedure fee edit -> ${edit.status}`);
    expect(edit.status).toBe(200);

    inv = await Invoice.findById(invoiceId);
    console.log(`S3 after edit: grandTotal=${inv.grandTotal} amountPaid=${inv.amountPaid} balanceDue=${inv.balanceDue}`);
    if (inv.amountPaid !== paidBefore) {
      note("S3", `fee edit MUTATED amountPaid: ${paidBefore} -> ${inv.amountPaid} (money already collected must never change)`);
    }
    expect(inv.grandTotal).toBe(7000);

    // Overpaid edge: drop the fee BELOW what's already been paid
    const over = await request(app).patch(`/api/appointments/${parentId}/treatment-items`)
      .set(authHeader(token))
      .send({ items: [{ description: "ZZTEST Root Canal", unitPrice: 1000, itemType: "treatment" }] });
    console.log(`S3 overpaid edit -> ${over.status}: ${over.body.message}`);
    inv = await Invoice.findById(invoiceId);
    console.log(`S3 overpaid state: grandTotal=${inv.grandTotal} amountPaid=${inv.amountPaid} balanceDue=${inv.balanceDue}`);
    if (inv.balanceDue < 0) {
      note("S3", `overpaid invoice produced a NEGATIVE balanceDue (${inv.balanceDue}) instead of clamping to 0`);
    }

    // Complete -> Active Treatments must exclude it
    const close = await request(app).post(`/api/appointments/${parentId}/close-treatment`)
      .set(authHeader(token)).send({ resolution: "completed", reason: "ZZTEST complete" });
    console.log(`S3 close-treatment -> ${close.status}`);
    expect(close.status).toBe(200);

    let ctx = await request(app).get(`/api/patients/${p._id}/active-context`).set(authHeader(token));
    let activeIds = (ctx.body.data?.activeTreatments || []).map((t) => String(t.parentAppointmentId));
    if (activeIds.includes(String(parentId))) {
      note("S3", "completed treatment STILL appears in the Active Treatments banner");
    }

    // Reopen -> reappears, history preserved
    const reopen = await request(app).post(`/api/appointments/${parentId}/reopen-treatment`)
      .set(authHeader(token)).send({ reason: "ZZTEST reopen" });
    console.log(`S3 reopen -> ${reopen.status}`);
    expect(reopen.status).toBe(200);

    ctx = await request(app).get(`/api/patients/${p._id}/active-context`).set(authHeader(token));
    activeIds = (ctx.body.data?.activeTreatments || []).map((t) => String(t.parentAppointmentId));
    if (!activeIds.includes(String(parentId))) {
      note("S3", "reopened treatment did NOT reappear in the Active Treatments banner");
    }

    const reopened = await Appointment.findById(parentId);
    expect(reopened.treatmentStatus).toBeFalsy();
    if (!reopened.treatmentHistory?.length && !reopened.statusHistory?.length) {
      note("S3", "no audit history preserved across close/reopen");
    }
  });

  // ================= SCENARIO 5 =================
  it("S5: the same record returns identical data from the main list and the patient-scoped view", async () => {
    const appts = await Appointment.find({ patient: patientA._id }).limit(2);
    expect(appts.length).toBeGreaterThan(0);

    for (const a of appts) {
      const direct = await request(app).get(`/api/appointments/${a._id}`).set(authHeader(token));
      const viaPatient = await request(app)
        .get(`/api/patients/${patientA._id}/appointments`).set(authHeader(token));

      expect(direct.status).toBe(200);
      const d = direct.body.data.appointment || direct.body.data;
      const list = viaPatient.body.data?.appointments || viaPatient.body.data || [];
      const match = list.find((x) => String(x._id) === String(a._id));

      if (!match) {
        note("S5", `appointment ${a.appointmentNumber} missing from the patient-scoped list`);
        continue;
      }
      // The fields that actually broke before: fee and patient identity.
      const dFee = d.invoice?.grandTotal ?? d.fee ?? d.opdFee;
      const mFee = match.invoice?.grandTotal ?? match.fee ?? match.opdFee;
      console.log(`S5 ${a.appointmentNumber}: direct fee=${dFee} viaPatient fee=${mFee}`);
      if (dFee !== mFee) {
        note("S5", `${a.appointmentNumber} fee differs by entry point: direct ${dFee} vs patient-tab ${mFee}`);
      }
      if (String(d.appointmentNumber) !== String(match.appointmentNumber)) {
        note("S5", `${a.appointmentNumber} appointmentNumber differs by entry point`);
      }
    }
  });

  // ================= SCENARIO 7 (security) =================
  it("S7: view-only staff cannot mutate across 4 modules; admin unaffected; no escalation", async () => {
    const EMAIL = "zztest.viewonly@test.com";
    await User.deleteOne({ email: EMAIL });
    await User.create({
      name: `${TAG}ViewOnly`, email: EMAIL, phone: "9000070900",
      password: "Staff@1234", role: "user",
    });

    const saved = [];
    for (const mod of ["patients", "appointments", "billing", "payments"]) {
      const existing = await Permission.findOne({ role: "user", module: mod });
      saved.push({ mod, doc: existing ? existing.toObject() : null });
      await Permission.findOneAndUpdate(
        { role: "user", module: mod },
        { $set: { view: true, create: false, edit: false, delete: false } },
        { upsert: true }
      );
    }

    const login = await request(app).post("/api/auth/login")
      .send({ email: EMAIL, password: "Staff@1234" });
    const staffToken = login.body.data?.token;
    expect(staffToken).toBeTruthy();

    const target = await Appointment.findOne({ patient: patientA._id });
    const nameBefore = (await Patient.findById(patientA._id)).name;

    const attempts = [
      ["patients edit", request(app).patch(`/api/patients/${patientA._id}`).send({ name: "ZZHACKED" })],
      ["patients delete", request(app).delete(`/api/patients/${patientA._id}`)],
      ["appointments edit", request(app).patch(`/api/appointments/${target._id}`).send({ reason: "ZZHACKED" })],
      ["appointments delete", request(app).delete(`/api/appointments/${target._id}`)],
      ["billing create", request(app).post("/api/billing/invoices").send({ patient: String(patientA._id), clinic: String(testData.clinic._id), items: [] })],
      ["payments collect", request(app).post("/api/payments/admin/collect").send({ invoiceId: String(target.invoice), amount: 1, mode: "cash" })],
    ];

    for (const [label, req] of attempts) {
      const res = await req.set(authHeader(staffToken));
      console.log(`S7 ${label} -> ${res.status}`);
      if (res.status !== 403) note("S7", `${label} returned ${res.status}, expected 403`);
    }

    // Records genuinely unchanged
    const nameAfter = (await Patient.findById(patientA._id)).name;
    if (nameAfter !== nameBefore) note("S7", "patient name was MODIFIED by a view-only account");
    expect(nameAfter).toBe(nameBefore);
    expect(await Appointment.findById(target._id)).toBeTruthy();

    // No privilege escalation
    const esc = await request(app).patch("/api/permissions/user/patients")
      .set(authHeader(staffToken)).send({ view: true, create: true, edit: true, delete: true });
    console.log(`S7 self-grant permissions -> ${esc.status}`);
    if (esc.status !== 403) note("S7", `PRIVILEGE ESCALATION: self-grant returned ${esc.status}`);

    // Admin still works
    const adminEdit = await request(app).patch(`/api/patients/${patientA._id}`)
      .set(authHeader(token)).send({ address: { city: "ZZTESTCITY" } });
    if (adminEdit.status !== 200) note("S7", `admin edit broken by permission changes (${adminEdit.status})`);

    // restore
    for (const { mod, doc } of saved) {
      if (doc) await Permission.findOneAndUpdate({ role: "user", module: mod }, { $set: doc });
      else await Permission.deleteOne({ role: "user", module: mod });
    }
  });

  // ================= SCENARIO 8 =================
  it("S8: admin can backdate 5 days at a non-aligned time; patient booking still blocks past dates", async () => {
    const p = await mkPatient("D", "9000070004");
    const past = new Date(Date.now() - 5 * 86400000).toISOString();

    const res = await book({
      patientId: p._id, phone: p.phone, date: past, timeSlot: "15:37", opdFee: 300,
    });
    console.log(`S8 backdated 5d @15:37 -> ${res.status}: ${res.body.message || "ok"}`);
    if (res.status !== 201) note("S8", `admin backdating failed (${res.status}: ${res.body.message})`);

    // Slots must still be listed for a backdated date (admin view)
    const slots = await request(app).get("/api/appointments/available-slots")
      .set(authHeader(token))
      .query({ clinic: String(testData.clinic._id), date: past.slice(0, 10) });
    console.log(`S8 available-slots for a past date -> ${slots.status}, count=${(slots.body.data?.availableSlots || []).length}`);
    if (slots.status === 200 && (slots.body.data?.availableSlots || []).length === 0) {
      note("S8", "no slots returned for a backdated date -- admin cannot pick a time");
    }
  });

  // ================= SCENARIO 9 =================
  it("S9: a multi-file report creates ONE document with all files; WhatsApp payloads are well formed", async () => {
    const p = await mkPatient("E", "9000070005");
    const cloud = process.env.CLOUDINARY_CLOUD_NAME || "test-cloud";
    process.env.CLOUDINARY_CLOUD_NAME = cloud;

    const files = [1, 2, 3].map((i) => ({
      url: `https://res.cloudinary.com/${cloud}/image/upload/v1/ujjwal-dental/zz${i}.jpg`,
      publicId: `ujjwal-dental/zz${i}`,
      fileName: `zz${i}.jpg`, fileSize: 5 * 1024 * 1024, fileType: "image/jpeg",
      description: `ZZTEST file ${i}`,
    }));

    const res = await request(app).post("/api/reports").set(authHeader(token)).send({
      patient: String(p._id), title: `${TAG}Multi report`, category: "xray", files,
    });
    console.log(`S9 multi-file report -> ${res.status}`);
    expect(res.status).toBe(201);

    const Report = (await import("../../src/modules/reports/report.model.js")).default;
    const reports = await Report.find({ patient: p._id });
    if (reports.length !== 1) note("S9", `multi-file upload created ${reports.length} Report docs, expected 1`);
    expect(reports).toHaveLength(1);
    expect(reports[0].files).toHaveLength(3);
    expect(reports[0].files.map((f) => f.description)).toEqual([
      "ZZTEST file 1", "ZZTEST file 2", "ZZTEST file 3",
    ]);
    expect(reports[0].files[0].fileType).toBe("image/jpeg");

    await Report.deleteMany({ patient: p._id });

    // WhatsApp payload shapes for every template type
    process.env.WHATSAPP_ENABLED = "true";
    process.env.TOUS_CONNECT_API_KEY = "zztest";
    vi.resetModules();
    const savedFetch = global.fetch;
    const sent = [];
    global.fetch = async (_u, o) => {
      sent.push(JSON.parse(o.body));
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    };
    try {
      const { sendWhatsApp } = await import("../../src/utils/whatsapp.js");
      const cases = [
        ["account_created", {}, 0],
        ["patient_login_otp", { otp: "123456" }, 1],
        ["payment_recorded", { amount: 300, description: "OPD Consultation", invoiceNumber: "INV-1" }, 4],
        ["appointment_booked_free", { date: "07/08/2026", time: "10:00", clinic: "Sonipat" }, 3],
        ["session_booked_free", { treatmentName: "Root Canal", date: "07/08/2026", time: "10:00" }, 3],
        ["membership_purchased", { planName: "Premium", validUntil: "2027-08-07" }, 2],
      ];
      for (const [type, data, expectedParams] of cases) {
        sent.length = 0;
        await sendWhatsApp("9000070005", type, data, `${TAG}Patient E`);
        const body = sent[0];
        const bodyComp = body.template_components.find((c) => c.type === "body");
        const count = bodyComp ? bodyComp.parameters.length : 0;
        console.log(`S9 ${type}: params=${count} (expected ${expectedParams}) contact_name=${body.contact_name}`);
        if (count !== expectedParams) {
          note("S9", `${type} sent ${count} body params, expected ${expectedParams}`);
        }
        if (body.contact_name !== `${TAG}Patient E`) {
          note("S9", `${type} contact_name wrong: ${body.contact_name}`);
        }
        for (const prm of bodyComp?.parameters || []) {
          if (prm.text === "") note("S9", `${type} has an EMPTY body param (Meta rejects these)`);
        }
        if (type === "patient_login_otp") {
          const btn = body.template_components.find((c) => c.type === "button");
          if (!btn) note("S9", "patient_login_otp missing the required authentication button component");
        }
      }
    } finally {
      global.fetch = savedFetch;
      delete process.env.WHATSAPP_ENABLED;
      vi.resetModules();
    }
  });
});
