import { config } from './config.js';

export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function mapDatabaseError(error) {
  if (error?.code === 'ER_DUP_ENTRY') {
    return new AppError('数据已存在，请检查唯一字段', 409, 'DUPLICATE_RESOURCE');
  }

  if (error?.code === 'ER_NO_REFERENCED_ROW_2') {
    return new AppError('关联数据不存在，请刷新后重试', 400, 'INVALID_REFERENCE');
  }

  if (error?.code === 'ER_ROW_IS_REFERENCED_2') {
    return new AppError('当前数据已被引用，不能直接删除', 409, 'RESOURCE_IN_USE');
  }

  return null;
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: '接口不存在',
    requestId: req.id
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const mapped = mapDatabaseError(error);
  const status = mapped?.status || error.status || 500;
  const code = mapped?.code || error.code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  const message = mapped?.message || error.message || '服务器错误';
  const details = mapped?.details || error.details;

  req.log?.[status >= 500 ? 'error' : 'warn'](
    {
      err: error,
      status,
      code,
      requestId: req.id
    },
    message
  );

  const payload = {
    code,
    message: status >= 500 && config.isProduction ? '服务器错误' : message,
    requestId: req.id
  };

  if (details && !config.isProduction) {
    payload.details = details;
  }

  return res.status(status).json(payload);
}
