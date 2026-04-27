import crypto from 'crypto';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { ensureDatabase, getPool } from './db.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');
const migrationsDir = path.join(projectRoot, 'migrations');
const migrationFilePattern = /^(\d{12,})_([a-z0-9][a-z0-9_-]*)\.js$/;
const migrationLockName = `${config.db.database}:schema_migrations`;

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseMigrationFileName(fileName) {
  const match = migrationFilePattern.exec(fileName);
  if (!match) {
    throw new Error(`Invalid migration file name: ${fileName}. Expected YYYYMMDDNNNN_description.js`);
  }
  return {
    version: match[1],
    name: match[2]
  };
}

function assertMigrationModule(fileName, migration) {
  const fileMeta = parseMigrationFileName(fileName);
  const version = migration.version;
  const name = migration.name;

  if (typeof version !== 'string' || typeof name !== 'string' || typeof migration.up !== 'function') {
    throw new Error(`迁移文件格式不合法：${fileName}`);
  }

  if (version !== fileMeta.version) {
    throw new Error(`Migration version mismatch in ${fileName}: exported ${migration.version}`);
  }

  if (name !== fileMeta.name) {
    throw new Error(`Migration name mismatch in ${fileName}: exported ${migration.name}`);
  }

  return {
    version,
    name,
    up: migration.up,
    down: typeof migration.down === 'function' ? migration.down : null,
    checksumPayload: migration.checksumPayload || ''
  };
}

async function listMigrationFiles() {
  const files = await readdir(migrationsDir);
  return files.filter((fileName) => fileName.endsWith('.js')).sort();
}

export async function loadMigrations() {
  const files = await listMigrationFiles();
  const invalidFiles = files.filter((fileName) => !migrationFilePattern.test(fileName));
  if (invalidFiles.length) {
    throw new Error(`Invalid migration file names: ${invalidFiles.join(', ')}`);
  }

  const migrations = [];
  const versions = new Set();

  for (const fileName of files) {
    const filePath = path.join(migrationsDir, fileName);
    const fileContent = await readFile(filePath, 'utf8');
    const moduleUrl = `${pathToFileURL(filePath).href}?checksum=${checksum(fileContent)}`;
    const migrationModule = await import(moduleUrl);
    const migration = assertMigrationModule(fileName, migrationModule);

    if (versions.has(migration.version)) {
      throw new Error(`发现重复迁移版本：${migration.version}`);
    }
    versions.add(migration.version);

    migrations.push({
      ...migration,
      fileName,
      checksum: checksum(`${fileContent}\n${migration.checksumPayload}`)
    });
  }

  return migrations;
}

async function ensureMigrationsTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(32) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_ms INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function getAppliedMigrations(connection) {
  const [rows] = await connection.execute(
    `SELECT version, name, checksum, applied_at AS appliedAt, execution_ms AS executionMs
     FROM schema_migrations
     ORDER BY version ASC`
  );
  return rows;
}

async function withMigrationLock(connection, callback) {
  const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 30) AS acquired', [migrationLockName]);
  if (!lockRows[0]?.acquired) {
    throw new Error('无法获取数据库迁移锁，请确认没有其他迁移任务正在运行');
  }

  try {
    return await callback();
  } finally {
    await connection.execute('SELECT RELEASE_LOCK(?)', [migrationLockName]);
  }
}

function createMigrationContext(connection) {
  return {
    connection,
    execute: (sql, params = []) => connection.execute(sql, params),
    query: (sql, params = []) => connection.query(sql, params)
  };
}

function assertNoChecksumMismatch(appliedMap, migrations) {
  for (const migration of migrations) {
    const applied = appliedMap.get(migration.version);
    if (applied && applied.checksum !== migration.checksum) {
      throw new Error(
        `迁移文件已被修改：${migration.version}_${migration.name}。已应用迁移必须保持不可变。`
      );
    }
  }
}

function assertMigrationPolicyShape(migrations) {
  let previousVersion = null;

  for (const migration of migrations) {
    if (!migration.down) {
      throw new Error(`Migration ${migration.fileName} must export a down() rollback function`);
    }

    if (previousVersion && previousVersion.localeCompare(migration.version) >= 0) {
      throw new Error(`Migration versions must be strictly increasing near ${migration.fileName}`);
    }

    previousVersion = migration.version;
  }
}

export async function validateMigrationPolicy({ requireDatabase = true } = {}) {
  const migrations = await loadMigrations();
  assertMigrationPolicyShape(migrations);

  if (!requireDatabase) {
    return {
      migrations,
      pending: [],
      checksumChanged: [],
      orphaned: [],
      applied: []
    };
  }

  await ensureDatabase();
  const connection = await getPool().getConnection();

  try {
    await ensureMigrationsTable(connection);
    const applied = await getAppliedMigrations(connection);
    const migrationMap = new Map(migrations.map((migration) => [migration.version, migration]));
    const appliedMap = new Map(applied.map((migration) => [migration.version, migration]));

    const pending = migrations.filter((migration) => !appliedMap.has(migration.version));
    const checksumChanged = migrations.filter((migration) => {
      const appliedMigration = appliedMap.get(migration.version);
      return appliedMigration && appliedMigration.checksum !== migration.checksum;
    });
    const orphaned = applied.filter((migration) => !migrationMap.has(migration.version));

    const violations = [];
    if (pending.length) {
      violations.push(`Pending migrations: ${pending.map((migration) => migration.fileName).join(', ')}`);
    }
    if (checksumChanged.length) {
      violations.push(
        `Applied migration files changed: ${checksumChanged.map((migration) => migration.fileName).join(', ')}`
      );
    }
    if (orphaned.length) {
      violations.push(
        `Applied migrations missing from repository: ${orphaned.map((migration) => migration.version).join(', ')}`
      );
    }

    if (violations.length) {
      throw new Error(`Migration policy check failed:\n- ${violations.join('\n- ')}`);
    }

    return {
      migrations,
      pending,
      checksumChanged,
      orphaned,
      applied
    };
  } finally {
    connection.release();
  }
}

