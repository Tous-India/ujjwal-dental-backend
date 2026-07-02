import mongoose from "mongoose";
import { config } from "dotenv";
config();

const URI = process.env.MONGODB_URI;
await mongoose.connect(URI);
const db = mongoose.connection.db;

const exact = await db.collection("invoices").find({ invoiceNumber: "INV-2606-0008" }).toArray();
console.log("=== INV-2606-0008 count:", exact.length);
exact.forEach(d => console.log("  _id:", String(d._id), "| createdAt:", d.createdAt));

const junCount = await db.collection("invoices").countDocuments({ invoiceNumber: { $regex: "^INV-2606-" } });
console.log("=== Total INV-2606-* invoices:", junCount);

const allJun = await db.collection("invoices")
  .find({ invoiceNumber: { $regex: "^INV-2606-" } }, { projection: { invoiceNumber: 1, createdAt: 1 } })
  .sort({ invoiceNumber: 1 })
  .toArray();
console.log("Numbers:", allJun.map(d => d.invoiceNumber));

await mongoose.disconnect();
