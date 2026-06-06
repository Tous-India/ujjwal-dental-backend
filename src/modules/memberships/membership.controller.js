import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import MembershipPlan from "./membership.model.js";
import Coupon from "./coupon.model.js";
import Patient from "../patients/patient.model.js";
import { generateInvoice } from "../billing/invoice.service.js";
import { notify } from "../../utils/notifyHelper.js";
import mongoose from "mongoose";

// Map a membership paymentMethod to an invoice-allowed paymentMethod.
const toInvoicePaymentMethod = (method) => {
  if (["cash", "card", "upi", "online"].includes(method)) return method;
  if (method === "bank_transfer") return "online";
  return undefined;
};

/**
 * MEMBERSHIP CONTROLLER
 *
 * Handles:
 * - Membership Plans (catalog of available plans)
 * - Patient Memberships (assign, renew, cancel)
 */

// ==================== MEMBERSHIP PLANS (Catalog) ====================

/**
 * @desc    Get all membership plans
 * @route   GET /api/memberships/plans
 * @access  Public
 */
export const getAllPlans = asyncHandler(async (req, res) => {
  const { active = "true", type, tier } = req.query;

  // Build filter
  const filter = {};
  if (active === "true") {
    filter.isActive = true;
  }
  if (type) {
    filter.type = type;
  }
  if (tier) {
    filter.tier = tier;
  }

  // Query database
  const plans = await MembershipPlan.find(filter).sort({ displayOrder: 1 });

  // Group by type if requested
  if (req.query.grouped === "true") {
    const grouped = await MembershipPlan.getActivePlans();
    return ApiResponse.success(res, { plans: grouped }, "Membership plans fetched successfully");
  }

  ApiResponse.success(res, { plans }, "Membership plans fetched successfully");
});

/**
 * @desc    Get plan by ID
 * @route   GET /api/memberships/plans/:id
 * @access  Public
 */
export const getPlanById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid plan ID", 400);
  }

  const plan = await MembershipPlan.findById(id);

  if (!plan) {
    return ApiResponse.error(res, "Membership plan not found", 404);
  }

  ApiResponse.success(res, { plan }, "Membership plan fetched successfully");
});

/**
 * @desc    Create new membership plan
 * @route   POST /api/memberships/plans
 * @access  Admin
 */
export const createPlan = asyncHandler(async (req, res) => {
  let {
    name,
    code,
    type,
    tier,
    description,
    price,
    durationMonths,
    discountPercentage,
    maxMembers,
    benefits,
    features,
    displayOrder,
  } = req.body;

  // Validation
  if (!name || !code || !type || !tier || price === undefined || discountPercentage === undefined) {
    return ApiResponse.error(res, "Name, code, type, tier, price and discount percentage are required", 400);
  }

  // Normalize
  name = name.trim();
  code = code.trim().toUpperCase();
  type = type.trim().toLowerCase();
  tier = tier.trim().toLowerCase();
  price = Number(price);
  discountPercentage = Number(discountPercentage);

  if (Number.isNaN(price) || Number.isNaN(discountPercentage)) {
    return ApiResponse.error(res, "Price and discount percentage must be numbers", 400);
  }

  // Check duplicate code
  const existing = await MembershipPlan.findOne({ code });
  if (existing) {
    return ApiResponse.error(res, "Membership plan with this code already exists", 409);
  }

  // Create plan
  const plan = await MembershipPlan.create({
    name,
    code,
    type,
    tier,
    description,
    price,
    durationMonths: durationMonths ? Number(durationMonths) : 12,
    discountPercentage,
    maxMembers: maxMembers ? Number(maxMembers) : (type === "family" ? 4 : 1),
    benefits: benefits || [],
    features: features || [],
    displayOrder: displayOrder ? Number(displayOrder) : 0,
  });

  ApiResponse.created(res, { plan }, "Membership plan created successfully");
});

/**
 * @desc    Update membership plan
 * @route   PATCH /api/memberships/plans/:id
 * @access  Admin
 */
export const updatePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid plan ID", 400);
  }

  const plan = await MembershipPlan.findById(id);

  if (!plan) {
    return ApiResponse.error(res, "Membership plan not found", 404);
  }

  // Update allowed fields
  const allowedFields = [
    "name",
    "description",
    "price",
    "durationMonths",
    "discountPercentage",
    "maxMembers",
    "benefits",
    "features",
    "displayOrder",
    "isActive",
    "couponConfig",
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      plan[field] = req.body[field];
    }
  });

  await plan.save();

  ApiResponse.success(res, { plan }, "Membership plan updated successfully");
});

