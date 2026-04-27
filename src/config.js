import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().min(1).default('fides-gaokao-academic-system'),
    APP_VERSION: z.string().min(1).default('1.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    BODY_LIMIT: z.string().min(1).default('2mb'),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DB_HOST: z.string().min(1).default('127.0.0.1'),
    DB_PORT: z.coerce.number().int().positive().default(3306),
    DB_USER: z.string().min(1).default('root'),
    DB_PASSWORD: z.string().default(''),
    DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/).default('fides_gaokao'),
    DB_AUTO_CREATE: z.enum(['true', 'false']).optional(),
    DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少需要 32 个字符'),
    JWT_EXPIRES_IN: z.string().min(1).default('8h'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    ADMIN_INITIAL_PASSWORD: z.string().optional(),
    AUDIT_EVENT_LOG_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    AUDIT_SIEM_WEBHOOK_URL: z.union([z.url(), z.literal('')]).default(''),
    AUDIT_SIEM_WEBHOOK_TOKEN: z.string().default(''),
    AUDIT_ALERTS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    AUDIT_ALERT_WEBHOOK_URL: z.union([z.url(), z.literal('')]).default(''),
    AUDIT_ALERT_WEBHOOK_TOKEN: z.string().default(''),
    AUDIT_FAILED_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    AUDIT_FAILED_LOGIN_THRESHOLD: z.coerce.number().int().positive().default(5),
    AUDIT_ACCOUNT_RESET_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    AUDIT_ACCOUNT_RESET_THRESHOLD: z.coerce.number().int().positive().default(3),
    AUDIT_NEW_IP_LOOKBACK_DAYS: z.coerce.number().int().positive().default(90),
    AUDIT_SLOW_API_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    AUDIT_SLOW_API_THRESHOLD_MS: z.coerce.number().int().positive().default(1500),
    OIDC_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    OIDC_PROVIDER_CODE: z.string().regex(/^[A-Za-z0-9_-]+$/).default('oidc'),
    OIDC_PROVIDER_NAME: z.string().min(1).default('学校统一身份认证'),
    OIDC_TENANT_ID: z.coerce.number().int().positive().default(1),
    OIDC_AUTHORIZATION_URL: z.union([z.url(), z.literal('')]).default(''),
    OIDC_TOKEN_URL: z.union([z.url(), z.literal('')]).default(''),
    OIDC_USERINFO_URL: z.union([z.url(), z.literal('')]).default(''),
    OIDC_CLIENT_ID: z.string().default(''),
    OIDC_CLIENT_SECRET: z.string().default(''),
    OIDC_REDIRECT_URI: z.union([z.url(), z.literal('')]).default(''),
    OIDC_SCOPES: z.string().default('openid profile email phone'),
    OIDC_TOKEN_AUTH_METHOD: z.enum(['client_secret_post', 'client_secret_basic']).default('client_secret_post'),
    OIDC_SUBJECT_CLAIM: z.string().min(1).default('sub'),
    OIDC_USERNAME_CLAIM: z.string().min(1).default('preferred_username'),
    OIDC_DISPLAY_NAME_CLAIM: z.string().min(1).default('name'),
    OIDC_EMAIL_CLAIM: z.string().min(1).default('email'),
    OIDC_PHONE_CLAIM: z.string().min(1).default('phone_number'),
    OIDC_AUTO_LINK_BY_USERNAME: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    SMS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMS_PROVIDER: z.enum(['log', 'webhook']).default('log'),
    SMS_WEBHOOK_URL: z.union([z.url(), z.literal('')]).default(''),
    SMS_WEBHOOK_TOKEN: z.string().default(''),
    SMS_ACCOUNT_NOTIFY_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional()
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && /(local-dev|replace|change)/i.test(env.JWT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: '生产环境必须使用独立生成的 JWT_SECRET'
      });
    }

    if (env.NODE_ENV === 'production' && env.ADMIN_INITIAL_PASSWORD && env.ADMIN_INITIAL_PASSWORD === 'admin123') {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_INITIAL_PASSWORD'],
        message: '生产环境禁止使用默认管理员初始密码'
      });
    }

    if (env.OIDC_ENABLED) {
      for (const key of ['OIDC_AUTHORIZATION_URL', 'OIDC_TOKEN_URL', 'OIDC_USERINFO_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI']) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: '启用 OIDC 统一身份认证时必须配置该变量'
          });
        }
      }
    }

    if (env.SMS_ENABLED && env.SMS_PROVIDER === 'webhook' && !env.SMS_WEBHOOK_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_WEBHOOK_URL'],
        message: '启用短信 Webhook 网关时必须配置 SMS_WEBHOOK_URL'
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('环境变量校验失败：');
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;
const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  app: {
    name: env.APP_NAME,
    version: env.APP_VERSION
  },
  server: {
    port: env.PORT,
    bodyLimit: env.BODY_LIMIT,
    trustProxy: env.TRUST_PROXY
  },
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    autoCreate: env.DB_AUTO_CREATE ? env.DB_AUTO_CREATE === 'true' : env.NODE_ENV !== 'production',
    connectionLimit: env.DB_CONNECTION_LIMIT
  },
  security: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    corsOrigins,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: env.RATE_LIMIT_MAX,
    authRateLimitMax: env.AUTH_RATE_LIMIT_MAX
  },
  account: {
    initialAdminPassword: env.ADMIN_INITIAL_PASSWORD
  },
  audit: {
    eventLogEnabled: env.AUDIT_EVENT_LOG_ENABLED,
    siemWebhookUrl: env.AUDIT_SIEM_WEBHOOK_URL,
    siemWebhookToken: env.AUDIT_SIEM_WEBHOOK_TOKEN,
    alertsEnabled: env.AUDIT_ALERTS_ENABLED,
    alertWebhookUrl: env.AUDIT_ALERT_WEBHOOK_URL,
    alertWebhookToken: env.AUDIT_ALERT_WEBHOOK_TOKEN,
    failedLoginWindowMs: env.AUDIT_FAILED_LOGIN_WINDOW_MS,
    failedLoginThreshold: env.AUDIT_FAILED_LOGIN_THRESHOLD,
    accountResetWindowMs: env.AUDIT_ACCOUNT_RESET_WINDOW_MS,
    accountResetThreshold: env.AUDIT_ACCOUNT_RESET_THRESHOLD,
    newIpLookbackDays: env.AUDIT_NEW_IP_LOOKBACK_DAYS,
    slowApiEnabled: env.AUDIT_SLOW_API_ENABLED,
    slowApiThresholdMs: env.AUDIT_SLOW_API_THRESHOLD_MS
  },
  identity: {
    oidc: {
      enabled: env.OIDC_ENABLED,
      providerCode: env.OIDC_PROVIDER_CODE,
      providerName: env.OIDC_PROVIDER_NAME,
      tenantId: env.OIDC_TENANT_ID,
      authorizationUrl: env.OIDC_AUTHORIZATION_URL,
      tokenUrl: env.OIDC_TOKEN_URL,
      userinfoUrl: env.OIDC_USERINFO_URL,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      redirectUri: env.OIDC_REDIRECT_URI,
      scopes: env.OIDC_SCOPES,
      tokenAuthMethod: env.OIDC_TOKEN_AUTH_METHOD,
      subjectClaim: env.OIDC_SUBJECT_CLAIM,
      usernameClaim: env.OIDC_USERNAME_CLAIM,
      displayNameClaim: env.OIDC_DISPLAY_NAME_CLAIM,
      emailClaim: env.OIDC_EMAIL_CLAIM,
      phoneClaim: env.OIDC_PHONE_CLAIM,
      autoLinkByUsername: env.OIDC_AUTO_LINK_BY_USERNAME
    }
  },
  sms: {
    enabled: env.SMS_ENABLED,
    provider: env.SMS_PROVIDER,
    webhookUrl: env.SMS_WEBHOOK_URL,
    webhookToken: env.SMS_WEBHOOK_TOKEN,
    accountNotifyEnabled: env.SMS_ACCOUNT_NOTIFY_ENABLED
  },
  logLevel: env.LOG_LEVEL || (env.NODE_ENV === 'production' ? 'info' : 'debug')
};
