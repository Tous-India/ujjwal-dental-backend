/**
 * Global Test Setup
 *
 * Spins up an ephemeral in-memory MongoDB (mongodb-memory-server) so the suite
 * runs without a real database or MONGODB_URI. Seeds data before tests and tears
 * the server down afterwards.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { seedTestData } from "./helpers/seed.js";

// Ensure test-environment behaviour (e.g. rate limiters skip in tests).
process.env.NODE_ENV = "test";

// Provide deterministic, non-secret defaults the app needs at runtime so the
// suite is self-contained (no real .env / .env.test required).
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5174";

let mongoServer;

beforeAll(async () => {
  // Production guard: hard-stop the suite before it touches any Atlas cluster.
  // This matters even though setup.js overrides MONGODB_URI with an in-memory
  // URI below — a future change that loads .env before this runs could silently
  // re-point models at production. Fail loudly instead.
  const rawUri = process.env.MONGODB_URI;
  if (rawUri && rawUri.includes(".mongodb.net")) {
    throw new Error(
      `PRODUCTION GUARD: MONGODB_URI "${rawUri.slice(0, 70)}..." ` +
      "points at a MongoDB Atlas cluster. " +
      "The test suite must run against an isolated database. Run aborted."
    );
  }

  // Pin to a MongoDB build that runs on the host OS (8.x targets macOS 14+).
  mongoServer = await MongoMemoryServer.create({
    binary: { version: "7.0.14" },
  });
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  await mongoose.connect(uri);
  await seedTestData();
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});