/**
 * @desc    Delete (deactivate) membership plan
 * @route   DELETE /api/memberships/plans/:id
 * @access  Admin
 */
export const deletePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid plan ID", 400);
  }

  const plan = await MembershipPlan.findById(id);

  if (!plan) {
    return ApiResponse.error(res, "Membership plan not found", 404);
  }

  // Soft delete
  plan.isActive = false;
  await plan.save();

  ApiResponse.success(res, null, "Membership plan deactivated successfully");
});

/**
 * @desc    Seed default membership plans
 * @route   POST /api/memberships/plans/seed
 * @access  Admin
 */
export const seedDefaultPlans = asyncHandler(async (req, res) => {
  await MembershipPlan.seedDefaultPlans();

  const plans = await MembershipPlan.find({ isActive: true }).sort({ displayOrder: 1 });

  ApiResponse.success(res, { plans }, "Default membership plans seeded successfully");
});

// ==================== PATIENT MEMBERSHIPS ====================

/**
 * @desc    Assign membership to patient
 * @route   POST /api/memberships/assign
 * @access  Admin
 */
export const assignMembership = asyncHandler(async (req, res) => {
  const { patientId, planId, paymentId } = req.body;

  // Validation
  if (!patientId || !planId) {
    return ApiResponse.error(res, "Patient ID and Plan ID are required", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(planId)) {
    return ApiResponse.error(res, "Invalid plan ID", 400);
  }

  // Get patient
  const patient = await Patient.findById(patientId);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Get plan
  const plan = await MembershipPlan.findById(planId);
  if (!plan) {
    return ApiResponse.error(res, "Membership plan not found", 404);
  }

  if (!plan.isActive) {
    return ApiResponse.error(res, "This membership plan is no longer available", 400);
  }

  // Check if patient already has active membership
  if (patient.hasMembership) {
    return ApiResponse.error(
      res,
      "Patient already has an active membership. Please cancel or let it expire first.",
      400
    );
  }

  // Calculate dates
  const startDate = new Date();
  const expiryDate = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + plan.durationMonths);

  // If patient has old membership, move it to history
  if (patient.membership && patient.membership.plan) {
    patient.membershipHistory.push({
      ...patient.membership.toObject(),
      status: "expired",
    });
  }

  // Assign new membership
  patient.membership = {
    plan: plan._id,
    planName: plan.name,
    discountPercent: plan.discountPercentage,
    startDate,
    expiryDate,
    status: "active",
  };

  await patient.save();

  // Generate coupons for this membership
  await Coupon.generateForMembership(patient, plan, startDate, expiryDate);

  // Populate membership plan for response
  await patient.populate("membership.plan");

  ApiResponse.success(
    res,
    {
      patient: {
        _id: patient._id,
        name: patient.name,
        phone: patient.phone,
        membership: patient.membership,
        hasMembership: patient.hasMembership,
        currentDiscount: patient.currentDiscount,
      },
      paymentId,
    },
    "Membership assigned successfully"
  );
});

/**
 * @desc    Manually assign a membership to a patient (admin, no payment gateway)
 * @route   POST /api/memberships/assign-manual
 * @access  Admin
 *
 * Differs from assignMembership: supports inactive/discontinued plans AND fully
 * custom plan names (for plans that no longer exist in the system), custom
 * start/end dates, a recorded amount + payment method, and admin notes. The
 * plan NAME is always stored as a permanent string so the record survives even
 * if the plan is later deleted. This is separate from the Razorpay flow.
 */
