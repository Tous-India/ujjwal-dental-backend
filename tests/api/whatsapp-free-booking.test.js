/**
 * Amount-free booking confirmations: appointment_booked_free / session_booked_free.
 *
 * Free appointments and treatment sessions were completely silent: every
 * booking-related template embedded a payment amount, and a free booking has
 * no amount to fill, so no template could legally be sent.
 *
 * Two layers here, because they prove different things:
 *
 *  1. PAYLOAD tests -- WHATSAPP_ENABLED is forced to "true" and global.fetch
 *     is mocked, so we capture the EXACT JSON body that would hit Tous
 *     Connect. This is what verifies parameter count/order/contact_name, and
 *     it is what matters for whether Meta accepts the send once the templates
 *     are approved. Stub mode never builds a payload at all, so the existing
 *     stub-based tests cannot check this.
 *
 *  2. ROUTING tests -- real HTTP bookings through the controller in stub
 *     mode, asserting which templateType fires for free vs paid vs session,
 *     including the mutual-exclusivity (no double-messaging) requirement.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getAdminToken, authHeader } from "../helpers/auth.js";
import { testData } from "../helpers/seed.js";
import Appointment from "../../src/modules/appointments/appointment.model.js";
import Invoice from "../../src/modules/billing/invoice.model.js";
import Payment from "../../src/modules/payments/payment.model.js";

describe("Amount-free booking WhatsApp confirmations", () => {
  let token;

  beforeAll(async () => {
    token = await getAdminToken(app);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Appointment.deleteMany({ patient: testData.patient._id });
    await Invoice.deleteMany({ patient: testData.patient._id });
    await Payment.deleteMany({ patient: testData.patient._id });
  });

  // ---------------------------------------------------------------- payloads

  /**
   * Load a fresh whatsapp.js with sending genuinely ENABLED and fetch mocked,
   * returning the parsed body of the outgoing request.
   */
  const capturePayload = async (templateType, data, patientName) => {
    const saved = process.env.WHATSAPP_ENABLED;
    process.env.WHATSAPP_ENABLED = "true";
    vi.resetModules();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    const savedFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const { sendWhatsApp } = await import("../../src/utils/whatsapp.js");
      await sendWhatsApp("919999888877", templateType, data, patientName);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      return JSON.parse(fetchMock.mock.calls[0][1].body);
    } finally {
      global.fetch = savedFetch;
      if (saved === undefined) delete process.env.WHATSAPP_ENABLED;
      else process.env.WHATSAPP_ENABLED = saved;
      vi.resetModules();
    }
  };

  it("T4a: appointment_booked_free payload -- exactly 3 params (date/time/clinic), no amount, correct contact_name", async () => {
    const body = await capturePayload(
      "appointment_booked_free",
      { date: "05/08/2026", time: "11:30", clinic: "Ujjwal Dental — Sonipat" },
      "Swati"
    );

    expect(body.type).toBe("template");
    expect(body.template_name).toBe("appointment_booked_free");
    expect(body.contact_name).toBe("Swati"); // never guessed from {{1}}

    const params = body.template_components.find((c) => c.type === "body").parameters;
    expect(params).toHaveLength(3);
    expect(params.map((p) => p.text)).toEqual([
      "05/08/2026",
      "11:30",
      "Ujjwal Dental — Sonipat",
    ]);

    // No amount anywhere -- the whole reason this template exists.
    // (Checked against the param VALUES: the literal key "parameters" itself
    // contains the substring "rs", so scanning the raw JSON false-positives.)
    for (const p of params) expect(p.text).not.toMatch(/\d+\s*(rs|₹)|rs\.?\s*\d|amount/i);
  });

  it("T4b: session_booked_free payload -- exactly 3 params (treatment/date/time), no amount", async () => {
    const body = await capturePayload(
      "session_booked_free",
      { treatmentName: "Root Canal", date: "06/08/2026", time: "16:00" },
      "Naresh kumar"
    );

    expect(body.template_name).toBe("session_booked_free");
    expect(body.contact_name).toBe("Naresh kumar");

    const params = body.template_components.find((c) => c.type === "body").parameters;
    expect(params).toHaveLength(3);
    expect(params.map((p) => p.text)).toEqual(["Root Canal", "06/08/2026", "16:00"]);
    for (const p of params) expect(p.text).not.toMatch(/\d+\s*(rs|₹)|rs\.?\s*\d|amount/i);
  });

  it("T4c: missing optional fields still produce well-formed 3-param payloads", async () => {
    const appt = await capturePayload("appointment_booked_free", { date: "05/08/2026", time: "11:30" }, "X");
    const apptParams = appt.template_components[0].parameters;
    expect(apptParams).toHaveLength(3);
    expect(apptParams[2].text).toBe("Ujjwal Dental Clinic"); // fallback, never empty

    const sess = await capturePayload("session_booked_free", { date: "06/08/2026", time: "16:00" }, "Y");
    const sessParams = sess.template_components[0].parameters;
    expect(sessParams).toHaveLength(3);
    expect(sessParams[0].text).toBe("your treatment");
    // Meta rejects empty body params -- none may be blank.
    for (const p of [...apptParams, ...sessParams]) expect(p.text).not.toBe("");
  });

  // ---------------------------------------------------------------- routing

  const stubCalls = (spy) =>
    spy.mock.calls.filter((args) => String(args[0]).startsWith("[WhatsApp STUB]"));
  const fired = (spy, templateType) =>
    stubCalls(spy).some((args) => args[0].includes(`"${templateType}"`));

  it("T1 (HARD GATE): a FREE OPD booking fires appointment_booked_free", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 86400000).toISOString(),
      timeSlot: "10:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Free follow-up",
      visitType: "opd",
      isFree: true,
    });

    expect(res.status).toBe(201);
    expect(fired(logSpy, "appointment_booked_free")).toBe(true);
    // A free booking has no payment, so a receipt must never be sent.
    expect(fired(logSpy, "payment_recorded")).toBe(false);
  });

  it("T3 (HARD GATE): a PAID booking fires ONLY payment_recorded -- no double-messaging", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 2 * 86400000).toISOString(),
      timeSlot: "12:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Checkup",
      visitType: "opd",
      opdFee: 300,
      paymentMethod: "cash",
      opdFeePaid: true,
    });

    expect(res.status).toBe(201);
    expect(fired(logSpy, "payment_recorded")).toBe(true);
    expect(fired(logSpy, "appointment_booked_free")).toBe(false); // the gate
  });

  it("postpay (chargeable but nothing collected) also gets a confirmation, not silence", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 3 * 86400000).toISOString(),
      timeSlot: "14:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Checkup",
      visitType: "opd",
      opdFee: 300,
      paymentMethod: "cash",
      opdFeePaid: false,
    });

    expect(res.status).toBe(201);
    expect(fired(logSpy, "appointment_booked_free")).toBe(true);
    expect(fired(logSpy, "payment_recorded")).toBe(false);
  });

  it("T2 (HARD GATE): booking a treatment SESSION fires session_booked_free with the treatment name", async () => {
    // Parent treatment first (paid up front, so the session itself is free).
    const opd = await Appointment.create({
      patient: testData.patient._id,
      clinic: testData.clinic._id,
      date: new Date(),
      timeSlot: "09:00",
      visitType: "opd",
      reason: "Checkup",
      opdFee: 300,
      fee: 300,
      isFree: false,
      opdFeePaid: true,
      paymentMethod: "cash",
      paymentStatus: "paid",
    });

    const parentRes = await request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 4 * 86400000).toISOString(),
      timeSlot: "11:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      reason: "Root Canal",
      visitType: "treatment",
      treatmentId: "other",
      treatmentName: "Root Canal",
      originatingOpdAppointmentId: opd._id.toString(),
      fee: 9000,
      items: [{ description: "Root Canal", unitPrice: 9000, itemType: "treatment" }],
      paymentMethod: "cash",
      opdFeePaid: true,
      amountPaid: 9000,
      sessionsPlanned: 4,
    });
    expect(parentRes.status).toBe(201);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const sessionRes = await request(app).post("/api/appointments").set(authHeader(token)).send({
      clinic: testData.clinic._id,
      date: new Date(Date.now() + 6 * 86400000).toISOString(),
      timeSlot: "15:00",
      phone: testData.patient.phone,
      patientId: testData.patient._id,
      visitType: "treatment_session",
      parentAppointment: parentRes.body.data.appointmentId,
      reason: "Session 2",
    });

    expect(sessionRes.status).toBe(201);
    expect(fired(logSpy, "session_booked_free")).toBe(true);
    // The OLD amount-bearing template must no longer fire for sessions.
    expect(fired(logSpy, "session_booked")).toBe(false);

    // The session really is free -- confirming there is no paid-session path
    // that would still need the old template.
    const session = await Appointment.findById(sessionRes.body.data._id);
    expect(session.isFree).toBe(true);
    expect(session.fee).toBe(0);
    expect(session.paymentStatus).toBe("free");
  });
});
