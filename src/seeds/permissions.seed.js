import dotenv from "dotenv";

import connectDB from "../config/db.js";
import Permission from "../modules/permissions/permission.model.js";
import { buildPermissionDocs } from "../modules/permissions/permission.constants.js";

dotenv.config();

/**
 * Seed the Permission matrix to EXACTLY match today's real, hardcoded
 * role-based access. See permission.constants.js for the full matrix and
 * the reasoning behind every value -- this script just persists it.
 * Additive only: creates new Permission documents, touches nothing else.
 */
const seedPermissions = async () => {
  try {
    await connectDB();

    const existing = await Permission.countDocuments();
    if (existing > 0) {
      console.log(`⚠️ ${existing} permission document(s) already exist. Skipping seed.`);
      console.log("To reseed, delete existing Permission documents first.");
      process.exit();
    }

    const docs = buildPermissionDocs();
    await Permission.insertMany(docs);
    console.log(`✅ Seeded ${docs.length} Permission documents.`);
    process.exit();
  } catch (err) {
    console.error("❌ Permission seed failed:", err);
    process.exit(1);
  }
};

seedPermissions();