export const assignManualMembership = asyncHandler(async (req, res) => {
  const {
    patientId,
    planId, // optional — selecting an existing (active OR inactive) plan
    planName, // optional custom name — required when no planId
    startDate,
    endDate,
    amountPaid,
    paymentMethod,
    notes,
  } = req.body;

  // ---- Validate patient ----
  if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "A valid patient ID is required", 400);
  }

  const patient = await Patient.findById(patientId);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // ---- Resolve the plan (existing plan reference OR custom name) ----
  let resolvedPlanId = null;
  let resolvedPlanName = (planName || "").trim();
  let discountPercent = 0;
  let planDurationMonths = 12;

  if (planId) {
    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return ApiResponse.error(res, "Invalid plan ID", 400);
    }
    // Look up WITHOUT filtering on isActive so discontinued plans are allowed
    const plan = await MembershipPlan.findById(planId);
    if (!plan) {
      return ApiResponse.error(res, "Membership plan not found", 404);
    }
    resolvedPlanId = plan._id;
    if (!resolvedPlanName) resolvedPlanName = plan.name;
    discountPercent = plan.discountPercentage || 0;
    planDurationMonths = plan.durationMonths || 12;
  }

  if (!resolvedPlanName) {
    return ApiResponse.error(
      res,
      "Please select a plan or enter a custom plan name",
      400,
    );
  }

  // ---- Resolve dates ----
  const start = startDate ? new Date(startDate) : new Date();
  let expiry;
  if (endDate) {
    expiry = new Date(endDate);
  } else {
    expiry = new Date(start);
    expiry.setMonth(expiry.getMonth() + planDurationMonths);
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(expiry.getTime())) {
    return ApiResponse.error(res, "Invalid start or end date", 400);
  }
  if (expiry <= start) {
    return ApiResponse.error(res, "End date must be after the start date", 400);
  }

  // ---- Validate payment method (optional) ----
  const validMethods = ["cash", "card", "upi", "bank_transfer", "online"];
  if (paymentMethod && !validMethods.includes(paymentMethod)) {
    return ApiResponse.error(res, "Invalid payment method", 400);
  }

  // ---- Move any existing membership into history ----
  if (patient.membership && patient.membership.planName) {
    patient.membershipHistory.push({
      ...patient.membership.toObject(),
      status:
        patient.membership.status === "active"
          ? "expired"
          : patient.membership.status,
    });
  }

  // ---- Assign the new membership ----
  patient.membership = {
    plan: resolvedPlanId, // null for custom plans
    planName: resolvedPlanName, // permanent string — never lost
    discountPercent,
    startDate: start,
    expiryDate: expiry,
    status: "active",
    amountPaid:
      amountPaid !== undefined && amountPaid !== null && amountPaid !== ""
        ? Number(amountPaid)
        : undefined,
    paymentMethod: paymentMethod || undefined,
    assignedBy: req.user?._id,
    notes: (notes || "").trim() || undefined,
  };

  await patient.save();

  // Generate coupon card only when a real, active plan was selected. Custom or
  // discontinued plans don't have valid coupon configs to generate from.
  if (resolvedPlanId) {
    try {
      const plan = await MembershipPlan.findById(resolvedPlanId);
      if (plan && plan.isActive && plan.couponConfig?.enabled) {
        await Coupon.generateForMembership(patient, plan, start, expiry);
      }
    } catch (err) {
      // Don't fail the assignment if coupon generation has an issue
      console.error("Manual membership: coupon generation skipped:", err.message);
    }
  }

  // Auto-invoice for the membership payment (marked paid). Skipped when no amount.
  const membershipPaid = patient.membership.amountPaid;
  if (membershipPaid && membershipPaid > 0) {
    try {
      await generateInvoice({
        patient,
        clinic: patient.preferredClinic || undefined,
        items: [
          {
            itemType: "membership",
            description: resolvedPlanName || "Membership",
            unitPrice: membershipPaid,
          },
        ],
        amountPaid: membershipPaid,
        paymentMethod: toInvoicePaymentMethod(patient.membership.paymentMethod),
        createdBy: req.user?._id,
        applyMembershipDiscount: false, // the membership purchase itself isn't discounted
      });
    } catch (err) {
      console.error("Auto-invoice for manual membership failed:", err.message);
    }
  }

  ApiResponse.success(
    res,
    {
      patient: {
        _id: patient._id,
        name: patient.name,
        phone: patient.phone,
        membership: patient.membership,
        hasMembership: patient.hasMembership,
        currentDiscount: patient.currentDiscount,
      },
    },
    "Membership assigned successfully",
  );
});

/**
 * @desc    Renew patient's membership
 * @route   POST /api/memberships/renew/:patientId
 * @access  Admin
 */
