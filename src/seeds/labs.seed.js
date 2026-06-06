import dotenv from "dotenv";
import connectDB from "../config/db.js";
import Lab from "../modules/labs/lab.model.js";

dotenv.config();

/**
 * Seed the 4 dental labs with their procedure price lists.
 * Idempotent: upserts by lab name and refreshes the procedures list.
 * Never deletes existing labs or lab orders.
 */

const labs = [
  {
    name: "SN Dental Lab",
    procedures: [
      { name: "PFM Crown", price: 300, pricingType: "per_unit" },
      { name: "Zirconia Crown", price: 1000, pricingType: "per_unit" },
      { name: "Ortho Appliance (Single)", price: 400, pricingType: "per_unit" },
    ],
  },
  {
    name: "Ranjeet Lab",
    procedures: [
      { name: "Denture (Full)", price: 1500, pricingType: "fixed" },
      {
        name: "Partial Denture",
        pricingType: "fixed_plus_per_unit",
        basePrice: 500,
        price: 100, // per additional unit
        notes: "₹500 base + ₹100 per unit",
      },
    ],
  },
  {
    name: "Ambani Dental Lab",
    procedures: [
      { name: "Denture", price: 2000, pricingType: "fixed" },
      { name: "RPD", price: 170, pricingType: "per_unit" },
      { name: "Zirconia 5yr", price: 1000, pricingType: "per_unit" },
      { name: "DMLS", price: 600, pricingType: "per_unit" },
      { name: "PFM Crown", price: 600, pricingType: "per_unit" },
    ],
  },
  {
    name: "DigiPro Dental Lab",
    procedures: [
      { name: "Cement Retained/Basal Implant PFM", price: 800, pricingType: "per_unit" },
      { name: "Screw Retained PFM", price: 1300, pricingType: "per_unit" },
      { name: "Screw Cement Retained Zirconia (Monolith)", price: 2000, pricingType: "per_unit" },
      { name: "Screw Cement Retained Zirconia (Layered)", price: 2500, pricingType: "per_unit" },
      { name: "Hybrid Prosthesis DMLS (Vita/Ivoclar Teeth)", price: 15000, pricingType: "per_arch" },
      { name: "DMLS PFM Full Arch Prosthesis", price: 18000, pricingType: "per_arch" },
      { name: "Paulo Malo Bridge DMLS Bar (PFM Crown + Gingival Porcelain)", price: 28000, pricingType: "per_arch" },
      { name: "Paulo Malo Bridge DMLS Bar (Zirconia Crown + Gingival Porcelain)", price: 38000, pricingType: "per_arch" },
      { name: "PEEK Prosthesis with Composite Build-Up", price: 3500, pricingType: "per_unit" },
      { name: "Metal Bar Ball Supported Implant Denture", price: 17000, pricingType: "fixed" },
      { name: "Metal Bar Clip (Hader Bar) Supported Overdenture", price: 18000, pricingType: "fixed" },
      { name: "Extra Ball Attachment (Female Part) on Metal Bar", price: 4000, pricingType: "per_unit" },
      { name: "Implant Prosthetic Screw (Osstem)", price: 250, pricingType: "per_unit" },
      { name: "DMLS Custom Abutment", price: 2200, pricingType: "per_unit" },
    ],
  },
];

const seedLabs = async () => {
  if (process.env.NODE_ENV === "production") {
    console.error("❌ Refusing to run seed script in production (NODE_ENV=production).");
    process.exit(1);
  }

  try {
    await connectDB();

    let inserted = 0;
    let updated = 0;

    for (const l of labs) {
      const existing = await Lab.findOne({ name: l.name });
      await Lab.updateOne(
        { name: l.name },
        { $set: { ...l, status: "active" } },
        { upsert: true, setDefaultsOnInsert: true },
      );
      if (existing) {
        updated += 1;
        console.log(`↻ updated  ${l.name} (${l.procedures.length} procedures)`);
      } else {
        inserted += 1;
        console.log(`＋ inserted ${l.name} (${l.procedures.length} procedures)`);
      }
    }

    const total = await Lab.countDocuments();
    console.log("\n✅ Lab seed complete.");
    console.log(`   inserted: ${inserted}, updated: ${updated}`);
    console.log(`   total labs now in DB: ${total}`);

    process.exit();
  } catch (error) {
    console.error("❌ Error seeding labs:", error);
    process.exit(1);
  }
};

seedLabs();
