import dotenv from "dotenv";

import connectDB from "../config/db.js";
import Clinic from "../modules/clinics/clinic.model.js";

dotenv.config();

/**
 * Seed clinics for Ujjwal Dental
 */
const seedClinics = async () => {
  try {
    await connectDB();

    // Check if clinics already exist
    const existingClinics = await Clinic.countDocuments();
    if (existingClinics > 0) {
      console.log(`⚠️ ${existingClinics} clinic(s) already exist. Skipping seed.`);
      console.log("To reseed, delete existing clinics first.");
      process.exit();
    }

    // Ujjwal Dental Clinic locations
    const clinics = [
      {
        name: "Ujjwal Dental - Delhi Road",
        address: {
          street: "Shop No. 5, Near Bus Stand",
          area: "Delhi Road",
          city: "Hisar",
          state: "Haryana",
          pincode: "125001",
        },
        phone: "9876543210",
        isActive: true,
      },
      {
        name: "Ujjwal Dental - Parsavnath",
        address: {
          street: "Parsavnath City Center, Shop No. 12",
          area: "Parsavnath",
          city: "Hisar",
          state: "Haryana",
          pincode: "125001",
        },
        phone: "9876543220",
        isActive: true,
      },
    ];

    // Create clinics
    const createdClinics = await Clinic.create(clinics);

    console.log("✅ Clinics seeded successfully!");
    console.log("\n📋 Clinic Details:");
    console.log("================================");
    createdClinics.forEach((clinic) => {
      console.log(`Name: ${clinic.name}`);
      console.log(`City: ${clinic.address.city}`);
      console.log(`Phone: ${clinic.phone}`);
      console.log(`Active: ${clinic.isActive}`);
      console.log("--------------------------------");
    });

    process.exit();
  } catch (error) {
    console.error("❌ Error seeding clinics:", error);
    process.exit(1);
  }
};

seedClinics();
