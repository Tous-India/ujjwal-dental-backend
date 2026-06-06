import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import LabOrder from "./labOrder.model.js";
import Lab from "./lab.model.js";
import Patient from "../patients/patient.model.js";
import mongoose from "mongoose";

/**
 * LAB ORDER CONTROLLER (admin-only)
 */

/**
 * @desc    List lab orders (filters: lab, deliveryStatus, paymentStatus, date range, search)
 * @route   GET /api/lab-orders
 * @access  Admin
 */
export const getAllLabOrders = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    lab,
    deliveryStatus,
    paymentStatus,
    from,
    to,
    search,
    archived,
  } = req.query;

  const query = {};
  if (lab && mongoose.Types.ObjectId.isValid(lab)) query.lab = lab;
  if (deliveryStatus) query.deliveryStatus = deliveryStatus;
  if (paymentStatus) query.paymentStatus = paymentStatus;

  // Default to the Active view (non-archived). archived=true shows the archive.
  query.archived = archived === "true";

  if (from || to) {
    query.orderDate = {};
    if (from) query.orderDate.$gte = new Date(from);
    if (to) query.orderDate.$lte = new Date(to);
  }

  if (search) {
    query.orderNumber = { $regex: search, $options: "i" };
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [orders, total] = await Promise.all([
    LabOrder.find(query)
      .populate("lab", "name phone")
      .populate("patient", "name phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    LabOrder.countDocuments(query),
  ]);

  ApiResponse.paginated(res, orders, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * @desc    Get a single lab order
 * @route   GET /api/lab-orders/:id
 * @access  Admin
 */
export const getLabOrderById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid order ID", 400);
  }

  const order = await LabOrder.findById(id)
    .populate("lab", "name phone contactPerson address")
    .populate("patient", "name phone email")
    .populate("createdBy", "name");

  if (!order) {
    return ApiResponse.error(res, "Lab order not found", 404);
  }

  ApiResponse.success(res, { order }, "Lab order fetched successfully");
});

/**
 * @desc    Create a lab order
 * @route   POST /api/lab-orders
 * @access  Admin
 */
export const createLabOrder = asyncHandler(async (req, res) => {
  const { lab, patient, doctor, items, expectedDelivery, notes, orderDate } = req.body;

  if (!lab || !mongoose.Types.ObjectId.isValid(lab)) {
    return ApiResponse.error(res, "A valid lab is required", 400);
  }
  if (!patient || !mongoose.Types.ObjectId.isValid(patient)) {
    return ApiResponse.error(res, "A valid patient is required", 400);
  }
  if (!Array.isArray(items) || items.length === 0) {
    return ApiResponse.error(res, "At least one item is required", 400);
  }

  // Verify lab + patient exist
  const [labDoc, patientDoc] = await Promise.all([
    Lab.findById(lab),
    Patient.findById(patient),
  ]);
  if (!labDoc) return ApiResponse.error(res, "Lab not found", 404);
  if (!patientDoc) return ApiResponse.error(res, "Patient not found", 404);

  // Normalise items. Pricing (pricingType/basePrice/unitPrice) is taken from the
  // lab's own procedure list when the name matches — server-authoritative — and
  // falls back to client values for ad-hoc procedures. The model computes the
  // per-item totalPrice from pricingType in calculateTotals().
  const VALID_TYPES = ["per_unit", "per_arch", "fixed", "fixed_plus_per_unit"];
  const cleanItems = items
    .filter((it) => it && it.procedure)
    .map((it) => {
      const proc = (labDoc.procedures || []).find((p) => p.name === it.procedure);
      const pricingType = proc?.pricingType
        ? proc.pricingType
        : VALID_TYPES.includes(it.pricingType)
        ? it.pricingType
        : "per_unit";
      return {
        procedure: String(it.procedure),
        quantity: Math.max(1, Number(it.quantity) || 1),
        unitPrice: proc ? Number(proc.price) || 0 : Math.max(0, Number(it.unitPrice) || 0),
        basePrice: proc ? Number(proc.basePrice) || 0 : Math.max(0, Number(it.basePrice) || 0),
        pricingType,
      };
    });

  if (cleanItems.length === 0) {
    return ApiResponse.error(res, "At least one valid item is required", 400);
  }

  const order = await LabOrder.create({
    lab,
    patient,
    doctor: doctor || undefined,
    items: cleanItems,
    expectedDelivery: expectedDelivery || undefined,
    orderDate: orderDate || undefined,
    notes: notes || undefined,
    createdBy: req.user?._id,
    // deliveryStatus defaults to "pending"; paymentStatus derived as "unpaid"
  });

  const populated = await LabOrder.findById(order._id)
    .populate("lab", "name phone")
    .populate("patient", "name phone");

  ApiResponse.created(res, { order: populated }, "Lab order created successfully");
});

