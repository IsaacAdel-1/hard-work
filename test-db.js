/* ============================================================
   test-db.js — quick standalone MongoDB connection check.
   Run with:  node test-db.js
   Does NOT touch the app, routes, or any data.
   ============================================================ */
require("dotenv").config();
const { connectDB, client } = require("./db");

(async () => {
  try {
    const db = await connectDB();
    // ping the server to confirm the connection really works
    await db.command({ ping: 1 });
    console.log(`✅ Connection test passed — database: "${db.databaseName}"`);
  } catch (err) {
    console.error("❌ Connection test FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
    console.log("Connection closed.");
  }
})();
