import dotenv from "dotenv";
import connectDB from "../config/db.js";
import User from "../modules/users/user.model.js";

dotenv.config();

const createAdmin = async () => {
  if (process.env.NODE_ENV === "production") {
    console.error("❌ Refusing to run seed script in production.");
    process.exit(1);
  }

  try {
    await connectDB();

    const email = "ujjwaldental832@gmail.com";

    const existing = await User.findOne({ email });
    if (existing) {
      // Update password so we know it's correct
      existing.password = "Easylogin@1";
      existing.isActive = true;
      await existing.save();
      console.log("✅ Admin password updated for:", email);
    } else {
      await User.create({
        name: "Admin",
        email,
        phone: "9876543210",
        password: "Easylogin@1",
        role: "admin",
      });
      console.log("✅ Admin created:", email);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
};

createAdmin();
