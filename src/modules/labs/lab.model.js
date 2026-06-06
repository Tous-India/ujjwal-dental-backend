import mongoose from "mongoose";

/**
 * LAB MODEL
 *
 * A dental lab the clinic outsources prosthetic/appliance work to.
 * Each lab has a price list of procedures.
 */

const procedureSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Per-unit price (for 'fixed' this is the flat amount).
    price: { type: Number, required: true, default: 0 },
    // Fixed base amount, only used when pricingType === 'fixed_plus_per_unit'.
    basePrice: { type: Number, default: 0 },
    pricingType: {
      type: String,
      enum: ["per_unit", "per_arch", "fixed", "fixed_plus_per_unit"],
      default: "per_unit",
    },
    notes: String,
  },
  { _id: true },
);

const labSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, "Lab name is required"], trim: true },
    contactPerson: String,
    phone: String,
    address: String,
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    procedures: [procedureSchema],
  },
  { timestamps: true },
);

labSchema.index({ name: 1 });
labSchema.index({ status: 1 });

const Lab = mongoose.model("Lab", labSchema);

export default Lab;