export const renewMembership = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const { planId, paymentId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  // Get patient
  const patient = await Patient.findById(patientId);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Check if patient has membership to renew
  if (!patient.membership || !patient.membership.plan) {
    return ApiResponse.error(res, "Patient does not have a membership to renew", 400);
  }

  // Get plan (use new plan if provided, otherwise use current plan)
  const planToUse = planId || patient.membership.plan;
  const plan = await MembershipPlan.findById(planToUse);
  if (!plan) {
    return ApiResponse.error(res, "Membership plan not found", 404);
  }

  if (!plan.isActive) {
    return ApiResponse.error(res, "This membership plan is no longer available", 400);
  }

  // Move current membership to history
  patient.membershipHistory.push({
    ...patient.membership.toObject(),
    status: patient.membership.status,
  });

  // Calculate new dates
  // If membership is still active, extend from expiry date
  // If expired, start from today
  let startDate;
  if (patient.hasMembership) {
    startDate = new Date(patient.membership.expiryDate);
  } else {
    startDate = new Date();
  }

  const expiryDate = new Date(startDate);
  expiryDate.setMonth(expiryDate.getMonth() + plan.durationMonths);

  // Update membership
  patient.membership = {
    plan: plan._id,
    planName: plan.name,
    discountPercent: plan.discountPercentage,
    startDate,
    expiryDate,
    status: "active",
  };

  await patient.save();

  // Generate coupons for renewed membership
  await Coupon.generateForMembership(patient, plan, startDate, expiryDate);

  // Populate membership plan for response
  await patient.populate("membership.plan");

  ApiResponse.success(
    res,
    {
      patient: {
        _id: patient._id,
        name: patient.name,
        phone: patient.phone,
        membership: patient.membership,
        hasMembership: patient.hasMembership,
        currentDiscount: patient.currentDiscount,
      },
      paymentId,
    },
    "Membership renewed successfully"
  );
});

/**
 * @desc    Cancel patient's membership
 * @route   POST /api/memberships/cancel/:patientId
 * @access  Admin
 */
export const cancelMembership = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    return ApiResponse.error(res, "Invalid patient ID", 400);
  }

  // Get patient
  const patient = await Patient.findById(patientId);
  if (!patient) {
    return ApiResponse.error(res, "Patient not found", 404);
  }

  // Check if patient has active membership
  if (!patient.membership || !patient.membership.plan) {
    return ApiResponse.error(res, "Patient does not have an active membership", 400);
  }

  if (patient.membership.status === "cancelled") {
    return ApiResponse.error(res, "Membership is already cancelled", 400);
  }

  // Move current membership to history with cancelled status
  patient.membershipHistory.push({
    ...patient.membership.toObject(),
    status: "cancelled",
  });

  // Clear current membership
  patient.membership = undefined;

  await patient.save();

  ApiResponse.success(
    res,
    {
      patient: {
        _id: patient._id,
        name: patient.name,
        phone: patient.phone,
        hasMembership: false,
        currentDiscount: 0,
      },
      reason,
    },
    "Membership cancelled successfully"
  );
});

/**
 * @desc    Get all members (patients with active membership)
 * @route   GET /api/memberships/members
 * @access  Admin
 */
