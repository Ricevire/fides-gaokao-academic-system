export const version = '202604250001';
export const name = 'audit_operations_monitoring';

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

export async function up({ execute, query }) {
  if (!(await columnExists(query, 'audit_alerts', 'disposition_note'))) {
    await execute('ALTER TABLE audit_alerts ADD COLUMN disposition_note VARCHAR(255) NULL AFTER acknowledged_at');
  }

  if (!(await columnExists(query, 'audit_alerts', 'resolved_by'))) {
    await execute('ALTER TABLE audit_alerts ADD COLUMN resolved_by INT NULL AFTER disposition_note');
  }

  if (!(await columnExists(query, 'audit_alerts', 'resolved_at'))) {
    await execute('ALTER TABLE audit_alerts ADD COLUMN resolved_at TIMESTAMP NULL AFTER resolved_by');
  }

  if (!(await indexExists(query, 'audit_alerts', 'idx_audit_alert_severity'))) {
    await execute('CREATE INDEX idx_audit_alert_severity ON audit_alerts (severity, status, last_seen_at)');
  }

  if (!(await constraintExists(query, 'fk_audit_alert_resolved_by'))) {
    await execute(
      'ALTER TABLE audit_alerts ADD CONSTRAINT fk_audit_alert_resolved_by FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL'
    );
  }
}

export async function down({ execute, query }) {
  if (await constraintExists(query, 'fk_audit_alert_resolved_by')) {
    await execute('ALTER TABLE audit_alerts DROP FOREIGN KEY fk_audit_alert_resolved_by');
  }

  if (await indexExists(query, 'audit_alerts', 'idx_audit_alert_severity')) {
    await execute('DROP INDEX idx_audit_alert_severity ON audit_alerts');
  }

  if (await columnExists(query, 'audit_alerts', 'resolved_at')) {
    await execute('ALTER TABLE audit_alerts DROP COLUMN resolved_at');
  }

  if (await columnExists(query, 'audit_alerts', 'resolved_by')) {
    await execute('ALTER TABLE audit_alerts DROP COLUMN resolved_by');
  }

  if (await columnExists(query, 'audit_alerts', 'disposition_note')) {
    await execute('ALTER TABLE audit_alerts DROP COLUMN disposition_note');
  }
}
