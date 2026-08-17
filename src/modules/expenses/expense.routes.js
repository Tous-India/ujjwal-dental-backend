import { Router } from "express";
import { authProtect } from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
import * as expenseController from "./expense.controller.js";

const router = Router();

/**
 * EXPENSE ROUTES
 * Base path: /api/expenses
 * All routes require admin authentication (authProtect).
 * Actions gated by the "expenses" permission module except P&L which
 * uses "reports:view" since it is a read-only financial summary.
 */

// Staff list for spentBy dropdown — expenses:view is sufficient
router.get("/staff", authProtect, checkPermission("expenses", "view"), expenseController.getStaffList);

// Stats summary cards (must come before /:id to avoid route conflict)
router.get("/stats", authProtect, checkPermission("expenses", "view"), expenseController.getExpenseStats);

// P&L report — gated by reports:view so it is accessible to all roles that
// can already see the Reports page, without requiring a separate expenses:view grant.
router.get("/pnl", authProtect, checkPermission("reports", "view"), expenseController.getProfitLoss);

// CRUD
router.get("/", authProtect, checkPermission("expenses", "view"), expenseController.getExpenses);
router.post("/", authProtect, checkPermission("expenses", "create"), expenseController.createExpense);
router.get("/:id", authProtect, checkPermission("expenses", "view"), expenseController.getExpenseById);
router.patch("/:id", authProtect, checkPermission("expenses", "edit"), expenseController.updateExpense);
router.delete("/:id", authProtect, checkPermission("expenses", "delete"), expenseController.deleteExpense);

export default router;
