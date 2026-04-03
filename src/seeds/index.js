import mongoose from "mongoose";
import dotenv from "dotenv";

import connectDB from "../config/db.js";
import User from "../modules/users/user.model.js";

dotenv.config();

const seedAdmin = async () => {
  try {
    await connectDB();

    // Delete existing admin and create fresh
    await User.deleteMany({ role: "admin" });
    console.log("🗑️ Cleared existing admins");

    const admin = await User.create({
      name: "Admin",
      email: "admin@ujjwaldental.com",
      phone: "9999999999",
      password: "Admin@123",
      role: "admin",
    });

    console.log("✅ Admin created successfully");
    console.log(admin);

    process.exit();
  } catch (error) {
    console.error("❌ Error seeding admin:", error);
    process.exit(1);
  }
};

seedAdmin();
