import mongoose from "mongoose";

/**
 * SYSTEM SETTINGS MODEL
 *
 * Singleton document for global system configuration.
 * Only one document should exist in the collection.
 */

const workingHoursSchema = new mongoose.Schema(
  {
    open: { type: String, default: "09:00" },
    close: { type: String, default: "18:00" },
    isOpen: { type: Boolean, default: true },
  },
  { _id: false }
);

const systemSettingsSchema = new mongoose.Schema(
  {
    // Clinic Information
    clinicName: { type: String, default: "Ujjwal Dental Clinic" },
    clinicPhone: String,
    clinicEmail: String,

    // Address
    address: {
      street: String,
      area: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: "India" },
    },

    // Working Hours
    workingHours: {
      monday: { type: workingHoursSchema, default: () => ({}) },
      tuesday: { type: workingHoursSchema, default: () => ({}) },
      wednesday: { type: workingHoursSchema, default: () => ({}) },
      thursday: { type: workingHoursSchema, default: () => ({}) },
      friday: { type: workingHoursSchema, default: () => ({}) },
      saturday: {
        type: workingHoursSchema,
        default: () => ({ open: "09:00", close: "14:00", isOpen: true }),
      },
      sunday: {
        type: workingHoursSchema,
        default: () => ({ open: "09:00", close: "18:00", isOpen: false }),
      },
    },

    // System Configuration
    systemConfig: {
      timezone: { type: String, default: "Asia/Kolkata" },
      currency: { type: String, default: "INR" },
      language: { type: String, default: "en" },
      dateFormat: { type: String, default: "DD/MM/YYYY" },
      timeFormat: { type: String, default: "12h" }, // "12h" or "24h"
    },

    // Backup Settings
    backupSettings: {
      autoBackup: { type: Boolean, default: false },
      backupFrequency: { type: String, default: "weekly" },
      lastBackupDate: Date,
    },

    // Fee Settings (OPD fees for appointments)
    feeSettings: {
      opdFeeRegular: { type: Number, default: 300 },
      opdFeeEmergency: { type: Number, default: 500 },
      consultationFee: { type: Number, default: 500 },
      requirePaymentBeforeBooking: { type: Boolean, default: true },
    },

    // Last updated by
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
  }
);

/**
 * Singleton pattern - get or create the single settings document
 */
systemSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

const SystemSettings = mongoose.model("SystemSettings", systemSettingsSchema);

export default SystemSettings;
