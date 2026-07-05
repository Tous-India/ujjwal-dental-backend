import mongoose from "mongoose";
import { nextDailyToken, istDateKey } from "./appointmentToken.js";

/**
 * APPOINTMENT MODEL
 * For booking and managing patient appointments
 *
 * Key features:
 * - Unique appointment number (DR-2401-0001)
 * - Time slot management
 * - Status tracking (scheduled → completed/cancelled)
 * - Token number for queue management
 */

// ============ APPOINTMENT SCHEMA ============

const appointmentSchema = new mongoose.Schema(
  {
    // Unique appointment number: CLINIC_CODE-YYMM-SERIAL
    // Example: DR-2401-0001 (Delhi Road, Jan 2024, first appointment)
    appointmentNumber: {
      type: String,
      unique: true,
    },

    // Patient reference
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: [true, "Patient is required"],
    },

    // Clinic reference
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: [true, "Clinic is required"],
    },

    // Appointment date and time
    date: {
      type: Date,
      required: [true, "Appointment date is required"],
    },

    timeSlot: {
      type: String, // Format: "09:00", "09:30", etc.
      required: [true, "Time slot is required"],
    },

    // Token number for the day (1, 2, 3...)
    // Helps patients know their position in queue
    tokenNumber: {
      type: Number,
    },

    // Created-date key (YYYY-MM-DD, IST) the token series belongs to. Lets tokens
    // be queried/displayed per clinic per day, and backs the uniqueness index.
    tokenDateKey: {
      type: String,
    },

    // Appointment type
    type: {
      type: String,
      enum: ["regular", "emergency", "follow_up"],
      default: "regular",
    },

    // Urgency. Source of truth for whether this is an emergency visit (drives
    // the emergency fee + badges). Kept separate from `type` so urgency and
    // regular/follow-up classification don't collide.
    appointmentType: {
      type: String,
      enum: ["regular", "emergency"],
      default: "regular",
    },

    // Visit type: OPD/consultation vs a specific treatment procedure.
    // Defaults to "opd" so existing/patient-booked appointments behave as before.
    visitType: {
      type: String,
      enum: ["opd", "treatment", "treatment_session"],
      default: "opd",
    },

    // For treatment_session appointments: ref to the parent treatment appointment.
    parentAppointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
      validate: {
        validator: function (value) {
          if (this.visitType === "treatment_session") return !!value;
          return true;
        },
        message: "parentAppointment is required for treatment_session appointments",
      },
    },

    // Session number within a treatment plan (1-based). Null for opd/treatment.
    sessionNumber: {
      type: Number,
      default: null,
      min: 1,
    },

    // Treatment (catalog) for treatment visits — nullable for OPD visits.
    treatmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TreatmentMaster",
    },

    // One-off custom treatment name (when the admin picked "Other" instead of a
    // catalog treatment). Stored as a plain string on the appointment — no
    // Treatment Master entry is created. Empty for normal/OPD visits.
    treatmentName: {
      type: String,
      trim: true,
    },

    // Fee for this visit (auto-filled from settings/treatment, admin-editable).
    fee: {
      type: Number,
    },

    // Optional fee note (e.g. "2nd sitting, crown fitting").
    feeNotes: String,

    // Auto-generated invoice linked to this appointment.
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
    },

    // Status tracking
    status: {
      type: String,
      enum: [
        "scheduled",
        "confirmed",
        "checked_in",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      default: "scheduled",
    },

    // Reason for visit (chief complaint)
    reason: {
      type: String,
      required: [true, "Reason for visit is required"],
    },

    // Additional notes by staff
    notes: String,

    // Check-in time (when patient arrives)
    checkInTime: Date,

    // Start time (when treatment starts)
    startTime: Date,

    // End time (when treatment ends)
    endTime: Date,
    cancellationReason: {
      type: String,
      default: "",
    },
    statusHistory: [
      {
        status: String,
        reason: String,
        changedAt: {
          type: Date,
          default: Date.now,
        },
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
    // Cancellation details
    cancellation: {
      cancelledAt: Date,
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: "cancellation.cancelledByModel",
      },
      cancelledByModel: {
        type: String,
        enum: ["User", "Patient"],
      },
      reason: String,
    },

    // OPD Fee for this appointment
    opdFee: {
      type: Number,
      default: 300,
    },

    // Was OPD fee paid?
    opdFeePaid: {
      type: Boolean,
      default: false,
    },

    // Is this a free appointment (no payment required)?
    isFree: {
      type: Boolean,
      default: false,
    },

    // Payment method recorded for this appointment.
    paymentMethod: {
      type: String,
      enum: ["cash", "online", "free"],
      default: "cash",
    },

    // Payment status (kept in sync with the linked invoice via PATCH handler).
    paymentStatus: {
      type: String,
      enum: ["paid", "unpaid", "free"],
      default: "unpaid",
    },

    // Created by (staff who booked)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Source of booking
    source: {
      type: String,
      enum: ["walk_in", "phone", "online", "app"],
      default: "walk_in",
    },

    // Reminder sent?
    reminderSent: {
      type: Boolean,
      default: false,
    },

    // Email notification tracking
    notifications: {
      clinicEmailSentAt: Date,
      patientEmailSentAt: Date,
      clinicEmailError: String,
      patientEmailError: String,
    },
  },
  {
    timestamps: true,
  },
);

// ============ INDEXES ============

