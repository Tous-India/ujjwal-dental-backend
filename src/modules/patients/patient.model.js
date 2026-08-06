import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

/**
 * PATIENT MODEL
 * For patient accounts and their data
 *
 * Key features:
 * - Personal info (name, phone, email, etc.)
 * - Medical info (blood group, allergies)
 * - Membership (embedded - stored directly in patient)
 * - Login via OTP (phone-based)
 */

// ============ SUB-SCHEMAS ============

/**
 * Address Schema (embedded)
 */
const addressSchema = new mongoose.Schema(
  {
    street: String,
    city: String,
    state: { type: String, default: "Haryana" },
    pincode: String,
  },
  { _id: false }, // Don't create separate _id for address
);

/**
 * Emergency Contact Schema (embedded)
 */
const emergencyContactSchema = new mongoose.Schema(
  {
    name: String,
    phone: String,
    relation: String,
  },
  { _id: false },
);

/**
 * Membership Schema (embedded in patient)
 * Stores current active membership
 */
const membershipSchema = new mongoose.Schema(
  {
    // Plan reference — nullable for manually-assigned custom/discontinued plans
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MembershipPlan",
    },
    // Permanent plan name string. Always stored so the record survives even if
    // the referenced plan is later edited, deactivated, or deleted.
    planName: String,
    discountPercent: Number,
    startDate: Date,
    expiryDate: Date,
    status: {
      type: String,
      enum: ["active", "paused", "expired", "cancelled"],
      default: "active",
    },
    // Set while paused; cleared on resume. Not currently used to auto-extend
    // expiryDate on resume (deliberate simplicity call -- see resumeMembership).
    pausedAt: Date,

    // Admin-only audit trail for pause/resume/cancel actions on THIS
    // membership -- distinct from patient.membershipHistory (which archives
    // whole past membership records on renewal/reassignment). Same
    // performedBy/performedAt/reason shape as the Reopen Treatment pattern
    // (appointment.treatmentHistory).
    statusHistory: [
      {
        action: {
          type: String,
          enum: ["paused", "resumed", "cancelled"],
          required: true,
        },
        reason: String,
        performedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        performedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // -------- Manual assignment fields (admin-assigned memberships) --------
    // Amount the patient paid (₹). For manual assignments (no Razorpay).
    amountPaid: Number,
    // How the patient paid for a manually-assigned membership
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "upi", "bank_transfer", "online"],
    },
    // Admin user who manually assigned this membership (null for online purchase)
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Optional admin notes
    notes: String,
  },
  { _id: false },
);

// ============ MAIN PATIENT SCHEMA ============

const patientSchema = new mongoose.Schema(
  {
    // -------- Authentication --------
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
    },

    email: {
      type: String,
      lowercase: true,
      sparse: true, // Allows multiple null values
    },

    password: {
      type: String,
      select: false,
    },

    // For password reset (admins use this flow; patients normally log in via OTP)
    resetPasswordToken: String,
    resetPasswordExpires: Date,

    // LEGACY email-based login OTP. Stores the code in PLAINTEXT and has no
    // attempt cap or rate limiting -- superseded by `loginOtp` below, which is
    // hashed, attempt-capped and rate-limited. Left in place only because the
    // email flow (/api/auth/patient/login) is still wired; retiring that flow
    // should delete this field with it.
    otp: {
      code: String,
      expiresAt: Date,
    },

    /**
     * WhatsApp login OTP.
     *
     * Stored on the Patient doc rather than a separate collection: the request
     * and verify paths both already load the patient by phone, so this needs no
     * extra query or join, and it keeps auth state in the one place a reader
     * would look for it. A separate collection would only pay off if we needed
     * OTPs for non-patient entities or native TTL expiry -- neither applies,
     * and expiry is enforced explicitly on read anyway.
     *
     * `codeHash` is a bcrypt hash -- the plaintext code exists only in memory
     * long enough to be sent over WhatsApp, and is never persisted.
     *
     * select:false so the hash never rides along on ordinary patient reads
     * (patient lists, detail modals, exports).
     */
    loginOtp: {
      codeHash: { type: String, select: false },
      expiresAt: { type: Date, select: false },
      attempts: { type: Number, default: 0, select: false },
      lastSentAt: { type: Date, select: false },
      // Rolling window used for the ~5/hour cap.
      sendCount: { type: Number, default: 0, select: false },
      windowStartedAt: { type: Date, select: false },
    },

    // -------- Personal Info --------
    name: {
      type: String,
      required: [true, "Patient name is required"],
      trim: true,
    },

    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },

    dateOfBirth: Date,

    // Standalone age (years), collected directly for patients who are
    // uncomfortable sharing an exact date of birth. Independent of
    // dateOfBirth/calculatedAge -- never derived from or used to infer one.
    age: {
      type: Number,
      min: 0,
      max: 130,
    },

    address: addressSchema,

    // -------- Medical Info --------
    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },

    allergies: [String], // Array of allergy names

    medicalHistory: [String], // Array of conditions

    emergencyContact: emergencyContactSchema,

    // -------- Membership --------
    membership: membershipSchema,

    // Keep history of past memberships
    membershipHistory: [membershipSchema],

    // -------- Preferences --------
    preferredClinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
    },

    // -------- Meta --------
    registeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    notes: String, // Internal notes by staff
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ============ INDEXES ============

