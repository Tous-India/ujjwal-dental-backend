import { asyncHandler } from "../../utils/asyncHandler.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import Expense from "./expense.model.js";
import Invoice from "../billing/invoice.model.js";
import Payment from "../payments/payment.model.js";
import LabOrder from "../labs/labOrder.model.js";
import User from "../users/user.model.js";
import mongoose from "mongoose";
import { parseIstDateRange, istStartOfDay, istEndOfDay } from "../../utils/istDateRange.js";
import { computeExternalIncomeTotal } from "../../utils/computeExternalIncomeTotal.js";

// ─── Revenue helpers ───────────────────────────────────────────────────────────
//
// These replicate the exact calculation used by billing.controller.js /
// getBillingStats so that P&L Revenue can never diverge from Billing's
// "Total Paid" figure for the same date range (satisfies T3).
// The logic is intentionally identical; see billing.controller.js for the
// detailed comments explaining WHY each piece is written this way.

const getVoidedInvoiceIds = () => Invoice.find({ isVoided: true }).distinct("_id");

// Computes gross collected + refunds for a given date range and clinic.
// Returns { grossRevenue, totalRefunds, netRevenue }.
const computeRevenue = async ({ from, to, clinic } = {}) => {
  const paymentMatch = { status: { $in: ["paid", "refunded", "refund_pending"] } };

  if (from || to) {
    paymentMatch.createdAt = parseIstDateRange(from, to);
  }
  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    paymentMatch.clinic = new mongoose.Types.ObjectId(clinic);
  }

  // Exclude payments linked to voided invoices — same exclusion as getBillingStats.
  const voidedIds = await getVoidedInvoiceIds();
  if (voidedIds.length > 0) {
    paymentMatch.invoice = { $nin: voidedIds };
    paymentMatch["settledInvoices.invoiceId"] = { $nin: voidedIds };
  }

  const [revenueAgg] = await Payment.aggregate([
    { $match: paymentMatch },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const grossRevenue = revenueAgg?.total || 0;

  // Refunds: money genuinely returned to the patient.
  const refundMatch = {
    status: { $in: ["refunded", "refund_pending"] },
    "refund.amount": { $gt: 0 },
  };
  if (from || to) {
    refundMatch["refund.refundedAt"] = parseIstDateRange(from, to);
  }

  const [refundAgg] = await Payment.aggregate([
    { $match: refundMatch },
    { $group: { _id: null, total: { $sum: "$refund.amount" } } },
  ]);
  const totalRefunds = refundAgg?.total || 0;

  // External income: non-patient revenue (another source) — added here so that
  // every revenue figure in the app (P&L, Payment History) picks it up from
  // ONE shared utility. Never counted separately per page.
  const externalIncome = await computeExternalIncomeTotal({ from, to });

  return {
    grossRevenue: grossRevenue + externalIncome,
    totalRefunds,
    netRevenue: grossRevenue + externalIncome - totalRefunds,
    externalIncome,
  };
};

// ─── Lab cost helper ────────────────────────────────────────────────────────────
//
// CASH BASIS: each paymentHistory entry is counted on the date it was paid
// (paymentHistory[].date), NOT the orderDate. This correctly places partial
// payments in the period they actually moved rather than when the order was placed.
// Lab orders are NOT copied into the Expense collection — P&L reads from
// laborders at query time to avoid duplicate-count drift (Phase 2 requirement).

const computeLabCosts = async ({ from, to } = {}) => {
  const pipeline = [
    { $unwind: "$paymentHistory" },
  ];

  if (from || to) {
    const dateRange = parseIstDateRange(from, to);
    pipeline.push({ $match: { "paymentHistory.date": dateRange } });
  }

  pipeline.push({
    $group: {
      _id: null,
      total: { $sum: "$paymentHistory.amount" },
      count: { $sum: 1 },
    },
  });

  const [agg] = await LabOrder.aggregate(pipeline);
  return { labCosts: agg?.total || 0, labPaymentCount: agg?.count || 0 };
};

// Build previous period dates (same duration, immediately preceding the current range).
const getPreviousPeriod = (from, to) => {
  if (!from || !to) return null;
  const start = istStartOfDay(from);
  const end = istEndOfDay(to);
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1); // 1 ms before current start
  const prevStart = new Date(prevEnd.getTime() - durationMs);

  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return { from: fmt(prevStart), to: fmt(prevEnd) };
};

