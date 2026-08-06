/**
 * WhatsApp OTP login for the patient portal.
 *
 * Context: every patient shared the default password "account123" on a portal
 * holding real medical records. These tests are the security proof for the
 * replacement, so they assert the properties that make it safe -- the code is
 * never stored in plaintext, it cannot be brute-forced, it cannot be used to
 * spam a real patient's WhatsApp, and it cannot be used to enumerate which
 * phone numbers belong to patients.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import Patient from "../../src/modules/patients/patient.model.js";

const PHONE = "9000012345";
const UNREGISTERED = "9000099999";

describe("Patient WhatsApp OTP login", () => {
  let patientId;

  beforeAll(async () => {
    await Patient.deleteMany({ phone: { $in: [PHONE, UNREGISTERED] } });
    const p = await Patient.create({
      name: "OTP Test Patient",
      phone: PHONE,
      gender: "female",
      age: 30,
      password: "account123", // the shared default, for the T7 fallback check
    });
    patientId = p._id;
  });

  afterAll(async () => {
    await Patient.deleteMany({ phone: { $in: [PHONE, UNREGISTERED] } });
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    // Reset throttle + OTP state between tests (kept deliberately sticky in prod).
    await Patient.updateOne({ _id: patientId }, { $unset: { loginOtp: "" } });
  });

  const requestOtp = (phone = PHONE) =>
    request(app).post("/api/patients/auth/request-otp").send({ phone });
  const verifyOtp = (otp, phone = PHONE) =>
    request(app).post("/api/patients/auth/verify-otp").send({ phone, otp });

  /** Read the OTP state including select:false fields. */
  const otpState = () =>
    Patient.findById(patientId)
      .select("+loginOtp.codeHash +loginOtp.expiresAt +loginOtp.attempts +loginOtp.lastSentAt +loginOtp.sendCount +loginOtp.windowStartedAt")
      .lean();

  /**
   * Capture the plaintext code by intercepting the dispatch. sendWhatsApp is
   * the only place it ever exists outside memory -- there is deliberately no
   * way to read it back from the DB.
   */
  const captureOtpCode = () => {
    const captured = {};
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      const line = String(args[0]);
      if (line.includes("[WhatsApp STUB]") && line.includes("patient_login_otp")) {
        captured.data = args[1];
        captured.line = line;
      }
    });
    return { captured, spy };
  };

  it("T1 (HARD GATE): request-otp generates a 6-digit code, stores it HASHED with 10-min expiry, and fires the right template", async () => {
    const { captured } = captureOtpCode();

    const res = await requestOtp();
    expect(res.status).toBe(200);
    expect(res.body.data.otpSent).toBe(true);

    // Dispatch fired with the right template and exactly one variable.
    expect(captured.line).toContain("patient_login_otp");
    expect(captured.data).toBeTruthy();
    expect(Object.keys(captured.data)).toEqual(["otp"]);
    // ...and the code is REDACTED in logs (it is a credential).
    expect(captured.data.otp).toBe("[REDACTED]");

    const state = await otpState();

    // Hashed, never plaintext.
    expect(state.loginOtp.codeHash).toBeTruthy();
    expect(state.loginOtp.codeHash).toMatch(/^\$2[aby]\$/); // bcrypt
    expect(state.loginOtp.codeHash).not.toMatch(/^\d{6}$/);

    // No plaintext 6-digit code anywhere on the persisted document.
    const raw = JSON.stringify(state);
    const sixDigitRuns = raw.match(/\b\d{6}\b/g) || [];
    expect(sixDigitRuns).toHaveLength(0);

    // 10-minute expiry (allow a few seconds of execution drift).
    const ttlMs = new Date(state.loginOtp.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(9 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);

    expect(state.loginOtp.attempts).toBe(0);
    expect(state.loginOtp.lastSentAt).toBeTruthy();
  });

  it("T2 (HARD GATE): the correct code logs in and returns a JWT that works on a real authenticated patient endpoint", async () => {
    // Generate a code directly on the model so we hold the plaintext.
    const patient = await Patient.findById(patientId).select("+loginOtp.codeHash");
    const code = await patient.generateLoginOtp();
    await patient.save();
    expect(code).toMatch(/^\d{6}$/);

    const res = await verifyOtp(code);
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.patient.phone).toBe(PHONE);

    // The JWT genuinely works against a real patient-protected route.
    const me = await request(app)
      .get("/api/auth/patient/me")
      .set("Authorization", `Bearer ${res.body.data.token}`);
    expect(me.status).toBe(200);

    // Single-use: the code is destroyed on success and cannot be replayed.
    const after = await otpState();
    expect(after.loginOtp.codeHash).toBeFalsy();
    const replay = await verifyOtp(code);
    expect(replay.status).toBe(400);
  });

  it("T3 (HARD GATE): wrong codes increment attempts; after 5 the OTP is destroyed and even the CORRECT code fails", async () => {
    const patient = await Patient.findById(patientId).select("+loginOtp.codeHash");
    const code = await patient.generateLoginOtp();
    await patient.save();

    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 1; i <= 4; i++) {
      const res = await verifyOtp(wrong);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/incorrect code/i);
      const st = await otpState();
      expect(st.loginOtp.attempts).toBe(i); // genuinely incrementing
    }

    // 5th failure destroys the code entirely.
    const fifth = await verifyOtp(wrong);
    expect(fifth.status).toBe(400);
    expect(fifth.body.message).toMatch(/too many incorrect attempts/i);

    const locked = await otpState();
    expect(locked.loginOtp.codeHash).toBeFalsy();

    // Brute-force protection: the CORRECT code no longer works.
    const correctNow = await verifyOtp(code);
    expect(correctNow.status).toBe(400);
    expect(correctNow.body.data?.token).toBeFalsy();
  });

  it("T4 (HARD GATE): a second request within 60s is rate-limited with a clear message", async () => {
    const first = await requestOtp();
    expect(first.status).toBe(200);

    const second = await requestOtp();
    expect(second.status).toBe(429);
    expect(second.body.message).toMatch(/please wait \d+ seconds? before requesting another code/i);

    // The stored code was NOT reissued by the blocked request.
    const st = await otpState();
    expect(st.loginOtp.sendCount).toBe(1);
  });

  it("T4b: the hourly cap blocks a 6th send even after the 60s cooldown passes", async () => {
    const patient = await Patient.findById(patientId).select("+loginOtp.codeHash");
    // Simulate 5 sends already made in this window, cooldown elapsed.
    patient.loginOtp = {
      sendCount: 5,
      windowStartedAt: new Date(Date.now() - 10 * 60 * 1000),
      lastSentAt: new Date(Date.now() - 5 * 60 * 1000),
      attempts: 0,
    };
    await patient.save();

    const res = await requestOtp();
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/too many code requests/i);
  });

  it("T5 (HARD GATE): an UNREGISTERED phone gets an identical generic success and nothing is sent", async () => {
    const { captured } = captureOtpCode();

    const known = await requestOtp();
    const unknown = await requestOtp(UNREGISTERED);

    // Byte-identical status + message -- no enumeration signal.
    expect(unknown.status).toBe(known.status);
    expect(unknown.body.message).toBe(known.body.message);
    expect(unknown.body.data).toEqual(known.body.data);

    // Only the registered number triggered a dispatch.
    expect(captured.line).toBeTruthy();
    expect(captured.line).toContain(PHONE);
    expect(captured.line).not.toContain(UNREGISTERED);

    // And no patient record was created for the unknown number.
    expect(await Patient.findOne({ phone: UNREGISTERED })).toBeFalsy();
  });

  it("T6: an expired OTP is rejected", async () => {
    const patient = await Patient.findById(patientId).select("+loginOtp.codeHash");
    const code = await patient.generateLoginOtp();
    patient.loginOtp.expiresAt = new Date(Date.now() - 1000); // just expired
    await patient.save();

    const res = await verifyOtp(code);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or has expired/i);

    const st = await otpState();
    expect(st.loginOtp.codeHash).toBeFalsy(); // cleared, not left dangling
  });

  it("T7: the existing PASSWORD login still works unchanged (transition fallback)", async () => {
    const res = await request(app)
      .post("/api/auth/patient/login-password")
      .send({ identifier: PHONE, password: "account123" });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();

    const me = await request(app)
      .get("/api/auth/patient/me")
      .set("Authorization", `Bearer ${res.body.data.token}`);
    expect(me.status).toBe(200);
  });

  it("the request message carries the full guidance copy, identically for both cases", async () => {
    const known = await requestOtp();
    const unknown = await requestOtp(UNREGISTERED);

    const EXPECTED =
      "If this number is registered with us, you'll receive a login code on WhatsApp within a minute. Didn't receive it? Please check the number, or call us at +91-9467776028.";

    expect(known.body.message).toBe(EXPECTED);
    expect(unknown.body.message).toBe(EXPECTED);
    // The guidance must survive verbatim -- it is what tells a patient who
    // mistyped their number what to do next.
    expect(known.body.message).toContain("+91-9467776028");
  });

  it("the RETIRED email-OTP endpoints answer 410 Gone, not 404 or a working login", async () => {
    for (const path of [
      "/api/auth/patient/login",
      "/api/auth/patient/verify-otp",
      "/api/auth/patient/resend-otp",
    ]) {
      const res = await request(app).post(path).send({ email: "x@y.com", otp: "123456" });
      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/retired/i);
    }
  });

  it("rejects a malformed phone number without touching the DB", async () => {
    const res = await requestOtp("12345");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid 10-digit phone/i);
  });
});