// For faster searches
// patientSchema.index({ phone: 1 });
patientSchema.index({ name: "text" }); // Text search on name
patientSchema.index({ "membership.status": 1 });

// ============ VIRTUALS ============

/**
 * Check if patient has active membership
 * Usage: patient.hasMembership
 */
patientSchema.virtual("hasMembership").get(function () {
  if (!this.membership || !this.membership.status) {
    return false;
  }
  return (
    this.membership.status === "active" &&
    this.membership.expiryDate > new Date()
  );
});

/**
 * Get current discount percentage
 * Usage: patient.currentDiscount
 */
patientSchema.virtual("currentDiscount").get(function () {
  if (this.hasMembership) {
    return this.membership.discountPercent || 0;
  }
  return 0;
});

/**
 * Calculate age from DOB
 */
patientSchema.virtual("calculatedAge").get(function () {
  if (!this.dateOfBirth) return null;

  const diff = Date.now() - this.dateOfBirth.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
});

// ============ METHODS ============

patientSchema.methods.comparePassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

/**
 * Generate OTP for login
 * @returns {string} - 6 digit OTP
 */
patientSchema.methods.generateOTP = function () {
  // Generate 6 digit random OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Set OTP with 10 minute expiry
  this.otp = {
    code: otp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  };

  return otp;
};

/**
 * Verify OTP
 * @param {string} enteredOTP - OTP to verify
 * @returns {boolean} - True if valid
 */
patientSchema.methods.verifyOTP = function (enteredOTP) {
  if (!this.otp || !this.otp.code) {
    return false;
  }

  // Check if expired
  if (this.otp.expiresAt < new Date()) {
    return false;
  }

  // Check if matches
  return this.otp.code === enteredOTP;
};

/**
 * Clear OTP after use
 */
patientSchema.methods.clearOTP = function () {
  this.otp = undefined;
};

// ============ WHATSAPP LOGIN OTP ============

/** How long a login OTP stays valid. */
export const LOGIN_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
/** Minimum gap between two OTP sends to the same phone. */
export const LOGIN_OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
/** Max sends per phone per rolling window. */
export const LOGIN_OTP_MAX_SENDS_PER_WINDOW = 5;
export const LOGIN_OTP_SEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour
/** Wrong-code attempts before the OTP is destroyed outright. */
export const LOGIN_OTP_MAX_ATTEMPTS = 5;

/**
 * Whether a new OTP may be sent right now.
 * @returns {{ allowed: boolean, reason?: "cooldown"|"hourly", retryAfterSec?: number }}
 */
patientSchema.methods.canSendLoginOtp = function () {
  const now = Date.now();
  const otp = this.loginOtp || {};

  if (otp.lastSentAt) {
    const since = now - new Date(otp.lastSentAt).getTime();
    if (since < LOGIN_OTP_RESEND_COOLDOWN_MS) {
      return {
        allowed: false,
        reason: "cooldown",
        retryAfterSec: Math.ceil((LOGIN_OTP_RESEND_COOLDOWN_MS - since) / 1000),
      };
    }
  }

  // Rolling hourly cap -- the window resets once it has fully elapsed.
  if (otp.windowStartedAt) {
    const windowAge = now - new Date(otp.windowStartedAt).getTime();
    if (windowAge < LOGIN_OTP_SEND_WINDOW_MS && (otp.sendCount || 0) >= LOGIN_OTP_MAX_SENDS_PER_WINDOW) {
      return {
        allowed: false,
        reason: "hourly",
        retryAfterSec: Math.ceil((LOGIN_OTP_SEND_WINDOW_MS - windowAge) / 1000),
      };
    }
  }

  return { allowed: true };
};

