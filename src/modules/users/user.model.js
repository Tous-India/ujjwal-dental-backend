import mongoose from "mongoose";
import bcrypt from "bcryptjs";

/**
 * USER MODEL
 * For Admin/Doctor/Staff accounts
 *
 * Simple structure:
 * - name, email, phone, password
 * - role: 'admin' (full access)
 * - isActive: for soft delete
 */

const userSchema = new mongoose.Schema(
  {
    // Basic Info
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      required: [true, "Phone is required"],
      unique: true,
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false, // Don't include password in queries by default
    },

    // Role - keeping it simple with just 'admin'
    role: {
      type: String,
      enum: ["admin", "user", "blog_editor"],
      default: "admin",
    },

    // Account Status
    isActive: {
      type: Boolean,
      default: true,
    },

    // Track last login
    lastLogin: {
      type: Date,
    },

    // For password reset
    resetPasswordToken: String,
    resetPasswordExpires: Date,

    // For token refresh
    refreshToken: {
      type: String,
      select: false,
    },

    // Profile Picture (Cloudinary)
    profilePicture: {
      url: String,
      publicId: String,
    },

    // Notification Preferences
    notificationPreferences: {
      email: {
        appointments: { type: Boolean, default: true },
        payments: { type: Boolean, default: true },
        systemAlerts: { type: Boolean, default: true },
      },
      sms: {
        appointments: { type: Boolean, default: false },
        payments: { type: Boolean, default: false },
        systemAlerts: { type: Boolean, default: false },
      },
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  },
);

// ============ MIDDLEWARE ============

/**
 * Hash password before saving
 * Only runs if password is modified
 */
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// ============ METHODS ============

/**
 * Compare entered password with hashed password
 * @param {string} enteredPassword - Password to check
 * @returns {boolean} - True if password matches
 */
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

/**
 * Remove sensitive fields when converting to JSON
 */
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.refreshToken;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;
  return user;
};

// Create and export the model
const User = mongoose.model("User", userSchema);

export default User;
