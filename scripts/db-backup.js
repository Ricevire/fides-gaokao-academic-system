import crypto from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { once } from 'events';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { dbConfig } from '../src/db.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBackupDir = path.join(projectRoot, 'backups');
const defaultDrillDir = path.join(defaultBackupDir, 'restore-drills');
const batchSize = 200;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseArgs(argv) {
  const command = argv[0] || 'help';
  const options = {};

  for (let index = 1; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;

    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }

  return { command, options };
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`不安全的数据库标识符：${value}`);
  }
  return `\`${value}\``;
}

function sqlString(value) {
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x08/g, '\\b')
    .replace(/\t/g, '\\t')
    .replace(/\x1a/g, '\\Z')
    .replace(/'/g, "\\'")}'`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  if (value instanceof Date) return sqlString(value.toISOString().slice(0, 19).replace('T', ' '));
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object') return sqlString(JSON.stringify(value));
  return sqlString(value);
}

async function createWriter(filePath) {
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  const hash = crypto.createHash('sha256');
  let bytes = 0;

  async function write(chunk) {
    hash.update(chunk);
    bytes += Buffer.byteLength(chunk);
    if (!stream.write(chunk)) {
      await once(stream, 'drain');
    }
  }

  async function close() {
    stream.end();
    await once(stream, 'finish');
    return { bytes, sha256: hash.digest('hex') };
  }

  return { write, close };
}

async function createServerConnection(options = {}) {
  return mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    charset: dbConfig.charset,
    dateStrings: true,
    ...options
  });
}

async function createDatabaseConnection(database, options = {}) {
  return createServerConnection({
    database,
    ...options
  });
}

async function getTables(connection, database) {
  const [rows] = await connection.query(
    `SELECT table_name AS tableName
     FROM information_schema.tables
     WHERE table_schema = ? AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [database]
  );
  return rows.map((row) => row.tableName);
}

async function getColumns(connection, database, tableName) {
  const [rows] = await connection.query(
    `SELECT column_name AS columnName
     FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ?
     ORDER BY ordinal_position`,
    [database, tableName]
  );
  return rows.map((row) => row.columnName);
}

async function tableCounts(connection, database) {
  const tables = await getTables(connection, database);
  const counts = {};

  for (const tableName of tables) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`);
    counts[tableName] = Number(rows[0].count);
  }

  return counts;
}

async function createBackup({ outputDir = defaultBackupDir } = {}) {
  await mkdir(outputDir, { recursive: true });

  const createdAt = new Date().toISOString();
  const fileName = `${config.db.database}_${timestamp()}.sql`;
  const backupPath = path.join(outputDir, fileName);
  const manifestPath = `${backupPath}.manifest.json`;
  const writer = await createWriter(backupPath);
  const connection = await createDatabaseConnection(config.db.database);

  try {
    const tables = await getTables(connection, config.db.database);
    const counts = {};

    await writer.write(`-- FIDES logical database backup\n`);
    await writer.write(`-- source_database: ${config.db.database}\n`);
    await writer.write(`-- created_at: ${createdAt}\n`);
    await writer.write(`SET NAMES utf8mb4;\n`);
    await writer.write(`SET FOREIGN_KEY_CHECKS=0;\n\n`);

    for (const tableName of tables.slice().reverse()) {
      await writer.write(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)};\n`);
    }
    await writer.write('\n');

    for (const tableName of tables) {
      const [createRows] = await connection.query(`SHOW CREATE TABLE ${quoteIdentifier(tableName)}`);
      await writer.write(`${createRows[0]['Create Table']};\n\n`);
    }

    for (const tableName of tables) {
      const columns = await getColumns(connection, config.db.database, tableName);
      const columnSql = columns.map(quoteIdentifier).join(', ');
      let offset = 0;
      let count = 0;

      while (true) {
        const [rows] = await connection.query(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ${batchSize} OFFSET ${offset}`);
        if (!rows.length) break;

        const valuesSql = rows
          .map((row) => `(${columns.map((columnName) => sqlValue(row[columnName])).join(', ')})`)
          .join(',\n');
        await writer.write(`INSERT INTO ${quoteIdentifier(tableName)} (${columnSql}) VALUES\n${valuesSql};\n`);

        offset += rows.length;
        count += rows.length;
      }

      counts[tableName] = count;
      await writer.write('\n');
    }

    await writer.write(`SET FOREIGN_KEY_CHECKS=1;\n`);
    const { bytes, sha256 } = await writer.close();

    const manifest = {
      type: 'fides-mysql-logical-backup',
      createdAt,
      sourceDatabase: config.db.database,
      app: config.app,
      tables: Object.entries(counts).map(([tableName, rowCount]) => ({ tableName, rowCount })),
      tableCount: tables.length,
      totalRows: Object.values(counts).reduce((sum, count) => sum + count, 0),
      file: {
        path: backupPath,
        bytes,
        sha256
      }
    };

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { backupPath, manifestPath, manifest };
  } finally {
    await connection.end();
  }
}

