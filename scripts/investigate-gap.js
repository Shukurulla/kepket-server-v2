const mongoose = require("mongoose");
require("dotenv").config();

const SHIFT_ID = "69782056920b465e4388509c";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI);

  const db = mongoose.connection.db;
  const oid = new mongoose.Types.ObjectId(SHIFT_ID);

  // 1. Barcha orderlar - statuslar bo'yicha
  const allOrders = await db.collection("orders").find({ shiftId: oid }).toArray();

  const statusMap = {};
  const paidMap = {};
  let totalAll = 0;
  let totalPaid = 0;
  let totalPaidActive = 0; // isPaid=true, status !== cancelled
  let totalUnpaid = 0;
  let totalCancelled = 0;

  for (const order of allOrders) {
    const st = order.status || "unknown";
    statusMap[st] = (statusMap[st] || 0) + 1;

    const paid = order.isPaid ? "paid" : "unpaid";
    paidMap[paid] = (paidMap[paid] || 0) + 1;

    totalAll += order.grandTotal || 0;

    if (order.isPaid) {
      totalPaid += order.grandTotal || 0;
      if (order.status !== "cancelled") {
        totalPaidActive += order.grandTotal || 0;
      }
    } else {
      totalUnpaid += order.grandTotal || 0;
    }

    if (order.status === "cancelled") {
      totalCancelled += order.grandTotal || 0;
    }
  }

  console.log("=== ORDERLAR STATISTIKASI ===");
  console.log("Jami orderlar:", allOrders.length);
  console.log("\nStatus bo'yicha:", statusMap);
  console.log("isPaid bo'yicha:", paidMap);
  console.log("\n=== SUMMALAR ===");
  console.log("Barcha orderlar grandTotal:", totalAll.toLocaleString());
  console.log("isPaid=true grandTotal:", totalPaid.toLocaleString());
  console.log("isPaid=true & status!=cancelled:", totalPaidActive.toLocaleString());
  console.log("isPaid=false grandTotal:", totalUnpaid.toLocaleString());
  console.log("status=cancelled grandTotal:", totalCancelled.toLocaleString());

  // 2. Active items asosida haqiqiy summa
  let realFoodTotal = 0;
  let realGrandTotal = 0;
  let paidActiveCount = 0;

  for (const order of allOrders) {
    if (!order.isPaid || order.status === "cancelled") continue;
    paidActiveCount++;

    const items = (order.items || []).filter(i => !i.isDeleted && i.status !== "cancelled" && !i.isCancelled);
    const foodTotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    realFoodTotal += foodTotal;
    realGrandTotal += foodTotal + Math.round(foodTotal * 0.1);
  }

  console.log("\n=== HAQIQIY HISOB (isPaid & !cancelled, active items) ===");
  console.log("Orderlar soni:", paidActiveCount);
  console.log("Food total:", realFoodTotal.toLocaleString());
  console.log("Grand total (food + 10%):", realGrandTotal.toLocaleString());

  // 3. Payment type bo'yicha
  const paymentTypes = {};
  for (const order of allOrders) {
    if (!order.isPaid || order.status === "cancelled") continue;
    const pt = order.paymentType || order.paymentMethod || "unknown";
    if (!paymentTypes[pt]) paymentTypes[pt] = { count: 0, total: 0 };
    paymentTypes[pt].count++;
    paymentTypes[pt].total += order.grandTotal || 0;
  }
  console.log("\n=== TO'LOV TURLARI ===");
  for (const [type, info] of Object.entries(paymentTypes)) {
    console.log(`${type}: ${info.count} ta, ${info.total.toLocaleString()} so'm`);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
