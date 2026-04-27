export const version = '202604240004';
export const name = 'audit_alerts';

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

export async function up({ execute, query }) {
  if (await tableExists(query, 'audit_alerts')) return;

  await execute(`
    CREATE TABLE audit_alerts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      alert_type VARCHAR(80) NOT NULL,
      severity ENUM('info', 'warning', 'critical') NOT NULL DEFAULT 'warning',
      status ENUM('open', 'acknowledged', 'closed') NOT NULL DEFAULT 'open',
      dedupe_key VARCHAR(191) NOT NULL UNIQUE,
      event_count INT NOT NULL DEFAULT 1,
      actor_user_id INT NULL,
      actor_username VARCHAR(80) NULL,
      target_type VARCHAR(60) NULL,
      target_id VARCHAR(80) NULL,
      target_username VARCHAR(80) NULL,
      ip_address VARCHAR(64) NULL,
      window_started_at TIMESTAMP NULL,
      window_ended_at TIMESTAMP NULL,
      details JSON NULL,
      first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      acknowledged_by INT NULL,
      acknowledged_at TIMESTAMP NULL,
      INDEX idx_audit_alert_status (status, last_seen_at),
      INDEX idx_audit_alert_type (alert_type, last_seen_at),
      INDEX idx_audit_alert_actor (actor_user_id, last_seen_at),
      CONSTRAINT fk_audit_alert_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_audit_alert_ack_by FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function down({ execute, query }) {
  if (await tableExists(query, 'audit_alerts')) {
    await execute('DROP TABLE audit_alerts');
  }
}
