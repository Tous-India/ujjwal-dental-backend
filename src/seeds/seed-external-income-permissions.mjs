/**
 * Seed: External Income Permissions
 *
 * Inserts (or updates) the 4 permission rows for the "external_income" module
 * for every role currently present in the Permission collection.
 *
 * Default grants:
 *   view   — all roles
 *   create — admin + user (staff)
 *   edit   — admin only
 *   delete — admin only  (delete = void in our soft-delete model)
 *
 * Uses upsert so re-running is fully idempotent.
 */
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not defined in .env");
  process.exit(1);
}

// Inline minimal Permission schema to avoid import-path issues in .mjs
const permissionSchema = new mongoose.Schema(
  {
    role: { type: String, required: true },
    module: { type: String, required: true },
    view: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
  },
  { timestamps: true }
);
permissionSchema.index({ role: 1, module: 1 }, { unique: true });

const Permission =
  mongoose.models.Permission || mongoose.model("Permission", permissionSchema);

const run = async () => {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  // Collect all distinct roles already in the Permission collection
  const distinctRoles = await Permission.distinct("role");

  if (distinctRoles.length === 0) {
    console.warn(
      "⚠️  No existing roles found in Permission collection. " +
      "Ensure the permission seed has been run first (or seed the main permissions)."
    );
    // Fall back to known roles from the app
    distinctRoles.push("admin", "user", "blog_editor", "clinic_manager");
    console.log("Using fallback roles:", distinctRoles.join(", "));
  } else {
    console.log("Roles found:", distinctRoles.join(", "));
  }

  const results = [];
  for (const role of distinctRoles) {
    const doc = await Permission.findOneAndUpdate(
      { role, module: "external_income" },
      {
        $set: {
          role,
          module: "external_income",
          view: true,
          create: role === "admin" || role === "user",
          edit: role === "admin",
          delete: role === "admin",
        },
      },
      { upsert: true, new: true }
    );
    results.push({ role, view: doc.view, create: doc.create, edit: doc.edit, delete: doc.delete });
  }

  console.table(results);
  console.log(`\n✅ external_income permissions seeded for ${results.length} role(s).`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
