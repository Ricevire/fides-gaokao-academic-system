export const version = '202604260002';
export const name = 'multi_org_isolation';

async function tableExists(query, tableName) {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(query, tableName, columnName) {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function indexExists(query, tableName, indexName) {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function constraintExists(query, constraintName) {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND constraint_name = ?
     LIMIT 1`,
    [constraintName]
  );
  return rows.length > 0;
}

async function addColumn({ execute, query }, tableName, columnName, definition) {
  if (!(await columnExists(query, tableName, columnName))) {
    await execute(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

async function addIndex({ execute, query }, tableName, indexName, definition) {
  if (!(await indexExists(query, tableName, indexName))) {
    await execute(`CREATE INDEX ${indexName} ON ${tableName} ${definition}`);
  }
}

async function addForeignKey({ execute, query }, constraintName, sql) {
  if (!(await constraintExists(query, constraintName))) {
    await execute(sql);
  }
}

async function dropForeignKey({ execute, query }, tableName, constraintName) {
  if (await constraintExists(query, constraintName)) {
    await execute(`ALTER TABLE ${tableName} DROP FOREIGN KEY ${constraintName}`);
  }
}

async function dropIndex({ execute, query }, tableName, indexName) {
  if (await indexExists(query, tableName, indexName)) {
    await execute(`DROP INDEX ${indexName} ON ${tableName}`);
  }
}

async function dropColumn({ execute, query }, tableName, columnName) {
  if (await columnExists(query, tableName, columnName)) {
    await execute(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
  }
}

export async function up(context) {
  const { execute, query } = context;

  if (!(await tableExists(query, 'tenants'))) {
    await execute(`
      CREATE TABLE tenants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(40) NOT NULL UNIQUE,
        name VARCHAR(80) NOT NULL,
        status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await tableExists(query, 'campuses'))) {
    await execute(`
      CREATE TABLE campuses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        code VARCHAR(40) NOT NULL,
        name VARCHAR(80) NOT NULL,
        address VARCHAR(160) NULL,
        status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_campuses_tenant_code (tenant_id, code),
        CONSTRAINT fk_campuses_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await tableExists(query, 'academic_years'))) {
    await execute(`
      CREATE TABLE academic_years (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(30) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
        is_current TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_academic_year_tenant_name (tenant_id, name),
        CONSTRAINT fk_academic_year_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  await execute(`
    INSERT INTO tenants (id, code, name, status)
    VALUES (1, 'default', '默认学校', 'active')
    ON DUPLICATE KEY UPDATE code = VALUES(code), name = VALUES(name), status = VALUES(status)
  `);
  await execute(`
    INSERT INTO campuses (id, tenant_id, code, name, status)
    VALUES (1, 1, 'main', '主校区', 'active')
    ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id), code = VALUES(code), name = VALUES(name), status = VALUES(status)
  `);
  await execute(`
    INSERT INTO academic_years (id, tenant_id, name, start_date, end_date, status, is_current)
    VALUES (1, 1, '2026学年', '2026-09-01', '2027-08-31', 'active', 1)
    ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id), name = VALUES(name), start_date = VALUES(start_date),
      end_date = VALUES(end_date), status = VALUES(status), is_current = VALUES(is_current)
  `);

  const tenantTables = [
    'users',
    'grades',
    'subject_combinations',
    'teachers',
    'classes',
    'students',
    'rooms',
    'course_plans',
    'teaching_classes',
    'timetable_entries',
    'exams',
    'announcements',
    'audit_logs',
    'audit_alerts'
  ];

  for (const tableName of tenantTables) {
    await addColumn(context, tableName, 'tenant_id', 'tenant_id INT NOT NULL DEFAULT 1 AFTER id');
    await addIndex(context, tableName, `idx_${tableName}_tenant`, '(tenant_id)');
    await addForeignKey(
      context,
      `fk_${tableName}_tenant`,
      `ALTER TABLE ${tableName} ADD CONSTRAINT fk_${tableName}_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)`
    );
  }

  for (const tableName of ['users', 'teachers', 'classes', 'students', 'rooms', 'teaching_classes', 'timetable_entries']) {
    await addColumn(context, tableName, 'campus_id', 'campus_id INT NULL AFTER tenant_id');
    await execute(`UPDATE ${tableName} SET campus_id = 1 WHERE campus_id IS NULL`);
    await addIndex(context, tableName, `idx_${tableName}_campus`, '(campus_id)');
    await addForeignKey(
      context,
      `fk_${tableName}_campus`,
      `ALTER TABLE ${tableName} ADD CONSTRAINT fk_${tableName}_campus FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL`
    );
  }

  const academicYearTables = [
    ['users', 'campus_id'],
    ['grades', 'tenant_id'],
    ['classes', 'campus_id'],
    ['students', 'campus_id'],
    ['course_plans', 'tenant_id'],
    ['teaching_classes', 'campus_id'],
    ['timetable_entries', 'campus_id'],
    ['exams', 'tenant_id']
  ];

  for (const [tableName, afterColumn] of academicYearTables) {
    await addColumn(context, tableName, 'academic_year_id', `academic_year_id INT NULL AFTER ${afterColumn}`);
    await execute(`UPDATE ${tableName} SET academic_year_id = 1 WHERE academic_year_id IS NULL`);
    await addIndex(context, tableName, `idx_${tableName}_academic_year`, '(academic_year_id)');
    await addForeignKey(
      context,
      `fk_${tableName}_academic_year`,
      `ALTER TABLE ${tableName} ADD CONSTRAINT fk_${tableName}_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL`
    );
  }
}

export async function down(context) {
  const tenantTables = [
    'audit_alerts',
    'audit_logs',
    'announcements',
    'exams',
    'timetable_entries',
    'teaching_classes',
    'course_plans',
    'rooms',
    'students',
    'classes',
    'teachers',
    'subject_combinations',
    'grades',
    'users'
  ];

  for (const tableName of ['users', 'grades', 'classes', 'students', 'course_plans', 'teaching_classes', 'timetable_entries', 'exams']) {
    await dropForeignKey(context, tableName, `fk_${tableName}_academic_year`);
    await dropIndex(context, tableName, `idx_${tableName}_academic_year`);
    await dropColumn(context, tableName, 'academic_year_id');
  }

  for (const tableName of ['users', 'teachers', 'classes', 'students', 'rooms', 'teaching_classes', 'timetable_entries']) {
    await dropForeignKey(context, tableName, `fk_${tableName}_campus`);
    await dropIndex(context, tableName, `idx_${tableName}_campus`);
    await dropColumn(context, tableName, 'campus_id');
  }

  for (const tableName of tenantTables) {
    await dropForeignKey(context, tableName, `fk_${tableName}_tenant`);
    await dropIndex(context, tableName, `idx_${tableName}_tenant`);
    await dropColumn(context, tableName, 'tenant_id');
  }

  await context.execute('DROP TABLE IF EXISTS academic_years');
  await context.execute('DROP TABLE IF EXISTS campuses');
  await context.execute('DROP TABLE IF EXISTS tenants');
}
