const mongoose = require("mongoose");
require("dotenv").config();

const SHIFT_ID = "69782056920b465e4388509c";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI);
  const oid = new mongoose.Types.ObjectId(SHIFT_ID);

  const orders = await mongoose.connection.db.collection("orders").find({ shiftId: oid, isPaid: true }).toArray();

  let paidStatusPaid = 0;
  let paidStatusServed = 0;
  let paidStatusOther = 0;
  let countPaid = 0, countServed = 0, countOther = 0;

  for (const o of orders) {
    const items = (o.items || []).filter(i => !i.isDeleted && i.status !== "cancelled" && !i.isCancelled);
    const food = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    const grand = food + Math.round(food * 0.1);

    if (o.status === "paid") {
      paidStatusPaid += grand;
      countPaid++;
    } else if (o.status === "served") {
      paidStatusServed += grand;
      countServed++;
    } else {
      paidStatusOther += grand;
      countOther++;
      console.log("  Other:", o.status, o.orderNumber, grand);
    }
  }

  console.log("\n=== isPaid=true orderlar status bo'yicha ===");
  console.log(`status=paid: ${countPaid} ta, ${paidStatusPaid.toLocaleString()} so'm`);
  console.log(`status=served: ${countServed} ta, ${paidStatusServed.toLocaleString()} so'm`);
  if (countOther) console.log(`boshqa: ${countOther} ta, ${paidStatusOther.toLocaleString()} so'm`);
  console.log(`\nJami: ${(paidStatusPaid + paidStatusServed + paidStatusOther).toLocaleString()} so'm`);
  console.log(`Faqat status=paid: ${paidStatusPaid.toLocaleString()} so'm`);

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
