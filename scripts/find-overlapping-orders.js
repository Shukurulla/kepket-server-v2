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

  // Table populate
  const tableIds = new Set();
  orders.forEach(o => {
    const t = typeof o.tableId === "object" ? (o.tableId?._id || o.tableId) : o.tableId;
    if (t) tableIds.add(String(t));
  });
  const tables = {};
  if (tableIds.size) {
    const tDocs = await mongoose.connection.db.collection("tables").find({ _id: { $in: [...tableIds].map(id => new mongoose.Types.ObjectId(id)) } }).toArray();
    tDocs.forEach(t => { tables[t._id.toString()] = t.number; });
  }
  function tid(o) { return String(typeof o.tableId === "object" ? (o.tableId?._id || o.tableId) : o.tableId || ""); }
  function tname(o) { const n = tables[tid(o)]; return n ? `Stol ${n}` : `ID:${tid(o).slice(-4)}`; }

  function getActive(o) {
    return (o.items || []).filter(i => !i.isDeleted && i.status !== "cancelled" && !i.isCancelled);
  }
  function calcGrand(o) {
    const items = getActive(o);
    const food = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    return food + Math.round(food * 0.1);
  }

  // Stol bo'yicha guruhlash
  const byTable = {};
  orders.forEach(o => {
    const t = tid(o);
    if (!byTable[t]) byTable[t] = [];
    byTable[t].push(o);
  });

  console.log("=== OVERLAP: Bir stolda bir vaqtda ochilgan orderlar ===\n");

  let overlapCount = 0;
  let overlapSum = 0;
  const overlapOrders = new Set(); // duplicate bo'lgan orderlar

  for (const [tableId, tOrders] of Object.entries(byTable)) {
    if (tOrders.length < 2) continue;
    tOrders.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (let i = 0; i < tOrders.length; i++) {
      for (let j = i + 1; j < tOrders.length; j++) {
        const a = tOrders[i];
        const b = tOrders[j];

        // A: createdAt -> paidAt
        // B: createdAt -> paidAt
        // Overlap: B.createdAt < A.paidAt (B ochilganda A hali to'lanmagan)
        const aCreated = new Date(a.createdAt).getTime();
        const aPaid = new Date(a.paidAt || a.createdAt).getTime();
        const bCreated = new Date(b.createdAt).getTime();
        const bPaid = new Date(b.paidAt || b.createdAt).getTime();

        if (bCreated < aPaid && bCreated > aCreated) {
          // B order A to'lanmasdan oldin ochilgan
          overlapCount++;

          const grandA = calcGrand(a);
          const grandB = calcGrand(b);
          const itemsA = getActive(a);
          const itemsB = getActive(b);

          console.log(`${tname(a)}: Order #${a.orderNumber} vs #${b.orderNumber} (OVERLAP)`);
          console.log(`  A: ${new Date(a.createdAt).toLocaleTimeString("uz")} -> ${new Date(a.paidAt).toLocaleTimeString("uz")} | ${grandA.toLocaleString()} | ${itemsA.map(i=>`${i.foodName||i.name} x${i.quantity}`).join(", ")}`);
          console.log(`  B: ${new Date(b.createdAt).toLocaleTimeString("uz")} -> ${new Date(b.paidAt).toLocaleTimeString("uz")} | ${grandB.toLocaleString()} | ${itemsB.map(i=>`${i.foodName||i.name} x${i.quantity}`).join(", ")}`);

          // Kichikroq orderni duplicate deb belgilash
          const smaller = grandA < grandB ? a : b;
          const smallerGrand = Math.min(grandA, grandB);
          if (!overlapOrders.has(smaller._id.toString())) {
            overlapOrders.add(smaller._id.toString());
            overlapSum += smallerGrand;
          }
          console.log("");
        }
      }
    }
  }

  console.log("=== XULOSA ===");
  console.log("Overlap juftliklar:", overlapCount);
  console.log("Unique overlap orderlar:", overlapOrders.size);
  console.log("Overlap summa (kichikroq orderlarni olib tashlasa):", overlapSum.toLocaleString());
  console.log("Hozirgi jami:", "17,622,000");
  console.log("Overlaplarni olib tashlasa:", (17622000 - overlapSum).toLocaleString());

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
