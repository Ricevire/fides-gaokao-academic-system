import { config } from './config.js';
import { query } from './db.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

function maskPhone(phone) {
  const text = String(phone || '');
  if (text.length <= 7) return text;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function renderTemplate(content, variables = {}) {
  return content.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    const value = variables[key];
    return value === undefined || value === null ? match : String(value);
  });
}

async function loadTemplate(tenantId, templateCode) {
  if (!templateCode) return null;
  const [template] = await query(
    `SELECT template_code AS templateCode, content
     FROM sms_templates
     WHERE tenant_id = :tenantId AND template_code = :templateCode AND status = 'active'
     LIMIT 1`,
    { tenantId, templateCode }
  );
  return template || null;
}

async function updateSmsStatus(id, status, patch = {}) {
  await query(
    `UPDATE sms_messages
     SET status = :status,
         attempts = attempts + :attemptIncrement,
         provider = COALESCE(:provider, provider),
         provider_message_id = COALESCE(:providerMessageId, provider_message_id),
         provider_response = COALESCE(CAST(:providerResponse AS JSON), provider_response),
         error_message = :errorMessage,
         sent_at = CASE WHEN :statusForSent = 'sent' THEN NOW() ELSE sent_at END
     WHERE id = :id`,
    {
      id,
      status,
      statusForSent: status,
      attemptIncrement: patch.attemptIncrement ?? 0,
      provider: patch.provider ?? null,
      providerMessageId: patch.providerMessageId ?? null,
      providerResponse: patch.providerResponse === undefined ? null : JSON.stringify(patch.providerResponse),
      errorMessage: patch.errorMessage ?? null
    }
  );
}

async function deliverWithWebhook(record) {
  const response = await fetch(config.sms.webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.sms.webhookToken ? { authorization: `Bearer ${config.sms.webhookToken}` } : {})
    },
    body: JSON.stringify({
      messageId: record.id,
      recipientPhone: record.recipientPhone,
      templateCode: record.templateCode,
      message: record.message,
      variables: record.variables || {}
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(`短信网关返回 ${response.status}`, 502, 'SMS_GATEWAY_FAILED', { payload });
  }
  return payload;
}

async function deliver(record) {
  if (!config.sms.enabled) {
    await updateSmsStatus(record.id, 'skipped', {
      provider: config.sms.provider,
      providerResponse: { reason: 'SMS_DISABLED' }
    });
    return { id: record.id, status: 'skipped', reason: 'SMS_DISABLED' };
  }

  try {
    if (config.sms.provider === 'webhook') {
      const payload = await deliverWithWebhook(record);
      await updateSmsStatus(record.id, 'sent', {
        attemptIncrement: 1,
        provider: 'webhook',
        providerMessageId: payload.messageId || payload.id || null,
        providerResponse: payload
      });
      return { id: record.id, status: 'sent', provider: 'webhook', providerMessageId: payload.messageId || payload.id || null };
    }

    logger.info(
      {
        sms_message: {
          id: record.id,
          recipientPhone: maskPhone(record.recipientPhone),
          templateCode: record.templateCode
        }
      },
      'sms_message_sent'
    );
    await updateSmsStatus(record.id, 'sent', {
      attemptIncrement: 1,
      provider: 'log',
      providerResponse: { provider: 'log' }
    });
    return { id: record.id, status: 'sent', provider: 'log' };
  } catch (error) {
    await updateSmsStatus(record.id, 'failed', {
      attemptIncrement: 1,
      provider: config.sms.provider,
      errorMessage: error.message
    });
    logger.error({ err: error, smsMessageId: record.id }, '短信发送失败');
    return { id: record.id, status: 'failed', error: error.message };
  }
}

export async function sendSms({ tenantId = 1, recipientPhone, templateCode, variables = {}, message, requestedBy, targetType, targetId }) {
  const phone = String(recipientPhone || '').trim();
  if (!phone) {
    throw new AppError('短信接收手机号不能为空', 400, 'SMS_PHONE_REQUIRED');
  }

  const template = await loadTemplate(tenantId, templateCode);
  const renderedMessage = String(message || (template ? renderTemplate(template.content, variables) : '')).trim();
  if (!renderedMessage) {
    throw new AppError('短信内容不能为空', 400, 'SMS_MESSAGE_REQUIRED');
  }

  const result = await query(
    `INSERT INTO sms_messages
     (tenant_id, recipient_phone, template_code, message, variables, requested_by, target_type, target_id)
     VALUES
     (:tenantId, :recipientPhone, :templateCode, :message, CAST(:variables AS JSON), :requestedBy, :targetType, :targetId)`,
    {
      tenantId,
      recipientPhone: phone,
      templateCode: templateCode || null,
      message: renderedMessage,
      variables: JSON.stringify(variables || {}),
      requestedBy: requestedBy || null,
      targetType: targetType || null,
      targetId: targetId === undefined || targetId === null ? null : String(targetId)
    }
  );

  return deliver({
    id: result.insertId,
    tenantId,
    recipientPhone: phone,
    templateCode: templateCode || null,
    message: renderedMessage,
    variables
  });
}

export async function listSmsMessages({ tenantId, filters = {}, pagination, order }) {
  const where = ['tenant_id = :tenantId'];
  const params = { tenantId };

  if (filters.status) {
    where.push('status = :status');
    params.status = filters.status;
  }
  if (filters.q) {
    where.push('(recipient_phone LIKE :q OR template_code LIKE :q OR message LIKE :q OR target_id LIKE :q)');
    params.q = `%${String(filters.q).trim()}%`;
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const countRows = await query(`SELECT COUNT(*) AS total FROM sms_messages ${whereSql}`, params);
  const rows = await query(
    `SELECT id, recipient_phone AS recipientPhone, template_code AS templateCode, message,
            status, attempts, provider, provider_message_id AS providerMessageId,
            error_message AS errorMessage, requested_by AS requestedBy,
            target_type AS targetType, target_id AS targetId,
            sent_at AS sentAt, created_at AS createdAt
     FROM sms_messages
     ${whereSql}
     ORDER BY ${order.sql}, id DESC
     LIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params
  );
  return { rows, total: Number(countRows[0]?.total || 0) };
}
