// test-conn.js
import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const res = await client.query("SELECT 1");
  console.log("SUCCESS:", res.rows);
} catch (err) {
  console.error("RAW PG ERROR:", err);
} finally {
  await client.end();
}