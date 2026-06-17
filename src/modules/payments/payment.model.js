import mongoose from "mongoose";

/**
 * PAYMENT MODEL
 *
 * For tracking all payments made by patients
 *
 * Supports:
 * - Cash payments
 * - Card payments
 * - UPI payments
 * - Razorpay online payments
 */

const paymentSchema = new mongoose.Schema(
  {
    // Unique payment number (auto-generated in pre-save)
    paymentNumber: {
      type: String,
      unique: true,
      index: true,
    },

    // Patient who made the payment (optional for online booking - linked after payment)
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
    },

    // Invoice being paid (optional - can be advance payment)
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
    },

    // Related appointment (optional)
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
    },

    // Related treatment from the catalog (optional - set for treatment payments
    // booked by patients from the portal). treatmentName is stored alongside so
    // the label survives even if the catalog entry is later edited/removed.
    treatmentType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TreatmentMaster",
    },
    treatmentName: String,

    // Clinic where payment was made (optional for online membership purchases)
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
    },

    // Payment amount
    amount: {
      type: Number,
      required: [true, "Payment amount is required"],
      min: [1, "Amount must be at least 1"],
    },

    // Payment method
    paymentMode: {
      type: String,
      enum: ["cash", "card", "upi", "razorpay", "netbanking", "other"],
      required: [true, "Payment method is required"],
    },

    // Payment status
    status: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "cancelled", "reversed"],
      default: "pending",
    },

    // Payment type
    type: {
      type: String,
      enum: [
        "opd_fee",
        "consultation",
        "treatment",
        "test",
        "invoice_payment",
        "advance",
        "membership",
        "refund",
        "other",
      ],
      default: "opd_fee",
    },

    // Payment date
    paidAt: Date,

    // === Razorpay specific fields ===
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,

    // Razorpay additional details
    razorpayDetails: {
      receipt: String,
      method: String, // card, upi, netbanking
      bank: String,
      wallet: String,
      vpa: String, // UPI ID
      fee: Number,
      tax: Number,
      errorCode: String,
      errorDescription: String,
    },

    // === For offline payments (cash/card/upi at clinic) ===
    referenceNumber: String, // For card/upi reference

    // Received by (staff)
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // === Refund details ===
    refund: {
      refundedAt: Date,
      refundedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      reason: String,
      razorpayRefundId: String,
    },

    // General notes
    notes: String,

    // ── Admin-recorded payment settlement ──────────────────────────────
    // Stores which invoices were settled and by how much, enabling exact reversal.
    settledInvoices: [
      {
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
        invoiceNumber: String,
        appliedAmount: Number,
        previousAmountPaid: Number,
      },
    ],

    // Admin user who recorded this payment (for manual cash/UPI/card payments)
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Reversal fields
    reversed: { type: Boolean, default: false },
    reversalReason: String,
    reversedAt: Date,
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// ============ INDEXES ============

paymentSchema.index({ patient: 1, createdAt: -1 });
paymentSchema.index({ invoice: 1 });
// paymentSchema.index({ paymentNumber: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ razorpayOrderId: 1 });

// ============ PRE-SAVE MIDDLEWARE ============

/**
 * Generate payment number (Mongoose 6.x+ async middleware - no next() needed)
 */
paymentSchema.pre("save", async function () {
  // Generate payment number for new documents
  if (this.isNew && !this.paymentNumber) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");

    // Count payments this month
    const count = await mongoose.model("Payment").countDocuments({
      createdAt: {
        $gte: new Date(date.getFullYear(), date.getMonth(), 1),
        $lte: new Date(date.getFullYear(), date.getMonth() + 1, 0),
      },
    });

    const serial = (count + 1).toString().padStart(4, "0");
    this.paymentNumber = `PAY-${year}${month}-${serial}`;
  }
});

// ============ POST-SAVE MIDDLEWARE ============

/**
 * Update invoice after successful payment
 */
paymentSchema.post("save", async function (doc) {
  // Only update invoice if payment is completed and linked to an invoice
  if (doc.status === "paid" && doc.invoice) {
    const Invoice = mongoose.model("Invoice");
    const invoice = await Invoice.findById(doc.invoice);

    if (invoice) {
      await invoice.recordPayment(doc.amount);
    }
  }
});

// ============ METHODS ============

/**
 * Mark payment as completed/paid
 */
paymentSchema.methods.markAsPaid = function () {
  this.status = "paid";
  this.paidAt = new Date();
  return this.save();
};

/**
 * Mark payment as failed
 */
paymentSchema.methods.markAsFailed = function (errorCode, errorDescription) {
  this.status = "failed";
  if (errorCode) {
    this.razorpayDetails = this.razorpayDetails || {};
    this.razorpayDetails.errorCode = errorCode;
    this.razorpayDetails.errorDescription = errorDescription;
  }
  return this.save();
};

/**
 * Process refund
 */
paymentSchema.methods.processRefund = function (
  userId,
  reason,
  razorpayRefundId,
) {
  this.status = "refunded";
  this.refund = {
    refundedAt: new Date(),
    refundedBy: userId,
    reason,
    razorpayRefundId,
  };
  return this.save();
};

// ============ STATICS ============

/**
 * Find payment by Razorpay order ID
 */
paymentSchema.statics.findByRazorpayOrderId = function (orderId) {
  return this.findOne({ razorpayOrderId: orderId });
};

/**
 * Get payment summary for a patient
 */
paymentSchema.statics.getPatientPaymentSummary = async function (patientId) {
  const result = await this.aggregate([
    {
      $match: {
        patient: new mongoose.Types.ObjectId(patientId),
        status: "paid",
      },
    },
    {
      $group: {
        _id: null,
        totalPaid: { $sum: "$amount" },
        paymentCount: { $sum: 1 },
      },
    },
  ]);

  if (result.length === 0) {
    return { totalPaid: 0, paymentCount: 0 };
  }

  return {
    totalPaid: result[0].totalPaid,
    paymentCount: result[0].paymentCount,
  };
};

/**
 * Get daily collection report
 */
paymentSchema.statics.getDailyCollection = async function (clinicId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await this.aggregate([
    {
      $match: {
        clinic: new mongoose.Types.ObjectId(clinicId),
        status: "paid",
        paidAt: { $gte: startOfDay, $lte: endOfDay },
      },
    },
    {
      $group: {
        _id: "$paymentMode",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const collection = {
    total: 0,
    byMethod: {},
    count: 0,
  };

  result.forEach((item) => {
    collection.byMethod[item._id] = {
      total: item.total,
      count: item.count,
    };
    collection.total += item.total;
    collection.count += item.count;
  });

  return collection;
};

// Create and export the model
const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;
