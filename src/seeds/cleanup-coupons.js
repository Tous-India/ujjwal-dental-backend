/**
 * ONE-TIME CLEANUP SCRIPT — DELETE AFTER RUNNING
 * Removes all coupon data from MongoDB:
 * 1. Drops the `coupons` collection
 * 2. Unsets coupon fields from all patients
 * 3. Unsets couponConfig from all membership plans
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

await connectDB();

const results = {};

// 1. Drop coupons collection
const collections = await mongoose.connection.db
  .listCollections({ name: "coupons" })
  .toArray();

if (collections.length > 0) {
  await mongoose.connection.db.dropCollection("coupons");
  results.couponsCollection = "DROPPED";
} else {
  results.couponsCollection = "not found (already clean)";
}

// 2. Remove coupon fields from all patients
const patientResult = await mongoose.connection.db
  .collection("patients")
  .updateMany({}, { $unset: { coupons: "", couponCards: "" } });
results.patientsModified = patientResult.modifiedCount;

// 3. Remove couponConfig from all membership plans
const planResult = await mongoose.connection.db
  .collection("membershipplans")
  .updateMany({}, { $unset: { couponConfig: "" } });
results.plansModified = planResult.modifiedCount;

console.log("Coupon cleanup complete:", results);

await mongoose.disconnect();
process.exit(0);
