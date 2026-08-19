import mongoose from "mongoose";
const { Schema } = mongoose;

const externalIncomeSchema = new Schema({
  date: { type: Date, required: true },
  amount: { type: Number, required: true, min: [0.01, "Amount must be greater than 0"] },
  doctor: { type: Schema.Types.ObjectId, ref: "User", default: null },
  doctorName: { type: String, default: "" },
  clinicName: { type: String, required: true, trim: true },
  treatment: { type: String, required: true, trim: true },
  notes: { type: String, default: "" },
  recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  isVoided: { type: Boolean, default: false },
  voidedAt: { type: Date, default: null },
  voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  voidReason: { type: String, default: "" },
}, { timestamps: true });

// Validate that exactly one of doctor or doctorName is provided.
// Using async style (no next callback) for Mongoose 9 compatibility.
externalIncomeSchema.pre("validate", async function () {
  const hasDoctor = this.doctor != null;
  const hasDoctorName = this.doctorName && this.doctorName.trim().length > 0;
  if (!hasDoctor && !hasDoctorName) {
    throw new Error("Either doctor (staff) or doctorName (free text) must be provided");
  }
});

externalIncomeSchema.index({ date: -1 });
externalIncomeSchema.index({ isVoided: 1 });

export default mongoose.model("ExternalIncome", externalIncomeSchema);