async function restoreBackup({ filePath, targetDatabase, yes = false, allowCurrentDatabase = false }) {
  if (!filePath) throw new Error('恢复必须指定 --file <backup.sql>');
  if (!targetDatabase) throw new Error('恢复必须指定 --target-db <database>');
  quoteIdentifier(targetDatabase);

  if (!yes) {
    throw new Error('恢复会重建目标库表，请显式添加 --yes');
  }

  if (targetDatabase === config.db.database && !allowCurrentDatabase) {
    throw new Error('拒绝直接覆盖当前业务库。如确需执行，必须额外添加 --allow-current-db');
  }

  const sql = await readFile(filePath, 'utf8');
  const serverConnection = await createServerConnection();
  await serverConnection.query(
    `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(targetDatabase)}
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await serverConnection.end();

  const restoreConnection = await createDatabaseConnection(targetDatabase, {
    multipleStatements: true
  });

  try {
    await restoreConnection.query(sql);
  } finally {
    await restoreConnection.end();
  }
}

async function dropDatabase(database) {
  quoteIdentifier(database);
  const connection = await createServerConnection();
  try {
    await connection.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
  } finally {
    await connection.end();
  }
}

async function runRestoreDrill({ keepDatabase = false, outputDir = defaultBackupDir, reportDir = defaultDrillDir } = {}) {
  await mkdir(reportDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const drillDatabase = `${config.db.database}_drill_${Date.now().toString(36)}`.slice(0, 64);
  const backup = await createBackup({ outputDir });
  const sourceCounts = Object.fromEntries(backup.manifest.tables.map((table) => [table.tableName, table.rowCount]));
  let restoredCounts = {};
  let status = 'failed';
  let mismatches = [];

  const started = Date.now();
  try {
    await restoreBackup({
      filePath: backup.backupPath,
      targetDatabase: drillDatabase,
      yes: true
    });

    const drillConnection = await createDatabaseConnection(drillDatabase);
    try {
      restoredCounts = await tableCounts(drillConnection, drillDatabase);
    } finally {
      await drillConnection.end();
    }

    mismatches = Object.entries(sourceCounts)
      .filter(([tableName, rowCount]) => restoredCounts[tableName] !== rowCount)
      .map(([tableName, rowCount]) => ({
        tableName,
        sourceRows: rowCount,
        restoredRows: restoredCounts[tableName] ?? null
      }));

    status = mismatches.length ? 'failed' : 'passed';
    return {
      status,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      sourceDatabase: config.db.database,
      drillDatabase,
      backupFile: backup.backupPath,
      manifestFile: backup.manifestPath,
      reportFile: null,
      keepDatabase,
      tablesVerified: Object.keys(sourceCounts).length,
      sourceTotalRows: Object.values(sourceCounts).reduce((sum, count) => sum + count, 0),
      restoredTotalRows: Object.values(restoredCounts).reduce((sum, count) => sum + count, 0),
      mismatches
    };
  } finally {
    if (!keepDatabase) {
      await dropDatabase(drillDatabase);
    }
  }
}

async function writeDrillReport(report) {
  await mkdir(defaultDrillDir, { recursive: true });
  const reportFile = path.join(defaultDrillDir, `restore-drill-${timestamp()}.json`);
  const payload = { ...report, reportFile };
  await writeFile(reportFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function printHelp() {
  console.log(`用法：
  node scripts/db-backup.js backup [--output-dir backups]
  node scripts/db-backup.js restore --file backups/file.sql --target-db restore_db --yes
  node scripts/db-backup.js drill [--keep-db]

命令：
  backup   备份当前 DB_NAME 到 SQL 文件，并生成 manifest
  restore  将指定 SQL 备份还原到目标数据库
  drill    备份当前库、还原到临时演练库、比对所有表行数、输出演练报告
`);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === 'backup') {
    const result = await createBackup({ outputDir: options['output-dir'] || defaultBackupDir });
    console.log(`备份完成：${result.backupPath}`);
    console.log(`清单文件：${result.manifestPath}`);
    console.log(`表数量：${result.manifest.tableCount}，总行数：${result.manifest.totalRows}`);
    return;
  }

  if (command === 'restore') {
    await restoreBackup({
      filePath: options.file,
      targetDatabase: options['target-db'],
      yes: Boolean(options.yes),
      allowCurrentDatabase: Boolean(options['allow-current-db'])
    });
    console.log(`恢复完成：${options.file} -> ${options['target-db']}`);
    return;
  }

  if (command === 'drill') {
    const report = await writeDrillReport(
      await runRestoreDrill({
        keepDatabase: Boolean(options['keep-db']),
        outputDir: options['output-dir'] || defaultBackupDir
      })
    );
    console.log(`恢复演练${report.status === 'passed' ? '通过' : '失败'}：${report.reportFile}`);
    console.log(`备份文件：${report.backupFile}`);
    console.log(`演练库：${report.drillDatabase}${report.keepDatabase ? '（已保留）' : '（已清理）'}`);
    console.log(`校验表数：${report.tablesVerified}，源总行数：${report.sourceTotalRows}，恢复总行数：${report.restoredTotalRows}`);
    if (report.mismatches.length) {
      console.table(report.mismatches);
      process.exitCode = 1;
    }
    return;
  }

  printHelp();
}

main().catch((error) => {
  console.error('备份/恢复任务失败：');
  console.error(error);
  process.exit(1);
});
