import mongoose from "mongoose";

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

    // Appointment type
    type: {
      type: String,
      enum: ["regular", "emergency", "follow_up"],
      default: "regular",
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
  },
  {
    timestamps: true,
  },
);

// ============ INDEXES ============

// Compound index to prevent double booking
// Same clinic, date, and time slot should be unique
appointmentSchema.index({ clinic: 1, date: 1, timeSlot: 1 }, { unique: true });

// Index for finding appointments by patient
appointmentSchema.index({ patient: 1, date: -1 });

// Index for finding appointments by date and status
appointmentSchema.index({ date: 1, status: 1 });

// Index for appointment number lookups
// appointmentSchema.index({ appointmentNumber: 1 });

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

  // Token number for the day
  const startOfDay = new Date(this.date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(this.date);
  endOfDay.setHours(23, 59, 59, 999);

  const todayCount = await mongoose.model("Appointment").countDocuments({
    clinic: this.clinic,
    date: { $gte: startOfDay, $lte: endOfDay },
    status: { $ne: "cancelled" },
  });

  this.tokenNumber = todayCount + 1;
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
