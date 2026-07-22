import mongoose from "mongoose";

/**
 * INVOICE MODEL
 *
 * For billing patients for treatments, tests, and services
 *
 * Key features:
 * - Unique invoice number (INV-2401-0001)
 * - Multiple line items (treatments, tests, OPD fees)
 * - Discounts (membership, special)
 * - Tax calculations (GST if applicable)
 * - Payment tracking
 */

// ============ LINE ITEM SCHEMA ============
// Each item in the invoice

const lineItemSchema = new mongoose.Schema(
  {
    // Item type / category. "opd_fee" kept for backwards-compatibility with
    // existing invoices; "surgery" and "medicine" added per billing categories.
    itemType: {
      type: String,
      enum: ["treatment", "surgery", "test", "opd_fee", "membership", "medicine", "other"],
      required: true,
    },

    // Reference to the actual item (treatment, test, etc.)
    itemRef: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "items.itemRefModel",
    },

    itemRefModel: {
      type: String,
      enum: ["Treatment", "Test", "Appointment", "MembershipPlan"],
    },

    // Description
    description: {
      type: String,
      required: true,
    },

    // Quantity
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },

    // Unit price
    unitPrice: {
      type: Number,
      required: true,
    },

    // Discount on this item
    discount: {
      percentage: {
        type: Number,
        default: 0,
      },
      amount: {
        type: Number,
        default: 0,
      },
    },

    // Tax rate (if applicable)
    taxRate: {
      type: Number,
      default: 0,
    },

    // Calculated amount (after discount, before tax)
    amount: {
      type: Number,
      required: true,
    },

    // Tax amount
    taxAmount: {
      type: Number,
      default: 0,
    },

    // Total (amount + tax)
    total: {
      type: Number,
      required: true,
    },
  },
  { _id: true }
);

// ============ INVOICE SCHEMA ============

const invoiceSchema = new mongoose.Schema(
  {
    // Unique invoice number
    invoiceNumber: {
      type: String,
      unique: true,
    },

    // Patient
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: [true, "Patient is required"],
    },

    // Clinic. Optional: auto-generated invoices for online membership/treatment
    // payments may not be tied to a specific clinic. Admin-created invoices still
    // pass it. (Existing invoices already have a clinic — unaffected.)
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
    },

    // Related appointment (optional)
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
    },

    // Invoice date
    invoiceDate: {
      type: Date,
      default: Date.now,
    },

    // Due date
    dueDate: {
      type: Date,
    },

    // Line items
    items: [lineItemSchema],

    // Subtotal (sum of all item amounts before discount)
    subtotal: {
      type: Number,
      default: 0,
    },

    // Overall discount
    discount: {
      percentage: {
        type: Number,
        default: 0,
      },
      amount: {
        type: Number,
        default: 0,
      },
      reason: String,
    },

    // Total tax
    totalTax: {
      type: Number,
      default: 0,
    },

    // Grand total
    grandTotal: {
      type: Number,
      default: 0,
    },

    // Amount paid so far
    amountPaid: {
      type: Number,
      default: 0,
    },

    // Balance due
    balanceDue: {
      type: Number,
      default: 0,
    },

    // Invoice status
    status: {
      type: String,
      enum: ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"],
      default: "draft",
    },

    // Payment status
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid"],
      default: "unpaid",
    },

    // Payment method captured at creation when an initial amount is paid.
    // Optional — older invoices simply won't have it.
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "upi", "online", "razorpay", "pay-at-clinic", "free"],
    },

    // Notes
    notes: String,

    // Terms and conditions
    terms: String,

    // Created by
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Cancelled details
    cancelledAt: Date,
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    cancellationReason: String,
  },
  {
    timestamps: true,
  }
);

// ============ INDEXES ============

invoiceSchema.index({ patient: 1, createdAt: -1 });
// invoiceSchema.index({ invoiceNumber: 1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ paymentStatus: 1 });

// ============ PRE-SAVE MIDDLEWARE ============

/**
 * Generate invoice number and calculate totals
 */
invoiceSchema.pre("save", async function () {
  // Generate invoice number for new documents
  if (this.isNew) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");

    this.invoiceNumber = await mongoose.model("Invoice").findAvailableInvoiceNumber(year, month);

    // Set default due date (7 days from invoice date)
    if (!this.dueDate) {
      this.dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
  }

  // Calculate totals
  this.calculateTotals();
});

