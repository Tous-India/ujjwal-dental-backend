/**
 * ONE-TIME DIAGNOSTIC SCRIPT — READ-ONLY
 *
 * Finds patients named "Aarav Mehta" who have an active membership
 * and logs their key fields to the console.
 *
 * Run from project root:
 *   node backend/src/scripts/findPatientByName.js
 *
 * DELETE THIS FILE after use — it is not meant to live in the repo.
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Patient from "../modules/patients/patient.model.js";

// Anchor .env to backend/ (2 dirs up from backend/src/scripts/)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });

// Case-insensitive partial match for "Aarav Mehta"
const NAME_REGEX = /aarav mehta/i;

const run = async () => {
  if (!process.env.MONGODB_URI) {
    console.error("❌  MONGODB_URI is not set. Check backend/.env");
    process.exit(1);
  }

  console.log("Connecting to MongoDB…");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected: ${mongoose.connection.host}\n`);

  // Query uses raw stored fields — virtuals are not queryable in MongoDB.
  // Matches patient.model.js hasMembership virtual:
  //   status === "active" AND expiryDate > now
  const patients = await Patient.find({
    name: { $regex: NAME_REGEX },
    "membership.status": "active",
    "membership.expiryDate": { $gt: new Date() },
  }).select(
    "-password -otp -resetPasswordToken -resetPasswordExpires"
  );

  if (patients.length === 0) {
    console.log(
      "⚠️  No patient found with name matching 'Aarav Mehta' and an active membership."
    );
  } else {
    console.log(`Found ${patients.length} matching patient(s):\n`);

    for (const p of patients) {
      console.log("──────────────────────────────────────────────────");
      console.log("_id              :", p._id.toString());
      console.log("name             :", p.name);
      console.log("phone            :", p.phone);
      console.log("email            :", p.email ?? "—");
      console.log("createdAt        :", p.createdAt);
      console.log("membership       :", JSON.stringify(p.membership, null, 2));
      console.log("hasMembership    :", p.hasMembership);   // virtual
      console.log("currentDiscount  :", p.currentDiscount, "%"); // virtual
      console.log("──────────────────────────────────────────────────\n");
    }
  }

  await mongoose.disconnect();
  console.log("Disconnected. Done.");
  process.exit(0);
};

run().catch((err) => {
  console.error("Script error:", err);
  mongoose.disconnect().finally(() => process.exit(1));
});
