// src/config/pool.js
import "dotenv/config";
import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL; this avoids self-signed cert issues
});

pool.on("error", (err) => {
  console.error("Unexpected pg pool error:", err);
});