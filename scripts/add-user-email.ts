import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
(async () => {
  await pool.query(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT`);
  console.log('User.email column ready.');
  await pool.end();
})();
