const mongoose = require("mongoose");
require("dotenv").config();

const SHIFT_ID = "69782056920b465e4388509c";

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI);
  const oid = new mongoose.Types.ObjectId(SHIFT_ID);

  const orders = await mongoose.connection.db.collection("orders").find({
    shiftId: oid,
    isPaid: true,
    status: { $ne: "cancelled" }
  }).toArray();

  // Har bir orderning active itemlarini olish
  function getActiveItems(order) {
    return (order.items || []).filter(i => !i.isDeleted && i.status !== "cancelled" && !i.isCancelled);
  }

  function getItemsKey(order) {
    const items = getActiveItems(order);
    // foodName + quantity + price bo'yicha sort qilib key yasash
    const sorted = items.map(i => `${i.foodName || i.name}:${i.quantity}:${i.price}`).sort();
    return sorted.join("|");
  }

  function getWaiterName(order) {
    if (order.waiterId && typeof order.waiterId === "object") {
      return `${order.waiterId.firstName || ""} ${order.waiterId.lastName || ""}`.trim();
    }
    return String(order.waiterId || "");
  }

  function getTableName(order) {
    if (order.tableId && typeof order.tableId === "object") {
      return order.tableId.number || order.tableId._id?.toString() || "";
    }
    return String(order.tableId || "");
  }

  // Bir xil stol + waiter + yaqin vaqt + oxshash itemlar
  const suspects = [];

  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const a = orders[i];
      const b = orders[j];

      // Waiter bir xil?
      const waiterA = getWaiterName(a);
      const waiterB = getWaiterName(b);
      if (waiterA !== waiterB) continue;

      // Stol bir xil?
      const tableA = getTableName(a);
      const tableB = getTableName(b);
      if (tableA !== tableB) continue;

      // Vaqt farqi 5 minut ichida?
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      const diffMin = Math.abs(timeA - timeB) / 60000;
      if (diffMin > 5) continue;

      // Itemlar bir xil?
      const keyA = getItemsKey(a);
      const keyB = getItemsKey(b);
      if (keyA !== keyB) continue;
      if (!keyA) continue; // bo'sh itemlar

      const itemsA = getActiveItems(a);
      const foodTotalA = itemsA.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
      const grandA = foodTotalA + Math.round(foodTotalA * 0.1);

      const itemsB = getActiveItems(b);
      const foodTotalB = itemsB.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
      const grandB = foodTotalB + Math.round(foodTotalB * 0.1);

      suspects.push({
        orderA: a.orderNumber,
        orderB: b.orderNumber,
        waiter: waiterA,
        table: tableA,
        timeDiffSec: Math.round(Math.abs(timeA - timeB) / 1000),
        timeA: new Date(a.createdAt).toLocaleString("uz"),
        timeB: new Date(b.createdAt).toLocaleString("uz"),
        itemsCount: itemsA.length,
        items: itemsA.map(i => `${i.foodName || i.name} x${i.quantity} @ ${i.price}`),
        grandTotalA: grandA,
        grandTotalB: grandB,
        idA: a._id.toString(),
        idB: b._id.toString(),
      });
    }
  }

  console.log("=== SHUBHALI DUPLICATE ORDERLAR ===");
  console.log("(Bir stol, bir waiter, 5 minut ichida, bir xil itemlar)\n");

  if (suspects.length === 0) {
    console.log("Hech qanday shubhali duplicate topilmadi.");
  } else {
    let totalDuplicate = 0;
    suspects.forEach((s, idx) => {
      console.log(`#${idx + 1}. Order ${s.orderA} vs ${s.orderB}`);
      console.log(`   Waiter: ${s.waiter} | Stol: ${s.table}`);
      console.log(`   Vaqt farqi: ${s.timeDiffSec} soniya`);
      console.log(`   Vaqt A: ${s.timeA} | Vaqt B: ${s.timeB}`);
      console.log(`   Itemlar (${s.itemsCount}): ${s.items.join(", ")}`);
      console.log(`   GrandTotal A: ${s.grandTotalA.toLocaleString()} | B: ${s.grandTotalB.toLocaleString()}`);
      console.log("");
      totalDuplicate += s.grandTotalB; // ikkinchisini duplicate deb hisoblash
    });

    console.log("=== XULOSA ===");
    console.log("Shubhali juftliklar:", suspects.length);
    console.log("Duplicate summa (ikkinchilarini olib tashlasa):", totalDuplicate.toLocaleString());

    // Hozirgi jami
    let currentTotal = 0;
    for (const o of orders) {
      const items = getActiveItems(o);
      const food = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
      currentTotal += food + Math.round(food * 0.1);
    }
    console.log("Hozirgi jami:", currentTotal.toLocaleString());
    console.log("Duplicatelarni olib tashlasa:", (currentTotal - totalDuplicate).toLocaleString());
  }

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