// ─── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Create an expense
 * @route   POST /api/expenses
 * @access  Admin (checkPermission expenses:create)
 */
export const createExpense = asyncHandler(async (req, res) => {
  const { date, category, description, amount, paymentMode, spentBy, vendor, clinic, notes } = req.body;

  if (!date || !category || !description || !amount || !paymentMode || !spentBy) {
    return ApiResponse.error(res, "date, category, description, amount, paymentMode, and spentBy are required", 400);
  }
  if (!mongoose.Types.ObjectId.isValid(spentBy)) {
    return ApiResponse.error(res, "Invalid spentBy user ID", 400);
  }
  if (clinic && !mongoose.Types.ObjectId.isValid(clinic)) {
    return ApiResponse.error(res, "Invalid clinic ID", 400);
  }

  const expense = await Expense.create({
    date: new Date(date),
    category,
    description,
    amount,
    paymentMode,
    spentBy,
    recordedBy: req.user._id, // immutable — always the logged-in user
    vendor,
    clinic: clinic || undefined,
    notes,
  });

  const populated = await Expense.findById(expense._id)
    .populate("spentBy", "name email role")
    .populate("recordedBy", "name email role")
    .populate("clinic", "name code")
    .lean();

  ApiResponse.created(res, { expense: populated }, "Expense recorded successfully");
});

/**
 * @desc    List expenses with filters and pagination
 * @route   GET /api/expenses?from&to&category&paymentMode&spentBy&search&page&limit
 * @access  Admin (checkPermission expenses:view)
 */
export const getExpenses = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    from,
    to,
    category,
    paymentMode,
    spentBy,
    clinic,
    search,
    voided,
  } = req.query;

  const query = {};

  // Default: exclude voided. Pass voided=true to view only voided records.
  if (voided === "true") {
    query.isVoided = true;
  } else {
    query.isVoided = { $ne: true };
  }

  if (from || to) {
    query.date = parseIstDateRange(from, to);
  }
  if (category) query.category = category;
  if (paymentMode) query.paymentMode = paymentMode;
  if (spentBy && mongoose.Types.ObjectId.isValid(spentBy)) {
    query.spentBy = spentBy;
  }
  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    query.clinic = clinic;
  }

  if (search && search.trim()) {
    const s = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { description: { $regex: s, $options: "i" } },
      { vendor: { $regex: s, $options: "i" } },
    ];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [expenses, total] = await Promise.all([
    Expense.find(query)
      .populate("spentBy", "name email role")
      .populate("recordedBy", "name email role")
      .populate("editedBy", "name email role")
      .populate("voidedBy", "name email role")
      .populate("clinic", "name code")
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Expense.countDocuments(query),
  ]);

  ApiResponse.paginated(res, expenses, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
  }, "Expenses fetched successfully");
});

/**
 * @desc    Get single expense
 * @route   GET /api/expenses/:id
 * @access  Admin (checkPermission expenses:view)
 */
export const getExpenseById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return ApiResponse.error(res, "Invalid expense ID", 400);
  }

  const expense = await Expense.findById(req.params.id)
    .populate("spentBy", "name email role")
    .populate("recordedBy", "name email role")
    .populate("editedBy", "name email role")
    .populate("clinic", "name code")
    .lean();

  if (!expense) return ApiResponse.error(res, "Expense not found", 404);

  ApiResponse.success(res, { expense });
});

