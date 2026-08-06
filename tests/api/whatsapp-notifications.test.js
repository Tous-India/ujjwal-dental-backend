import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Patient from "../../src/modules/patients/patient.model.js";

/**
 * WhatsApp dispatch infrastructure -- T1 (HARD GATE) + T2.
 *
 * WHATSAPP_ENABLED is unset in the test environment (tests/setup.js never
 * sets it), so sendWhatsApp() runs in stub mode: it logs
 * `[WhatsApp STUB] Would send "<templateType>" ...` and never makes a
 * network call. These tests exercise the REAL controller code paths (real
 * HTTP requests through supertest, real Mongo writes against the in-memory
 * DB) and assert two things per trigger point:
 *   1. The underlying action still succeeds (2xx, record actually created/
 *      updated in the DB) -- the notification attempt never blocks or
 *      breaks it.
 *   2. console.log was called with the stub's line for the right
 *      templateType, proving the hook actually fired.
 */
describe("WhatsApp notification dispatch (stubbed)", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  const stubCalls = (spy) =>
    spy.mock.calls.filter((args) => String(args[0]).startsWith("[WhatsApp STUB]"));

  it("T1 (HARD GATE): account_created fires on new patient creation (createPatient) without blocking the response", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await request(app)
        .post("/api/patients")
        .set(authHeader(token))
        .send({
          name: "WhatsApp Test Patient",
          phone: "8123456701",
          email: "whatsapp.patient@test.com",
          gender: "male",
        });

      expect(res.status).toBe(201);
      const patient = res.body.data.patient || res.body.data;
      expect(patient.phone).toBe("8123456701");

      // Real record actually created in the DB (not blocked/broken by the hook).
      const fresh = await Patient.findOne({ phone: "8123456701" });
      expect(fresh).toBeTruthy();

      const calls = stubCalls(logSpy);
      const match = calls.find(
        (args) => args[0].includes('"account_created"') && args[0].includes("8123456701")
      );
      expect(match).toBeTruthy();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("T1 (HARD GATE): membership_purchased + payment_recorded fire on assignManualMembership without blocking the response", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await request(app)
        .post("/api/memberships/assign-manual")
        .set(authHeader(token))
        .send({
          patientId: testData.patient._id.toString(),
          planName: "WhatsApp Test Gold Plan",
          amountPaid: 1500,
          paymentMethod: "cash",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Real membership actually persisted.
      const fresh = await Patient.findById(testData.patient._id);
      expect(fresh.membership.planName).toBe("WhatsApp Test Gold Plan");
      expect(fresh.membership.status).toBe("active");

      const calls = stubCalls(logSpy);
      const membershipMatch = calls.find((args) => args[0].includes('"membership_purchased"'));
      const paymentMatch = calls.find((args) => args[0].includes('"payment_recorded"'));
      expect(membershipMatch).toBeTruthy();
      expect(paymentMatch).toBeTruthy();

      // Reset for the next test (cancel so hasMembership doesn't block other suites).
      await Patient.findByIdAndUpdate(testData.patient._id, {
        $set: { "membership.status": "cancelled" },
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("T1 (HARD GATE): payment_recorded fires on collectPayment without blocking the response", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const invoice = await Invoice.create({
        patient: testData.patient._id,
        clinic: testData.clinic._id,
        items: [
          {
            itemType: "treatment",
            description: "Whitening",
            quantity: 1,
            unitPrice: 4000,
            amount: 4000,
            total: 4000,
          },
        ],
        amountPaid: 0,
      });

      const res = await request(app)
        .post("/api/payments/admin/collect")
        .set(authHeader(token))
        .send({ invoiceId: invoice._id, amount: 4000, mode: "cash" });

      expect(res.status).toBe(200);

      // Real payment + invoice update actually persisted.
      const updatedInvoice = await Invoice.findById(invoice._id).lean();
      expect(updatedInvoice.amountPaid).toBe(4000);

      // collectPayment resolves the patient's phone via a fire-and-forget async
      // lookup (invoice.patient is only an ObjectId at that call site) -- give
      // the microtask queue a tick to let it run before asserting on the spy.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const calls = stubCalls(logSpy);
      const match = calls.find((args) => args[0].includes('"payment_recorded"'));
      expect(match).toBeTruthy();

      await Invoice.deleteOne({ _id: invoice._id });
    } finally {
      logSpy.mockRestore();
    }
  });

  // Sessions now fire session_booked_free, NOT the old amount-bearing
  // session_booked. Sessions are always free at booking (the parent
  // treatment's invoice covers them), so the old template could never
  // legitimately fill its amount variable -- which is why sessions were silent.
  it("T1 (HARD GATE): session_booked_free fires when a treatment_session appointment is booked via POST /api/appointments", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split("T")[0];

      // A treatment appointment must reference the OPD visit it originated
      // from (mandatory field, unrelated to this feature -- see
      // treatment-phase1.test.js for the same setup pattern).
      const originatingOpd = await Appointment.create({
        patient: testData.patient._id,
        clinic: testData.clinic._id,
        date: new Date(),
        timeSlot: "08:00",
        visitType: "opd",
        fee: 300,
        reason: "Initial consult",
      });

      const parentRes = await request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          clinic: testData.clinic._id.toString(),
          date: tomorrowStr,
          timeSlot: "09:00",
          phone: testData.patient.phone,
          patientId: testData.patient._id.toString(),
          reason: "Root canal",
          visitType: "treatment",
          treatmentId: "other",
          treatmentName: "Root Canal",
          fee: 5000,
          originatingOpdAppointmentId: String(originatingOpd._id),
        });
      expect(parentRes.status).toBe(201);
      const parentId = parentRes.body.data.appointmentId;

      const sessionRes = await request(app)
        .post("/api/appointments")
        .set(authHeader(token))
        .send({
          clinic: testData.clinic._id.toString(),
          date: tomorrowStr,
          timeSlot: "09:30",
          phone: testData.patient.phone,
          patientId: testData.patient._id.toString(),
          reason: "Root canal session 2",
          visitType: "treatment_session",
          parentAppointment: parentId,
        });

      expect(sessionRes.status).toBe(201);
      const sessionId = sessionRes.body.data._id;
      expect(sessionId).toBeTruthy();

      // Real session appointment actually persisted.
      const freshSession = await Appointment.findById(sessionId).lean();
      expect(freshSession.visitType).toBe("treatment_session");

      const calls = stubCalls(logSpy);
      const match = calls.find(
        (args) => args[0].includes('"session_booked_free"') && args[0].includes(testData.patient.phone)
      );
      expect(match).toBeTruthy();

      await Appointment.deleteMany({ _id: { $in: [parentId, sessionId, originatingOpd._id] } });
      await Invoice.deleteMany({ patient: testData.patient._id });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("T2: the WhatsApp dispatch attempt does not meaningfully slow down the request", async () => {
    const start = Date.now();
    const res = await request(app)
      .post("/api/patients")
      .set(authHeader(token))
      .send({
        name: "Latency Check Patient",
        phone: "8123456702",
        gender: "female",
      });
    const elapsedMs = Date.now() - start;

    expect(res.status).toBe(201);
    // Generous ceiling for an in-memory-Mongo test request; the point is that
    // fireWhatsApp() is a synchronous, non-awaited kick-off in stub mode, not
    // a network round trip, so this should be fast.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