// Compound index for fast per-slot lookups. NOT unique: each 30-minute slot
// may hold up to SLOT_CAPACITY bookings (enforced in the controller).
appointmentSchema.index({ clinic: 1, date: 1, timeSlot: 1 });

// Fast session lookup and sessionNumber auto-calc.
appointmentSchema.index({ parentAppointment: 1, sessionNumber: 1 });

// Index for finding appointments by patient
appointmentSchema.index({ patient: 1, date: -1 });

// Index for finding appointments by date and status
appointmentSchema.index({ date: 1, status: 1 });

// Index for appointment number lookups
// appointmentSchema.index({ appointmentNumber: 1 });

// Safety net: the DB itself rejects any duplicate token within a clinic + day.
// Partial filter so it only applies to docs that have a tokenDateKey (legacy
// appointments created before this field exists are excluded, avoiding clashes).
appointmentSchema.index(
  { clinic: 1, tokenDateKey: 1, tokenNumber: 1 },
  { unique: true, partialFilterExpression: { tokenDateKey: { $exists: true } } },
);

// ============ PRE-SAVE MIDDLEWARE ============

/**
 * Generate appointment number before saving
 * Format: CLINIC_CODE-YYMM-SERIAL
 */
appointmentSchema.pre("save", async function () {
  // Run only for new appointments
  if (!this.isNew) return;

  const Clinic = mongoose.model("Clinic");
  const clinic = await Clinic.findById(this.clinic);

  if (!clinic) {
    throw new Error("Clinic not found");
  }

  // Appointment number
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const count = await mongoose.model("Appointment").countDocuments({
    clinic: this.clinic,
    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
  });

  const serial = String(count + 1).padStart(4, "0");
  // Use clinic code if available, otherwise generate from clinic name
  const clinicCode = clinic.code || clinic.name?.split(/[\s-]+/).map(w => w[0]).join("").toUpperCase().slice(0, 3) || "UDC";
  this.appointmentNumber = `${clinicCode}-${year}${month}-${serial}`;

  // Token number — single shared, atomic source for BOTH booking paths
  // (website + admin). Series is per clinic, keyed by the CREATED date in IST,
  // so it resets at IST midnight automatically. nextDailyToken uses an atomic
  // counter (findByIdAndUpdate $inc) and is collision-proof under concurrency.
  const dateKey = istDateKey(); // created "now" in IST
  this.tokenDateKey = dateKey;
  this.tokenNumber = await nextDailyToken(this.clinic, dateKey);
});

// ============ METHODS ============

/**
 * Check in patient (mark arrival)
 */
appointmentSchema.methods.checkIn = function () {
  this.status = "checked_in";
  this.checkInTime = new Date();
  return this.save();
};

/**
 * Start appointment
 */
appointmentSchema.methods.start = function () {
  this.status = "in_progress";
  this.startTime = new Date();
  return this.save();
};

/**
 * Complete appointment
 */
appointmentSchema.methods.complete = function () {
  this.status = "completed";
  this.endTime = new Date();
  return this.save();
};

/**
 * Cancel appointment
 * @param {ObjectId} cancelledBy - User or Patient who cancelled
 * @param {String} cancelledByModel - 'User' or 'Patient'
 * @param {String} reason - Reason for cancellation
 */
appointmentSchema.methods.cancel = function (
  cancelledBy,
  cancelledByModel,
  reason,
) {
  this.status = "cancelled";
  this.cancellation = {
    cancelledAt: new Date(),
    cancelledBy,
    cancelledByModel,
    reason,
  };
  return this.save();
};

/**
 * Mark as no-show
 */
appointmentSchema.methods.markNoShow = function () {
  this.status = "no_show";
  return this.save();
};

// ============ STATICS ============

/**
 * Get available slots for a clinic on a specific date
 * @param {ObjectId} clinicId - Clinic ID
 * @param {Date} date - Date to check
 * @returns {Array} - Array of available time slots
 */
appointmentSchema.statics.getAvailableSlots = async function (clinicId, date) {
  const Clinic = mongoose.model("Clinic");
  const clinic = await Clinic.findById(clinicId);

  if (!clinic) {
    throw new Error("Clinic not found");
  }

  // Check if clinic is open on this date
  const openStatus = clinic.isOpenOn(date);
  if (!openStatus.isOpen) {
    return { isOpen: false, reason: openStatus.reason, slots: [] };
  }

  // Get all possible slots for this day
  const allSlots = clinic.getTimeSlots(date);

  // Get booked slots for this date
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const bookedAppointments = await this.find({
    clinic: clinicId,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $nin: ["cancelled"] },
  }).select("timeSlot");

  const bookedSlots = bookedAppointments.map((apt) => apt.timeSlot);

  // Filter out booked slots
  const availableSlots = allSlots.filter((slot) => !bookedSlots.includes(slot));

  return {
    isOpen: true,
    totalSlots: allSlots.length,
    bookedSlots: bookedSlots.length,
    availableSlots,
  };
};

/**
 * Get today's appointments for a clinic
 * @param {ObjectId} clinicId - Clinic ID
 * @returns {Array} - Today's appointments
 */
appointmentSchema.statics.getTodayAppointments = async function (clinicId) {
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));

  return this.find({
    clinic: clinicId,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $nin: ["cancelled"] },
  })
    .populate("patient", "name phone")
    .sort({ tokenNumber: 1 });
};

// Create and export the model
const Appointment = mongoose.model("Appointment", appointmentSchema);

export default Appointment;