// ============ METHODS ============

/**
 * Calculate all totals
 */
invoiceSchema.methods.calculateTotals = function () {
  // Safety net: a paid invoice's grandTotal should never collapse to 0 while it
  // still has line items. This doesn't block the save (the guard in
  // updateAppointment is the real fix) -- it's a canary so a similar bug
  // elsewhere shows up in logs instead of silently corrupting an invoice.
  const hadNonzeroBalance = (this.amountPaid || 0) > 0;
  const willHaveItems = this.items && this.items.length > 0;

  // Calculate each item's totals
  this.items.forEach((item) => {
    // Calculate item amount after discount
    let amount = item.unitPrice * item.quantity;

    if (item.discount.percentage > 0) {
      amount = amount - (amount * item.discount.percentage) / 100;
    }
    if (item.discount.amount > 0) {
      amount = amount - item.discount.amount;
    }

    item.amount = Math.max(0, amount);

    // Calculate tax
    item.taxAmount = (item.amount * item.taxRate) / 100;

    // Calculate total
    item.total = item.amount + item.taxAmount;
  });

  // Calculate subtotal
  this.subtotal = this.items.reduce((sum, item) => sum + item.amount, 0);

  // Calculate total tax
  this.totalTax = this.items.reduce((sum, item) => sum + item.taxAmount, 0);

  // Apply overall discount
  let discountedSubtotal = this.subtotal;
  if (this.discount.percentage > 0) {
    discountedSubtotal = discountedSubtotal - (discountedSubtotal * this.discount.percentage) / 100;
  }
  if (this.discount.amount > 0) {
    discountedSubtotal = discountedSubtotal - this.discount.amount;
  }

  // Calculate grand total
  this.grandTotal = Math.max(0, Math.round(discountedSubtotal + this.totalTax));

  if (hadNonzeroBalance && willHaveItems && this.grandTotal === 0) {
    console.error(
      `SUSPICIOUS: recalculation would zero grandTotal on a paid invoice ` +
        `(invoice ${this._id}, invoiceNumber ${this.invoiceNumber}, ` +
        `amountPaid was ${this.amountPaid}, items still present but priced to 0).`
    );
  }

  // Calculate balance due
  this.balanceDue = Math.max(0, this.grandTotal - this.amountPaid);

  // Update payment status
  if (this.amountPaid >= this.grandTotal) {
    this.paymentStatus = "paid";
    if (this.status !== "cancelled") {
      this.status = "paid";
    }
  } else if (this.amountPaid > 0) {
    this.paymentStatus = "partial";
    if (this.status !== "cancelled") {
      this.status = "partially_paid";
    }
  } else {
    this.paymentStatus = "unpaid";
    // If status was previously "paid" or "partially_paid" (e.g. from a direct DB edit
    // or a future bug that sets status without updating amountPaid), reset it to "sent"
    // so the two fields stay consistent. "sent" is correct here because the invoice was
    // already issued to the patient — regressing to "draft" would hide it from the
    // patient and make it unactionable. Mirrors what reverseAdminPayment already does
    // manually (payment.controller.js) for the same reason.
    if (["paid", "partially_paid"].includes(this.status)) {
      this.status = "sent";
    }
  }
};

/**
 * Add a line item
 */
invoiceSchema.methods.addItem = function (itemData) {
  this.items.push(itemData);
  this.calculateTotals();
  return this.save();
};

/**
 * Remove a line item
 */
invoiceSchema.methods.removeItem = function (itemId) {
  this.items = this.items.filter((item) => item._id.toString() !== itemId.toString());
  this.calculateTotals();
  return this.save();
};

/**
 * Record a payment
 */
invoiceSchema.methods.recordPayment = function (amount) {
  this.amountPaid += amount;
  this.calculateTotals();
  return this.save();
};

/**
 * Mark as sent
 */
invoiceSchema.methods.markAsSent = function () {
  if (this.status === "draft") {
    this.status = "sent";
  }
  return this.save();
};

/**
 * Cancel invoice
 */
invoiceSchema.methods.cancelInvoice = function (userId, reason) {
  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = userId;
  this.cancellationReason = reason;
  return this.save();
};

// ============ STATICS ============

