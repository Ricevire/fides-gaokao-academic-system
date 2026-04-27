import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from '../config.js';

function corsOptionsDelegate(req, callback) {
  const origin = req.header('Origin');

  if (!origin) {
    return callback(null, { origin: true });
  }

  if (config.security.corsOrigins.includes('*') || config.security.corsOrigins.includes(origin)) {
    return callback(null, { origin: true, credentials: true });
  }

  return callback(null, { origin: false });
}

export function registerSecurityMiddleware(app) {
  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", ...config.security.corsOrigins.filter((origin) => origin !== '*')]
        }
      }
    })
  );

  app.use(cors(corsOptionsDelegate));
  app.use(compression());

  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: config.security.rateLimitWindowMs,
      limit: config.security.authRateLimitMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { code: 'RATE_LIMITED', message: '登录尝试过于频繁，请稍后再试' }
    })
  );

  app.use(
    '/api',
    rateLimit({
      windowMs: config.security.rateLimitWindowMs,
      limit: config.security.rateLimitMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' }
    })
  );
}
