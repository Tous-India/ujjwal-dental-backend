/**
 * Invoice Service
 *
 * Shared helper for auto-generating invoices from any monetary transaction
 * (admin appointment booking, membership assignment/purchase, treatment payment).
 *
 * Centralises the line-item processing + membership-discount logic so every
 * caller produces identical, server-authoritative invoices. The Invoice model's
 * pre-save hook computes invoiceNumber / subtotal / tax / grandTotal / balanceDue
 * and derives paymentStatus from amountPaid, so callers only supply raw inputs.
 */
import Invoice from "./invoice.model.js";
import Patient from "../patients/patient.model.js";

/**
 * Build line items and create an Invoice.
 *
 * @param {Object}  opts
 * @param {string|Object} opts.patient   Patient id OR a loaded Patient doc
 * @param {string} [opts.clinic]         Clinic id (optional)
 * @param {string} [opts.appointment]    Appointment id (optional)
 * @param {Array}  opts.items            [{ itemType, description, unitPrice|amount, quantity?, discount?, taxRate?, itemRef?, itemRefModel? }]
 * @param {Object} [opts.discount]       Invoice-level discount { percentage, amount }
 * @param {number} [opts.amountPaid=0]   Amount already paid (derives paymentStatus)
 * @param {string} [opts.paymentMethod]  cash|card|upi|online|razorpay|pay-at-clinic
 * @param {string} [opts.notes]
 * @param {string} [opts.createdBy]      User id
 * @param {boolean}[opts.applyMembershipDiscount=true] Apply the patient's active
 *        membership discount to items that don't already carry one. Set false for
 *        membership purchases and for amounts that were already discounted upstream.
 * @returns {Promise<Object>} the created Invoice document
 */
export const generateInvoice = async ({
  patient,
  clinic,
  appointment,
  items,
  discount,
  amountPaid = 0,
  paymentMethod,
  notes,
  createdBy,
  applyMembershipDiscount = true,
}) => {
  // Accept either an id or an already-loaded patient doc (avoids a refetch).
  const patientDoc =
    patient && typeof patient === "object" && patient.hasMembership !== undefined
      ? patient
      : await Patient.findById(patient);

  if (!patientDoc) {
    const err = new Error("Patient not found for invoice generation");
    err.statusCode = 404;
    throw err;
  }

  const processedItems = (items || []).map((item) => {
    const quantity = item.quantity || 1;
    const unitPrice = Number(item.unitPrice ?? item.amount ?? 0);

    let itemDiscount = { percentage: 0, amount: 0 };
    if (applyMembershipDiscount && patientDoc.hasMembership && !item.discount?.percentage) {
      itemDiscount.percentage = patientDoc.currentDiscount || 0;
    } else if (item.discount) {
      itemDiscount = item.discount;
    }

    let amount = unitPrice * quantity;
    if (itemDiscount.percentage > 0) amount -= (amount * itemDiscount.percentage) / 100;
    if (itemDiscount.amount > 0) amount -= itemDiscount.amount;
    amount = Math.max(0, amount);

    const taxRate = item.taxRate || 0;
    const taxAmount = (amount * taxRate) / 100;

    return {
      itemType: item.itemType || "other",
      ...(item.itemRef ? { itemRef: item.itemRef } : {}),
      ...(item.itemRefModel ? { itemRefModel: item.itemRefModel } : {}),
      description: item.description,
      quantity,
      unitPrice,
      discount: itemDiscount,
      taxRate,
      amount,
      taxAmount,
      total: amount + taxAmount,
    };
  });

  const initialPaid = Math.max(0, Number(amountPaid) || 0);

  const invoice = await Invoice.create({
    patient: patientDoc._id,
    ...(clinic ? { clinic } : {}),
    ...(appointment ? { appointment } : {}),
    items: processedItems,
    discount: discount || { percentage: 0, amount: 0 },
    amountPaid: initialPaid,
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(notes ? { notes } : {}),
    ...(createdBy ? { createdBy } : {}),
  });

  return invoice;
};

export default generateInvoice;
