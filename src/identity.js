import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from './config.js';
import { query } from './db.js';
import { AppError } from './errors.js';

const stateExpiresIn = '10m';

function oidcConfig(providerCode) {
  const oidc = config.identity.oidc;
  if (!oidc.enabled || providerCode !== oidc.providerCode) {
    throw new AppError('统一身份认证未启用', 404, 'SSO_PROVIDER_NOT_FOUND');
  }
  return oidc;
}

function claim(profile, name) {
  return profile?.[name] ? String(profile[name]).trim() : '';
}

function safeRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function basicAuth(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function postForm(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers
    },
    body: new URLSearchParams(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(`统一身份认证令牌交换失败：${payload.error_description || payload.error || response.status}`, 502, 'OIDC_TOKEN_EXCHANGE_FAILED');
  }
  return payload;
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(`统一身份认证用户信息获取失败：${payload.error_description || payload.error || response.status}`, 502, 'OIDC_USERINFO_FAILED');
  }
  return payload;
}

export function ssoConfigResponse() {
  const oidc = config.identity.oidc;
  return {
    enabled: oidc.enabled,
    providers: oidc.enabled
      ? [
          {
            code: oidc.providerCode,
            name: oidc.providerName,
            protocol: 'oidc',
            startUrl: `/api/auth/sso/${oidc.providerCode}/start`
          }
        ]
      : []
  };
}

export function buildOidcAuthorizationUrl({ providerCode, redirectTo = '/' } = {}) {
  const oidc = oidcConfig(providerCode);
  const state = jwt.sign(
    {
      type: 'oidc_state',
      providerCode: oidc.providerCode,
      redirectTo: safeRedirect(redirectTo),
      nonce: crypto.randomUUID()
    },
    config.security.jwtSecret,
    { expiresIn: stateExpiresIn }
  );
  const url = new URL(oidc.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', oidc.clientId);
  url.searchParams.set('redirect_uri', oidc.redirectUri);
  url.searchParams.set('scope', oidc.scopes);
  url.searchParams.set('state', state);
  return { authorizationUrl: url.toString(), state };
}

export function verifyOidcState(state, providerCode) {
  let payload;
  try {
    payload = jwt.verify(state, config.security.jwtSecret);
  } catch {
    throw new AppError('统一身份认证状态已过期，请重新发起登录', 400, 'OIDC_STATE_INVALID');
  }
  if (payload.type !== 'oidc_state' || payload.providerCode !== providerCode) {
    throw new AppError('统一身份认证状态不匹配', 400, 'OIDC_STATE_MISMATCH');
  }
  return {
    providerCode: payload.providerCode,
    redirectTo: safeRedirect(payload.redirectTo)
  };
}

export async function exchangeOidcCode(providerCode, code) {
  const oidc = oidcConfig(providerCode);
  const body = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: oidc.redirectUri,
    client_id: oidc.clientId
  };
  const headers = {};

  if (oidc.tokenAuthMethod === 'client_secret_basic') {
    headers.authorization = `Basic ${basicAuth(oidc.clientId, oidc.clientSecret)}`;
  } else {
    body.client_secret = oidc.clientSecret;
  }

  const token = await postForm(oidc.tokenUrl, body, headers);
  if (!token.access_token) {
    throw new AppError('统一身份认证未返回 access_token', 502, 'OIDC_ACCESS_TOKEN_MISSING');
  }
  return token;
}

export async function fetchOidcProfile(providerCode, accessToken) {
  const oidc = oidcConfig(providerCode);
  return getJson(oidc.userinfoUrl, {
    authorization: `Bearer ${accessToken}`
  });
}

export function mapOidcProfile(providerCode, profile) {
  const oidc = oidcConfig(providerCode);
  const subject = claim(profile, oidc.subjectClaim);
  if (!subject) {
    throw new AppError(`统一身份认证用户信息缺少 ${oidc.subjectClaim}`, 502, 'OIDC_SUBJECT_MISSING');
  }

  return {
    tenantId: oidc.tenantId,
    providerCode: oidc.providerCode,
    subject,
    username: claim(profile, oidc.usernameClaim),
    displayName: claim(profile, oidc.displayNameClaim),
    email: claim(profile, oidc.emailClaim),
    phone: claim(profile, oidc.phoneClaim),
    rawProfile: profile
  };
}

const userSelect = `
  SELECT u.id, u.username, u.password_hash, u.display_name, u.role, u.enabled, u.must_change_password,
         u.tenant_id AS tenantId, tenant.name AS tenantName,
         u.campus_id AS campusId, campus.name AS campusName,
         u.academic_year_id AS academicYearId, ay.name AS academicYearName
  FROM users u
  LEFT JOIN tenants tenant ON tenant.id = u.tenant_id
  LEFT JOIN campuses campus ON campus.id = u.campus_id
  LEFT JOIN academic_years ay ON ay.id = u.academic_year_id
`;

async function bindExternalIdentity(externalUser, user) {
  await query(
    `INSERT INTO external_identities
     (tenant_id, user_id, provider_code, external_subject, external_username, external_email, external_phone, display_name, last_login_at)
     VALUES
     (:tenantId, :userId, :providerCode, :subject, :username, :email, :phone, :displayName, NOW())
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       external_username = VALUES(external_username),
       external_email = VALUES(external_email),
       external_phone = VALUES(external_phone),
       display_name = VALUES(display_name),
       last_login_at = NOW()`,
    {
      tenantId: externalUser.tenantId,
      userId: user.id,
      providerCode: externalUser.providerCode,
      subject: externalUser.subject,
      username: externalUser.username || null,
      email: externalUser.email || null,
      phone: externalUser.phone || null,
      displayName: externalUser.displayName || null
    }
  );
}

export async function resolveExternalUser(externalUser) {
  const [linked] = await query(
    `${userSelect}
     JOIN external_identities ei ON ei.user_id = u.id
     WHERE ei.tenant_id = :tenantId
       AND ei.provider_code = :providerCode
       AND ei.external_subject = :subject
       AND u.enabled = 1
     LIMIT 1`,
    {
      tenantId: externalUser.tenantId,
      providerCode: externalUser.providerCode,
      subject: externalUser.subject
    }
  );
  if (linked) {
    await bindExternalIdentity(externalUser, linked);
    return linked;
  }

  if (!config.identity.oidc.autoLinkByUsername || !externalUser.username) {
    throw new AppError('统一身份认证账号未绑定本系统账号', 403, 'SSO_ACCOUNT_NOT_LINKED');
  }

  const [localUser] = await query(
    `${userSelect}
     WHERE u.tenant_id = :tenantId
       AND u.username = :username
       AND u.enabled = 1
     LIMIT 1`,
    {
      tenantId: externalUser.tenantId,
      username: externalUser.username
    }
  );
  if (!localUser) {
    throw new AppError('统一身份认证账号未绑定本系统账号', 403, 'SSO_ACCOUNT_NOT_LINKED');
  }

  await bindExternalIdentity(externalUser, localUser);
  return localUser;
}
