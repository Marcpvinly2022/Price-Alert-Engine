import 'dotenv/config';
import pg from 'pg';

console.log('Connecting to:', process.env.DATABASE_URL);

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
});

try {
  await client.connect();
  console.log('CONNECTED');

  const result = await client.query('SELECT NOW()');
  console.log(result.rows);

  await client.end();
} catch (err) {
  console.error('DB ERROR');
  console.error(err);
}