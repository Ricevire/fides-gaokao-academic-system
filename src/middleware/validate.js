import { AppError } from '../errors.js';

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }));
      return next(new AppError('请求参数不合法', 400, 'VALIDATION_ERROR', details));
    }

    req.body = result.data;
    return next();
  };
}
