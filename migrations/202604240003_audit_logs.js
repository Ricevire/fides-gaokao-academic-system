export const version = '202604240003';
export const name = 'audit_logs';

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
  if (await tableExists(query, 'audit_logs')) return;

  await execute(`
    CREATE TABLE audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(60) NOT NULL,
      action VARCHAR(80) NOT NULL,
      outcome ENUM('success', 'failure') NOT NULL,
      actor_user_id INT NULL,
      actor_username VARCHAR(80) NULL,
      actor_role VARCHAR(40) NULL,
      target_type VARCHAR(60) NULL,
      target_id VARCHAR(80) NULL,
      target_username VARCHAR(80) NULL,
      ip_address VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      request_id VARCHAR(80) NULL,
      details JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_created_at (created_at),
      INDEX idx_audit_actor (actor_user_id, created_at),
      INDEX idx_audit_event (event_type, action, created_at),
      INDEX idx_audit_target (target_type, target_id, created_at),
      CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function down({ execute, query }) {
  if (await tableExists(query, 'audit_logs')) {
    await execute('DROP TABLE audit_logs');
  }
}
