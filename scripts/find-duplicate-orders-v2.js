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

  function getActiveItems(order) {
    return (order.items || []).filter(i => !i.isDeleted && i.status !== "cancelled" && !i.isCancelled);
  }

  function getWaiterId(order) {
    if (order.waiterId && typeof order.waiterId === "object") return order.waiterId._id?.toString() || "";
    return String(order.waiterId || "");
  }

  function getTableId(order) {
    if (order.tableId && typeof order.tableId === "object") return order.tableId._id?.toString() || "";
    return String(order.tableId || "");
  }

  function getWaiterName(order) {
    if (order.waiterId && typeof order.waiterId === "object") {
      return `${order.waiterId.firstName || ""} ${order.waiterId.lastName || ""}`.trim();
    }
    return "";
  }

  function getTableName(order) {
    if (order.tableId && typeof order.tableId === "object") return "Stol " + (order.tableId.number || "?");
    return "";
  }

  // Stol va waiter bo'yicha guruhlash
  const groups = {};
  for (const o of orders) {
    const key = getTableId(o) + "__" + getWaiterId(o);
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  }

  const suspects = [];

  for (const [key, group] of Object.entries(groups)) {
    if (group.length < 2) continue;

    // Vaqt bo'yicha sort
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        const diffMin = Math.abs(timeA - timeB) / 60000;

        // 30 minut ichida
        if (diffMin > 30) continue;

        // Itemlarni solishtirish
        const itemsA = getActiveItems(a);
        const itemsB = getActiveItems(b);

        if (itemsA.length === 0 || itemsB.length === 0) continue;

        // Food name + price bo'yicha set
        const setA = new Set(itemsA.map(i => `${i.foodName || i.name}:${i.price}`));
        const setB = new Set(itemsB.map(i => `${i.foodName || i.name}:${i.price}`));

        // Mos kelish foizi
        let matchCount = 0;
        for (const item of setA) {
          if (setB.has(item)) matchCount++;
        }
        const maxSet = Math.max(setA.size, setB.size);
        const matchPercent = Math.round((matchCount / maxSet) * 100);

        if (matchPercent < 50) continue;

        const foodA = itemsA.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
        const grandA = foodA + Math.round(foodA * 0.1);
        const foodB = itemsB.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
        const grandB = foodB + Math.round(foodB * 0.1);

        suspects.push({
          orderA: a.orderNumber,
          orderB: b.orderNumber,
          waiter: getWaiterName(a),
          table: getTableName(a),
          diffMin: Math.round(diffMin * 10) / 10,
          matchPercent,
          itemsA: itemsA.map(i => `${i.foodName || i.name} x${i.quantity}`).join(", "),
          itemsB: itemsB.map(i => `${i.foodName || i.name} x${i.quantity}`).join(", "),
          grandA,
          grandB,
        });
      }
    }
  }

  console.log("=== SHUBHALI DUPLICATE ORDERLAR (kengaytirilgan) ===");
  console.log("(Bir stol, bir waiter, 30 min ichida, 50%+ mos itemlar)\n");

  if (suspects.length === 0) {
    console.log("Hech qanday shubhali duplicate topilmadi.");
  } else {
    let totalDuplicate = 0;
    suspects.forEach((s, idx) => {
      console.log(`#${idx + 1}. Order ${s.orderA} vs ${s.orderB} [${s.matchPercent}% mos]`);
      console.log(`   Waiter: ${s.waiter} | Stol: ${s.table} | Vaqt farqi: ${s.diffMin} min`);
      console.log(`   A (${s.grandA.toLocaleString()}): ${s.itemsA}`);
      console.log(`   B (${s.grandB.toLocaleString()}): ${s.itemsB}`);
      console.log("");
      totalDuplicate += Math.min(s.grandA, s.grandB);
    });

    console.log("=== XULOSA ===");
    console.log("Shubhali juftliklar:", suspects.length);
    console.log("Duplicate summa:", totalDuplicate.toLocaleString());
  }

  // Umumiy statistika
  let currentTotal = 0;
  for (const o of orders) {
    const items = getActiveItems(o);
    const food = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    currentTotal += food + Math.round(food * 0.1);
  }
  console.log("\nHozirgi jami:", currentTotal.toLocaleString());

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
