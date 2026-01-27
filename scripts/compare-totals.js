const mongoose = require("mongoose");
require("dotenv").config();

const SHIFT_ID = "69782056920b465e4388509c";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI);

  const orders = await mongoose.connection.db.collection("orders").find({
    shiftId: new mongoose.Types.ObjectId(SHIFT_ID),
    isPaid: true,
    status: { $ne: "cancelled" }
  }).toArray();

  let grandTotalSum = 0;
  let activeTotalSum = 0;
  let mismatchCount = 0;
  let bigMismatch = [];

  for (const order of orders) {
    const items = order.items || [];
    const activeItems = items.filter(i => {
      return !i.isDeleted && i.status !== "cancelled" && !i.isCancelled;
    });

    const foodTotal = activeItems.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    const activeGrand = foodTotal + Math.round(foodTotal * 0.1);

    grandTotalSum += order.grandTotal || 0;
    activeTotalSum += activeGrand;

    const diff = activeGrand - (order.grandTotal || 0);
    if (Math.abs(diff) > 1000) {
      mismatchCount++;
      bigMismatch.push({
        orderNumber: order.orderNumber,
        grandTotal: order.grandTotal,
        activeGrand: activeGrand,
        diff: diff,
        allItemsCount: items.length,
        activeItemsCount: activeItems.length,
        deletedCount: items.filter(i => i.isDeleted).length,
        cancelledCount: items.filter(i => i.isCancelled || i.status === "cancelled").length
      });
    }
  }

  console.log("========== SUMMARY ==========");
  console.log("Orderlar:", orders.length);
  console.log("grandTotal yig'indisi:", grandTotalSum);
  console.log("Active items yig'indisi:", activeTotalSum);
  console.log("Farq:", activeTotalSum - grandTotalSum);
  console.log("Mismatch orderlar:", mismatchCount);

  console.log("\n--- Eng katta farqli orderlar ---");
  bigMismatch.sort((a, b) => b.diff - a.diff);
  bigMismatch.forEach(m => {
    console.log("Order #" + m.orderNumber + ": grandTotal=" + m.grandTotal + " active=" + m.activeGrand + " diff=" + m.diff + " (items: " + m.allItemsCount + " all, " + m.activeItemsCount + " active, " + m.deletedCount + " deleted, " + m.cancelledCount + " cancelled)");
  });

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
