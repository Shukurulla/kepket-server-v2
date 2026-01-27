const mongoose = require("mongoose");
const fs = require("fs");
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
  function tname(o) { const n = tables[tid(o)]; return n ? `Stol ${n}` : `Noma'lum`; }

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

  const overlapOrderIds = new Set();

  for (const [tableId, tOrders] of Object.entries(byTable)) {
    if (tOrders.length < 2) continue;
    tOrders.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (let i = 0; i < tOrders.length; i++) {
      for (let j = i + 1; j < tOrders.length; j++) {
        const a = tOrders[i];
        const b = tOrders[j];

        const aCreated = new Date(a.createdAt).getTime();
        const aPaid = new Date(a.paidAt || a.createdAt).getTime();
        const bCreated = new Date(b.createdAt).getTime();

        if (bCreated < aPaid && bCreated > aCreated) {
          // Kichikroq grandTotal li orderni duplicate deb belgilash
          const grandA = calcGrand(a);
          const grandB = calcGrand(b);
          const smaller = grandA < grandB ? a : b;
          overlapOrderIds.add(smaller._id.toString());
        }
      }
    }
  }

  // JSON uchun ma'lumotlar yig'ish
  const overlapOrders = orders.filter(o => overlapOrderIds.has(o._id.toString()));
  let totalSum = 0;

  const jsonData = overlapOrders.map(o => {
    const items = getActive(o);
    const grand = calcGrand(o);
    totalSum += grand;
    return {
      _id: o._id.toString(),
      orderNumber: o.orderNumber,
      table: tname(o),
      tableId: tid(o),
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      grandTotal: grand,
      storedGrandTotal: o.grandTotal,
      items: items.map(i => ({
        foodName: i.foodName || i.name,
        quantity: i.quantity,
        price: i.price,
        total: (i.price || 0) * (i.quantity || 0)
      }))
    };
  }).sort((a, b) => a.orderNumber - b.orderNumber);

  console.log("Overlap orderlar soni:", jsonData.length);
  console.log("Overlap orderlar summasi:", totalSum.toLocaleString());

  // JSON faylga yozish
  const output = {
    shiftId: SHIFT_ID,
    totalOverlapOrders: jsonData.length,
    totalOverlapSum: totalSum,
    exportedAt: new Date().toISOString(),
    orders: jsonData
  };

  fs.writeFileSync("scripts/overlap-orders.json", JSON.stringify(output, null, 2), "utf-8");
  console.log("JSON fayl yaratildi: scripts/overlap-orders.json");

  // MongoDB da isDeleted: true qilish
  const ids = jsonData.map(o => new mongoose.Types.ObjectId(o._id));
  const result = await mongoose.connection.db.collection("orders").updateMany(
    { _id: { $in: ids } },
    { $set: { isDeleted: true } }
  );
  console.log("MongoDB da isDeleted: true qilindi:", result.modifiedCount, "ta order");

  // Yangi jami
  const remaining = orders.filter(o => !overlapOrderIds.has(o._id.toString()));
  let newTotal = 0;
  remaining.forEach(o => { newTotal += calcGrand(o); });
  console.log("\nEski jami: 17,622,000");
  console.log("Yangi jami (overlap olib tashlangandan keyin):", newTotal.toLocaleString());

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
