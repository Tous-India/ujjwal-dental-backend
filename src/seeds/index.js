import mongoose from "mongoose";
import dotenv from "dotenv";

import connectDB from "../config/db.js";
import User from "../modules/users/user.model.js";

dotenv.config();

const seedAdmin = async () => {
  // Refuse to run against production: this seed deletes all admin users and
  // recreates one with a well-known default password.
  if (process.env.NODE_ENV === "production") {
    console.error("❌ Refusing to run seed script in production (NODE_ENV=production).");
    process.exit(1);
  }

  try {
    await connectDB();

    // Delete existing admin and create fresh
    await User.deleteMany({ role: "admin" });
    console.log("🗑️ Cleared existing admins");

    const admin = await User.create({
      name: "Admin",
      email: "ujjwaldentalplanet.in@gmail.com",
      phone: "9999999999",
      password: "Easylogin@1",
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


// mail: ujjwaldentalplanet.in@gmail.com
// Password: Easylogin@1
 