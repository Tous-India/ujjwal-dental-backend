import mongoose from "mongoose";

/**
 * CLINIC MODEL (BASIC CRUD)
 * Used for managing clinic locations
 */

const clinicSchema = new mongoose.Schema(
  {
    // -------- Basic Info --------
    name: {
      type: String,
      required: [true, "Clinic name is required"],
      trim: true,
    },

    // Short code used as the appointment-number prefix (e.g. "UP", "UD").
    // Falls back to computed name-initials in the pre-save hook when unset —
    // set this explicitly whenever two clinics' initials would collide.
    code: {
      type: String,
      trim: true,
      uppercase: true,
    },

    // -------- Address --------
    address: {
      street: String,
      area: String,
      city: String,
      state: String,
      pincode: String,
    },

    // -------- Contact --------
    phone: {
      type: String,
      required: [true, "Clinic phone number is required"],
    },

    // -------- Status --------
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // createdAt & updatedAt
  }
);

// -------- EXPORT --------
const Clinic = mongoose.model("Clinic", clinicSchema);

export default Clinic;
