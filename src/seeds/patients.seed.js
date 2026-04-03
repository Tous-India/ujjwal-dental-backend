import mongoose from "mongoose";
import dotenv from "dotenv";

import connectDB from "../config/db.js";
import Patient from "../modules/patients/patient.model.js";

dotenv.config();

/**
 * Seed test patients with email and password for testing
 */
const seedPatients = async () => {
  try {
    await connectDB();

    // Test patients data
    const testPatients = [
      {
        name: "Test Patient",
        phone: "9876543210",
        email: "patient@test.com",
        password: "Patient@123",
        gender: "male",
        dateOfBirth: new Date("1990-05-15"),
        bloodGroup: "O+",
        address: {
          street: "123 Test Street",
          city: "Hisar",
          state: "Haryana",
          pincode: "125001",
        },
        isActive: true,
      },
      {
        name: "Rahul Sharma",
        phone: "9876543211",
        email: "rahul@example.com",
        password: "Patient@123",
        gender: "male",
        dateOfBirth: new Date("1985-08-20"),
        bloodGroup: "A+",
        address: {
          street: "456 Main Road",
          city: "Hisar",
          state: "Haryana",
          pincode: "125001",
        },
        isActive: true,
      },
      {
        name: "Priya Gupta",
        phone: "9876543212",
        email: "priya@example.com",
        password: "Patient@123",
        gender: "female",
        dateOfBirth: new Date("1992-03-10"),
        bloodGroup: "B+",
        address: {
          street: "789 Park Avenue",
          city: "Hisar",
          state: "Haryana",
          pincode: "125001",
        },
        allergies: ["Penicillin"],
        isActive: true,
      },
    ];

    // Delete existing test patients by email
    const testEmails = testPatients.map((p) => p.email);
    await Patient.deleteMany({ email: { $in: testEmails } });
    console.log("🗑️ Cleared existing test patients");

    // Create patients
    const createdPatients = await Patient.create(testPatients);

    console.log("✅ Test patients created successfully");
    console.log("\n📋 Test Patient Credentials:");
    console.log("================================");
    testPatients.forEach((p) => {
      console.log(`Email: ${p.email}`);
      console.log(`Password: ${p.password}`);
      console.log("--------------------------------");
    });

    process.exit();
  } catch (error) {
    console.error("❌ Error seeding patients:", error);
    process.exit(1);
  }
};

// Run if called directly
seedPatients();