/**
 * Generate a 6-digit login OTP, storing ONLY its bcrypt hash.
 * Returns the plaintext code for immediate dispatch -- it is never persisted.
 *
 * Uses crypto.randomInt (CSPRNG), not Math.random, since this code is a
 * credential.
 */
patientSchema.methods.generateLoginOtp = async function () {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date();

  const prev = this.loginOtp || {};
  const windowExpired =
    !prev.windowStartedAt ||
    Date.now() - new Date(prev.windowStartedAt).getTime() >= LOGIN_OTP_SEND_WINDOW_MS;

  this.loginOtp = {
    codeHash: await bcrypt.hash(code, 10),
    expiresAt: new Date(Date.now() + LOGIN_OTP_TTL_MS),
    attempts: 0,
    lastSentAt: now,
    sendCount: windowExpired ? 1 : (prev.sendCount || 0) + 1,
    windowStartedAt: windowExpired ? now : prev.windowStartedAt,
  };

  return code;
};

/**
 * Verify a submitted login OTP.
 *
 * @returns {Promise<{ ok: boolean, reason?: "none"|"expired"|"locked"|"mismatch", attemptsRemaining?: number }>}
 *
 * On the LOGIN_OTP_MAX_ATTEMPTS-th failure the stored hash is destroyed, so a
 * 6-digit code can never be brute-forced -- a fresh request is then required.
 * The caller must persist the document afterwards (attempts/clearing are
 * mutations).
 */
patientSchema.methods.verifyLoginOtp = async function (submitted) {
  const otp = this.loginOtp;

  if (!otp || !otp.codeHash) return { ok: false, reason: "none" };

  if (!otp.expiresAt || new Date(otp.expiresAt).getTime() < Date.now()) {
    this.clearLoginOtp();
    return { ok: false, reason: "expired" };
  }

  if ((otp.attempts || 0) >= LOGIN_OTP_MAX_ATTEMPTS) {
    this.clearLoginOtp();
    return { ok: false, reason: "locked" };
  }

  const matches = await bcrypt.compare(String(submitted), otp.codeHash);

  if (!matches) {
    otp.attempts = (otp.attempts || 0) + 1;
    if (otp.attempts >= LOGIN_OTP_MAX_ATTEMPTS) {
      this.clearLoginOtp();
      return { ok: false, reason: "locked", attemptsRemaining: 0 };
    }
    return {
      ok: false,
      reason: "mismatch",
      attemptsRemaining: LOGIN_OTP_MAX_ATTEMPTS - otp.attempts,
    };
  }

  return { ok: true };
};

/**
 * Destroy the stored OTP. Send-throttle state (lastSentAt/sendCount/
 * windowStartedAt) is deliberately PRESERVED -- clearing it would let a
 * caller reset their own rate limit just by burning an OTP.
 */
patientSchema.methods.clearLoginOtp = function () {
  const prev = this.loginOtp || {};
  this.loginOtp = {
    codeHash: undefined,
    expiresAt: undefined,
    attempts: 0,
    lastSentAt: prev.lastSentAt,
    sendCount: prev.sendCount,
    windowStartedAt: prev.windowStartedAt,
  };
};

// ============ STATICS ============

/**
 * Search patients by name or phone
 * @param {string} query - Search query
 * @returns {Array} - Matching patients
 */
patientSchema.statics.search = async function (query) {
  return this.find({
    isActive: true,
    $or: [
      { name: { $regex: query, $options: "i" } },
      { phone: { $regex: query, $options: "i" } },
    ],
  }).limit(20);
};

patientSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;

  this.password = await bcrypt.hash(this.password, 12);
});

// Safety net: a patient with an active membership is always Active
patientSchema.pre("save", function () {
  if (
    this.membership?.status === "active" &&
    this.membership?.expiryDate &&
    new Date(this.membership.expiryDate) > new Date()
  ) {
    this.isActive = true;
  }
});
// Create and export the model
const Patient = mongoose.model("Patient", patientSchema);

export default Patient;
