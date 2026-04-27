import { query } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';

const sensitiveKeys = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'initialPassword',
  'token',
  'authorization',
  'cookie'
]);

function redact(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sensitiveKeys.has(key) ? '[REDACTED]' : redact(item)])
    );
  }

  return value;
}

function truncate(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function getIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

function toDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function windowKey(windowMs) {
  return Math.floor(Date.now() / windowMs);
}

function buildHeaders(token) {
  const headers = { 'content-type': 'application/json' };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function postWebhook(url, token, payload) {
  if (!url) return;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Webhook 返回 ${response.status}`);
  }
}

function emitAuditEvent(event) {
  if (config.audit.eventLogEnabled) {
    logger.info({ audit_event: event }, 'audit_event');
  }

  postWebhook(config.audit.siemWebhookUrl, config.audit.siemWebhookToken, {
    type: 'audit_event',
    source: config.app.name,
    version: config.app.version,
    event
  }).catch((error) => {
    logger.error({ err: error, auditLogId: event.id }, '审计事件推送 SIEM 失败');
  });
}

async function createOrUpdateAlert(alert) {
  await query(
    `INSERT INTO audit_alerts
     (tenant_id, alert_type, severity, status, dedupe_key, event_count, actor_user_id, actor_username,
      target_type, target_id, target_username, ip_address, window_started_at, window_ended_at, details)
     VALUES
     (:tenantId, :alertType, :severity, 'open', :dedupeKey, :eventCount, :actorUserId, :actorUsername,
      :targetType, :targetId, :targetUsername, :ipAddress, :windowStartedAt, :windowEndedAt, CAST(:details AS JSON))
     ON DUPLICATE KEY UPDATE
      severity = VALUES(severity),
      status = 'open',
      event_count = VALUES(event_count),
      actor_user_id = VALUES(actor_user_id),
      actor_username = VALUES(actor_username),
      target_type = VALUES(target_type),
      target_id = VALUES(target_id),
      target_username = VALUES(target_username),
      ip_address = VALUES(ip_address),
      window_started_at = VALUES(window_started_at),
      window_ended_at = VALUES(window_ended_at),
      details = VALUES(details),
      acknowledged_by = NULL,
      acknowledged_at = NULL,
      disposition_note = NULL,
      resolved_by = NULL,
      resolved_at = NULL,
      last_seen_at = CURRENT_TIMESTAMP`,
    {
      tenantId: alert.tenantId ?? 1,
      alertType: alert.alertType,
      severity: alert.severity,
      dedupeKey: alert.dedupeKey,
      eventCount: alert.eventCount,
      actorUserId: alert.actorUserId ?? null,
      actorUsername: truncate(alert.actorUsername, 80),
      targetType: truncate(alert.targetType, 60),
      targetId: truncate(alert.targetId, 80),
      targetUsername: truncate(alert.targetUsername, 80),
      ipAddress: truncate(alert.ipAddress, 64),
      windowStartedAt: alert.windowStartedAt ?? null,
      windowEndedAt: alert.windowEndedAt ?? null,
      details: JSON.stringify(redact(alert.details ?? {}))
    }
  );

  const rows = await query('SELECT * FROM audit_alerts WHERE dedupe_key = :dedupeKey LIMIT 1', {
    dedupeKey: alert.dedupeKey
  });
  return rows[0];
}

function emitAlert(alert) {
  logger.warn({ audit_alert: alert }, 'audit_alert');

  const alertWebhookUrl = config.audit.alertWebhookUrl || config.audit.siemWebhookUrl;
  const alertWebhookToken = config.audit.alertWebhookToken || config.audit.siemWebhookToken;

  postWebhook(alertWebhookUrl, alertWebhookToken, {
    type: 'audit_alert',
    source: config.app.name,
    version: config.app.version,
    alert
  }).catch((error) => {
    logger.error({ err: error, alertType: alert.alert_type || alert.alertType }, '审计告警推送失败');
  });
}

async function raiseAlert(alert) {
  const savedAlert = await createOrUpdateAlert(alert);
  emitAlert(savedAlert || alert);
}

async function detectFailedLoginBurst(event) {
  if (!(event.eventType === 'auth' && event.action === 'login' && event.outcome === 'failure')) return;

  const seconds = Math.ceil(config.audit.failedLoginWindowMs / 1000);
  const rows = await query(
    `SELECT COUNT(*) AS count, MIN(created_at) AS windowStartedAt, MAX(created_at) AS windowEndedAt
     FROM audit_logs
     WHERE event_type = 'auth'
       AND action = 'login'
       AND outcome = 'failure'
       AND tenant_id = :tenantId
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${seconds} SECOND)
       AND id <= :id
       AND target_username = :targetUsername
       AND ip_address = :ipAddress`,
    {
      id: event.id,
      tenantId: event.tenantId,
      targetUsername: event.targetUsername,
      ipAddress: event.ipAddress
    }
  );

  const count = Number(rows[0]?.count || 0);
  logger.debug(
    {
      alert_rule: 'failed_login_burst',
      count,
      threshold: config.audit.failedLoginThreshold,
      targetUsername: event.targetUsername,
      ipAddress: event.ipAddress
    },
    'audit_alert_rule_evaluated'
  );
  if (count < config.audit.failedLoginThreshold) return;

  await raiseAlert({
    alertType: 'failed_login_burst',
    tenantId: event.tenantId,
    severity: count >= config.audit.failedLoginThreshold * 2 ? 'critical' : 'warning',
    dedupeKey: `tenant-${event.tenantId || 1}:failed-login:${event.targetUsername || 'unknown'}:${event.ipAddress || 'unknown'}:${windowKey(config.audit.failedLoginWindowMs)}`,
    eventCount: count,
    actorUserId: event.actorUserId,
    actorUsername: event.actorUsername,
    targetType: 'user',
    targetId: event.targetId,
    targetUsername: event.targetUsername,
    ipAddress: event.ipAddress,
    windowStartedAt: rows[0]?.windowStartedAt,
    windowEndedAt: rows[0]?.windowEndedAt,
    details: {
      threshold: config.audit.failedLoginThreshold,
      windowMs: config.audit.failedLoginWindowMs,
      latestAuditLogId: event.id
    }
  });
}

async function detectAccountResetBurst(event) {
  const accountActions = new Set([
    'teacher_account_created',
    'teacher_account_reset',
    'student_account_created',
    'student_account_reset'
  ]);
  if (!(event.eventType === 'permission' && accountActions.has(event.action) && event.outcome === 'success')) return;

  const seconds = Math.ceil(config.audit.accountResetWindowMs / 1000);
  const rows = await query(
    `SELECT COUNT(*) AS count, MIN(created_at) AS windowStartedAt, MAX(created_at) AS windowEndedAt
     FROM audit_logs
     WHERE event_type = 'permission'
       AND action IN ('teacher_account_created', 'teacher_account_reset', 'student_account_created', 'student_account_reset')
       AND outcome = 'success'
       AND tenant_id = :tenantId
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${seconds} SECOND)
       AND id <= :id
       AND actor_user_id = :actorUserId`,
    { id: event.id, tenantId: event.tenantId, actorUserId: event.actorUserId }
  );

  const count = Number(rows[0]?.count || 0);
  logger.debug(
    {
      alert_rule: 'account_reset_burst',
      count,
      threshold: config.audit.accountResetThreshold,
      actorUserId: event.actorUserId
    },
    'audit_alert_rule_evaluated'
  );
  if (count < config.audit.accountResetThreshold) return;

  await raiseAlert({
    alertType: 'account_reset_burst',
    tenantId: event.tenantId,
    severity: count >= config.audit.accountResetThreshold * 2 ? 'critical' : 'warning',
    dedupeKey: `tenant-${event.tenantId || 1}:account-reset:${event.actorUserId || event.actorUsername || 'unknown'}:${windowKey(config.audit.accountResetWindowMs)}`,
    eventCount: count,
    actorUserId: event.actorUserId,
    actorUsername: event.actorUsername,
    targetType: event.targetType,
    targetId: event.targetId,
    targetUsername: event.targetUsername,
    ipAddress: event.ipAddress,
    windowStartedAt: rows[0]?.windowStartedAt,
    windowEndedAt: rows[0]?.windowEndedAt,
    details: {
      threshold: config.audit.accountResetThreshold,
      windowMs: config.audit.accountResetWindowMs,
      latestAuditLogId: event.id
    }
  });
}

async function detectNewIpLogin(event) {
  if (!(event.eventType === 'auth' && event.action === 'login' && event.outcome === 'success')) return;
  if (!event.targetUsername || !event.ipAddress) return;

  const lookbackDays = config.audit.newIpLookbackDays;
  const rows = await query(
    `SELECT
       SUM(CASE WHEN ip_address = :ipAddress THEN 1 ELSE 0 END) AS sameIpCount,
       COUNT(*) AS totalCount
     FROM audit_logs
     WHERE event_type = 'auth'
       AND action = 'login'
       AND outcome = 'success'
       AND tenant_id = :tenantId
       AND target_username = :targetUsername
       AND id <> :id
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${lookbackDays} DAY)`,
    {
      id: event.id,
      tenantId: event.tenantId,
      targetUsername: event.targetUsername,
      ipAddress: event.ipAddress
    }
  );

  const sameIpCount = Number(rows[0]?.sameIpCount || 0);
  const totalCount = Number(rows[0]?.totalCount || 0);
  if (totalCount === 0 || sameIpCount > 0) return;

  await raiseAlert({
    alertType: 'new_ip_login',
    tenantId: event.tenantId,
    severity: 'warning',
    dedupeKey: `tenant-${event.tenantId || 1}:new-ip-login:${event.targetUsername}:${event.ipAddress}`,
    eventCount: 1,
    actorUserId: event.actorUserId,
    actorUsername: event.actorUsername,
    targetType: 'user',
    targetId: event.targetId,
    targetUsername: event.targetUsername,
    ipAddress: event.ipAddress,
    windowStartedAt: null,
    windowEndedAt: null,
    details: {
      lookbackDays,
      latestAuditLogId: event.id
    }
  });
}

async function evaluateAlerts(event) {
  if (!config.audit.alertsEnabled) return;

  await Promise.all([
    detectFailedLoginBurst(event),
    detectAccountResetBurst(event),
    detectNewIpLogin(event)
  ]);
}

function scheduleAlertEvaluation(event) {
  if (!config.audit.alertsEnabled) return;

  const timer = setTimeout(() => {
    evaluateAlerts(event).catch((error) => {
      logger.error({ err: error, auditLogId: event.id }, '审计告警检测失败');
    });
  }, 250);

  timer.unref?.();
}

export async function recordAuditLog(
  req,
  {
    eventType,
    action,
    outcome = 'success',
    actorUserId,
    actorUsername,
    actorRole,
    tenantId,
    targetType,
    targetId,
    targetUsername,
    details
  }
) {
  const auditEvent = {
    eventType,
    action,
    outcome,
    actorUserId: actorUserId ?? req.user?.id ?? null,
    actorUsername: truncate(actorUsername ?? req.user?.username, 80),
    actorRole: truncate(actorRole ?? req.user?.role, 40),
    tenantId: tenantId ?? req.user?.tenantId ?? req.user?.tenant_id ?? 1,
    targetType: truncate(targetType, 60),
    targetId: truncate(targetId, 80),
    targetUsername: truncate(targetUsername, 80),
    ipAddress: truncate(getIp(req), 64),
    userAgent: truncate(req.headers?.['user-agent'], 255),
    requestId: truncate(req.id, 80),
    details: redact(details ?? {})
  };

  const result = await query(
    `INSERT INTO audit_logs
     (tenant_id, event_type, action, outcome, actor_user_id, actor_username, actor_role,
      target_type, target_id, target_username, ip_address, user_agent, request_id, details)
     VALUES
     (:tenantId, :eventType, :action, :outcome, :actorUserId, :actorUsername, :actorRole,
     :targetType, :targetId, :targetUsername, :ipAddress, :userAgent, :requestId, CAST(:details AS JSON))`,
    {
      ...auditEvent,
      details: JSON.stringify(auditEvent.details)
    }
  );

  auditEvent.id = result.insertId;
  auditEvent.createdAt = new Date().toISOString();

  emitAuditEvent(auditEvent);
  scheduleAlertEvaluation(auditEvent);
  return auditEvent;
}

export function safeRecordAuditLog(req, event) {
  recordAuditLog(req, event).catch((error) => {
    logger.error({ err: error, eventType: event.eventType, action: event.action, requestId: req.id }, '审计日志写入失败');
  });
}

export async function recordSlowApi(req, { durationMs, statusCode }) {
  if (!config.audit.slowApiEnabled) return null;

  const route = `${req.method} ${req.route?.path || req.path || req.originalUrl}`;
  const event = await recordAuditLog(req, {
    eventType: 'performance',
    action: 'slow_api',
    outcome: statusCode >= 500 ? 'failure' : 'success',
    targetType: 'route',
    targetId: route,
    details: {
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      statusCode,
      durationMs,
      thresholdMs: config.audit.slowApiThresholdMs
    }
  });

  const rows = await query(
    `SELECT COUNT(*) AS count, MIN(created_at) AS windowStartedAt, MAX(created_at) AS windowEndedAt
     FROM audit_logs
     WHERE event_type = 'performance'
       AND action = 'slow_api'
       AND tenant_id = :tenantId
       AND target_id = :route
       AND created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
    { route, tenantId: event.tenantId }
  );
  const count = Number(rows[0]?.count || 1);

  await raiseAlert({
    alertType: 'slow_api',
    tenantId: event.tenantId,
    severity: durationMs >= config.audit.slowApiThresholdMs * 3 || statusCode >= 500 ? 'critical' : 'warning',
    dedupeKey: `tenant-${event.tenantId || 1}:slow-api:${route}:${windowKey(15 * 60 * 1000)}`,
    eventCount: count,
    actorUserId: event.actorUserId,
    actorUsername: event.actorUsername,
    targetType: 'route',
    targetId: route,
    targetUsername: null,
    ipAddress: event.ipAddress,
    windowStartedAt: rows[0]?.windowStartedAt,
    windowEndedAt: rows[0]?.windowEndedAt,
    details: {
      latestAuditLogId: event.id,
      method: req.method,
      path: req.path,
      statusCode,
      durationMs,
      thresholdMs: config.audit.slowApiThresholdMs,
      windowMs: 15 * 60 * 1000
    }
  });

  return event;
}

export function safeRecordSlowApi(req, metrics) {
  recordSlowApi(req, metrics).catch((error) => {
    logger.error({ err: error, requestId: req.id, path: req.originalUrl }, '慢接口审计写入失败');
  });
}
