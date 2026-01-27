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

  // Waiter va table populate
  const waiterIds = new Set();
  const tableIds = new Set();
  orders.forEach(o => {
    const wid = typeof o.waiterId === "object" ? (o.waiterId?._id || o.waiterId) : o.waiterId;
    const tid = typeof o.tableId === "object" ? (o.tableId?._id || o.tableId) : o.tableId;
    if (wid) waiterIds.add(String(wid));
    if (tid) tableIds.add(String(tid));
  });

  const waiters = {};
  const tables = {};
  if (waiterIds.size) {
    const wDocs = await mongoose.connection.db.collection("users").find({ _id: { $in: [...waiterIds].map(id => new mongoose.Types.ObjectId(id)) } }).toArray();
    wDocs.forEach(w => { waiters[w._id.toString()] = `${w.firstName || ""} ${w.lastName || ""}`.trim(); });
  }
  if (tableIds.size) {
    const tDocs = await mongoose.connection.db.collection("tables").find({ _id: { $in: [...tableIds].map(id => new mongoose.Types.ObjectId(id)) } }).toArray();
    tDocs.forEach(t => { tables[t._id.toString()] = t.number; });
  }

  function wid(o) { return String(typeof o.waiterId === "object" ? (o.waiterId?._id || o.waiterId) : o.waiterId || ""); }
  function tid(o) { return String(typeof o.tableId === "object" ? (o.tableId?._id || o.tableId) : o.tableId || ""); }
  function wname(o) { return waiters[wid(o)] || "???"; }
  function tname(o) { return tables[tid(o)] ? `Stol ${tables[tid(o)]}` : "???"; }

  function getActive(o) {
    return (o.items || []).filter(i => !i.isDeleted && i.status !== "cancelled" && !i.isCancelled);
  }
  function calcGrand(o) {
    const items = getActive(o);
    const food = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0);
    return food + Math.round(food * 0.1);
  }

  // 1. Stol bo'yicha guruhlash - bir stolda bir vaqtda nechta order bo'lgan
  console.log("=== 1. STOLLAR BO'YICHA BARCHA ORDERLAR ===\n");

  const byTable = {};
  orders.forEach(o => {
    const t = tid(o);
    if (!byTable[t]) byTable[t] = [];
    byTable[t].push(o);
  });

  let totalGrand = 0;
  const allOrdersList = [];

  for (const [tableId, tOrders] of Object.entries(byTable)) {
    tOrders.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const tTotal = tOrders.reduce((s, o) => s + calcGrand(o), 0);
    totalGrand += tTotal;

    const tableName = tables[tableId] ? `Stol ${tables[tableId]}` : `??? (${tableId})`;
    console.log(`${tableName}: ${tOrders.length} ta order, ${tTotal.toLocaleString()} so'm`);

    tOrders.forEach(o => {
      const items = getActive(o);
      const grand = calcGrand(o);
      const time = new Date(o.createdAt).toLocaleTimeString("uz");
      const paidTime = o.paidAt ? new Date(o.paidAt).toLocaleTimeString("uz") : "?";
      console.log(`  #${o.orderNumber} | ${wname(o)} | ${time} -> ${paidTime} | ${grand.toLocaleString()} | ${items.map(i => `${(i.foodName||i.name)} x${i.quantity}`).join(", ")}`);

      allOrdersList.push({
        orderNumber: o.orderNumber,
        table: tableName,
        waiter: wname(o),
        grand,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        _id: o._id.toString(),
      });
    });
    console.log("");
  }

  console.log("JAMI:", totalGrand.toLocaleString(), "\n");

  // 2. isPaid=true lekin paidAt yo'q
  const noPaidAt = orders.filter(o => !o.paidAt);
  if (noPaidAt.length) {
    console.log(`=== 2. paidAt YO'Q ORDERLAR: ${noPaidAt.length} ta ===`);
    let noPaidTotal = 0;
    noPaidAt.forEach(o => {
      const g = calcGrand(o);
      noPaidTotal += g;
      console.log(`  #${o.orderNumber} | ${tname(o)} | ${wname(o)} | ${g.toLocaleString()}`);
    });
    console.log(`  Jami: ${noPaidTotal.toLocaleString()}\n`);
  }

  // 3. Eng katta orderlar (top 20)
  console.log("=== 3. ENG KATTA ORDERLAR (top 20) ===");
  allOrdersList.sort((a, b) => b.grand - a.grand);
  allOrdersList.slice(0, 20).forEach((o, i) => {
    console.log(`  ${i+1}. #${o.orderNumber} | ${o.table} | ${o.waiter} | ${o.grand.toLocaleString()}`);
  });

  // 4. Waiter bo'yicha
  console.log("\n=== 4. WAITER BO'YICHA ===");
  const byWaiter = {};
  orders.forEach(o => {
    const w = wname(o);
    if (!byWaiter[w]) byWaiter[w] = { count: 0, total: 0 };
    byWaiter[w].count++;
    byWaiter[w].total += calcGrand(o);
  });
  Object.entries(byWaiter).sort((a, b) => b[1].total - a[1].total).forEach(([name, data]) => {
    console.log(`  ${name}: ${data.count} ta, ${data.total.toLocaleString()}`);
  });

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
