export const version = '202604260003';
export const name = 'identity_sms_notifications';

export async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS identity_providers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      provider_code VARCHAR(40) NOT NULL,
      name VARCHAR(80) NOT NULL,
      protocol ENUM('oidc') NOT NULL DEFAULT 'oidc',
      status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
      config JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_identity_provider_tenant_code (tenant_id, provider_code),
      CONSTRAINT fk_identity_providers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS external_identities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      user_id INT NOT NULL,
      provider_code VARCHAR(40) NOT NULL,
      external_subject VARCHAR(160) NOT NULL,
      external_username VARCHAR(80) NULL,
      external_email VARCHAR(120) NULL,
      external_phone VARCHAR(40) NULL,
      display_name VARCHAR(120) NULL,
      last_login_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_external_identity_subject (tenant_id, provider_code, external_subject),
      KEY idx_external_identity_user (user_id),
      KEY idx_external_identity_username (tenant_id, provider_code, external_username),
      CONSTRAINT fk_external_identities_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_external_identities_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS sms_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      template_code VARCHAR(60) NOT NULL,
      name VARCHAR(80) NOT NULL,
      content VARCHAR(500) NOT NULL,
      status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_sms_template_tenant_code (tenant_id, template_code),
      CONSTRAINT fk_sms_templates_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS sms_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      recipient_phone VARCHAR(40) NOT NULL,
      template_code VARCHAR(60) NULL,
      message VARCHAR(500) NOT NULL,
      variables JSON NULL,
      status ENUM('queued', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'queued',
      attempts INT NOT NULL DEFAULT 0,
      provider VARCHAR(40) NULL,
      provider_message_id VARCHAR(120) NULL,
      provider_response JSON NULL,
      error_message VARCHAR(300) NULL,
      requested_by INT NULL,
      target_type VARCHAR(60) NULL,
      target_id VARCHAR(80) NULL,
      sent_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_sms_messages_tenant_created (tenant_id, created_at),
      KEY idx_sms_messages_status (tenant_id, status),
      KEY idx_sms_messages_target (tenant_id, target_type, target_id),
      CONSTRAINT fk_sms_messages_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_sms_messages_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    INSERT INTO identity_providers (tenant_id, provider_code, name, protocol, status)
    VALUES (1, 'oidc', '学校统一身份认证', 'oidc', 'disabled')
    ON DUPLICATE KEY UPDATE name = VALUES(name), protocol = VALUES(protocol)
  `);

  await execute(`
    INSERT INTO sms_templates (tenant_id, template_code, name, content, status)
    VALUES
      (1, 'account_initial_password', '初始账号通知', '【FIDES教务】{displayName}，您的{roleLabel}账号为 {username}，初始密码为 {initialPassword}，首次登录后请立即修改密码。', 'active'),
      (1, 'account_reset_password', '账号重置通知', '【FIDES教务】{displayName}，您的{roleLabel}账号 {username} 已重置，临时密码为 {initialPassword}，请尽快登录并修改密码。', 'active')
    ON DUPLICATE KEY UPDATE name = VALUES(name), content = VALUES(content), status = VALUES(status)
  `);
}

export async function down({ execute }) {
  await execute('DROP TABLE IF EXISTS sms_messages');
  await execute('DROP TABLE IF EXISTS sms_templates');
  await execute('DROP TABLE IF EXISTS external_identities');
  await execute('DROP TABLE IF EXISTS identity_providers');
}