/**
 * @desc    Update an expense (recordedBy is never editable)
 * @route   PATCH /api/expenses/:id
 * @access  Admin (checkPermission expenses:edit)
 */
export const updateExpense = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return ApiResponse.error(res, "Invalid expense ID", 400);
  }

  const expense = await Expense.findById(req.params.id);
  if (!expense) return ApiResponse.error(res, "Expense not found", 404);

  // recordedBy is server-set on create and NEVER editable — strip it silently.
  const { recordedBy: _stripped, ...updates } = req.body;

  if (updates.spentBy && !mongoose.Types.ObjectId.isValid(updates.spentBy)) {
    return ApiResponse.error(res, "Invalid spentBy user ID", 400);
  }
  if (updates.clinic && !mongoose.Types.ObjectId.isValid(updates.clinic)) {
    return ApiResponse.error(res, "Invalid clinic ID", 400);
  }
  if (updates.date) updates.date = new Date(updates.date);

  Object.assign(expense, updates);
  expense.editedBy = req.user._id;
  expense.editedAt = new Date();
  await expense.save();

  const populated = await Expense.findById(expense._id)
    .populate("spentBy", "name email role")
    .populate("recordedBy", "name email role")
    .populate("editedBy", "name email role")
    .populate("clinic", "name code")
    .lean();

  ApiResponse.success(res, { expense: populated }, "Expense updated successfully");
});

/**
 * @desc    Void (soft-delete) an expense — mirrors the established Invoice void pattern.
 *          Voided expenses are excluded from lists, stats, and P&L but remain
 *          queryable via voided=true for audit purposes.
 * @route   POST /api/expenses/:id/void
 * @access  Admin (checkPermission expenses:delete)
 */
export const voidExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return ApiResponse.error(res, "Invalid expense ID", 400);
  }

  const { reason } = req.body;
  if (!reason || reason.trim().length < 10) {
    return ApiResponse.error(res, "A reason of at least 10 characters is required", 400);
  }

  const expense = await Expense.findById(id);
  if (!expense) return ApiResponse.error(res, "Expense not found", 404);
  if (expense.isVoided) return ApiResponse.error(res, "Expense is already voided", 400);

  await Expense.updateOne(
    { _id: id },
    {
      $set: {
        isVoided: true,
        voidedAt: new Date(),
        voidedBy: req.user?._id || null,
        voidReason: reason.trim(),
      },
    }
  );

  const updated = await Expense.findById(id)
    .populate("spentBy", "name email role")
    .populate("recordedBy", "name email role")
    .populate("voidedBy", "name email role")
    .populate("clinic", "name code")
    .lean();

  ApiResponse.success(res, { expense: updated }, "Expense voided successfully");
});

/**
 * @desc    Permanently hard-delete a voided expense (admin only, two-step safety).
 *          An active expense must be voided first — this prevents accidental deletion
 *          of records that are still counted in P&L.
 * @route   DELETE /api/expenses/:id/permanent
 * @access  Admin only (restrictTo("admin"))
 */
export const permanentDeleteExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return ApiResponse.error(res, "Invalid expense ID", 400);

  const expense = await Expense.findById(id);
  if (!expense) return ApiResponse.error(res, "Expense not found", 404);
  if (!expense.isVoided)
    return ApiResponse.error(
      res,
      "Only voided expenses can be permanently deleted. Void the expense first.",
      400
    );

  await Expense.deleteOne({ _id: id });
  ApiResponse.success(res, null, "Expense permanently deleted");
});

/**
 * @desc    Summary stats for the current filter (total + by category)
 * @route   GET /api/expenses/stats?from&to&category&clinic
 * @access  Admin (checkPermission expenses:view)
 */
