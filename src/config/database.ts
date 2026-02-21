import { Pool } from 'pg';
import dotenv from 'dotenv';
// database.ts imports external modules, so no relative imports to fix.

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

export default pool;
