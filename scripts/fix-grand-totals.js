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

  let fixedCount = 0;
  let oldSum = 0;
  let newSum = 0;

  for (const order of orders) {
    const items = order.items || [];
    const activeItems = items.filter(i => {
      return !i.isDeleted && i.status !== "cancelled" && !i.isCancelled;
    });

    const foodTotal = activeItems.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    const serviceCharge = Math.round(foodTotal * 0.1);
    const correctGrandTotal = foodTotal + serviceCharge;

    oldSum += order.grandTotal || 0;
    newSum += correctGrandTotal;

    if (Math.abs(correctGrandTotal - (order.grandTotal || 0)) > 100) {
      fixedCount++;
      console.log("Order #" + order.orderNumber + ": " + order.grandTotal + " -> " + correctGrandTotal + " (diff: " + (correctGrandTotal - order.grandTotal) + ")");

      await mongoose.connection.db.collection("orders").updateOne(
        { _id: order._id },
        {
          $set: {
            grandTotal: correctGrandTotal,
            total: foodTotal,
            subtotal: foodTotal,
            finalTotal: correctGrandTotal,
            serviceCharge: serviceCharge
          }
        }
      );
    }
  }

  console.log("\n========== NATIJA ==========");
  console.log("Tuzatilgan orderlar:", fixedCount);
  console.log("Eski grandTotal yig'indisi:", oldSum);
  console.log("Yangi grandTotal yig'indisi:", newSum);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
