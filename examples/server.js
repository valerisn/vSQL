// JS usage examples for a consumer resource. Treat exports.vSQL as the API.
const db = global.exports.vSQL;

// 1) Read with positional params; await the promise directly.
on('app:getVehicles', async (owner) => {
  const vehicles = await db.query('SELECT plate, model FROM vehicles WHERE owner = ?', [owner]);
  console.log(`player ${owner} owns ${vehicles.length} vehicle(s)`);
});

// 2) Batched insert — one prepared statement, many rows, wrapped in a transaction.
async function importVehicles(owner, list) {
  const affected = await db.batch('INSERT INTO vehicles (plate, owner, model) VALUES (?, ?, ?)', list.map((v) => [v.plate, owner, v.model]));
  return affected;
}

// 3) Transaction via callback — anything thrown rolls the whole thing back.
async function buyVehicle(buyer, plate, model, price) {
  return db.transaction(async (tx) => {
    const bank = await tx.scalar('SELECT bank FROM players WHERE citizenid = ?', [buyer]);
    if (bank < price) throw new Error('insufficient funds');
    await tx.update('UPDATE players SET bank = bank - ? WHERE citizenid = ?', [price, buyer]);
    return tx.insert('INSERT INTO vehicles (plate, owner, model) VALUES (?, ?, ?)', [plate, buyer, model]);
  });
}

module.exports = { importVehicles, buyVehicle };
