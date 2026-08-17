/**
 * add-expenses-permissions.js
 *
 * One-time migration: upserts Permission documents for the new "expenses"
 * module for all 4 roles. Safe to re-run — uses findOneAndUpdate with
 * upsert: true so existing rows are updated and missing ones are created.
 *
 * Usage (from backend/ directory):
 *   node src/seeds/add-expenses-permissions.js
 */

import "dotenv/config";
import connectDB from "../config/db.js";
import Permission from "../modules/permissions/permission.model.js";

const EXPENSES_MATRIX = {
  admin:          { view: true,  create: true,  edit: true,  delete: true  },
  blog_editor:    { view: false, create: false, edit: false, delete: false },
  clinic_manager: { view: true,  create: true,  edit: true,  delete: true  },
  user:           { view: true,  create: true,  edit: true,  delete: false },
};

const run = async () => {
  try {
    await connectDB();
    console.log("Connected to MongoDB.");

    for (const [role, actions] of Object.entries(EXPENSES_MATRIX)) {
      const result = await Permission.findOneAndUpdate(
        { role, module: "expenses" },
        { role, module: "expenses", ...actions },
        { upsert: true, new: true }
      );
      console.log(`  ${role} / expenses → upserted (${JSON.stringify(actions)})`);
    }

    const total = await Permission.countDocuments();
    console.log(`\nDone. Total permission documents: ${total}`);
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
};

run();
