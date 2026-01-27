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

  let totalActive = 0;
  let suspiciousOrders = 0;

  for (const order of orders) {
    const items = order.items || [];
    const activeItems = items.filter(i => {
      return !i.isDeleted && i.status !== "cancelled" && !i.isCancelled;
    });

    // foodId bo'yicha guruhlash (quantity farqi bilan ham)
    const foodGroups = new Map();
    for (const item of activeItems) {
      const foodId = item.foodId ? item.foodId.toString() : "";
      const key = foodId + "_" + (item.foodName || "");
      if (!foodGroups.has(key)) {
        foodGroups.set(key, []);
      }
      foodGroups.get(key).push(item);
    }

    // Bir xil food 2+ marta turgan orderlarni ko'rsatish
    let hasSuspicious = false;
    for (const [key, group] of foodGroups.entries()) {
      if (group.length > 1) {
        if (!hasSuspicious) {
          hasSuspicious = true;
          suspiciousOrders++;
          const foodTotal = activeItems.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
          console.log("\n--- Order #" + order.orderNumber + " | grandTotal=" + order.grandTotal + " | activeFoodTotal=" + foodTotal + " ---");
          console.log("  Active items (" + activeItems.length + "):");
          activeItems.forEach(item => {
            const ts = item._id.getTimestamp ? item._id.getTimestamp().toISOString() : "?";
            console.log("    " + item.foodName + " x" + item.quantity + " @ " + item.price + " | status=" + (item.status || "?") + " | created=" + ts);
          });
        }
        console.log("  SUSPECT: " + group[0].foodName + " - " + group.length + " marta:");
        group.forEach(item => {
          const ts = item._id.getTimestamp ? item._id.getTimestamp().toISOString() : "?";
          console.log("    _id=" + item._id + " qty=" + item.quantity + " created=" + ts);
        });
      }
    }

    const foodTotal = activeItems.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    totalActive += foodTotal + Math.round(foodTotal * 0.1);
  }

  console.log("\n========== XULOSA ==========");
  console.log("Jami active tushum:", totalActive);
  console.log("Shubhali orderlar:", suspiciousOrders);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
