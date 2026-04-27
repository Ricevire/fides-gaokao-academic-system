import mysql from 'mysql2/promise';
import { config } from './config.js';

export const dbConfig = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  namedPlaceholders: true,
  dateStrings: true
};

let pool;

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe database identifier: ${value}`);
  }
  return `\`${value}\``;
}

export async function ensureDatabase({ force = false } = {}) {
  if (!force && !config.db.autoCreate) {
    return;
  }

  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    charset: dbConfig.charset
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(dbConfig.database)}
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.end();
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}

export async function query(sql, params = {}) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

export async function pingDatabase() {
  await query('SELECT 1 AS ok');
}

export async function transaction(callback) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
