/**
 * purge-patient-data.js
 *
 * Deletes all patient-related documents from the database.
 * Preserves: users, blogs, membershipplans, clinics, systemsettings, permissions.
 *
 * Usage:
 *   node src/seeds/purge-patient-data.js
 *
 * Run from the backend/ directory where .env lives.
 * Requires MONGODB_URI to be set in .env.
 *
 * Flow:
 *   Step 1 — counts (read-only, displayed immediately)
 *   Step 2 — asks for explicit confirmation ("yes" must be typed)
 *   Step 3 — deletes (only if confirmed)
 *   Step 4 — verifies counts are all 0
 */

import "dotenv/config";
import mongoose from "mongoose";
import readline from "readline";

// ── Collections ────────────────────────────────────────────────────────────────

const TO_DELETE = [
  "patients",
  "appointments",
  "invoices",
  "payments",
  "reports",
  "labs",
  "laborders",
  "enquiries",
  "notifications",
  "followupreminders",
];

const TO_PRESERVE = [
  "users",
  "blogs",
  "membershipplans",
  "clinics",
  "systemsettings",
  "permissions",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const db = () => mongoose.connection.db;

async function countAll(names) {
  const results = {};
  for (const name of names) {
    results[name] = await db().collection(name).countDocuments();
  }
  return results;
}

function printCounts(label, counts) {
  console.log(`\n${label}`);
  console.log("─".repeat(40));
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(22)} ${count}`);
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("❌  MONGODB_URI is not set. Check your .env file.");
    process.exit(1);
  }

  console.log("\n━━━  PATIENT DATA PURGE SCRIPT  ━━━");
  console.log(`    Database: ${process.env.MONGODB_URI.replace(/\/\/[^@]+@/, "//***@")}`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅  Connected to MongoDB.\n");

  // ── STEP 1: Count ───────────────────────────────────────────────────────────

  console.log("STEP 1 — Current document counts");

  const deleteCounts  = await countAll(TO_DELETE);
  const preserveCounts = await countAll(TO_PRESERVE);

  printCounts("WILL BE DELETED:", deleteCounts);
  printCounts("WILL BE PRESERVED (not touched):", preserveCounts);

  const totalToDelete = Object.values(deleteCounts).reduce((a, b) => a + b, 0);
  console.log(`\n  Total documents to be deleted: ${totalToDelete}`);

  if (totalToDelete === 0) {
    console.log("\n✅  Nothing to delete — all collections are already empty.");
    await mongoose.disconnect();
    process.exit(0);
  }

  // ── STEP 2: Confirm ─────────────────────────────────────────────────────────

  console.log("\n" + "⚠️ ".repeat(20));
  console.log("  This operation is IRREVERSIBLE.");
  console.log("  All patient records, appointments, invoices, payments,");
  console.log("  reports, lab orders, enquiries, and notifications will be");
  console.log("  permanently deleted from the database.");
  console.log("⚠️ ".repeat(20));

  const answer = await ask('\nType  yes  to proceed, anything else to cancel: ');

  if (answer !== "yes") {
    console.log("\n❌  Cancelled. No data was deleted.");
    await mongoose.disconnect();
    process.exit(0);
  }

  // ── STEP 3: Delete ──────────────────────────────────────────────────────────

  console.log("\nSTEP 2 — Deleting...\n");

  for (const name of TO_DELETE) {
    const result = await db().collection(name).deleteMany({});
    console.log(`  ✓  ${name.padEnd(22)} deleted ${result.deletedCount} documents`);
  }

  // ── STEP 4: Verify ──────────────────────────────────────────────────────────

  console.log("\nSTEP 3 — Verifying...\n");

  const afterDelete   = await countAll(TO_DELETE);
  const afterPreserve = await countAll(TO_PRESERVE);

  printCounts("SHOULD ALL BE 0:", afterDelete);
  printCounts("SHOULD MATCH STEP 1 EXACTLY (untouched):", afterPreserve);

  const allZero = Object.values(afterDelete).every((n) => n === 0);
  const preserved = TO_PRESERVE.every((n) => afterPreserve[n] === preserveCounts[n]);

  console.log("\n" + "─".repeat(40));

  if (allZero && preserved) {
    console.log("✅  All checks passed. Purge complete.");
  } else {
    if (!allZero) {
      console.error("❌  Some delete-target collections are not empty — check manually.");
    }
    if (!preserved) {
      console.error("❌  Preserved collection counts changed — investigate immediately.");
    }
  }

  await mongoose.disconnect();
  console.log("🔌  Disconnected.\n");
}

main().catch((err) => {
  console.error("\n❌  Fatal error:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