export const getExpenseStats = asyncHandler(async (req, res) => {
  const { from, to, category, clinic } = req.query;

  const match = { isVoided: { $ne: true } };
  if (from || to) match.date = parseIstDateRange(from, to);
  if (category) match.category = category;
  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    match.clinic = new mongoose.Types.ObjectId(clinic);
  }

  const [totals, byCategory] = await Promise.all([
    Expense.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$category",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]),
  ]);

  const grandTotal = totals[0]?.total || 0;

  ApiResponse.success(res, {
    total: grandTotal,
    count: totals[0]?.count || 0,
    byCategory: byCategory.map((c) => ({
      category: c._id,
      total: c.total,
      count: c.count,
      pct: grandTotal > 0 ? Math.round((c.total / grandTotal) * 100) : 0,
    })),
  });
});

/**
 * @desc    Get list of staff users for the spentBy dropdown
 * @route   GET /api/expenses/staff
 * @access  Admin (checkPermission expenses:view)
 */
export const getStaffList = asyncHandler(async (req, res) => {
  const users = await User.find({ isActive: true })
    .select("name email role")
    .sort({ name: 1 })
    .lean();

  ApiResponse.success(res, { users });
});

// ─── P&L ───────────────────────────────────────────────────────────────────────

/**
 * @desc    Profit & Loss report for a given date range
 * @route   GET /api/expenses/pnl?from&to&clinic
 * @access  Admin (checkPermission reports:view)
 *
 * Cash basis throughout:
 *   Revenue   = Payment.amount (paid/refunded/refund_pending), voided-excluded,
 *               filtered by Payment.createdAt — IDENTICAL to getBillingStats
 *               totalPaid so Billing and P&L can never disagree (T3).
 *   Refunds   = Payment.refund.amount (refunded/refund_pending), by refundedAt.
 *   Lab costs = LabOrder.paymentHistory[].amount, filtered by paymentHistory[].date.
 *               NOT a copy in Expense — read at query time from the single source
 *               of truth (Phase 2 requirement, avoids drift).
 *   Expenses  = Expense.amount, filtered by Expense.date.
 */
