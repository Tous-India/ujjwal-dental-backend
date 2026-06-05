import mongoose from "mongoose";
import bcrypt from "bcryptjs";

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
    plan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MembershipPlan",
    },
    planName: String,
    discountPercent: Number,
    startDate: Date,
    expiryDate: Date,
    status: {
      type: String,
      enum: ["active", "expired", "cancelled"],
      default: "active",
    },
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

    // OTP for login
    otp: {
      code: String,
      expiresAt: Date,
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
// Create and export the model
const Patient = mongoose.model("Patient", patientSchema);

export default Patient;
