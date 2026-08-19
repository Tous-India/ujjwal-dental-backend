/**
 * Shared utility: compute the total non-voided external income for a date range.
 *
 * Imported by BOTH expense.controller.js (P&L) and payment.controller.js
 * (Payment History summary-stats) so external income is added in ONE place
 * and picked up by every revenue-total figure in the app.
 *
 * Date field: ExternalIncome.date (the income event date, IST-anchored).
 */
import ExternalIncome from "../modules/externalIncome/externalIncome.model.js";
import { parseIstDateRange } from "./istDateRange.js";

/**
 * @param {Object} opts
 * @param {string} [opts.from]  yyyy-mm-dd start (inclusive)
 * @param {string} [opts.to]    yyyy-mm-dd end   (inclusive)
 * @returns {Promise<number>}  total amount of non-voided external income in range
 */
export const computeExternalIncomeTotal = async ({ from, to } = {}) => {
  const match = { isVoided: false };
  if (from || to) match.date = parseIstDateRange(from, to);

  const [agg] = await ExternalIncome.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return agg?.total || 0;
};