export const getProfitLoss = asyncHandler(async (req, res) => {
  const { from, to, clinic } = req.query;

  // ── Current period ─────────────────────────────────────────────────────────

  const [
    { grossRevenue, totalRefunds, netRevenue, externalIncome },
    { labCosts, labPaymentCount },
  ] = await Promise.all([
    computeRevenue({ from, to, clinic }),
    computeLabCosts({ from, to }),
  ]);

  // Expenses from Expense collection, grouped by category — exclude voided
  const expenseMatch = { isVoided: { $ne: true } };
  if (from || to) expenseMatch.date = parseIstDateRange(from, to);
  if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
    expenseMatch.clinic = new mongoose.Types.ObjectId(clinic);
  }

  const expenseAgg = await Expense.aggregate([
    { $match: expenseMatch },
    {
      $group: {
        _id: "$category",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  // ── Lab-bucketing: category drives placement ──────────────────────────────
  // Expense docs in range WHERE category === "lab" are counted as lab costs
  // (alongside LabOrder paymentHistory payments). All other non-voided Expense
  // docs go into otherExpenses. Every non-voided expense is counted exactly once.
  const labCategoryRows    = expenseAgg.filter((e) => e._id === "lab");
  const nonLabCategoryRows = expenseAgg.filter((e) => e._id !== "lab");

  const labExpensesTotal = labCategoryRows.reduce((s, e) => s + e.total, 0);
  const labExpensesCount = labCategoryRows.reduce((s, e) => s + e.count, 0);

  // totalLabCosts = LabOrder payments in range + lab-category Expense docs in range
  const totalLabCosts      = labCosts + labExpensesTotal;
  const totalOtherExpenses = nonLabCategoryRows.reduce((s, e) => s + e.total, 0);
  const totalExpenses      = totalLabCosts + totalOtherExpenses;
  const netProfit          = netRevenue - totalExpenses;

  // Expense breakdown by category — non-lab categories only; lab-category
  // expenses are surfaced through labBreakdown (in the lab bucket).
  const expenseBreakdown = nonLabCategoryRows.map((e) => ({
    category: e._id,
    total: e.total,
    count: e.count,
    pct: totalExpenses > 0 ? Math.round((e.total / totalExpenses) * 100) : 0,
  }));

  // Lab breakdown entry: LabOrder payments + lab-category Expense docs combined.
  // Shown whenever the combined lab total is non-zero.
  const labBreakdown = totalLabCosts > 0
    ? {
        category: "lab_orders",
        label: "Lab Orders (paid)",
        total: totalLabCosts,
        count: labPaymentCount + labExpensesCount,
        pct: totalExpenses > 0 ? Math.round((totalLabCosts / totalExpenses) * 100) : 0,
      }
    : null;

  // Unpaid lab orders — surfaced for visibility, NOT counted in P&L expenses
  const [unpaidLabCount, unpaidLabAgg] = await Promise.all([
    LabOrder.countDocuments({ paymentStatus: { $in: ["unpaid", "partially_paid"] } }),
    LabOrder.aggregate([
      { $match: { paymentStatus: { $in: ["unpaid", "partially_paid"] } } },
      { $group: { _id: null, total: { $sum: "$balanceDue" } } },
    ]),
  ]);
  const unpaidLabAmount = unpaidLabAgg[0]?.total || 0;

  // ── Previous period (same duration, immediately preceding) ─────────────────
  const prevRange = getPreviousPeriod(from, to);
  let previousPeriod = null;

  if (prevRange) {
    const [prevRevenue, prevLabCosts] = await Promise.all([
      computeRevenue({ from: prevRange.from, to: prevRange.to, clinic }), // includes external income via computeRevenue
      computeLabCosts({ from: prevRange.from, to: prevRange.to }),
    ]);

    const prevExpenseMatch = { isVoided: { $ne: true }, date: parseIstDateRange(prevRange.from, prevRange.to) };
    if (clinic && mongoose.Types.ObjectId.isValid(clinic)) {
      prevExpenseMatch.clinic = new mongoose.Types.ObjectId(clinic);
    }
    // Apply the same lab-bucketing logic: lab-category Expense docs count as lab costs.
    const prevExpAgg = await Expense.aggregate([
      { $match: prevExpenseMatch },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
    ]);
    const prevLabExp  = prevExpAgg.filter((e) => e._id === "lab").reduce((s, e) => s + e.total, 0);
    const prevOtherExp = prevExpAgg.filter((e) => e._id !== "lab").reduce((s, e) => s + e.total, 0);
    const prevTotalExp = (prevLabCosts.labCosts + prevLabExp) + prevOtherExp;
    const prevNetProfit = prevRevenue.netRevenue - prevTotalExp;

    const pct = (curr, prev) =>
      prev === 0 ? null : Math.round(((curr - prev) / Math.abs(prev)) * 100);

    previousPeriod = {
      from: prevRange.from,
      to: prevRange.to,
      netRevenue: prevRevenue.netRevenue,
      totalExpenses: prevTotalExp,
      netProfit: prevNetProfit,
      changes: {
        netRevenuePct: pct(netRevenue, prevRevenue.netRevenue),
        totalExpensesPct: pct(totalExpenses, prevTotalExp),
        netProfitPct: pct(netProfit, prevNetProfit),
      },
    };
  }

  ApiResponse.success(res, {
    period: { from: from || null, to: to || null },
    revenue: {
      gross: grossRevenue,
      refunds: totalRefunds,
      net: netRevenue,
      externalIncome,
    },
    expenses: {
      lab: totalLabCosts,
      other: totalOtherExpenses,
      total: totalExpenses,
      breakdown: labBreakdown
        ? [labBreakdown, ...expenseBreakdown]
        : expenseBreakdown,
    },
    netProfit,
    unpaidLab: {
      count: unpaidLabCount,
      balanceDue: unpaidLabAmount,
    },
    previousPeriod,
  }, "P&L report generated");
});
