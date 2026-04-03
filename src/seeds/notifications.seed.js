/**
 * Notification Seed Script
 *
 * Creates sample notifications for testing the notification system
 *
 * Usage:
 * node src/seeds/notifications.seed.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Notification from "../modules/notifications/notification.model.js";
import User from "../modules/users/user.model.js";
import Patient from "../modules/patients/patient.model.js";

// Load environment variables
dotenv.config();

/**
 * Seed notifications
 */
const seedNotifications = async () => {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Find admin user
    const admin = await User.findOne({ role: "admin" });
    if (!admin) {
      console.error("❌ No admin user found. Please run the main seed first.");
      process.exit(1);
    }

    console.log(`👤 Found admin: ${admin.name} (${admin.email})`);

    // Delete existing notifications for this admin
    await Notification.deleteMany({ recipient: admin._id, recipientModel: "User" });
    console.log("🗑️  Deleted existing admin notifications");

    // Create sample notifications
    const notifications = [
      {
        title: "Welcome to Notification System",
        message: "Your notification system is now active! You'll receive updates about appointments, payments, and more.",
        type: "general",
        priority: "normal",
        recipientType: "user",
        recipient: admin._id,
        recipientModel: "User",
        showInApp: true,
        isRead: false,
        createdBy: admin._id,
      },
      {
        title: "New Appointment Booked",
        message: "A new appointment has been scheduled for tomorrow at 10:00 AM. Patient: John Doe",
        type: "appointment_confirmation",
        priority: "high",
        recipientType: "user",
        recipient: admin._id,
        recipientModel: "User",
        showInApp: true,
        isRead: false,
        createdBy: admin._id,
      },
      {
        title: "Payment Received",
        message: "Payment of ₹5,000 has been received from Sarah Johnson for invoice #INV-2024-001",
        type: "payment_received",
        priority: "normal",
        recipientType: "user",
        recipient: admin._id,
        recipientModel: "User",
        showInApp: true,
        isRead: false,
        createdBy: admin._id,
      },
      {
        title: "Membership Expiring Soon",
        message: "Premium membership for Michael Brown will expire in 7 days. Follow up recommended.",
        type: "membership_expiry",
        priority: "high",
        recipientType: "user",
        recipient: admin._id,
        recipientModel: "User",
        showInApp: true,
        isRead: false,
        createdBy: admin._id,
      },
      {
        title: "Treatment Completed",
        message: "Root canal treatment for Emma Wilson has been successfully completed.",
        type: "treatment_update",
        priority: "normal",
        recipientType: "user",
        recipient: admin._id,
        recipientModel: "User",
        showInApp: true,
        isRead: true,
        readAt: new Date(),
        createdBy: admin._id,
      },
      {
        title: "Appointment Reminder",
        message: "You have 5 appointments scheduled for tomorrow. Review your schedule.",
        type: "appointment_reminder",
        priority: "high",
        recipientType: "user",
        recipient: admin._id,
        recipientModel: "User",
        showInApp: true,
        isRead: false,
        createdBy: admin._id,
      },
      {
        title: "Test Results Available",
        message: "Lab test results for David Lee are now available for review.",
        type: "test_result",
        priority: "urgent",
        recipientType: "user",
        recipient: admin._id,
        recipientModel: "User",
        showInApp: true,
        isRead: false,
        createdBy: admin._id,
      },
    ];

    // Insert notifications with staggered timestamps
    for (let i = 0; i < notifications.length; i++) {
      const notification = notifications[i];
      // Create notifications with timestamps spread over the last 24 hours
      const createdAt = new Date(Date.now() - (i * 3 * 60 * 60 * 1000)); // 3 hours apart
      await Notification.create({
        ...notification,
        createdAt,
        updatedAt: createdAt,
      });
    }

    console.log(`✅ Created ${notifications.length} sample notifications`);
    console.log("\n📊 Notification breakdown:");
    console.log(`   - Unread: ${notifications.filter((n) => !n.isRead).length}`);
    console.log(`   - Read: ${notifications.filter((n) => n.isRead).length}`);
    console.log(`   - High Priority: ${notifications.filter((n) => n.priority === "high").length}`);
    console.log(`   - Urgent: ${notifications.filter((n) => n.priority === "urgent").length}`);

    console.log("\n✅ Notification seed completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding notifications:", error);
    process.exit(1);
  }
};

// Run the seed
seedNotifications();
