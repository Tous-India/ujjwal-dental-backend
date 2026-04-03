import mongoose from "mongoose";
import dotenv from "dotenv";

import connectDB from "../config/db.js";
import Patient from "../modules/patients/patient.model.js";

dotenv.config();

/**
 * Set password for an existing patient
 * Usage: node src/seeds/set-patient-password.js <email> <password>
 */
const setPatientPassword = async () => {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.log("Usage: node src/seeds/set-patient-password.js <email> <password>");
    console.log("Example: node src/seeds/set-patient-password.js patient@test.com MyPassword123");
    process.exit(1);
  }

  try {
    await connectDB();

    // Find patient by email
    const patient = await Patient.findOne({ email: email.toLowerCase() });

    if (!patient) {
      console.error(`❌ Patient with email "${email}" not found`);
      process.exit(1);
    }

    // Set password (will be hashed by pre-save hook)
    patient.password = password;
    await patient.save();

    console.log(`✅ Password set successfully for patient: ${patient.name} (${patient.email})`);
    process.exit();
  } catch (error) {
    console.error("❌ Error setting password:", error);
    process.exit(1);
  }
};

setPatientPassword();
