import dotenv from "dotenv";

import connectDB from "../config/db.js";
import { TreatmentMaster } from "../modules/treatments/treatment.model.js";

dotenv.config();

/**
 * Seed the treatment master catalog (15 treatments) from the public site's
 * treatment list. Prices are approximate starting points — editable later from
 * the admin panel.
 *
 * Non-destructive: upserts by `code`, so re-running updates rather than
 * duplicates and never deletes existing treatments.
 */
const treatments = [
  { name: "Dental Implant", code: "IMPL", category: "prosthodontic", price: 25000, duration: 90, description: "Titanium posts placed in the jawbone as a permanent foundation for replacement teeth." },
  { name: "Root Canal Treatment (RCT)", code: "RCT", category: "endodontic", price: 5000, duration: 60, description: "Removes infected pulp, cleans/disinfects, and seals the tooth to save it." },
  { name: "Wisdom Teeth", code: "WIS", category: "surgical", price: 3000, duration: 45, description: "Extraction of impacted or problematic third molars." },
  { name: "Clear Aligners", code: "ALGN", category: "orthodontic", price: 50000, duration: 45, description: "Custom, near-invisible removable trays that gradually straighten teeth." },
  { name: "Cosmetic Dental Bonding", code: "BOND", category: "cosmetic", price: 2000, duration: 45, description: "Tooth-colored resin applied and cured to repair or improve a tooth's look." },
  { name: "Laser Dentistry", code: "LASER", category: "other", price: 3000, duration: 30, description: "Focused-light procedures with greater precision and faster recovery." },
  { name: "Kids Dentistry", code: "KIDS", category: "pediatric", price: 800, duration: 30, description: "Child-focused oral care from infancy through the teen years." },
  { name: "Dental Crowns and Bridges", code: "CRWN", category: "restorative", price: 6000, duration: 60, description: "Fixed prosthetics that cover damaged teeth or fill gaps from missing ones." },
  { name: "Gum Disease Treatment", code: "GUM", category: "periodontic", price: 3000, duration: 45, description: "Treats periodontal infection that damages gum tissue and supporting bone." },
  { name: "Dental Filling", code: "FILL", category: "restorative", price: 800, duration: 30, description: "Restores a decayed tooth to normal shape and function." },
  { name: "Dentures", code: "DENT", category: "prosthodontic", price: 8000, duration: 60, description: "Removable replacements for missing teeth and surrounding tissue." },
  { name: "Teeth Whitening", code: "WHTN", category: "cosmetic", price: 6000, duration: 60, description: "Professional lightening that removes stains and discoloration." },
  { name: "Mouth Ulcers", code: "ULCR", category: "other", price: 500, duration: 20, description: "Diagnosis and relief for painful canker sores and oral lesions." },
  { name: "Braces", code: "BRC", category: "orthodontic", price: 30000, duration: 60, description: "Fixed appliances that correct misaligned teeth and jaws over time." },
  { name: "Smile Makeover", code: "SMILE", category: "cosmetic", price: 50000, duration: 90, description: "Combined cosmetic procedures customized to redesign the smile." },
];

const seedTreatments = async () => {
  // Match the main seed's guard: never run with NODE_ENV=production.
  // (This seed is non-destructive — upsert only — but we keep the guard for
  // consistency; the target database is selected by MONGODB_URI.)
  if (process.env.NODE_ENV === "production") {
    console.error("❌ Refusing to run seed script in production (NODE_ENV=production).");
    process.exit(1);
  }

  try {
    await connectDB();

    let inserted = 0;
    let updated = 0;

    for (const t of treatments) {
      const code = t.code.toUpperCase();
      const existing = await TreatmentMaster.findOne({ code });

      // Upsert by code (no deletes). setDefaultsOnInsert keeps schema defaults
      // (isActive: true, sessionsRequired: 1) on first insert.
      await TreatmentMaster.updateOne(
        { code },
        { $set: { ...t, code } },
        { upsert: true, setDefaultsOnInsert: true },
      );

      if (existing) {
        updated += 1;
        console.log(`↻ updated  ${code.padEnd(6)} ${t.name}`);
      } else {
        inserted += 1;
        console.log(`＋ inserted ${code.padEnd(6)} ${t.name}`);
      }
    }

    const total = await TreatmentMaster.countDocuments();
    console.log("\n✅ Treatment seed complete.");
    console.log(`   inserted: ${inserted}, updated: ${updated}`);
    console.log(`   total treatment masters now in DB: ${total}`);

    process.exit();
  } catch (error) {
    console.error("❌ Error seeding treatments:", error);
    process.exit(1);
  }
};

seedTreatments();