/**
 * @desc    Update a lab order (delivery status, expected/delivered date, notes)
 * @route   PATCH /api/lab-orders/:id
 * @access  Admin
 */
export const updateLabOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid order ID", 400);
  }

  const order = await LabOrder.findById(id);
  if (!order) {
    return ApiResponse.error(res, "Lab order not found", 404);
  }

  const { deliveryStatus, expectedDelivery, deliveredDate, notes } = req.body;

  if (deliveryStatus !== undefined) {
    order.deliveryStatus = deliveryStatus;
    // Auto-stamp delivered date when first marked delivered
    if (deliveryStatus === "delivered" && !order.deliveredDate) {
      order.deliveredDate = deliveredDate ? new Date(deliveredDate) : new Date();
    }
  }
  if (expectedDelivery !== undefined) order.expectedDelivery = expectedDelivery;
  if (deliveredDate !== undefined) order.deliveredDate = deliveredDate;
  if (notes !== undefined) order.notes = notes;

  await order.save();

  const populated = await LabOrder.findById(order._id)
    .populate("lab", "name phone")
    .populate("patient", "name phone");

  ApiResponse.success(res, { order: populated }, "Lab order updated successfully");
});

/**
 * @desc    Record a payment against a lab order
 * @route   POST /api/lab-orders/:id/payment
 * @access  Admin
 */
export const recordLabOrderPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, method, notes, date } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid order ID", 400);
  }

  const order = await LabOrder.findById(id);
  if (!order) {
    return ApiResponse.error(res, "Lab order not found", 404);
  }

  const amt = Number(amount);
  if (!amt || amt <= 0) {
    return ApiResponse.error(res, "Valid payment amount is required", 400);
  }
  if (amt > order.balanceDue + 0.01) {
    return ApiResponse.error(
      res,
      `Payment amount (${amt}) exceeds balance due (${order.balanceDue})`,
      400,
    );
  }

  await order.recordPayment({ amount: amt, method, notes, date });

  const populated = await LabOrder.findById(order._id)
    .populate("lab", "name phone")
    .populate("patient", "name phone");

  ApiResponse.success(res, { order: populated }, "Payment recorded successfully");
});

/**
 * Shared helper: set the archived flag on an order.
 */
const setArchived = async (req, res, value) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid order ID", 400);
  }
  const order = await LabOrder.findById(id);
  if (!order) {
    return ApiResponse.error(res, "Lab order not found", 404);
  }
  order.archived = value;
  await order.save();
  return ApiResponse.success(
    res,
    { order },
    value ? "Lab order archived" : "Lab order restored",
  );
};

/**
 * @desc    Archive a lab order (soft — keeps the record)
 * @route   PATCH /api/lab-orders/:id/archive
 * @access  Admin
 */
export const archiveLabOrder = asyncHandler((req, res) => setArchived(req, res, true));

/**
 * @desc    Unarchive a lab order (restore to Active)
 * @route   PATCH /api/lab-orders/:id/unarchive
 * @access  Admin
 */
export const unarchiveLabOrder = asyncHandler((req, res) => setArchived(req, res, false));
