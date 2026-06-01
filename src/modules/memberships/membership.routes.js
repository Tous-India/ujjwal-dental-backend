import { Router } from "express";
import * as membershipController from "./membership.controller.js";
import { authProtect, patientProtect, optionalAuth } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * MEMBERSHIP ROUTES
 * Base path: /api/memberships
 *
 * Ujjwal Dental has 6 membership plans:
 * 1. Cosmodentofacial Family Dental Plan - ₹4,999
 * 2. Cosmodentofacial Women Dental Plan - ₹3,400
 * 3. Implant Post Care - ₹4,500
 * 4. Cosmodentofacial Student's Dental Plan - ₹1,300
 * 5. Oral Hygiene Products Kit for Adults - ₹562
 * 6. Oral Hygiene Products Kit for Kids - ₹270
 */

// ==================== MEMBERSHIP PLANS (Catalog) ====================

// Get all membership plans - Public
router.get("/plans", membershipController.getAllPlans);

// Get single plan by ID - Public
router.get("/plans/:id", membershipController.getPlanById);

// Create new plan (Admin)
router.post("/plans", authProtect, membershipController.createPlan);

// Update plan (Admin)
router.patch("/plans/:id", authProtect, membershipController.updatePlan);

// Delete (deactivate) plan (Admin)
router.delete("/plans/:id", authProtect, membershipController.deletePlan);

// Seed default plans (Admin)
router.post("/plans/seed", authProtect, membershipController.seedDefaultPlans);

// ==================== PATIENT MEMBERSHIPS ====================

// Purchase membership (Patient - after payment)
router.post("/purchase", optionalAuth, membershipController.purchaseMembership);

// Assign membership to patient (Admin)
router.post("/assign", authProtect, membershipController.assignMembership);

// Renew patient's membership (Admin)
router.post("/renew/:patientId", authProtect, membershipController.renewMembership);

// Cancel patient's membership (Admin)
router.post("/cancel/:patientId", authProtect, membershipController.cancelMembership);

// ==================== MEMBER MANAGEMENT ====================

// Get all active members (Admin)
router.get("/members", authProtect, membershipController.getActiveMembers);

// Get membership statistics (Admin)
router.get("/stats", authProtect, membershipController.getMembershipStats);

// ==================== COUPON MANAGEMENT ====================

// Admin: get all coupons across all patients
router.get("/coupons/all", authProtect, membershipController.getAllCoupons);

// Patient: get own coupons
router.get("/coupons/my", patientProtect, membershipController.getMyCoupons);

// Admin: get coupons for a patient
router.get("/coupons/patient/:patientId", authProtect, membershipController.getPatientCoupons);

// Admin: verify and redeem a coupon by code
router.post("/coupons/verify", authProtect, membershipController.verifyCoupon);

// Admin: undo a used coupon
router.patch("/coupons/:couponId/unuse", authProtect, membershipController.undoCouponUsed);

export default router;