/**
 * Find an available invoice number for the given year/month.
 *
 * Uses the count of existing invoices with the same prefix as the starting
 * serial, then walks forward until an unused slot is found. This is
 * collision-safe under concurrent creates: we verify existence before
 * returning the number instead of blindly assigning count+1.
 *
 * @param {string} year  - 2-digit year, e.g. "26"
 * @param {string} month - 2-digit month, e.g. "06"
 * @returns {Promise<string>} Available invoice number, e.g. "INV-2606-0009"
 */
invoiceSchema.statics.findAvailableInvoiceNumber = async function (year, month) {
  const prefix = `INV-${year}${month}-`;

  const count = await this.countDocuments({
    invoiceNumber: { $regex: `^${prefix}` },
  });

  const MAX_ATTEMPTS = 10;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const candidate = `${prefix}${(count + 1 + i).toString().padStart(4, "0")}`;
    const exists = await this.findOne({ invoiceNumber: candidate }).lean();
    if (!exists) return candidate;
    console.warn(`[Invoice] invoiceNumber ${candidate} already taken, trying next...`);
  }

  throw new Error(
    `[Invoice] Could not find a free invoice number after ${MAX_ATTEMPTS} attempts (prefix: ${prefix})`
  );
};

/**
 * Aggregate invoice statistics for a given match query.
 *
 * Single source of truth for billing totals — used by the admin billing stats
 * endpoint AND the patient's own billing summary, so "Balance Due" / pending
 * amounts are always computed the same way (sum of per-invoice balanceDue).
 *
 * @param {Object} matchQuery - Mongo match stage (e.g. patient/clinic/date/status)
 * @returns {Promise<Object>} { totalInvoices, totalAmount, totalPaid, totalDue, paidCount, partialCount, unpaidCount }
 */
invoiceSchema.statics.getStats = async function (matchQuery = {}) {
  const stats = await this.aggregate([
    { $match: matchQuery },
    // Compute per-invoice OPD fee subtotal before grouping.
    // Filters items to opd_fee type and sums item.total (post-discount, post-tax).
    // For OPD fees taxRate is typically 0, so item.total == item.amount in practice.
    // This represents billed OPD revenue (not strictly cash-collected, since amountPaid
    // is not broken down per item type).
    {
      $addFields: {
        // Sum of OPD fee line-item totals for this invoice (0 if no OPD items).
        // Used as a flag: > 0 means this invoice contains OPD fee items.
        opdItemsTotal: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: "$items",
                  cond: { $eq: ["$$this.itemType", "opd_fee"] },
                },
              },
              in: "$$this.total",
            },
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        totalInvoices: { $sum: 1 },
        totalAmount: { $sum: "$grandTotal" },
        totalPaid: { $sum: "$amountPaid" },
        totalDue: { $sum: "$balanceDue" },
        paidCount: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] },
        },
        partialCount: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "partial"] }, 1, 0] },
        },
        unpaidCount: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "unpaid"] }, 1, 0] },
        },
        // Sum amountPaid (not billed amount) for invoices that contain OPD fee
        // items — gives cash actually collected, not total billed.
        opdCollection: {
          $sum: {
            $cond: [
              { $and: [{ $gt: ["$opdItemsTotal", 0] }, { $gt: ["$amountPaid", 0] }] },
              "$amountPaid",
              0,
            ],
          },
        },
      },
    },
  ]);

  return (
    stats[0] || {
      totalInvoices: 0,
      totalAmount: 0,
      totalPaid: 0,
      totalDue: 0,
      paidCount: 0,
      partialCount: 0,
      unpaidCount: 0,
      opdCollection: 0,
    }
  );
};

/**
 * Get pending invoices for a patient
 */
invoiceSchema.statics.getPendingInvoices = function (patientId) {
  return this.find({
    patient: patientId,
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: { $ne: "cancelled" },
  }).sort({ createdAt: -1 });
};

/**
 * Get overdue invoices
 */
invoiceSchema.statics.getOverdueInvoices = async function () {
  const now = new Date();

  // First update status of overdue invoices
  await this.updateMany(
    {
      dueDate: { $lt: now },
      paymentStatus: { $in: ["unpaid", "partial"] },
      status: { $nin: ["paid", "cancelled", "overdue"] },
    },
    { status: "overdue" }
  );

  // Return overdue invoices
  return this.find({
    status: "overdue",
  })
    .populate("patient", "name phone")
    .sort({ dueDate: 1 });
};

// Create and export the model
const Invoice = mongoose.model("Invoice", invoiceSchema);

export default Invoice;
