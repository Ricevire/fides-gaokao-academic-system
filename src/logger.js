import { randomUUID } from 'crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config.js';

export const logger = pino({
  level: config.logLevel,
  base: {
    service: config.app.name,
    version: config.app.version,
    env: config.env
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'body.password',
      'body.currentPassword',
      'body.newPassword',
      'body.confirmPassword',
      'body.initialPassword',
      '*.password'
    ],
    censor: '[REDACTED]'
  }
});

export function requestLogger() {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existing = req.headers['x-request-id'];
      const requestId = Array.isArray(existing) ? existing[0] : existing || randomUUID();
      res.setHeader('x-request-id', requestId);
      return requestId;
    },
    customLogLevel: (req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customProps: (req) => ({
      userId: req.user?.id,
      userRole: req.user?.role
    })
  });
}
