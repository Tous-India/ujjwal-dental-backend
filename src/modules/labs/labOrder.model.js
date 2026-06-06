import mongoose from "mongoose";

/**
 * LAB ORDER MODEL
 *
 * An order placed with a dental lab for a patient. Tracks line items,
 * payment history (with auto-derived paymentStatus) and delivery status.
 */

const orderItemSchema = new mongoose.Schema(
  {
    procedure: { type: String, required: true },
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, required: true, default: 0 }, // per-unit (or flat, for 'fixed')
    basePrice: { type: Number, default: 0 }, // fixed base for 'fixed_plus_per_unit'
    pricingType: {
      type: String,
      enum: ["per_unit", "per_arch", "fixed", "fixed_plus_per_unit"],
      default: "per_unit",
    },
    totalPrice: { type: Number, default: 0 }, // computed from pricingType
  },
  { _id: true },
);

const paymentEntrySchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    method: { type: String }, // Cash / UPI / Bank Transfer
    notes: String,
  },
  { _id: true },
);

const labOrderSchema = new mongoose.Schema(
  {
    // Human-friendly order number (auto-generated)
    orderNumber: { type: String, unique: true, index: true },

    lab: { type: mongoose.Schema.Types.ObjectId, ref: "Lab", required: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    doctor: String, // name of the ordering doctor

    items: [orderItemSchema],

    totalAmount: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partially_paid", "paid"],
      default: "unpaid",
    },
    paymentHistory: [paymentEntrySchema],

    deliveryStatus: {
      type: String,
      enum: ["pending", "in_progress", "delivered", "rejected"],
      default: "pending",
    },

    // Soft archive — archived orders are hidden from the default "Active" view.
    archived: { type: Boolean, default: false },

    orderDate: { type: Date, default: Date.now },
    expectedDelivery: Date,
    deliveredDate: Date,
    notes: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

labOrderSchema.index({ lab: 1, createdAt: -1 });
labOrderSchema.index({ patient: 1, createdAt: -1 });
labOrderSchema.index({ deliveryStatus: 1 });
labOrderSchema.index({ paymentStatus: 1 });

// ============ METHODS ============

/**
 * Recompute per-item totals, order total, balance and paymentStatus.
 */
labOrderSchema.methods.calculateTotals = function () {
  this.items.forEach((it) => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unitPrice) || 0;
    const base = Number(it.basePrice) || 0;
    if (it.pricingType === "fixed") {
      it.totalPrice = unit; // flat amount, quantity ignored
    } else if (it.pricingType === "fixed_plus_per_unit") {
      it.totalPrice = base + qty * unit; // e.g. ₹500 + (3 × ₹100) = ₹800
    } else {
      it.totalPrice = qty * unit; // per_unit / per_arch
    }
  });
  this.totalAmount = this.items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
  this.balanceDue = Math.max(0, this.totalAmount - this.amountPaid);

  if (this.totalAmount > 0 && this.amountPaid >= this.totalAmount) {
    this.paymentStatus = "paid";
  } else if (this.amountPaid > 0) {
    this.paymentStatus = "partially_paid";
  } else {
    this.paymentStatus = "unpaid";
  }
};

/**
 * Record a payment against this order and recompute status.
 */
labOrderSchema.methods.recordPayment = function ({ amount, method, notes, date }) {
  this.amountPaid += Number(amount) || 0;
  this.paymentHistory.push({
    amount: Number(amount) || 0,
    method,
    notes,
    date: date ? new Date(date) : new Date(),
  });
  this.calculateTotals();
  return this.save();
};

// ============ PRE-SAVE ============

labOrderSchema.pre("save", async function () {
  // Generate order number on first save (LO-YYMM-XXXX)
  if (this.isNew && !this.orderNumber) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const count = await mongoose.model("LabOrder").countDocuments({
      createdAt: {
        $gte: new Date(date.getFullYear(), date.getMonth(), 1),
        $lte: new Date(date.getFullYear(), date.getMonth() + 1, 0),
      },
    });
    this.orderNumber = `LO-${year}${month}-${(count + 1).toString().padStart(4, "0")}`;
  }

  // Keep totals/status in sync on every save
  this.calculateTotals();
});

const LabOrder = mongoose.model("LabOrder", labOrderSchema);

export default LabOrder;