export const getActiveMembers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, plan, expiringSoon } = req.query;

  // Build query
  const query = {
    "membership.status": "active",
    "membership.expiryDate": { $gt: new Date() },
  };

  if (plan && mongoose.Types.ObjectId.isValid(plan)) {
    query["membership.plan"] = plan;
  }

  // Expiring soon = within 30 days
  if (expiringSoon === "true") {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    query["membership.expiryDate"] = {
      $gt: new Date(),
      $lte: thirtyDaysFromNow,
    };
  }

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [members, total] = await Promise.all([
    Patient.find(query)
      .select("name phone email membership")
      .populate("membership.plan", "name code type tier")
      .sort({ "membership.expiryDate": 1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Patient.countDocuments(query),
  ]);

  ApiResponse.paginated(res, members, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Purchase membership (patient self-service after payment)
 * @route   POST /api/memberships/purchase
 * @access  Patient (authenticated)
 */
export const purchaseMembership = asyncHandler(async (req, res) => {
  const { planId, paymentId, name, phone, email } = req.body;

  // Patient from auth middleware (logged in) or find/create from request body
  let patient = req.patient;

  if (!patient && phone) {
    // Public purchase — find or create patient
    patient = await Patient.findOne({ phone });
    if (!patient && email) {
      patient = await Patient.findOne({ email: email.toLowerCase() });
    }
    if (!patient) {
      if (!name) {
        return ApiResponse.error(res, "Name is required for new patient", 400);
      }
      // Name must not contain digits (letters, spaces and dots only)
      if (/\d/.test(name)) {
        return ApiResponse.error(res, "Name cannot contain numbers", 400);
      }
      const autoPassword = (name.replace(/\s/g, "").slice(0, 4) + phone.slice(-4)) || "Patient@123";
      patient = await Patient.create({
        name,
        phone,
        email: email?.toLowerCase(),
        password: autoPassword,
      });

      // Send welcome email
      if (email) {
        const { sendEmail } = await import("../../utils/email.js");
        sendEmail({
          to: email,
          subject: "Welcome to Ujjwal Dental Clinic - Your Portal Login",
          html: `<div style="font-family:Arial;max-width:500px;margin:0 auto;padding:20px"><h2 style="color:#1976d2;text-align:center">Ujjwal Dental Clinic</h2><p>Hello ${name},</p><p>Your patient portal account has been created.</p><div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:20px 0"><p><strong>Email:</strong> ${email}</p><p><strong>Password:</strong> ${autoPassword}</p></div><p>Login at your patient portal to view your membership details.</p></div>`,
          text: `Hello ${name}, Your account: Email: ${email}, Password: ${autoPassword}`,
        }).catch((err) => console.error("[Membership] Welcome email error:", err));
      }
    }
  }

  if (!patient) {
    return ApiResponse.error(res, "Patient information is required. Please provide name, phone, and email.", 400);
  }

  // Validation
  if (!planId) {
    return ApiResponse.error(res, "Plan ID is required", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(planId)) {
    return ApiResponse.error(res, "Invalid plan ID", 400);
  }

  // Get plan
  const plan = await MembershipPlan.findById(planId);
  if (!plan) {
    return ApiResponse.error(res, "Membership plan not found", 404);
  }

  if (!plan.isActive) {
    return ApiResponse.error(res, "This membership plan is no longer available", 400);
  }

  // Check if patient already has active membership
  if (patient.hasMembership) {
    return ApiResponse.error(
      res,
      "You already have an active membership. Please wait for it to expire or contact support.",
      400
    );
  }

  // Calculate dates
  const startDate = new Date();
  const expiryDate = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + plan.durationMonths);

  // If patient has old membership, move it to history
  if (patient.membership && patient.membership.plan) {
    patient.membershipHistory.push({
      ...patient.membership.toObject(),
      status: "expired",
    });
  }

  // Assign new membership
  patient.membership = {
    plan: plan._id,
    planName: plan.name,
    discountPercent: plan.discountPercentage,
    startDate,
    expiryDate,
    status: "active",
  };

  await patient.save();

  // Generate coupons for purchased membership
  await Coupon.generateForMembership(patient, plan, startDate, expiryDate);

  // Auto-invoice for the online membership purchase (paid). No existing invoice
  // is created elsewhere in this flow, so there's nothing to duplicate.
  try {
    await generateInvoice({
      patient,
      clinic: patient.preferredClinic || undefined,
      items: [
        {
          itemType: "membership",
          description: plan.name,
          unitPrice: plan.price,
        },
      ],
      amountPaid: plan.price,
      paymentMethod: "online",
      applyMembershipDiscount: false,
    });
  } catch (err) {
    console.error("Auto-invoice for membership purchase failed:", err.message);
  }

  // Populate membership plan for response
  await patient.populate("membership.plan");

  ApiResponse.success(
    res,
    {
      patient: {
        _id: patient._id,
        name: patient.name,
        phone: patient.phone,
        membership: patient.membership,
        hasMembership: patient.hasMembership,
        currentDiscount: patient.currentDiscount,
      },
      paymentId,
    },
    "Membership purchased successfully"
  );

  notify({ recipientId: patient._id, recipientModel: "Patient", type: "membership_renewal", title: "Membership Activated", message: `Your ${plan.name} membership is now active! Valid until ${expiryDate.toLocaleDateString("en-IN")}. Enjoy your benefits.`, sendEmail: true });
});

/**
 * @desc    Get membership statistics
 * @route   GET /api/memberships/stats
 * @access  Admin
 */
export const getMembershipStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  // Get counts
  const [activeCount, expiringCount, planStats] = await Promise.all([
    // Active members
    Patient.countDocuments({
      "membership.status": "active",
      "membership.expiryDate": { $gt: now },
    }),

    // Expiring within 30 days
    Patient.countDocuments({
      "membership.status": "active",
      "membership.expiryDate": { $gt: now, $lte: thirtyDaysFromNow },
    }),

    // Stats by plan
    Patient.aggregate([
      {
        $match: {
          "membership.status": "active",
          "membership.expiryDate": { $gt: now },
        },
      },
      {
        $group: {
          _id: "$membership.plan",
          count: { $sum: 1 },
          planName: { $first: "$membership.planName" },
        },
      },
    ]),
  ]);

  ApiResponse.success(
    res,
    {
      stats: {
        totalActiveMembers: activeCount,
        expiringWithin30Days: expiringCount,
        byPlan: planStats,
      },
    },
    "Membership statistics fetched successfully"
  );
});

// ==================== COUPON MANAGEMENT ====================

export const getAllCoupons = asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;
  const query = {};

  if (status && ["unused", "used", "locked"].includes(status)) {
    query.status = status;
  }

  if (search) {
    const patients = await Patient.find({
      $or: [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ],
    }).select("_id");
    const patientIds = patients.map((p) => p._id);
    query.$or = [
      { patient: { $in: patientIds } },
      { code: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [coupons, total] = await Promise.all([
    Coupon.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("patient", "name phone email")
      .populate("membershipPlan", "name code"),
    Coupon.countDocuments(query),
  ]);

  const stats = await Coupon.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const statMap = stats.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {});

  ApiResponse.success(res, {
    coupons,
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit)),
    stats: { total: total, unused: statMap.unused || 0, used: statMap.used || 0, locked: statMap.locked || 0 },
  }, "All coupons fetched successfully");
});

