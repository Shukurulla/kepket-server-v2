const mongoose = require("mongoose");
require("dotenv").config();

const SHIFT_ID = "69782056920b465e4388509c";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI);
  const oid = new mongoose.Types.ObjectId(SHIFT_ID);

  // isPaid=true lekin status served bo'lganlarni paid qilish
  const result = await mongoose.connection.db.collection("orders").updateMany(
    { shiftId: oid, isPaid: true, status: "served" },
    { $set: { status: "paid" } }
  );

  console.log("O'zgartirildi:", result.modifiedCount, "ta order (served -> paid)");

  // Natijani tekshirish
  const orders = await mongoose.connection.db.collection("orders").find({ shiftId: oid, status: "paid" }).toArray();
  let total = 0;
  for (const o of orders) {
    total += o.grandTotal || 0;
  }
  console.log("Yangi status=paid jami grandTotal:", total.toLocaleString());
  console.log("Jami paid orderlar:", orders.length);

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
