import { Router } from "express";
import * as membershipController from "./membership.controller.js";
import { authProtect, patientProtect, optionalAuth, restrictTo } from "../../middlewares/auth.middleware.js";

// Pause/Cancel/Resume touch a patient's paid financial benefit and must be
// admin-only -- explicitly restricted beyond plain authProtect (unlike most
// other routes in this file, which only require ANY authenticated User).
const membershipManagerOnly = restrictTo("admin", "clinic_manager");

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

// Get active subscriber counts + preview for all plans (Admin) — MUST precede /plans/:id
router.get("/plans/subscriber-counts", authProtect, membershipController.getPlanSubscriberCounts);

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

// Get own membership with full plan details (Patient)
router.get("/my-plan", patientProtect, membershipController.getMyPlan);

// Purchase membership (Patient - after payment)
router.post("/purchase", optionalAuth, membershipController.purchaseMembership);

// Assign membership to patient (Admin)
router.post("/assign", authProtect, membershipController.assignMembership);

// Manually assign membership — supports inactive/custom plans, custom dates,
// amount + payment method, notes (Admin, no payment gateway)
router.post("/assign-manual", authProtect, membershipController.assignManualMembership);

// Renew patient's membership (Admin)
router.post("/renew/:patientId", authProtect, membershipController.renewMembership);

// Cancel patient's membership (Admin, Clinic Manager only)
router.post("/cancel/:patientId", authProtect, membershipManagerOnly, membershipController.cancelMembership);

// Pause patient's membership -- temporary, resumable (Admin, Clinic Manager only)
router.post("/pause/:patientId", authProtect, membershipManagerOnly, membershipController.pauseMembership);

// Resume a paused membership (Admin, Clinic Manager only)
router.post("/resume/:patientId", authProtect, membershipManagerOnly, membershipController.resumeMembership);

// ==================== MEMBER MANAGEMENT ====================

// Get all active members (Admin)
router.get("/members", authProtect, membershipController.getActiveMembers);

// Get membership statistics (Admin)
router.get("/stats", authProtect, membershipController.getMembershipStats);

export default router;