export const getPatientCoupons = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const coupons = await Coupon.find({ patient: patientId })
    .sort({ couponNumber: 1 })
    .populate("membershipPlan", "name code");

  ApiResponse.success(res, { coupons }, "Coupons fetched successfully");
});

export const getMyCoupons = asyncHandler(async (req, res) => {
  const patientId = req.patient?._id || req.user?._id;
  if (!patientId) return ApiResponse.error(res, "Unauthorized", 401);

  const coupons = await Coupon.find({ patient: patientId })
    .sort({ couponNumber: 1 })
    .populate("membershipPlan", "name code");

  ApiResponse.success(res, { coupons }, "Coupons fetched successfully");
});

export const verifyCoupon = asyncHandler(async (req, res) => {
  const { code, usageNotes } = req.body;
  if (!code) return ApiResponse.error(res, "Coupon code is required", 400);

  const coupon = await Coupon.findOne({ code: code.toUpperCase() })
    .populate("patient", "name phone email")
    .populate("membershipPlan", "name code");

  if (!coupon) return ApiResponse.error(res, "Invalid coupon code", 404);
  if (coupon.status === "used") return ApiResponse.error(res, "This coupon has already been used", 400);
  if (coupon.status === "locked") return ApiResponse.error(res, "This coupon is not yet unlocked. Previous coupons must be used first.", 400);
  if (new Date() > coupon.membershipExpiry) return ApiResponse.error(res, "This coupon has expired", 400);

  coupon.status = "used";
  coupon.usedAt = new Date();
  coupon.usedBy = req.user._id;
  coupon.usageNotes = usageNotes || "";
  await coupon.save();

  // Unlock the next coupon in sequence
  await Coupon.findOneAndUpdate(
    { patient: coupon.patient._id, couponNumber: coupon.couponNumber + 1, status: "locked" },
    { status: "unused" }
  );

  ApiResponse.success(
    res,
    {
      coupon,
      patient: coupon.patient,
      message: `Coupon #${coupon.couponNumber} verified — ₹${coupon.flatDiscount} off + ${coupon.surgeryDiscount}% off surgery`,
    },
    "Coupon verified and redeemed successfully"
  );
});

export const undoCouponUsed = asyncHandler(async (req, res) => {
  const { couponId } = req.params;
  const coupon = await Coupon.findById(couponId);
  if (!coupon) return ApiResponse.error(res, "Coupon not found", 404);
  if (coupon.status !== "used") return ApiResponse.error(res, "Coupon is not in used state", 400);

  // Re-lock the next coupon if it's currently unused
  await Coupon.findOneAndUpdate(
    { patient: coupon.patient, couponNumber: coupon.couponNumber + 1, status: "unused" },
    { status: "locked" }
  );

  coupon.status = "unused";
  coupon.usedAt = undefined;
  coupon.usedBy = undefined;
  coupon.usageNotes = undefined;
  await coupon.save();

  ApiResponse.success(res, { coupon }, "Coupon usage reverted successfully");
});