export async function getMigrationStatus() {
  await ensureDatabase();
  const connection = await getPool().getConnection();

  try {
    await ensureMigrationsTable(connection);
    const [migrations, applied] = await Promise.all([loadMigrations(), getAppliedMigrations(connection)]);
    const migrationMap = new Map(migrations.map((migration) => [migration.version, migration]));
    const appliedMap = new Map(applied.map((migration) => [migration.version, migration]));
    const known = migrations.map((migration) => {
      const appliedMigration = appliedMap.get(migration.version);
      return {
        version: migration.version,
        name: migration.name,
        fileName: migration.fileName,
        applied: Boolean(appliedMigration),
        appliedAt: appliedMigration?.appliedAt || null,
        executionMs: appliedMigration?.executionMs ?? null,
        checksum: appliedMigration ? appliedMigration.checksum === migration.checksum : null
      };
    });

    const orphaned = applied
      .filter((migration) => !migrationMap.has(migration.version))
      .map((migration) => ({
        version: migration.version,
        name: migration.name,
        fileName: null,
        applied: true,
        appliedAt: migration.appliedAt,
        executionMs: migration.executionMs,
        checksum: false,
        orphaned: true
      }));

    return [...known, ...orphaned].sort((a, b) => a.version.localeCompare(b.version));
  } finally {
    connection.release();
  }
}

export async function migrateUp({ targetVersion } = {}) {
  await ensureDatabase();
  const connection = await getPool().getConnection();

  try {
    return await withMigrationLock(connection, async () => {
      await ensureMigrationsTable(connection);
      const migrations = await loadMigrations();
      const applied = await getAppliedMigrations(connection);
      const appliedMap = new Map(applied.map((migration) => [migration.version, migration]));

      assertNoChecksumMismatch(appliedMap, migrations);

      const pending = migrations.filter(
        (migration) =>
          !appliedMap.has(migration.version) &&
          (!targetVersion || migration.version.localeCompare(targetVersion) <= 0)
      );
      const appliedNow = [];

      for (const migration of pending) {
        const startedAt = Date.now();
        await migration.up(createMigrationContext(connection));
        const executionMs = Date.now() - startedAt;

        await connection.execute(
          `INSERT INTO schema_migrations (version, name, checksum, execution_ms)
           VALUES (?, ?, ?, ?)`,
          [migration.version, migration.name, migration.checksum, executionMs]
        );

        appliedNow.push({ version: migration.version, name: migration.name, executionMs });
      }

      return appliedNow;
    });
  } finally {
    connection.release();
  }
}

export async function baselineMigrations() {
  await ensureDatabase();
  const connection = await getPool().getConnection();

  try {
    return await withMigrationLock(connection, async () => {
      await ensureMigrationsTable(connection);
      const migrations = await loadMigrations();
      const applied = await getAppliedMigrations(connection);
      const appliedMap = new Map(applied.map((migration) => [migration.version, migration]));

      assertNoChecksumMismatch(appliedMap, migrations);

      const baselined = [];
      for (const migration of migrations) {
        if (appliedMap.has(migration.version)) continue;
        await connection.execute(
          `INSERT INTO schema_migrations (version, name, checksum, execution_ms)
           VALUES (?, ?, ?, 0)`,
          [migration.version, migration.name, migration.checksum]
        );
        baselined.push({ version: migration.version, name: migration.name });
      }

      return baselined;
    });
  } finally {
    connection.release();
  }
}

export async function migrateDown({ steps = 1 } = {}) {
  await ensureDatabase();
  const connection = await getPool().getConnection();

  try {
    return await withMigrationLock(connection, async () => {
      await ensureMigrationsTable(connection);
      const migrations = await loadMigrations();
      const migrationMap = new Map(migrations.map((migration) => [migration.version, migration]));
      const applied = await getAppliedMigrations(connection);
      const targets = applied.slice().reverse().slice(0, steps);
      const reverted = [];

      for (const appliedMigration of targets) {
        const migration = migrationMap.get(appliedMigration.version);
        if (!migration?.down) {
          throw new Error(`迁移 ${appliedMigration.version} 没有可执行的 down 回滚逻辑`);
        }

        await migration.down(createMigrationContext(connection));
        await connection.execute('DELETE FROM schema_migrations WHERE version = ?', [appliedMigration.version]);
        reverted.push({ version: appliedMigration.version, name: appliedMigration.name });
      }

      return reverted;
    });
  } finally {
    connection.release();
  }
}
