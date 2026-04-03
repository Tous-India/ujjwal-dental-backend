/**
 * Global Test Setup
 *
 * Connects to test database, seeds data, tears down after all tests.
 */
import { config } from "dotenv";
import { resolve } from "path";
import mongoose from "mongoose";
import { seedTestData } from "./helpers/seed.js";

// Load test env vars
config({ path: resolve(process.cwd(), ".env.test") });

beforeAll(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri || !uri.includes("test")) {
    throw new Error("Refusing to run tests on non-test database. Set MONGODB_URI to a test DB in .env.test");
  }

  await mongoose.connect(uri);
  await seedTestData();
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});
