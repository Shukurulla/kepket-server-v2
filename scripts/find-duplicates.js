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

  console.log("Jami orderlar:", orders.length);

  let totalGrand = 0;
  let duplicateCount = 0;
  let ordersWithDupes = 0;

  for (const order of orders) {
    const items = order.items || [];
    const activeItems = items.filter(i => {
      return !i.isDeleted && i.status !== "cancelled" && !i.isCancelled;
    });

    // foodId + foodName + price + quantity bo'yicha guruhlash
    const seen = new Map();
    let hasDupe = false;

    for (const item of activeItems) {
      const foodId = item.foodId ? item.foodId.toString() : "";
      const key = foodId + "_" + (item.foodName || "") + "_" + item.price + "_" + item.quantity;
      if (!seen.has(key)) {
        seen.set(key, [item]);
      } else {
        seen.get(key).push(item);
        hasDupe = true;
      }
    }

    if (hasDupe) {
      ordersWithDupes++;
      console.log("\n--- Order #" + order.orderNumber + " (ID: " + order._id + ") ---");
      console.log("grandTotal:", order.grandTotal);
      for (const [key, group] of seen.entries()) {
        if (group.length > 1) {
          duplicateCount += group.length - 1;
          console.log("  DUPLICATE: " + group[0].foodName + " x" + group[0].quantity + " @ " + group[0].price + " (" + group.length + " ta)");
          group.forEach((item, idx) => {
            console.log("    [" + idx + "] _id=" + item._id + " qty=" + item.quantity + " status=" + (item.status || "?") + " isCancelled=" + item.isCancelled);
          });
        }
      }
    }

    const foodTotal = activeItems.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    totalGrand += foodTotal + Math.round(foodTotal * 0.1);
  }

  console.log("\n========== XULOSA ==========");
  console.log("Jami active tushum (hisoblangan):", totalGrand);
  console.log("Duplicate itemlar soni:", duplicateCount);
  console.log("Duplicate bolgan orderlar:", ordersWithDupes);

  // Agar kassadagi summa ~12M bo'lsa, farq = 19.4M - 12M = ~7.4M
  // Bu duplicate itemlar summasi bo'lishi kerak

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
