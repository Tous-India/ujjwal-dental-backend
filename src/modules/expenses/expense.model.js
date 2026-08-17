import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: ["lab", "salaries", "rent", "utilities", "materials", "equipment", "marketing", "other"],
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    paymentMode: {
      type: String,
      required: true,
      enum: ["cash", "upi", "net_banking", "card", "cheque", "other"],
    },
    // Who physically spent/paid the money — user-selectable, defaults to the
    // logged-in user but can be changed to record someone else's spend.
    spentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Who entered this record — set server-side from req.user, never editable.
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    vendor: {
      type: String,
      trim: true,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
    },
    notes: {
      type: String,
      trim: true,
    },
    // Minimal financial-audit trail: last-edit tracking only.
    // Full edit-history (an array of {editedBy,editedAt,changes}) would be
    // more rigorous but adds complexity — the simpler approach records who
    // last touched the record, which covers the primary audit need.
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    editedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1 });
expenseSchema.index({ clinic: 1, date: -1 });
expenseSchema.index({ spentBy: 1 });

const Expense = mongoose.model("Expense", expenseSchema);
export default Expense;
