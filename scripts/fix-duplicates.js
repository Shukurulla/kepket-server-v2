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

  let totalFixed = 0;
  let totalDuplicateItems = 0;

  for (const order of orders) {
    const items = order.items || [];
    const activeItems = items.filter(i => {
      return !i.isDeleted && i.status !== "cancelled" && !i.isCancelled;
    });

    // foodId + foodName + price + quantity bo'yicha guruhlash
    const seen = new Map();
    const duplicateIds = [];

    for (const item of activeItems) {
      const foodId = item.foodId ? item.foodId.toString() : "";
      const key = foodId + "_" + (item.foodName || "") + "_" + item.price + "_" + item.quantity;
      if (!seen.has(key)) {
        seen.set(key, item);
      } else {
        // Bu duplicate - isDeleted qilish kerak
        duplicateIds.push(item._id);
      }
    }

    if (duplicateIds.length > 0) {
      totalFixed++;
      totalDuplicateItems += duplicateIds.length;
      console.log("Order #" + order.orderNumber + " - " + duplicateIds.length + " ta duplicate o'chirildi");

      // items massivida duplicate itemlarni isDeleted: true qilish
      const updatedItems = items.map(item => {
        const isDupe = duplicateIds.some(id => id.toString() === item._id.toString());
        if (isDupe) {
          return { ...item, isDeleted: true };
        }
        return item;
      });

      await mongoose.connection.db.collection("orders").updateOne(
        { _id: order._id },
        { $set: { items: updatedItems } }
      );
    }
  }

  console.log("\n========== NATIJA ==========");
  console.log("Tuzatilgan orderlar:", totalFixed);
  console.log("isDeleted qilingan itemlar:", totalDuplicateItems);

  // Qayta hisoblash
  const ordersAfter = await mongoose.connection.db.collection("orders").find({
    shiftId: new mongoose.Types.ObjectId(SHIFT_ID),
    isPaid: true,
    status: { $ne: "cancelled" }
  }).toArray();

  let newTotal = 0;
  for (const order of ordersAfter) {
    const activeItems = (order.items || []).filter(i => {
      return !i.isDeleted && i.status !== "cancelled" && !i.isCancelled;
    });
    const foodTotal = activeItems.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    newTotal += foodTotal + Math.round(foodTotal * 0.1);
  }

  console.log("Yangi jami tushum:", newTotal);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
