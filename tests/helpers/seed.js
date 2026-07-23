/**
 * Test Seed Data
 *
 * Creates minimal fixtures for testing.
 * Run once before all tests via setup.js
 */
import User from "../../src/modules/users/user.model.js";
import Patient from "../../src/modules/patients/patient.model.js";
import Clinic from "../../src/modules/clinics/clinic.model.js";
import Permission from "../../src/modules/permissions/permission.model.js";
import { buildPermissionDocs } from "../../src/modules/permissions/permission.constants.js";

export const testData = {
  admin: null,
  patient: null,
  clinic: null,
};

export async function seedTestData() {
  // Clean collections
  await User.deleteMany({});
  await Patient.deleteMany({});
  await Clinic.deleteMany({});
  await Permission.deleteMany({});

  // Seed the same Permission matrix the real DB has, so checkPermission-gated
  // routes behave identically in tests (in-memory DB starts empty otherwise).
  await Permission.insertMany(buildPermissionDocs());

  // Create admin
  testData.admin = await User.create({
    name: "Test Admin",
    email: "admin@test.com",
    phone: "9999999999",
    password: "Admin@123",
    role: "admin",
  });

  // Create clinic
  testData.clinic = await Clinic.create({
    name: "Test Clinic",
    phone: "1234567890",
    address: {
      street: "Test Street",
      city: "Test City",
      state: "Test State",
      pincode: "123456",
    },
    isActive: true,
  });

  // Create patient
  testData.patient = await Patient.create({
    name: "Test Patient",
    phone: "9876543210",
    email: "patient@test.com",
    password: "Patient@123",
    gender: "male",
  });

  return testData;
}
