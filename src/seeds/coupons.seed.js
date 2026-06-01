import dotenv from "dotenv";

import connectDB from "../config/db.js";
import Patient from "../modules/patients/patient.model.js";
import MembershipPlan from "../modules/memberships/membership.model.js";
import Coupon from "../modules/memberships/coupon.model.js";

dotenv.config();

/**
 * Seed mock patients who already bought a membership plan,
 * and auto-generate their coupon cards (same flow as a real purchase).
 *
 * Use this to demo the coupon cards + redeem flow.
 */
const mockMembers = [
  { name: "Aarav Mehta", phone: "9000000001", email: "member1@test.com" },
  { name: "Priya Nair", phone: "9000000002", email: "member2@test.com" },
  { name: "Rohan Verma", phone: "9000000003", email: "member3@test.com" },
];

const seedCoupons = async () => {
  try {
    await connectDB();

    // Get active plans
    const plans = await MembershipPlan.find({ isActive: true }).sort({ displayOrder: 1 });
    if (plans.length === 0) {
      console.error("❌ No active membership plans found. Run `npm run seed` first to seed plans.");
      process.exit(1);
    }

    console.log(`\n📋 Found ${plans.length} active plans\n`);

    const summary = [];

    for (let i = 0; i < mockMembers.length; i++) {
      const member = mockMembers[i];
      const plan = plans[i % plans.length]; // rotate through available plans

      // Clean re-run: remove existing patient + their coupons
      const existing = await Patient.findOne({ phone: member.phone });
      if (existing) {
        await Coupon.deleteMany({ patient: existing._id });
        await Patient.deleteOne({ _id: existing._id });
      }

      // Membership dates: now → +duration (default 12 months)
      const startDate = new Date();
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + (plan.durationMonths || 12));

      // Create patient with active membership
      const patient = await Patient.create({
        name: member.name,
        phone: member.phone,
        email: member.email,
        password: "Patient@123",
        isActive: true,
        membership: {
          plan: plan._id,
          planName: plan.name,
          discountPercent: plan.discountPercentage,
          startDate,
          expiryDate,
          status: "active",
        },
      });

      // Generate coupon cards (coupon #1 = unused/active, rest = locked)
      const coupons = await Coupon.generateForMembership(patient, plan, startDate, expiryDate);
      const sortedCoupons = [...coupons].sort((a, b) => a.couponNumber - b.couponNumber);

      // For the FIRST member, mark coupon #1 as used + unlock #2 (to demo "used" state)
      if (i === 0 && sortedCoupons.length >= 2) {
        const first = sortedCoupons[0];
        first.status = "used";
        first.usedAt = new Date();
        first.usageNotes = "Demo: redeemed at clinic visit";
        await first.save();

        const second = sortedCoupons[1];
        second.status = "unused";
        await second.save();
      }

      summary.push({
        patient: member.name,
        email: member.email,
        plan: plan.name,
        couponCodes: sortedCoupons.map((c) => `${c.code} [${c.couponNumber === 1 && i === 0 ? "used" : c.status}]`),
      });
    }

    // Print summary
    console.log("✅ Mock members + coupons created successfully!\n");
    console.log("═══════════════════════════════════════════════════");
    summary.forEach((s) => {
      console.log(`\n👤 ${s.patient}  (${s.email} / Patient@123)`);
      console.log(`   Plan: ${s.plan}`);
      console.log(`   Coupons:`);
      s.couponCodes.forEach((code) => console.log(`     • ${code}`));
    });
    console.log("\n═══════════════════════════════════════════════════");
    console.log("\n💡 To test redeem: copy an [unused] coupon code and verify it on Admin → Coupons page.\n");

    process.exit();
  } catch (error) {
    console.error("❌ Error seeding coupons:", error);
    process.exit(1);
  }
};

seedCoupons();
