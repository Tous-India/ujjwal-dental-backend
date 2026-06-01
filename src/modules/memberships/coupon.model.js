import mongoose from "mongoose";
import crypto from "crypto";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },

    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    membershipPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MembershipPlan",
      required: true,
    },

    membershipStart: { type: Date, required: true },
    membershipExpiry: { type: Date, required: true },

    flatDiscount: { type: Number, default: 500 },
    surgeryDiscount: { type: Number, default: 30 },
    conditions: { type: String, default: "" },

    couponNumber: { type: Number, required: true },
    totalCoupons: { type: Number, required: true },

    status: {
      type: String,
      enum: ["unused", "used", "locked"],
      default: "locked",
    },

    usedAt: Date,
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    usageNotes: String,
  },
  { timestamps: true }
);

couponSchema.index({ patient: 1, status: 1 });
couponSchema.index({ patient: 1, couponNumber: 1 });

couponSchema.statics.generateForMembership = async function (patient, plan, startDate, expiryDate) {
  const config = plan.couponConfig || {};
  if (config.enabled === false) return [];

  const count = config.numberOfCoupons || 6;
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  const coupons = [];

  for (let i = 1; i <= count; i++) {
    coupons.push({
      code: `UJJ-${plan.code}-${rand}-${String(i).padStart(2, "0")}`,
      patient: patient._id,
      membershipPlan: plan._id,
      membershipStart: startDate,
      membershipExpiry: expiryDate,
      flatDiscount: config.flatDiscount || 500,
      surgeryDiscount: config.surgeryDiscount || 30,
      conditions: config.conditions || "",
      couponNumber: i,
      totalCoupons: count,
      status: i === 1 ? "unused" : "locked",
    });
  }

  return this.insertMany(coupons);
};

const Coupon = mongoose.model("Coupon", couponSchema);

export default Coupon;
