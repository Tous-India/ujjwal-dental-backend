/**
 * ONE-TIME FIX SCRIPT — Delete after use
 *
 * Re-activates patients who have an active membership plan but are
 * incorrectly marked as Inactive (isActive: false).
 *
 * Only touches: isActive field
 * Does NOT modify: membership, phone, name, or any other field
 *
 * Run: node --experimental-vm-modules src/scripts/fixMemberPatientStatus.js
 *  or: node -r dotenv/config src/scripts/fixMemberPatientStatus.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Patient from "../modules/patients/patient.model.js";

await connectDB();

const now = new Date();

const stalePatients = await Patient.find({
  "membership.status": "active",
  "membership.expiryDate": { $gt: now },
  isActive: false,
});

if (stalePatients.length === 0) {
  console.log("No patients need fixing — all member patients are already Active.");
} else {
  console.log(`Found ${stalePatients.length} patient(s) to re-activate:\n`);

  for (const patient of stalePatients) {
    patient.isActive = true;
    await patient.save();
    console.log(`  ✔ ${patient.name} (${patient.phone}) — re-activated`);
  }

  console.log(`\nDone. ${stalePatients.length} patient(s) corrected.`);
}

await mongoose.disconnect();
process.exit(0);
