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

  // Waiter va table ma'lumotlarini olish
  const waiterIds = [...new Set(orders.map(o => o.waiterId).filter(Boolean).map(w => typeof w === "object" ? w._id || w : w))];
  const tableIds = [...new Set(orders.map(o => o.tableId).filter(Boolean).map(t => typeof t === "object" ? t._id || t : t))];

  const waiters = {};
  const tables = {};

  if (waiterIds.length) {
    const wDocs = await mongoose.connection.db.collection("users").find({ _id: { $in: waiterIds.map(id => new mongoose.Types.ObjectId(String(id))) } }).toArray();
    wDocs.forEach(w => { waiters[w._id.toString()] = `${w.firstName || ""} ${w.lastName || ""}`.trim(); });
  }
  if (tableIds.length) {
    const tDocs = await mongoose.connection.db.collection("tables").find({ _id: { $in: tableIds.map(id => new mongoose.Types.ObjectId(String(id))) } }).toArray();
    tDocs.forEach(t => { tables[t._id.toString()] = `Stol ${t.number}`; });
  }

  function getWaiterId(o) { return (typeof o.waiterId === "object" ? (o.waiterId._id || o.waiterId) : o.waiterId)?.toString() || ""; }
  function getTableId(o) { return (typeof o.tableId === "object" ? (o.tableId._id || o.tableId) : o.tableId)?.toString() || ""; }
  function getWaiterName(o) { return waiters[getWaiterId(o)] || "Noma'lum"; }
  function getTableName(o) { return tables[getTableId(o)] || "Noma'lum stol"; }

  function getActiveItems(order) {
    return (order.items || []).filter(i => !i.isDeleted && i.status !== "cancelled" && !i.isCancelled);
  }

  // Aniq duplicate: bir stol, bir waiter, bir xil itemlar (foodName+qty+price), 2 min ichida
  function getItemsFingerprint(order) {
    const items = getActiveItems(order);
    return items.map(i => `${(i.foodName || i.name || "").trim()}|${i.quantity}|${i.price}`).sort().join(";;");
  }

  // Guruhlash: stol + waiter
  const groups = {};
  for (const o of orders) {
    const key = getTableId(o) + "_" + getWaiterId(o);
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  }

  const exactDups = [];

  for (const group of Object.values(groups)) {
    if (group.length < 2) continue;
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];

        const diffSec = Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) / 1000;
        if (diffSec > 120) continue; // 2 minut

        const fpA = getItemsFingerprint(a);
        const fpB = getItemsFingerprint(b);

        if (fpA === fpB && fpA !== "") {
          const items = getActiveItems(a);
          const food = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
          const grand = food + Math.round(food * 0.1);

          exactDups.push({
            orderA: a.orderNumber,
            orderB: b.orderNumber,
            waiter: getWaiterName(a),
            table: getTableName(a),
            diffSec: Math.round(diffSec),
            items: items.map(i => `${i.foodName || i.name} x${i.quantity} (${i.price})`),
            grandTotal: grand,
            idA: a._id.toString(),
            idB: b._id.toString(),
          });
        }
      }
    }
  }

  console.log("=== ANIQ DUPLICATE ORDERLAR ===");
  console.log("(Bir stol, bir waiter, 2 min ichida, 100% bir xil itemlar)\n");

  if (exactDups.length === 0) {
    console.log("Topilmadi.\n");
  } else {
    let dupSum = 0;
    exactDups.forEach((d, idx) => {
      console.log(`#${idx + 1}. Order ${d.orderA} vs ${d.orderB} (${d.diffSec} sek farq)`);
      console.log(`   ${d.waiter} | ${d.table}`);
      console.log(`   Itemlar: ${d.items.join(", ")}`);
      console.log(`   GrandTotal: ${d.grandTotal.toLocaleString()}`);
      console.log("");
      dupSum += d.grandTotal;
    });
    console.log("Duplicate summa:", dupSum.toLocaleString());
  }

  // Kengaytirilgan: 5 min ichida, 100% mos
  console.log("\n=== 5 MIN ICHIDA 100% MOS ===");
  const near = [];
  for (const group of Object.values(groups)) {
    if (group.length < 2) continue;
    group.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const diffSec = Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) / 1000;
        if (diffSec > 300) continue;
        if (diffSec <= 120) continue; // allaqachon yuqorida ko'rsatilgan

        const fpA = getItemsFingerprint(a);
        const fpB = getItemsFingerprint(b);
        if (fpA === fpB && fpA !== "") {
          const items = getActiveItems(a);
          const food = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
          const grand = food + Math.round(food * 0.1);
          near.push({
            orderA: a.orderNumber,
            orderB: b.orderNumber,
            waiter: getWaiterName(a),
            table: getTableName(a),
            diffSec: Math.round(diffSec),
            items: items.map(i => `${i.foodName || i.name} x${i.quantity}`),
            grandTotal: grand,
          });
        }
      }
    }
  }

  if (near.length === 0) {
    console.log("Topilmadi.");
  } else {
    near.forEach((d, idx) => {
      console.log(`#${idx + 1}. Order ${d.orderA} vs ${d.orderB} (${d.diffSec} sek farq)`);
      console.log(`   ${d.waiter} | ${d.table} | ${d.items.join(", ")} | ${d.grandTotal.toLocaleString()}`);
    });
  }

  console.log("\nHozirgi jami grandTotal:", orders.reduce((s, o) => {
    const items = getActiveItems(o);
    const food = items.reduce((s2, i) => s2 + (i.price || 0) * (i.quantity || 0), 0);
    return s + food + Math.round(food * 0.1);
  }, 0).toLocaleString());

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
