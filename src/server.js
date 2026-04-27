import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { recordAuditLog, safeRecordAuditLog, safeRecordSlowApi } from './audit.js';
import {
  buildOidcAuthorizationUrl,
  exchangeOidcCode,
  fetchOidcProfile,
  mapOidcProfile,
  resolveExternalUser,
  ssoConfigResponse,
  verifyOidcState
} from './identity.js';
import { listSmsMessages, sendSms } from './sms.js';
import {
  applyStudentImport,
  applyTeacherImport,
  excelMimeType,
  studentExportWorkbook,
  studentTemplateWorkbook,
  teacherExportWorkbook,
  teacherTemplateWorkbook,
  validateStudentWorkbook,
  validateTeacherWorkbook
} from './bulk-excel.js';
import { config } from './config.js';
import { closePool, ensureDatabase, pingDatabase, query, transaction } from './db.js';
import { AppError, errorHandler, notFoundHandler } from './errors.js';
import { logger, requestLogger } from './logger.js';
import { registerSecurityMiddleware } from './middleware/security.js';
import { validateBody } from './middleware/validate.js';
import { hasPermission, permissionContextForRole } from './permissions.js';
import {
  classSchema,
  changePasswordSchema,
  examSchema,
  examScoreSchema,
  autoScheduleSchema,
  issueAccountSchema,
  loginSchema,
  smsSendSchema,
  studentSchema,
  subjectCombinationSchema,
  teacherSchema,
  teacherDutySchema,
  teachingClassSchema,
  timetableSchema
} from './validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = config.server.port;
const jwtSecret = config.security.jwtSecret;

const preferredSubjects = ['physics', 'history'];
const electiveSubjects = ['chemistry', 'biology', 'politics', 'geography'];
const teacherDutyRoleLabels = {
  grade_leader: '段长',
  deputy_grade_leader: '副段长',
  grade_subject_leader: '年级学科负责人',
  head_teacher: '班主任',
  course_teacher: '任课老师'
};

app.use(requestLogger());
registerSecurityMiddleware(app);
app.use(express.json({ limit: config.server.bodyLimit }));
app.use(express.urlencoded({ extended: false, limit: config.server.bodyLimit }));
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: config.isProduction ? '1d' : 0,
    etag: true
  })
);

app.get('/health', (req, res) => {
  res.json({ ok: true, service: config.app.name, version: config.app.version });
});

app.get('/health/live', (req, res) => {
  res.json({ ok: true });
});

app.get(
  '/health/ready',
  asyncHandler(async (req, res) => {
    await pingDatabase();
    res.json({ ok: true, database: 'ready' });
  })
);

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function slowApiMonitor(req, res, next) {
  const excludedPaths = ['/api/audit-logs', '/api/audit-alerts'];
  if (
    !config.audit.slowApiEnabled ||
    !req.path.startsWith('/api/') ||
    excludedPaths.some((pathPrefix) => req.path.startsWith(pathPrefix))
  ) {
    return next();
  }

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (durationMs < config.audit.slowApiThresholdMs) return;
    safeRecordSlowApi(req, {
      durationMs: Math.round(durationMs),
      statusCode: res.statusCode
    });
  });

  return next();
}

app.use(slowApiMonitor);

function signToken(user) {
  const tenantId = user.tenant_id ?? user.tenantId ?? 1;
  const campusId = user.campus_id ?? user.campusId ?? null;
  const academicYearId = user.academic_year_id ?? user.academicYearId ?? null;
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
      tenantId,
      tenantName: user.tenantName ?? user.tenant_name ?? null,
      campusId,
      campusName: user.campusName ?? user.campus_name ?? null,
      academicYearId,
      academicYearName: user.academicYearName ?? user.academic_year_name ?? null
    },
    jwtSecret,
    { expiresIn: config.security.jwtExpiresIn }
  );
}

function userResponse(user) {
  const permissions = permissionContextForRole(user.role);
  const tenantId = user.tenant_id ?? user.tenantId ?? 1;
  const campusId = user.campus_id ?? user.campusId ?? null;
  const academicYearId = user.academic_year_id ?? user.academicYearId ?? null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name ?? user.displayName,
    role: user.role,
    roleLabel: permissions.roleLabel,
    mustChangePassword: Boolean(user.must_change_password ?? user.mustChangePassword),
    tenantId,
    tenantName: user.tenantName ?? user.tenant_name ?? null,
    campusId,
    campusName: user.campusName ?? user.campus_name ?? null,
    academicYearId,
    academicYearName: user.academicYearName ?? user.academic_year_name ?? null,
    permissions: permissions.permissions,
    pages: permissions.pages
  };
}

function ssoCallbackHtml({ token, user, redirectTo }) {
  const tokenJson = JSON.stringify(token).replace(/</g, '\\u003c');
  const userJson = JSON.stringify(user).replace(/</g, '\\u003c');
  const redirectJson = JSON.stringify(redirectTo || '/').replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>统一身份认证登录中</title></head>
<body>
<script>
localStorage.setItem('fides_gaokao_token', ${tokenJson});
localStorage.setItem('fides_gaokao_user', ${userJson});
location.replace(${redirectJson});
</script>
</body>
</html>`;
}

function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) {
    return res.status(401).json({ message: '请先登录' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = {
      ...decoded,
      tenantId: decoded.tenantId || 1,
      campusId: decoded.campusId ?? null,
      academicYearId: decoded.academicYearId ?? null
    };
    return next();
  } catch {
    return res.status(401).json({ message: '登录已过期，请重新登录' });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user.role, permission)) {
      safeRecordAuditLog(req, {
        eventType: 'permission',
        action: 'permission_denied',
        outcome: 'failure',
        targetType: 'route',
        targetId: `${req.method} ${req.originalUrl}`,
        details: {
          requiredPermission: permission,
          actualRole: req.user.role
        }
      });
      return res.status(403).json({ message: '当前账号没有权限执行该操作' });
    }
    return next();
  };
}

function requirePasswordReady(req, res, next) {
  if (req.user?.mustChangePassword) {
    return res.status(423).json({
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: '首次登录必须修改密码',
      mustChangePassword: true
    });
  }
  return next();
}

function assertStrongPassword(password) {
  const rules = [
    [password.length >= 10, '至少 10 个字符'],
    [/[a-z]/.test(password), '包含小写字母'],
    [/[A-Z]/.test(password), '包含大写字母'],
    [/\d/.test(password), '包含数字'],
    [/[^A-Za-z0-9]/.test(password), '包含特殊字符']
  ];
  const failed = rules.filter(([ok]) => !ok).map(([, message]) => message);

  if (failed.length) {
    throw new AppError(`密码强度不足：${failed.join('、')}`, 400, 'WEAK_PASSWORD');
  }

  if (config.isProduction && password === 'admin123') {
    throw new AppError('生产环境禁止使用默认密码', 400, 'DEFAULT_PASSWORD_FORBIDDEN');
  }
}

function generateInitialPassword() {
  return `Fi-${crypto.randomBytes(9).toString('base64url')}9!`;
}

function sanitizeUsername(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 50);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function issueLinkedAccount({ entity, id, username, initialPassword, tenantId = 1 }) {
  const isTeacher = entity === 'teacher';
  const table = isTeacher ? 'teachers' : 'students';
  const codeColumn = isTeacher ? 'employee_no' : 'student_no';
  const role = isTeacher ? 'teacher' : 'student';
  const prefix = isTeacher ? 't' : 's';
  const notifySelect = isTeacher ? 'phone AS notifyPhone' : 'COALESCE(phone, guardian_phone) AS notifyPhone';
  const yearSelect = isTeacher
    ? `(SELECT ay.id FROM academic_years ay WHERE ay.tenant_id = ${table}.tenant_id AND ay.is_current = 1 LIMIT 1) AS academicYearId`
    : 'academic_year_id AS academicYearId';

  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT id, user_id AS userId, ${codeColumn} AS code, name,
              tenant_id AS tenantId, campus_id AS campusId, ${yearSelect}, ${notifySelect}
       FROM ${table}
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [id, tenantId]
    );
    const record = rows[0];

    if (!record) {
      throw new AppError(isTeacher ? '教师不存在' : '学生不存在', 404, 'RESOURCE_NOT_FOUND');
    }

    const accountUsername = normalizeOptionalString(username) || sanitizeUsername(`${prefix}_${record.code}`);
    const password = normalizeOptionalString(initialPassword) || generateInitialPassword();
    assertStrongPassword(password);
    const passwordHash = await bcrypt.hash(password, 10);

    if (record.userId) {
      await connection.execute(
        `UPDATE users
         SET username = ?, password_hash = ?, display_name = ?, role = ?, enabled = 1,
             must_change_password = 1, password_changed_at = NULL,
             tenant_id = ?, campus_id = ?, academic_year_id = ?
         WHERE id = ?`,
        [accountUsername, passwordHash, record.name, role, record.tenantId, record.campusId, record.academicYearId, record.userId]
      );

      return {
        action: 'reset',
        userId: record.userId,
        username: accountUsername,
        initialPassword: password,
        mustChangePassword: true,
        displayName: record.name,
        role,
        notifyPhone: record.notifyPhone
      };
    }

    const [result] = await connection.execute(
      `INSERT INTO users
       (username, password_hash, display_name, role, enabled, must_change_password, tenant_id, campus_id, academic_year_id)
       VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      [accountUsername, passwordHash, record.name, role, record.tenantId, record.campusId, record.academicYearId]
    );

    await connection.execute(`UPDATE ${table} SET user_id = ? WHERE id = ?`, [result.insertId, id]);

    return {
      action: 'created',
      userId: result.insertId,
      username: accountUsername,
      initialPassword: password,
      mustChangePassword: true,
      displayName: record.name,
      role,
      notifyPhone: record.notifyPhone
    };
  });
}

function asNullable(value) {
  return value === undefined || value === '' ? null : value;
}

function asPositiveId(value) {
  const normalized = asNullable(value);
  if (normalized === null) return null;
  const number = Number(normalized);
  return Number.isInteger(number) && number > 0 ? number : normalized;
}

function currentTenantId(req) {
  return asPositiveId(req.user?.tenantId ?? req.user?.tenant_id) || 1;
}

function currentCampusId(req) {
  return asPositiveId(req.user?.campusId ?? req.user?.campus_id);
}

function currentAcademicYearId(req) {
  return asPositiveId(req.user?.academicYearId ?? req.user?.academic_year_id);
}

function orgContext(req, body = {}) {
  return {
    tenantId: currentTenantId(req),
    campusId: asPositiveId(body.campusId) || currentCampusId(req) || 1,
    academicYearId: asPositiveId(body.academicYearId) || currentAcademicYearId(req) || 1
  };
}

function appendOrgFilters(filters, params, req, alias, { campus = false, academicYear = false } = {}) {
  appendFilter(filters, params, `${alias}.tenant_id = :tenantId`, { tenantId: currentTenantId(req) });

  if (campus && req.query.campusId) {
    appendFilter(filters, params, `${alias}.campus_id = :campusId`, { campusId: req.query.campusId });
  }

  if (academicYear && req.query.academicYearId) {
    appendFilter(filters, params, `${alias}.academic_year_id = :academicYearId`, { academicYearId: req.query.academicYearId });
  }
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === '');
  if (missing.length) {
    const error = new Error(`缺少必填字段：${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }
}

function readRawBody(req, { maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let rejected = false;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        rejected = true;
        reject(new AppError('上传文件不能超过 8MB', 413, 'UPLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });

    req.on('error', (error) => {
      if (!rejected) reject(error);
    });
  });
}

function sendExcel(res, fileName, buffer) {
  const encodedName = encodeURIComponent(fileName);
  const fallbackName = fileName.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Type', excelMimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`);
  res.send(buffer);
}

function shouldDryRun(req) {
  return req.query.dryRun !== '0' && req.query.dryRun !== 'false';
}

function parsePositiveInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function paginationFromQuery(req, { defaultPageSize = 20, maxPageSize = 100 } = {}) {
  const pageSize = parsePositiveInt(req.query.pageSize || req.query.limit, defaultPageSize, {
    min: 1,
    max: maxPageSize
  });
  const offset = req.query.offset === undefined ? null : parsePositiveInt(req.query.offset, 0, { min: 0, max: 10_000_000 });
  const page = offset === null ? parsePositiveInt(req.query.page, 1, { min: 1, max: 100000 }) : Math.floor(offset / pageSize) + 1;
  return {
    page,
    pageSize,
    limit: pageSize,
    offset: offset === null ? (page - 1) * pageSize : offset
  };
}

function orderByFromQuery(req, sortMap, defaultSort) {
  const sortKey = String(req.query.sort || defaultSort.key);
  const sortExpression = sortMap[sortKey] || sortMap[defaultSort.key];
  const order = String(req.query.order || defaultSort.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return {
    sort: sortMap[sortKey] ? sortKey : defaultSort.key,
    order: order.toLowerCase(),
    sql: `${sortExpression} ${order}`
  };
}

function pagedResponse(items, total, pagination, order) {
  const totalPages = Math.max(Math.ceil(total / pagination.pageSize), 1);
  return {
    items,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages,
      hasPrev: pagination.page > 1,
      hasNext: pagination.page < totalPages
    },
    sort: {
      key: order.sort,
      order: order.order
    }
  };
}

function limitClause(pagination) {
  return `LIMIT ${pagination.limit} OFFSET ${pagination.offset}`;
}

function appendFilter(filters, params, condition, values = {}) {
  filters.push(condition);
  Object.assign(params, values);
}

function likeParam(value) {
  return `%${String(value).trim()}%`;
}

function isDateLike(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function assertNewGaokaoSelection(preferredSubject, selectedElectives) {
  if (!preferredSubjects.includes(preferredSubject)) {
    const error = new Error('首选科目必须为物理或历史');
    error.status = 400;
    throw error;
  }

  if (!Array.isArray(selectedElectives) || selectedElectives.length !== 2) {
    const error = new Error('再选科目必须且只能选择 2 门');
    error.status = 400;
    throw error;
  }

  const unique = new Set(selectedElectives);
  if (unique.size !== 2 || selectedElectives.some((code) => !electiveSubjects.includes(code))) {
    const error = new Error('再选科目只能从化学、生物、思想政治、地理中选择，且不可重复');
    error.status = 400;
    throw error;
  }
}

function buildCombinationKey(preferredSubject, selectedElectives) {
  return [preferredSubject, ...selectedElectives.slice().sort()].join('+');
}

async function listGrades(req) {
  return query(
    `SELECT id, name, entry_year AS entryYear, status, academic_year_id AS academicYearId
     FROM grades
     WHERE tenant_id = :tenantId
     ORDER BY entry_year DESC`,
    { tenantId: currentTenantId(req) }
  );
}

function appendAnalyticsStudentFilters(filters, params, req, alias = 's') {
  appendFilter(filters, params, `${alias}.tenant_id = :tenantId`, { tenantId: currentTenantId(req) });
  if (req.query.campusId) appendFilter(filters, params, `${alias}.campus_id = :campusId`, { campusId: req.query.campusId });
  if (req.query.academicYearId) {
    appendFilter(filters, params, `${alias}.academic_year_id = :academicYearId`, { academicYearId: req.query.academicYearId });
  }
  if (req.query.gradeId) appendFilter(filters, params, `${alias}.grade_id = :gradeId`, { gradeId: req.query.gradeId });
  if (req.query.classId) appendFilter(filters, params, `${alias}.class_id = :classId`, { classId: req.query.classId });
}

function predictionRiskLevel({ projectedStudents, share, suggestedTeachingClasses }) {
  if (suggestedTeachingClasses >= 2 || share >= 0.2 || projectedStudents >= 45) return 'high';
  if (projectedStudents >= 15 || share >= 0.08) return 'medium';
  return 'low';
}

async function assertProductionAdminPasswordPolicy() {
  if (!config.isProduction) return;

  try {
    const [admin] = await query('SELECT password_hash AS passwordHash FROM users WHERE username = :username LIMIT 1', {
      username: 'admin'
    });

    if (admin && (await bcrypt.compare('admin123', admin.passwordHash))) {
      throw new AppError('生产环境检测到默认管理员密码，服务拒绝启动', 500, 'DEFAULT_ADMIN_PASSWORD');
    }
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return;
    throw error;
  }
}

async function getTeacherIdForUser(userId) {
  const [teacher] = await query('SELECT id FROM teachers WHERE user_id = :userId LIMIT 1', { userId });
  return teacher?.id || null;
}

async function getStudentIdForUser(userId) {
  const [student] = await query('SELECT id FROM students WHERE user_id = :userId LIMIT 1', { userId });
  return student?.id || null;
}

function denyScopedAccess(message = '当前账号没有权限访问该数据') {
  throw new AppError(message, 403, 'DATA_SCOPE_DENIED');
}

function hideAccountFields(rows, role, permission) {
  if (hasPermission(role, permission)) return rows;
  return rows.map(({ accountUsername, accountEnabled, accountMustChangePassword, ...row }) => row);
}

function teacherDutyScopeName(duty) {
  if (duty.roleType === 'grade_subject_leader') {
    return [duty.gradeName, duty.subjectName].filter(Boolean).join(' / ');
  }
  if (duty.roleType === 'head_teacher') return duty.className || duty.gradeName || '';
  if (duty.roleType === 'course_teacher') return duty.teachingClassName || duty.subjectName || '';
  return duty.gradeName || '';
}

function publicTeacherDuty(row) {
  return {
    ...row,
    roleLabel: teacherDutyRoleLabels[row.roleType] || row.roleType,
    scopeName: teacherDutyScopeName(row)
  };
}

async function listTeacherDuties({ tenantId, teacherIds = [], filters = {} } = {}) {
  const where = ['td.tenant_id = :tenantId'];
  const params = { tenantId };

  if (teacherIds.length) {
    const placeholders = teacherIds.map((teacherId, index) => {
      const key = `teacherId${index}`;
      params[key] = teacherId;
      return `:${key}`;
    });
    where.push(`td.teacher_id IN (${placeholders.join(', ')})`);
  }
  if (filters.id) appendFilter(where, params, 'td.id = :id', { id: filters.id });
  if (filters.teacherId) appendFilter(where, params, 'td.teacher_id = :teacherId', { teacherId: filters.teacherId });
  if (filters.roleType) appendFilter(where, params, 'td.role_type = :roleType', { roleType: filters.roleType });
  if (filters.gradeId) appendFilter(where, params, 'td.grade_id = :gradeId', { gradeId: filters.gradeId });
  if (filters.subjectCode) appendFilter(where, params, 'td.subject_code = :subjectCode', { subjectCode: filters.subjectCode });
  if (filters.classId) appendFilter(where, params, 'td.class_id = :classId', { classId: filters.classId });
  if (filters.teachingClassId) appendFilter(where, params, 'td.teaching_class_id = :teachingClassId', { teachingClassId: filters.teachingClassId });
  if (filters.campusId) appendFilter(where, params, 'td.campus_id = :campusId', { campusId: filters.campusId });
  if (filters.academicYearId) appendFilter(where, params, 'td.academic_year_id = :academicYearId', { academicYearId: filters.academicYearId });

  const rows = await query(
    `SELECT td.id, td.teacher_id AS teacherId, t.employee_no AS employeeNo, t.name AS teacherName,
            td.role_type AS roleType, td.tenant_id AS tenantId,
            td.campus_id AS campusId, campus.name AS campusName,
            td.academic_year_id AS academicYearId, ay.name AS academicYearName,
            td.grade_id AS gradeId, g.name AS gradeName,
            td.subject_code AS subjectCode, subj.name AS subjectName,
            td.class_id AS classId, c.name AS className,
            td.teaching_class_id AS teachingClassId, tc.name AS teachingClassName,
            td.note, td.created_at AS createdAt
     FROM teacher_duties td
     JOIN teachers t ON t.id = td.teacher_id
     LEFT JOIN campuses campus ON campus.id = td.campus_id
     LEFT JOIN academic_years ay ON ay.id = td.academic_year_id
     LEFT JOIN grades g ON g.id = td.grade_id
     LEFT JOIN subjects subj ON subj.code = td.subject_code
     LEFT JOIN classes c ON c.id = td.class_id
     LEFT JOIN teaching_classes tc ON tc.id = td.teaching_class_id
     WHERE ${where.join(' AND ')}
     ORDER BY FIELD(td.role_type, 'grade_leader', 'deputy_grade_leader', 'grade_subject_leader', 'head_teacher', 'course_teacher'),
              g.entry_year DESC, subj.id ASC, c.name ASC, tc.name ASC, td.id DESC`,
    params
  );

  return rows.map(publicTeacherDuty);
}

async function attachTeacherDuties(rows, tenantId) {
  if (!rows.length) return rows;
  const duties = await listTeacherDuties({ tenantId, teacherIds: rows.map((row) => row.id) });
  const grouped = new Map();
  duties.forEach((duty) => {
    grouped.set(duty.teacherId, [...(grouped.get(duty.teacherId) || []), duty]);
  });
  return rows.map((row) => ({
    ...row,
    duties: grouped.get(row.id) || []
  }));
}

async function resolveTeacherDutyContext(req, body) {
  const tenantId = currentTenantId(req);
  const org = orgContext(req, body);
  const roleType = body.roleType;
  const [teacher] = await query('SELECT id FROM teachers WHERE id = :teacherId AND tenant_id = :tenantId LIMIT 1', {
    teacherId: body.teacherId,
    tenantId
  });
  if (!teacher) throw new AppError('教师不存在', 404, 'RESOURCE_NOT_FOUND');

  const duty = {
    tenantId,
    campusId: org.campusId,
    academicYearId: org.academicYearId,
    teacherId: body.teacherId,
    roleType,
    gradeId: asNullable(body.gradeId),
    subjectCode: normalizeOptionalString(body.subjectCode),
    classId: asNullable(body.classId),
    teachingClassId: asNullable(body.teachingClassId),
    note: normalizeOptionalString(body.note)
  };

  if (roleType === 'grade_leader' || roleType === 'deputy_grade_leader') {
    if (!duty.gradeId) throw new AppError('段长/副段长必须选择年级', 400, 'INVALID_TEACHER_DUTY');
    return duty;
  }

  if (roleType === 'grade_subject_leader') {
    if (!duty.gradeId || !duty.subjectCode) {
      throw new AppError('年级学科负责人必须选择年级和学科', 400, 'INVALID_TEACHER_DUTY');
    }
    return duty;
  }

  if (roleType === 'head_teacher') {
    if (!duty.classId) throw new AppError('班主任职务必须选择行政班', 400, 'INVALID_TEACHER_DUTY');
    const [clazz] = await query(
      `SELECT id, tenant_id AS tenantId, campus_id AS campusId, academic_year_id AS academicYearId, grade_id AS gradeId
       FROM classes
       WHERE id = :classId AND tenant_id = :tenantId
       LIMIT 1`,
      { classId: duty.classId, tenantId }
    );
    if (!clazz) throw new AppError('行政班不存在', 404, 'RESOURCE_NOT_FOUND');
    return {
      ...duty,
      campusId: clazz.campusId,
      academicYearId: clazz.academicYearId,
      gradeId: clazz.gradeId
    };
  }

  if (roleType === 'course_teacher') {
    if (!duty.teachingClassId) throw new AppError('任课老师职务必须选择教学班', 400, 'INVALID_TEACHER_DUTY');
    const [teachingClass] = await query(
      `SELECT id, tenant_id AS tenantId, campus_id AS campusId, academic_year_id AS academicYearId,
              grade_id AS gradeId, subject_code AS subjectCode
       FROM teaching_classes
       WHERE id = :teachingClassId AND tenant_id = :tenantId
       LIMIT 1`,
      { teachingClassId: duty.teachingClassId, tenantId }
    );
    if (!teachingClass) throw new AppError('教学班不存在', 404, 'RESOURCE_NOT_FOUND');
    return {
      ...duty,
      campusId: teachingClass.campusId,
      academicYearId: teachingClass.academicYearId,
      gradeId: teachingClass.gradeId,
      subjectCode: teachingClass.subjectCode
    };
  }

  throw new AppError('未知教师职务类型', 400, 'INVALID_TEACHER_DUTY');
}

async function replaceTeacherDuty(duty) {
  if (duty.roleType === 'grade_leader') {
    await query(
      `DELETE FROM teacher_duties
       WHERE tenant_id = :tenantId AND role_type = 'grade_leader'
         AND academic_year_id <=> :academicYearId AND grade_id <=> :gradeId`,
      duty
    );
  } else if (duty.roleType === 'deputy_grade_leader') {
    await query(
      `DELETE FROM teacher_duties
       WHERE tenant_id = :tenantId AND role_type = 'deputy_grade_leader'
         AND teacher_id = :teacherId AND academic_year_id <=> :academicYearId AND grade_id <=> :gradeId`,
      duty
    );
  } else if (duty.roleType === 'grade_subject_leader') {
    await query(
      `DELETE FROM teacher_duties
       WHERE tenant_id = :tenantId AND role_type = 'grade_subject_leader'
         AND academic_year_id <=> :academicYearId AND grade_id <=> :gradeId AND subject_code <=> :subjectCode`,
      duty
    );
  } else if (duty.roleType === 'head_teacher') {
    await query(`DELETE FROM teacher_duties WHERE tenant_id = :tenantId AND role_type = 'head_teacher' AND class_id = :classId`, duty);
    await query('UPDATE classes SET head_teacher_id = :teacherId WHERE id = :classId AND tenant_id = :tenantId', duty);
  } else if (duty.roleType === 'course_teacher') {
    await query(
      `DELETE FROM teacher_duties
       WHERE tenant_id = :tenantId AND role_type = 'course_teacher' AND teaching_class_id = :teachingClassId`,
      duty
    );
    await query('UPDATE teaching_classes SET teacher_id = :teacherId WHERE id = :teachingClassId AND tenant_id = :tenantId', duty);
  }

  const result = await query(
    `INSERT INTO teacher_duties
       (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, subject_code, class_id, teaching_class_id, note)
     VALUES
       (:tenantId, :campusId, :academicYearId, :teacherId, :roleType, :gradeId, :subjectCode, :classId, :teachingClassId, :note)`,
    duty
  );
  return result.insertId;
}

async function syncHeadTeacherDuty({ tenantId, classId, teacherId }) {
  await query(`DELETE FROM teacher_duties WHERE tenant_id = :tenantId AND role_type = 'head_teacher' AND class_id = :classId`, { tenantId, classId });
  if (!teacherId) return;
  const [clazz] = await query(
    `SELECT id AS classId, campus_id AS campusId, academic_year_id AS academicYearId, grade_id AS gradeId
     FROM classes
     WHERE id = :classId AND tenant_id = :tenantId
     LIMIT 1`,
    { tenantId, classId }
  );
  if (!clazz) return;
  await query(
    `INSERT INTO teacher_duties
       (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, class_id, note)
     VALUES (:tenantId, :campusId, :academicYearId, :teacherId, 'head_teacher', :gradeId, :classId, '行政班班主任')`,
    { tenantId, teacherId, ...clazz }
  );
}

async function syncCourseTeacherDuty({ tenantId, teachingClassId, teacherId }) {
  await query(
    `DELETE FROM teacher_duties
     WHERE tenant_id = :tenantId AND role_type = 'course_teacher' AND teaching_class_id = :teachingClassId`,
    { tenantId, teachingClassId }
  );
  if (!teacherId) return;
  const [teachingClass] = await query(
    `SELECT id AS teachingClassId, campus_id AS campusId, academic_year_id AS academicYearId,
            grade_id AS gradeId, subject_code AS subjectCode
     FROM teaching_classes
     WHERE id = :teachingClassId AND tenant_id = :tenantId
     LIMIT 1`,
    { tenantId, teachingClassId }
  );
  if (!teachingClass) return;
  await query(
    `INSERT INTO teacher_duties
       (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, subject_code, teaching_class_id, note)
     VALUES (:tenantId, :campusId, :academicYearId, :teacherId, 'course_teacher', :gradeId, :subjectCode, :teachingClassId, '教学班任课老师')`,
    { tenantId, teacherId, ...teachingClass }
  );
}

async function studentScope(req, alias = 's') {
  const tenantId = currentTenantId(req);
  if (['admin', 'academic'].includes(req.user.role)) {
    return { where: `${alias}.tenant_id = :tenantId`, params: { tenantId } };
  }

  if (req.user.role === 'head_teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return {
      where: `${alias}.tenant_id = :tenantId
        AND ${alias}.class_id IN (SELECT id FROM classes WHERE tenant_id = :tenantId AND head_teacher_id = :scopeTeacherId)`,
      params: { tenantId, scopeTeacherId: teacherId }
    };
  }

  if (req.user.role === 'teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return {
      where: `${alias}.tenant_id = :tenantId AND EXISTS (
        SELECT 1
        FROM teaching_class_students scoped_tcs
        JOIN teaching_classes scoped_tc ON scoped_tc.id = scoped_tcs.teaching_class_id
        WHERE scoped_tcs.student_id = ${alias}.id
          AND scoped_tc.tenant_id = :tenantId
          AND scoped_tc.teacher_id = :scopeTeacherId
      )`,
      params: { tenantId, scopeTeacherId: teacherId }
    };
  }

  if (req.user.role === 'student') {
    return { where: `${alias}.tenant_id = :tenantId AND ${alias}.user_id = :scopeUserId`, params: { tenantId, scopeUserId: req.user.id } };
  }

  return { where: '1 = 0', params: {} };
}

async function classScope(req, alias = 'c') {
  const tenantId = currentTenantId(req);
  if (['admin', 'academic'].includes(req.user.role)) {
    return { where: `${alias}.tenant_id = :tenantId`, params: { tenantId } };
  }

  if (req.user.role === 'head_teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return { where: `${alias}.tenant_id = :tenantId AND ${alias}.head_teacher_id = :scopeTeacherId`, params: { tenantId, scopeTeacherId: teacherId } };
  }

  if (req.user.role === 'teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return {
      where: `${alias}.tenant_id = :tenantId AND EXISTS (
        SELECT 1
        FROM students scoped_students
        JOIN teaching_class_students scoped_tcs ON scoped_tcs.student_id = scoped_students.id
        JOIN teaching_classes scoped_tc ON scoped_tc.id = scoped_tcs.teaching_class_id
        WHERE scoped_students.class_id = ${alias}.id AND scoped_tc.teacher_id = :scopeTeacherId
          AND scoped_students.tenant_id = :tenantId
          AND scoped_tc.tenant_id = :tenantId
      )`,
      params: { tenantId, scopeTeacherId: teacherId }
    };
  }

  if (req.user.role === 'student') {
    return {
      where: `${alias}.tenant_id = :tenantId AND EXISTS (
        SELECT 1 FROM students scoped_students
        WHERE scoped_students.tenant_id = :tenantId
          AND scoped_students.class_id = ${alias}.id
          AND scoped_students.user_id = :scopeUserId
      )`,
      params: { tenantId, scopeUserId: req.user.id }
    };
  }

  return { where: '1 = 0', params: {} };
}

async function teachingClassScope(req, alias = 'tc') {
  const tenantId = currentTenantId(req);
  if (['admin', 'academic'].includes(req.user.role)) {
    return { where: `${alias}.tenant_id = :tenantId`, params: { tenantId } };
  }

  if (req.user.role === 'head_teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return {
      where: `${alias}.tenant_id = :tenantId AND EXISTS (
        SELECT 1
        FROM teaching_class_students scoped_tcs
        JOIN students scoped_students ON scoped_students.id = scoped_tcs.student_id
        WHERE scoped_tcs.teaching_class_id = ${alias}.id
          AND scoped_students.tenant_id = :tenantId
          AND scoped_students.class_id IN (SELECT id FROM classes WHERE tenant_id = :tenantId AND head_teacher_id = :scopeTeacherId)
      )`,
      params: { tenantId, scopeTeacherId: teacherId }
    };
  }

  if (req.user.role === 'teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return { where: `${alias}.tenant_id = :tenantId AND ${alias}.teacher_id = :scopeTeacherId`, params: { tenantId, scopeTeacherId: teacherId } };
  }

  if (req.user.role === 'student') {
    const studentId = await getStudentIdForUser(req.user.id);
    if (!studentId) return { where: '1 = 0', params: {} };
    return {
      where: `${alias}.tenant_id = :tenantId AND EXISTS (
        SELECT 1 FROM teaching_class_students scoped_tcs
        WHERE scoped_tcs.teaching_class_id = ${alias}.id AND scoped_tcs.student_id = :scopeStudentId
      )`,
      params: { tenantId, scopeStudentId: studentId }
    };
  }

  return { where: '1 = 0', params: {} };
}

async function timetableScope(req) {
  const tenantId = currentTenantId(req);
  if (['admin', 'academic'].includes(req.user.role)) {
    return { where: 'te.tenant_id = :tenantId', params: { tenantId } };
  }

  if (req.user.role === 'head_teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return {
      where: `te.tenant_id = :tenantId AND (c.head_teacher_id = :scopeTeacherId OR EXISTS (
        SELECT 1
        FROM teaching_class_students scoped_tcs
        JOIN students scoped_students ON scoped_students.id = scoped_tcs.student_id
        WHERE scoped_tcs.teaching_class_id = tc.id
          AND scoped_students.tenant_id = :tenantId
          AND scoped_students.class_id IN (SELECT id FROM classes WHERE tenant_id = :tenantId AND head_teacher_id = :scopeTeacherId)
      ))`,
      params: { tenantId, scopeTeacherId: teacherId }
    };
  }

  if (req.user.role === 'teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return { where: 'te.tenant_id = :tenantId AND tc.teacher_id = :scopeTeacherId', params: { tenantId, scopeTeacherId: teacherId } };
  }

  if (req.user.role === 'student') {
    const studentId = await getStudentIdForUser(req.user.id);
    if (!studentId) return { where: '1 = 0', params: {} };
    return {
      where: `te.tenant_id = :tenantId AND (EXISTS (
        SELECT 1 FROM students scoped_students
        WHERE scoped_students.tenant_id = :tenantId
          AND scoped_students.id = :scopeStudentId
          AND scoped_students.class_id = te.class_id
      ) OR EXISTS (
        SELECT 1 FROM teaching_class_students scoped_tcs
        WHERE scoped_tcs.student_id = :scopeStudentId AND scoped_tcs.teaching_class_id = te.teaching_class_id
      ))`,
      params: { tenantId, scopeStudentId: studentId }
    };
  }

  return { where: '1 = 0', params: {} };
}

async function examScoreScope(req) {
  const tenantId = currentTenantId(req);
  if (['admin', 'academic'].includes(req.user.role)) {
    return { where: 'e.tenant_id = :tenantId AND stu.tenant_id = :tenantId', params: { tenantId } };
  }

  if (req.user.role === 'head_teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return {
      where: 'e.tenant_id = :tenantId AND stu.tenant_id = :tenantId AND stu.class_id IN (SELECT id FROM classes WHERE tenant_id = :tenantId AND head_teacher_id = :scopeTeacherId)',
      params: { tenantId, scopeTeacherId: teacherId }
    };
  }

  if (req.user.role === 'teacher') {
    const teacherId = await getTeacherIdForUser(req.user.id);
    if (!teacherId) return { where: '1 = 0', params: {} };
    return {
      where: `e.tenant_id = :tenantId AND stu.tenant_id = :tenantId AND EXISTS (
        SELECT 1
        FROM teaching_class_students scoped_tcs
        JOIN teaching_classes scoped_tc ON scoped_tc.id = scoped_tcs.teaching_class_id
        WHERE scoped_tcs.student_id = stu.id
          AND scoped_tc.tenant_id = :tenantId
          AND scoped_tc.teacher_id = :scopeTeacherId
          AND scoped_tc.subject_code = es.subject_code
      )`,
      params: { tenantId, scopeTeacherId: teacherId }
    };
  }

  if (req.user.role === 'student') {
    return { where: 'e.tenant_id = :tenantId AND stu.tenant_id = :tenantId AND stu.user_id = :scopeUserId', params: { tenantId, scopeUserId: req.user.id } };
  }

  return { where: '1 = 0', params: {} };
}

async function assertHeadTeacherCanWriteStudent(req, { studentId, classId }) {
  if (req.user.role !== 'head_teacher') return;

  const teacherId = await getTeacherIdForUser(req.user.id);
  if (!teacherId) denyScopedAccess('当前班主任账号未绑定教师档案');
  const tenantId = currentTenantId(req);

  if (!classId) {
    denyScopedAccess('班主任新增或修改学生时必须指定本人负责的行政班');
  }

  const [ownedClass] = await query('SELECT id FROM classes WHERE id = :classId AND tenant_id = :tenantId AND head_teacher_id = :teacherId LIMIT 1', {
    classId,
    tenantId,
    teacherId
  });
  if (!ownedClass) denyScopedAccess('班主任只能维护本人负责行政班的学生');

  if (studentId) {
    const [student] = await query('SELECT id FROM students WHERE id = :studentId AND tenant_id = :tenantId AND class_id = :classId LIMIT 1', {
      studentId,
      tenantId,
      classId
    });
    if (!student) denyScopedAccess('班主任只能维护本人负责行政班的学生');
  }
}

async function assertTeacherCanWriteScore(req, { studentId, subjectCode }) {
  if (req.user.role !== 'teacher') return;

  const teacherId = await getTeacherIdForUser(req.user.id);
  if (!teacherId) denyScopedAccess('当前教师账号未绑定教师档案');
  const tenantId = currentTenantId(req);

  const [teachingClass] = await query(
    `SELECT tc.id
     FROM teaching_classes tc
     JOIN teaching_class_students tcs ON tcs.teaching_class_id = tc.id
     WHERE tc.teacher_id = :teacherId
       AND tc.tenant_id = :tenantId
       AND tc.subject_code = :subjectCode
       AND tcs.student_id = :studentId
     LIMIT 1`,
    { tenantId, teacherId, subjectCode, studentId }
  );

  if (!teachingClass) {
    denyScopedAccess('教师只能录入本人教学班学生的对应学科成绩');
  }
}

function conflictRow(type, message, row) {
  return {
    type,
    message,
    entryId: row.id,
    weekday: row.weekday,
    period: row.period,
    slotLabel: row.slotLabel,
    className: row.className,
    teachingClassName: row.teachingClassName,
    teacherName: row.teacherName,
    roomName: row.roomName
  };
}

function addConflict(conflicts, seen, conflict) {
  const key = `${conflict.type}:${conflict.entryId || conflict.message}`;
  if (seen.has(key)) return;
  seen.add(key);
  conflicts.push(conflict);
}

async function getTimetableSlot({ weekday, period }) {
  const [slot] = await query(
    `SELECT id, weekday, period, slot_type AS slotType, label, start_time AS startTime, end_time AS endTime
     FROM timetable_slots
     WHERE weekday = :weekday AND period = :period
     LIMIT 1`,
    { weekday, period }
  );
  return slot;
}

async function getTeachingClassForSchedule(teachingClassId, tenantId) {
  if (!teachingClassId) return null;
  const [teachingClass] = await query(
    `SELECT tc.id, tc.name, tc.grade_id AS gradeId, tc.subject_code AS subjectCode,
            tc.teacher_id AS teacherId, t.name AS teacherName, tc.room_id AS roomId,
            tc.campus_id AS campusId, tc.academic_year_id AS academicYearId
     FROM teaching_classes tc
     LEFT JOIN teachers t ON t.id = tc.teacher_id
     WHERE tc.id = :teachingClassId AND tc.tenant_id = :tenantId
     LIMIT 1`,
    { teachingClassId, tenantId }
  );
  return teachingClass || null;
}

async function getClassForSchedule(classId, tenantId) {
  if (!classId) return null;
  const [clazz] = await query(
    `SELECT id, name, campus_id AS campusId, academic_year_id AS academicYearId
     FROM classes
     WHERE id = :classId AND tenant_id = :tenantId
     LIMIT 1`,
    { classId, tenantId }
  );
  return clazz || null;
}

async function findTimetableConflicts({ tenantId, semester, slotId, classId, teachingClassId, roomId, ignoreEntryId = null }) {
  const conflicts = [];
  const seen = new Set();
  const params = {
    tenantId,
    semester,
    slotId,
    classId,
    teachingClassId,
    roomId,
    ignoreEntryId
  };
  const rowSelect = `SELECT te.id, ts.weekday, ts.period, COALESCE(ts.label, CONCAT('第', ts.period, '节')) AS slotLabel,
                           c.name AS className, tc.name AS teachingClassName, teacher.name AS teacherName, r.name AS roomName
                    FROM timetable_entries te
                    JOIN timetable_slots ts ON ts.id = te.slot_id
                    LEFT JOIN classes c ON c.id = te.class_id
                    LEFT JOIN teaching_classes tc ON tc.id = te.teaching_class_id
                    LEFT JOIN teachers teacher ON teacher.id = tc.teacher_id
                    LEFT JOIN rooms r ON r.id = te.room_id`;
  const sameSlot = `te.tenant_id = :tenantId
                    AND te.semester = :semester
                    AND te.slot_id = :slotId
                    AND (:ignoreEntryId IS NULL OR te.id <> :ignoreEntryId)`;

  if (classId) {
    const rows = await query(
      `${rowSelect}
       WHERE ${sameSlot} AND te.class_id = :classId`,
      params
    );
    rows.forEach((row) => addConflict(conflicts, seen, conflictRow('class', '同一行政班在该时段已有课程', row)));

    const studentRows = await query(
      `${rowSelect}
       JOIN teaching_class_students existing_tcs ON existing_tcs.teaching_class_id = te.teaching_class_id
       JOIN students existing_students ON existing_students.id = existing_tcs.student_id
       WHERE ${sameSlot}
         AND existing_students.tenant_id = :tenantId
         AND existing_students.class_id = :classId`,
      params
    );
    studentRows.forEach((row) => addConflict(conflicts, seen, conflictRow('student', '行政班学生在该时段已有教学班课程', row)));
  }

  if (teachingClassId) {
    const rows = await query(
      `${rowSelect}
       WHERE ${sameSlot} AND te.teaching_class_id = :teachingClassId`,
      params
    );
    rows.forEach((row) => addConflict(conflicts, seen, conflictRow('teaching_class', '同一教学班在该时段已有课程', row)));

    const teacherRows = await query(
      `${rowSelect}
       JOIN teaching_classes target_tc ON target_tc.id = :teachingClassId
       WHERE ${sameSlot}
         AND target_tc.tenant_id = :tenantId
         AND target_tc.teacher_id IS NOT NULL
         AND tc.teacher_id = target_tc.teacher_id`,
      params
    );
    teacherRows.forEach((row) => addConflict(conflicts, seen, conflictRow('teacher', '任课教师在该时段已有课程', row)));

    const studentRows = await query(
      `${rowSelect}
       JOIN teaching_class_students proposed_tcs ON proposed_tcs.teaching_class_id = :teachingClassId
       JOIN teaching_class_students existing_tcs ON existing_tcs.student_id = proposed_tcs.student_id
       WHERE ${sameSlot}
         AND existing_tcs.teaching_class_id = te.teaching_class_id`,
      params
    );
    studentRows.forEach((row) => addConflict(conflicts, seen, conflictRow('student', '教学班学生在该时段已有课程', row)));

    const classRows = await query(
      `${rowSelect}
       JOIN teaching_class_students proposed_tcs ON proposed_tcs.teaching_class_id = :teachingClassId
       JOIN students proposed_students ON proposed_students.id = proposed_tcs.student_id
       WHERE ${sameSlot}
         AND proposed_students.tenant_id = :tenantId
         AND te.class_id = proposed_students.class_id`,
      params
    );
    classRows.forEach((row) => addConflict(conflicts, seen, conflictRow('student', '教学班学生所属行政班在该时段已有课程', row)));
  }

  if (roomId) {
    const rows = await query(
      `${rowSelect}
       WHERE ${sameSlot} AND te.room_id = :roomId`,
      params
    );
    rows.forEach((row) => addConflict(conflicts, seen, conflictRow('room', '教室在该时段已被占用', row)));
  }

  return conflicts;
}

async function buildTimetableEntryPayload(body, req) {
  const classId = asNullable(body.classId);
  const teachingClassId = asNullable(body.teachingClassId);
  const org = orgContext(req, body);

  if (!classId && !teachingClassId) {
    throw new AppError('课表项必须选择行政班或教学班', 400, 'TIMETABLE_TARGET_REQUIRED');
  }

  const [slot, clazz, teachingClass] = await Promise.all([
    getTimetableSlot({ weekday: body.weekday, period: body.period }),
    getClassForSchedule(classId, org.tenantId),
    getTeachingClassForSchedule(teachingClassId, org.tenantId)
  ]);

  if (!slot) throw new AppError('课节不存在', 400, 'TIMETABLE_SLOT_NOT_FOUND');
  if (classId && !clazz) throw new AppError('行政班不存在', 400, 'CLASS_NOT_FOUND');
  if (teachingClassId && !teachingClass) throw new AppError('教学班不存在', 400, 'TEACHING_CLASS_NOT_FOUND');

  return {
    semester: body.semester,
    tenantId: org.tenantId,
    campusId: asPositiveId(body.campusId) || clazz?.campusId || teachingClass?.campusId || org.campusId,
    academicYearId: asPositiveId(body.academicYearId) || clazz?.academicYearId || teachingClass?.academicYearId || org.academicYearId,
    slot,
    classId,
    teachingClassId,
    roomId: asNullable(body.roomId) || teachingClass?.roomId || null,
    note: asNullable(body.note)
  };
}

async function insertTimetableEntry(payload) {
  const conflicts = await findTimetableConflicts({
    tenantId: payload.tenantId,
    semester: payload.semester,
    slotId: payload.slot.id,
    classId: payload.classId,
    teachingClassId: payload.teachingClassId,
    roomId: payload.roomId
  });

  if (conflicts.length) {
    throw new AppError('课表存在冲突', 409, 'TIMETABLE_CONFLICT', { conflicts });
  }

  const result = await query(
    `INSERT INTO timetable_entries
     (tenant_id, campus_id, academic_year_id, semester, slot_id, class_id, teaching_class_id, room_id, note)
     VALUES (:tenantId, :campusId, :academicYearId, :semester, :slotId, :classId, :teachingClassId, :roomId, :note)`,
    {
      tenantId: payload.tenantId,
      campusId: payload.campusId,
      academicYearId: payload.academicYearId,
      semester: payload.semester,
      slotId: payload.slot.id,
      classId: payload.classId,
      teachingClassId: payload.teachingClassId,
      roomId: payload.roomId,
      note: payload.note
    }
  );

  return result.insertId;
}

async function teacherDailyLoad({ tenantId, semester, teacherId, weekday }) {
  const [row] = await query(
    `SELECT COUNT(*) AS total
     FROM timetable_entries te
     JOIN timetable_slots ts ON ts.id = te.slot_id
     JOIN teaching_classes tc ON tc.id = te.teaching_class_id
     WHERE te.tenant_id = :tenantId
       AND te.semester = :semester
       AND ts.weekday = :weekday
       AND tc.teacher_id = :teacherId`,
    { tenantId, semester, teacherId, weekday }
  );
  return Number(row?.total || 0);
}

async function maybeNotifyAccountBySms(req, account, entity, targetId) {
  if (!config.sms.accountNotifyEnabled) return null;
  if (!account.notifyPhone) {
    return { status: 'skipped', reason: 'MISSING_PHONE' };
  }

  return sendSms({
    tenantId: currentTenantId(req),
    recipientPhone: account.notifyPhone,
    templateCode: account.action === 'created' ? 'account_initial_password' : 'account_reset_password',
    variables: {
      displayName: account.displayName,
      roleLabel: entity === 'teacher' ? '教师' : '学生',
      username: account.username,
      initialPassword: account.initialPassword
    },
    requestedBy: req.user.id,
    targetType: entity,
    targetId
  });
}

app.get('/api/auth/sso/config', (req, res) => {
  res.json(ssoConfigResponse());
});

app.get(
  '/api/auth/sso/:provider/start',
  asyncHandler(async (req, res) => {
    const { authorizationUrl } = buildOidcAuthorizationUrl({
      providerCode: req.params.provider,
      redirectTo: req.query.redirectTo || '/'
    });
    if (req.query.format === 'json') {
      return res.json({ authorizationUrl });
    }
    return res.redirect(authorizationUrl);
  })
);

app.get(
  '/api/auth/sso/:provider/callback',
  asyncHandler(async (req, res) => {
    requireFields(req.query, ['code', 'state']);
    const state = verifyOidcState(req.query.state, req.params.provider);
    const tokenSet = await exchangeOidcCode(req.params.provider, req.query.code);
    const profile = await fetchOidcProfile(req.params.provider, tokenSet.access_token);
    const externalUser = mapOidcProfile(req.params.provider, profile);
    const user = await resolveExternalUser(externalUser);

    if (user.must_change_password) {
      await query('UPDATE users SET must_change_password = 0, password_changed_at = NOW() WHERE id = :id', { id: user.id });
      user.must_change_password = 0;
    }

    await recordAuditLog(req, {
      eventType: 'auth',
      action: 'sso_login',
      outcome: 'success',
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      tenantId: user.tenantId,
      targetType: 'user',
      targetId: user.id,
      targetUsername: user.username,
      details: {
        providerCode: externalUser.providerCode,
        externalUsername: externalUser.username || null
      }
    });

    const appToken = signToken(user);
    const responseUser = userResponse(user);
    if (req.query.format === 'json') {
      return res.json({ token: appToken, user: responseUser });
    }
    res.type('html').send(ssoCallbackHtml({ token: appToken, user: responseUser, redirectTo: state.redirectTo }));
  })
);

app.post(
  '/api/auth/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['username', 'password']);
    const [user] = await query(
      `SELECT u.id, u.username, u.password_hash, u.display_name, u.role, u.enabled, u.must_change_password,
              u.tenant_id AS tenantId, tenant.name AS tenantName,
              u.campus_id AS campusId, campus.name AS campusName,
              u.academic_year_id AS academicYearId, ay.name AS academicYearName
       FROM users u
       LEFT JOIN tenants tenant ON tenant.id = u.tenant_id
       LEFT JOIN campuses campus ON campus.id = u.campus_id
       LEFT JOIN academic_years ay ON ay.id = u.academic_year_id
       WHERE u.username = :username`,
      { username: req.body.username }
    );

    if (!user || !user.enabled) {
      await recordAuditLog(req, {
        eventType: 'auth',
        action: 'login',
        outcome: 'failure',
        actorUsername: req.body.username,
        targetType: 'user',
        targetUsername: req.body.username,
        details: {
          reason: user ? 'disabled' : 'not_found'
        }
      });
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    const passwordOk = await bcrypt.compare(req.body.password, user.password_hash);
    if (!passwordOk) {
      await recordAuditLog(req, {
        eventType: 'auth',
        action: 'login',
        outcome: 'failure',
        actorUserId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        targetType: 'user',
        targetId: user.id,
        targetUsername: user.username,
        details: {
          reason: 'invalid_password'
        }
      });
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    await query('UPDATE users SET last_login_at = NOW() WHERE id = :id', { id: user.id });
    await recordAuditLog(req, {
      eventType: 'auth',
      action: 'login',
      outcome: 'success',
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      targetType: 'user',
      targetId: user.id,
      targetUsername: user.username,
      details: {
        mustChangePassword: Boolean(user.must_change_password)
      }
    });

    res.json({
      token: signToken(user),
      user: userResponse(user)
    });
  })
);

app.post(
  '/api/auth/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const [user] = await query(
      `SELECT u.id, u.username, u.password_hash, u.display_name, u.role, u.enabled, u.must_change_password,
              u.tenant_id AS tenantId, tenant.name AS tenantName,
              u.campus_id AS campusId, campus.name AS campusName,
              u.academic_year_id AS academicYearId, ay.name AS academicYearName
       FROM users u
       LEFT JOIN tenants tenant ON tenant.id = u.tenant_id
       LEFT JOIN campuses campus ON campus.id = u.campus_id
       LEFT JOIN academic_years ay ON ay.id = u.academic_year_id
       WHERE u.id = :id`,
      { id: req.user.id }
    );

    if (!user || !user.enabled) {
      return res.status(401).json({ message: '账号不可用' });
    }

    const currentOk = await bcrypt.compare(req.body.currentPassword, user.password_hash);
    if (!currentOk) {
      await recordAuditLog(req, {
        eventType: 'auth',
        action: 'change_password',
        outcome: 'failure',
        targetType: 'user',
        targetId: user.id,
        targetUsername: user.username,
        details: {
          reason: 'invalid_current_password'
        }
      });
      throw new AppError('当前密码不正确', 400, 'INVALID_CURRENT_PASSWORD');
    }

    const samePassword = await bcrypt.compare(req.body.newPassword, user.password_hash);
    if (samePassword) {
      await recordAuditLog(req, {
        eventType: 'auth',
        action: 'change_password',
        outcome: 'failure',
        targetType: 'user',
        targetId: user.id,
        targetUsername: user.username,
        details: {
          reason: 'password_reused'
        }
      });
      throw new AppError('新密码不能与当前密码相同', 400, 'PASSWORD_REUSED');
    }

    assertStrongPassword(req.body.newPassword);
    const passwordHash = await bcrypt.hash(req.body.newPassword, 10);

    await query(
      `UPDATE users
       SET password_hash = :passwordHash, must_change_password = 0, password_changed_at = NOW()
      WHERE id = :id`,
      { id: user.id, passwordHash }
    );
    await recordAuditLog(req, {
      eventType: 'auth',
      action: 'change_password',
      outcome: 'success',
      targetType: 'user',
      targetId: user.id,
      targetUsername: user.username,
      details: {
        previousMustChangePassword: Boolean(user.must_change_password)
      }
    });

    const updatedUser = {
      ...user,
      password_hash: passwordHash,
      must_change_password: 0
    };

    res.json({
      token: signToken(updatedUser),
      user: userResponse(updatedUser)
    });
  })
);

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: userResponse(req.user) });
});

app.use('/api', requireAuth, requirePasswordReady);

app.get(
  '/api/audit-logs',
  requirePermission('audit_logs.read'),
  asyncHandler(async (req, res) => {
    const pagination = paginationFromQuery(req, { defaultPageSize: 50, maxPageSize: 200 });
    const order = orderByFromQuery(
      req,
      {
        id: 'id',
        createdAt: 'created_at',
        eventType: 'event_type',
        action: 'action',
        outcome: 'outcome',
        actorUsername: 'actor_username',
        targetUsername: 'target_username',
        ipAddress: 'ip_address'
      },
      { key: 'id', order: 'desc' }
    );
    const filters = ['tenant_id = :tenantId'];
    const params = { tenantId: currentTenantId(req) };

    if (req.query.q) {
      appendFilter(
        filters,
        params,
        `(actor_username LIKE :q OR target_username LIKE :q OR target_id LIKE :q OR action LIKE :q
          OR event_type LIKE :q OR ip_address LIKE :q OR request_id LIKE :q)`,
        { q: likeParam(req.query.q) }
      );
    }
    if (req.query.eventType) appendFilter(filters, params, 'event_type = :eventType', { eventType: req.query.eventType });
    if (req.query.action) appendFilter(filters, params, 'action = :action', { action: req.query.action });
    if (req.query.outcome) appendFilter(filters, params, 'outcome = :outcome', { outcome: req.query.outcome });
    if (req.query.actorUsername) appendFilter(filters, params, 'actor_username LIKE :actorUsername', { actorUsername: likeParam(req.query.actorUsername) });
    if (req.query.targetType) appendFilter(filters, params, 'target_type = :targetType', { targetType: req.query.targetType });
    if (req.query.targetUsername) appendFilter(filters, params, 'target_username LIKE :targetUsername', { targetUsername: likeParam(req.query.targetUsername) });
    if (req.query.ipAddress) appendFilter(filters, params, 'ip_address = :ipAddress', { ipAddress: req.query.ipAddress });
    if (isDateLike(req.query.from)) appendFilter(filters, params, 'created_at >= :fromDate', { fromDate: `${req.query.from} 00:00:00` });
    if (isDateLike(req.query.to)) appendFilter(filters, params, 'created_at <= :toDate', { toDate: `${req.query.to} 23:59:59` });

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRows = await query(`SELECT COUNT(*) AS total FROM audit_logs ${where}`, params);
    const rows = await query(
      `SELECT id, event_type AS eventType, action, outcome,
              actor_user_id AS actorUserId, actor_username AS actorUsername, actor_role AS actorRole,
              target_type AS targetType, target_id AS targetId, target_username AS targetUsername,
              ip_address AS ipAddress, user_agent AS userAgent, request_id AS requestId,
              details, created_at AS createdAt
       FROM audit_logs
       ${where}
       ORDER BY ${order.sql}, id DESC
       ${limitClause(pagination)}`,
      params
    );

    await recordAuditLog(req, {
      eventType: 'audit',
      action: 'audit_log_read',
      outcome: 'success',
      targetType: 'audit_logs',
      details: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        filters: {
          q: req.query.q || null,
          eventType: req.query.eventType || null,
          action: req.query.action || null,
          outcome: req.query.outcome || null,
          from: req.query.from || null,
          to: req.query.to || null
        }
      }
    });

    res.json(pagedResponse(rows, Number(countRows[0]?.total || 0), pagination, order));
  })
);

app.get(
  '/api/audit-alerts',
  requirePermission('audit_alerts.read'),
  asyncHandler(async (req, res) => {
    const pagination = paginationFromQuery(req, { defaultPageSize: 50, maxPageSize: 200 });
    const order = orderByFromQuery(
      req,
      {
        id: 'id',
        alertType: 'alert_type',
        severity: 'severity',
        status: 'status',
        eventCount: 'event_count',
        firstSeenAt: 'first_seen_at',
        lastSeenAt: 'last_seen_at'
      },
      { key: 'lastSeenAt', order: 'desc' }
    );
    const allowedStatuses = new Set(['open', 'acknowledged', 'closed']);
    const allowedSeverities = new Set(['info', 'warning', 'critical']);
    const filters = ['tenant_id = :tenantId'];
    const params = { tenantId: currentTenantId(req) };
    const status = allowedStatuses.has(req.query.status) ? req.query.status : req.query.status === 'all' ? null : 'open';

    if (status) appendFilter(filters, params, 'status = :status', { status });
    if (allowedSeverities.has(req.query.severity)) {
      appendFilter(filters, params, 'severity = :severity', { severity: req.query.severity });
    }
    if (req.query.alertType) appendFilter(filters, params, 'alert_type = :alertType', { alertType: req.query.alertType });
    if (req.query.q) {
      appendFilter(
        filters,
        params,
        '(alert_type LIKE :q OR actor_username LIKE :q OR target_username LIKE :q OR target_id LIKE :q OR ip_address LIKE :q OR disposition_note LIKE :q)',
        { q: likeParam(req.query.q) }
      );
    }
    if (isDateLike(req.query.from)) appendFilter(filters, params, 'last_seen_at >= :fromDate', { fromDate: `${req.query.from} 00:00:00` });
    if (isDateLike(req.query.to)) appendFilter(filters, params, 'last_seen_at <= :toDate', { toDate: `${req.query.to} 23:59:59` });

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRows = await query(`SELECT COUNT(*) AS total FROM audit_alerts ${where}`, params);
    const rows = await query(
      `SELECT id, alert_type AS alertType, severity, status, dedupe_key AS dedupeKey,
              event_count AS eventCount, actor_user_id AS actorUserId,
              actor_username AS actorUsername, target_type AS targetType,
              target_id AS targetId, target_username AS targetUsername,
              ip_address AS ipAddress, window_started_at AS windowStartedAt,
              window_ended_at AS windowEndedAt, details,
              first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt,
              acknowledged_by AS acknowledgedBy, acknowledged_at AS acknowledgedAt,
              disposition_note AS dispositionNote, resolved_by AS resolvedBy, resolved_at AS resolvedAt
       FROM audit_alerts
       ${where}
       ORDER BY ${order.sql}, id DESC
       ${limitClause(pagination)}`,
      params
    );

    await recordAuditLog(req, {
      eventType: 'audit',
      action: 'audit_alert_read',
      outcome: 'success',
      targetType: 'audit_alerts',
      details: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        status: status || 'all',
        severity: req.query.severity || null,
        alertType: req.query.alertType || null,
        q: req.query.q || null
      }
    });

    res.json(pagedResponse(rows, Number(countRows[0]?.total || 0), pagination, order));
  })
);

app.post(
  '/api/audit-alerts/:id/acknowledge',
  requirePermission('audit_alerts.acknowledge'),
  asyncHandler(async (req, res) => {
    const result = await query(
      `UPDATE audit_alerts
       SET status = 'acknowledged', acknowledged_by = :userId, acknowledged_at = NOW(),
           disposition_note = :note
       WHERE id = :id AND tenant_id = :tenantId AND status = 'open'`,
      { id: req.params.id, userId: req.user.id, note: asNullable(req.body?.note), tenantId: currentTenantId(req) }
    );

    await recordAuditLog(req, {
      eventType: 'audit',
      action: 'audit_alert_acknowledge',
      outcome: result.affectedRows ? 'success' : 'failure',
      targetType: 'audit_alert',
      targetId: req.params.id
    });

    res.json({ ok: Boolean(result.affectedRows) });
  })
);

app.post(
  '/api/audit-alerts/:id/dispose',
  requirePermission('audit_alerts.acknowledge'),
  asyncHandler(async (req, res) => {
    const allowedStatuses = new Set(['open', 'acknowledged', 'closed']);
    const allowedSeverities = new Set(['info', 'warning', 'critical']);
    const status = allowedStatuses.has(req.body.status) ? req.body.status : null;
    const severity = allowedSeverities.has(req.body.severity) ? req.body.severity : null;
    const note = asNullable(req.body.note);

    if (!status && !severity && !note) {
      throw new AppError('至少需要提供状态、等级或处置备注', 400, 'INVALID_ALERT_DISPOSITION');
    }

    const result = await query(
      `UPDATE audit_alerts
       SET
         status = COALESCE(:status, status),
         severity = COALESCE(:severity, severity),
         disposition_note = COALESCE(:note, disposition_note),
         acknowledged_by = CASE
           WHEN :statusForAck = 'acknowledged' THEN :userId
           ELSE acknowledged_by
         END,
         acknowledged_at = CASE
           WHEN :statusForAck = 'acknowledged' THEN NOW()
           ELSE acknowledged_at
         END,
         resolved_by = CASE
           WHEN :statusForResolve = 'closed' THEN :userId
           WHEN :statusForResolve = 'open' THEN NULL
           ELSE resolved_by
         END,
         resolved_at = CASE
           WHEN :statusForResolve = 'closed' THEN NOW()
           WHEN :statusForResolve = 'open' THEN NULL
           ELSE resolved_at
         END
       WHERE id = :id AND tenant_id = :tenantId`,
      {
        id: req.params.id,
        tenantId: currentTenantId(req),
        userId: req.user.id,
        status,
        statusForAck: status,
        statusForResolve: status,
        severity,
        note
      }
    );

    await recordAuditLog(req, {
      eventType: 'audit',
      action: 'audit_alert_dispose',
      outcome: result.affectedRows ? 'success' : 'failure',
      targetType: 'audit_alert',
      targetId: req.params.id,
      details: {
        status,
        severity,
        note
      }
    });

    res.json({ ok: Boolean(result.affectedRows) });
  })
);

app.get(
  '/api/sms/messages',
  requirePermission('sms_messages.read'),
  asyncHandler(async (req, res) => {
    const pagination = paginationFromQuery(req, { defaultPageSize: 50, maxPageSize: 200 });
    const order = orderByFromQuery(
      req,
      {
        id: 'id',
        createdAt: 'created_at',
        sentAt: 'sent_at',
        status: 'status',
        recipientPhone: 'recipient_phone',
        templateCode: 'template_code'
      },
      { key: 'id', order: 'desc' }
    );
    const allowedStatuses = new Set(['queued', 'sent', 'failed', 'skipped']);
    const result = await listSmsMessages({
      tenantId: currentTenantId(req),
      filters: {
        status: allowedStatuses.has(req.query.status) ? req.query.status : null,
        q: req.query.q || null
      },
      pagination,
      order
    });

    await recordAuditLog(req, {
      eventType: 'notification',
      action: 'sms_message_read',
      outcome: 'success',
      targetType: 'sms_messages',
      details: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        status: req.query.status || null,
        q: req.query.q || null
      }
    });

    res.json(pagedResponse(result.rows, result.total, pagination, order));
  })
);

app.post(
  '/api/sms/send',
  requirePermission('sms_messages.send'),
  validateBody(smsSendSchema),
  asyncHandler(async (req, res) => {
    if (!req.body.templateCode && !req.body.message) {
      throw new AppError('短信发送必须提供模板代码或短信内容', 400, 'SMS_CONTENT_REQUIRED');
    }

    const result = await sendSms({
      tenantId: currentTenantId(req),
      recipientPhone: req.body.recipientPhone,
      templateCode: asNullable(req.body.templateCode),
      message: asNullable(req.body.message),
      variables: req.body.variables || {},
      requestedBy: req.user.id,
      targetType: asNullable(req.body.targetType),
      targetId: asNullable(req.body.targetId)
    });

    await recordAuditLog(req, {
      eventType: 'notification',
      action: 'sms_send',
      outcome: result.status === 'failed' ? 'failure' : 'success',
      targetType: 'sms_message',
      targetId: result.id,
      details: {
        status: result.status,
        provider: result.provider || config.sms.provider,
        templateCode: req.body.templateCode || null,
        targetType: req.body.targetType || null,
        targetId: req.body.targetId || null
      }
    });

    res.status(result.status === 'failed' ? 502 : 201).json(result);
  })
);

app.get(
  '/api/dashboard',
  requirePermission('dashboard.read'),
  asyncHandler(async (req, res) => {
    const tenantId = currentTenantId(req);
    const [
      [students],
      [teachers],
      [classes],
      [teachingClasses],
      comboRows,
      gradeRows,
      examRows,
      announcements
    ] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM students WHERE tenant_id = :tenantId AND status = "在读"', { tenantId }),
      query('SELECT COUNT(*) AS total FROM teachers WHERE tenant_id = :tenantId AND status = "active"', { tenantId }),
      query('SELECT COUNT(*) AS total FROM classes WHERE tenant_id = :tenantId', { tenantId }),
      query('SELECT COUNT(*) AS total FROM teaching_classes WHERE tenant_id = :tenantId', { tenantId }),
      query(
        `SELECT sc.label, COUNT(s.id) AS count
         FROM subject_combinations sc
         LEFT JOIN students s ON s.subject_combo_id = sc.id AND s.tenant_id = :tenantId AND s.status = '在读'
         WHERE sc.tenant_id = :tenantId
         GROUP BY sc.id
         HAVING count > 0
         ORDER BY count DESC, sc.label ASC
         LIMIT 8`,
        { tenantId }
      ),
      query(
        `SELECT g.name, COUNT(s.id) AS students
         FROM grades g
         LEFT JOIN students s ON s.grade_id = g.id AND s.tenant_id = :tenantId AND s.status = '在读'
         WHERE g.tenant_id = :tenantId
         GROUP BY g.id
         ORDER BY g.entry_year DESC`,
        { tenantId }
      ),
      query(
        `SELECT e.id, e.name, e.exam_type AS examType, e.exam_date AS examDate, g.name AS gradeName,
                ROUND(AVG(es.raw_score), 1) AS averageScore
         FROM exams e
         JOIN grades g ON g.id = e.grade_id
         LEFT JOIN exam_scores es ON es.exam_id = e.id
         WHERE e.tenant_id = :tenantId
         GROUP BY e.id
         ORDER BY e.exam_date DESC
         LIMIT 5`,
        { tenantId }
      ),
      query(
        `SELECT title, content, target_role AS targetRole, published_at AS publishedAt
         FROM announcements
         WHERE tenant_id = :tenantId AND target_role IN ('all', :role)
         ORDER BY published_at DESC
         LIMIT 5`,
        { tenantId, role: req.user.role }
      )
    ]);

    res.json({
      stats: {
        students: students.total,
        teachers: teachers.total,
        classes: classes.total,
        teachingClasses: teachingClasses.total
      },
      combos: comboRows,
      grades: gradeRows,
      exams: examRows,
      announcements
    });
  })
);

app.get(
  '/api/analytics/dashboard',
  requirePermission('analytics.read'),
  asyncHandler(async (req, res) => {
    const tenantId = currentTenantId(req);
    const studentFilters = [];
    const studentParams = {};
    appendAnalyticsStudentFilters(studentFilters, studentParams, req, 's');
    const studentWhere = `WHERE ${studentFilters.join(' AND ')}`;
    const scoreFilters = ['e.tenant_id = :tenantId'];
    const scoreParams = { tenantId };
    if (req.query.academicYearId) appendFilter(scoreFilters, scoreParams, 'e.academic_year_id = :academicYearId', { academicYearId: req.query.academicYearId });
    if (req.query.gradeId) appendFilter(scoreFilters, scoreParams, 'e.grade_id = :gradeId', { gradeId: req.query.gradeId });
    if (req.query.campusId) appendFilter(scoreFilters, scoreParams, 's.campus_id = :campusId', { campusId: req.query.campusId });
    if (req.query.classId) appendFilter(scoreFilters, scoreParams, 's.class_id = :classId', { classId: req.query.classId });
    const scoreWhere = `WHERE ${scoreFilters.join(' AND ')}`;

    const [statusDistribution, campusDistribution, gradeAverages, subjectAverages, [scoreSummary], recentScoreBands] = await Promise.all([
      query(
        `SELECT s.status, COUNT(*) AS total
         FROM students s
         ${studentWhere}
         GROUP BY s.status
         ORDER BY total DESC`,
        studentParams
      ),
      query(
        `SELECT campus.id AS campusId, campus.name AS campusName,
                COUNT(DISTINCT s.id) AS students,
                COUNT(DISTINCT c.id) AS classes
         FROM campuses campus
         LEFT JOIN students s ON s.campus_id = campus.id AND s.tenant_id = :tenantId AND s.status = '在读'
         LEFT JOIN classes c ON c.campus_id = campus.id AND c.tenant_id = :tenantId
         WHERE campus.tenant_id = :tenantId
         GROUP BY campus.id
         ORDER BY students DESC, campus.name ASC`,
        { tenantId }
      ),
      query(
        `SELECT g.id AS gradeId, g.name AS gradeName, ROUND(AVG(es.raw_score), 1) AS averageScore,
                COUNT(es.id) AS scoreCount
         FROM grades g
         LEFT JOIN exams e ON e.grade_id = g.id AND e.tenant_id = :tenantId
         LEFT JOIN exam_scores es ON es.exam_id = e.id
         WHERE g.tenant_id = :tenantId
         GROUP BY g.id
         ORDER BY g.entry_year DESC`,
        { tenantId }
      ),
      query(
        `SELECT subj.code AS subjectCode, subj.name AS subjectName,
                ROUND(AVG(es.raw_score), 1) AS averageScore,
                COUNT(es.id) AS scoreCount
         FROM subjects subj
         JOIN exam_scores es ON es.subject_code = subj.code
         JOIN exams e ON e.id = es.exam_id
         JOIN students s ON s.id = es.student_id AND s.tenant_id = :tenantId
         ${scoreWhere}
         GROUP BY subj.code, subj.name
         ORDER BY averageScore DESC, subj.id ASC
         LIMIT 12`,
        scoreParams
      ),
      query(
        `SELECT COUNT(DISTINCT e.id) AS examCount,
                COUNT(es.id) AS scoreCount,
                ROUND(AVG(es.raw_score), 1) AS averageScore,
                ROUND(MAX(es.raw_score), 1) AS highestScore,
                ROUND(MIN(es.raw_score), 1) AS lowestScore
         FROM exams e
         LEFT JOIN exam_scores es ON es.exam_id = e.id
         LEFT JOIN students s ON s.id = es.student_id AND s.tenant_id = :tenantId
         ${scoreWhere}`,
        scoreParams
      ),
      query(
        `SELECT
           SUM(CASE WHEN es.raw_score >= 90 THEN 1 ELSE 0 END) AS excellent,
           SUM(CASE WHEN es.raw_score >= 60 AND es.raw_score < 90 THEN 1 ELSE 0 END) AS passed,
           SUM(CASE WHEN es.raw_score < 60 THEN 1 ELSE 0 END) AS needSupport
         FROM exams e
         JOIN exam_scores es ON es.exam_id = e.id
         JOIN students s ON s.id = es.student_id AND s.tenant_id = :tenantId
         ${scoreWhere}`,
        scoreParams
      )
    ]);

    res.json({
      scoreSummary: {
        examCount: Number(scoreSummary?.examCount || 0),
        scoreCount: Number(scoreSummary?.scoreCount || 0),
        averageScore: scoreSummary?.averageScore,
        highestScore: scoreSummary?.highestScore,
        lowestScore: scoreSummary?.lowestScore
      },
      statusDistribution: statusDistribution.map((row) => ({ ...row, total: Number(row.total || 0) })),
      campusDistribution: campusDistribution.map((row) => ({
        ...row,
        students: Number(row.students || 0),
        classes: Number(row.classes || 0)
      })),
      gradeAverages: gradeAverages.map((row) => ({ ...row, scoreCount: Number(row.scoreCount || 0) })),
      subjectAverages: subjectAverages.map((row) => ({ ...row, scoreCount: Number(row.scoreCount || 0) })),
      scoreBands: {
        excellent: Number(recentScoreBands[0]?.excellent || 0),
        passed: Number(recentScoreBands[0]?.passed || 0),
        needSupport: Number(recentScoreBands[0]?.needSupport || 0)
      }
    });
  })
);

app.get(
  '/api/analytics/score-trends',
  requirePermission('analytics.read'),
  asyncHandler(async (req, res) => {
    const tenantId = currentTenantId(req);
    const filters = ['e.tenant_id = :tenantId', 'stu.tenant_id = :tenantId'];
    const params = { tenantId };

    if (req.query.gradeId) appendFilter(filters, params, 'e.grade_id = :gradeId', { gradeId: req.query.gradeId });
    if (req.query.classId) appendFilter(filters, params, 'stu.class_id = :classId', { classId: req.query.classId });
    if (req.query.studentId) appendFilter(filters, params, 'stu.id = :studentId', { studentId: req.query.studentId });
    if (req.query.subjectCode) appendFilter(filters, params, 'es.subject_code = :subjectCode', { subjectCode: req.query.subjectCode });
    if (req.query.examType) appendFilter(filters, params, 'e.exam_type = :examType', { examType: req.query.examType });
    if (req.query.academicYearId) appendFilter(filters, params, 'e.academic_year_id = :academicYearId', { academicYearId: req.query.academicYearId });
    if (req.query.campusId) appendFilter(filters, params, 'stu.campus_id = :campusId', { campusId: req.query.campusId });

    const rows = await query(
      `SELECT e.id AS examId, e.name AS examName, e.semester, e.exam_date AS examDate,
              e.exam_type AS examType, g.name AS gradeName,
              es.subject_code AS subjectCode, subj.name AS subjectName,
              ROUND(AVG(es.raw_score), 1) AS averageScore,
              ROUND(MIN(es.raw_score), 1) AS lowestScore,
              ROUND(MAX(es.raw_score), 1) AS highestScore,
              COUNT(es.id) AS scoreCount
       FROM exam_scores es
       JOIN exams e ON e.id = es.exam_id
       JOIN students stu ON stu.id = es.student_id
       JOIN grades g ON g.id = e.grade_id
       JOIN subjects subj ON subj.code = es.subject_code
       WHERE ${filters.join(' AND ')}
       GROUP BY e.id, es.subject_code
       ORDER BY e.exam_date ASC, e.id ASC, subj.id ASC
       LIMIT 200`,
      params
    );

    res.json(rows.map((row) => ({ ...row, scoreCount: Number(row.scoreCount || 0) })));
  })
);

app.get(
  '/api/analytics/subject-combo-predictions',
  requirePermission('analytics.read'),
  asyncHandler(async (req, res) => {
    const tenantId = currentTenantId(req);
    const filters = [];
    const params = {};
    appendAnalyticsStudentFilters(filters, params, req, 's');
    appendFilter(filters, params, "s.status = '在读'");

    const rows = await query(
      `SELECT sc.id AS comboId, sc.combination_key AS combinationKey, sc.label,
              sc.preferred_subject AS preferredSubject, sc.elective_subjects AS electiveSubjects,
              COUNT(s.id) AS currentStudents
       FROM subject_combinations sc
       LEFT JOIN students s ON s.subject_combo_id = sc.id AND ${filters.join(' AND ')}
       WHERE sc.tenant_id = :tenantId
       GROUP BY sc.id
       ORDER BY currentStudents DESC, sc.preferred_subject DESC, sc.label`,
      { ...params, tenantId }
    );
    const [totals] = await query(
      `SELECT COUNT(*) AS totalStudents,
              SUM(CASE WHEN subject_combo_id IS NULL THEN 1 ELSE 0 END) AS unselectedStudents,
              SUM(CASE WHEN subject_combo_id IS NOT NULL THEN 1 ELSE 0 END) AS selectedStudents
       FROM students s
       WHERE ${filters.join(' AND ')}`,
      params
    );

    const totalStudents = Number(totals?.totalStudents || 0);
    const unselectedStudents = Number(totals?.unselectedStudents || 0);
    const selectedStudents = Number(totals?.selectedStudents || 0);
    const smoothingBase = selectedStudents + rows.length;
    const predictions = rows.map((row) => {
      const currentStudents = Number(row.currentStudents || 0);
      const projectedAdditional = smoothingBase > 0 ? Math.round(unselectedStudents * ((currentStudents + 1) / smoothingBase)) : 0;
      const projectedStudents = currentStudents + projectedAdditional;
      const share = totalStudents > 0 ? projectedStudents / totalStudents : 0;
      const suggestedTeachingClasses = Math.ceil(projectedStudents / 45);
      return {
        ...row,
        currentStudents,
        projectedStudents,
        projectedAdditional,
        share: Number((share * 100).toFixed(1)),
        suggestedTeachingClasses,
        confidence: selectedStudents >= 30 ? 'high' : selectedStudents >= 10 ? 'medium' : 'low',
        riskLevel: predictionRiskLevel({ projectedStudents, share, suggestedTeachingClasses })
      };
    });

    res.json({
      summary: {
        totalStudents,
        selectedStudents,
        unselectedStudents,
        method: '基于当前选科人数，并对未选科学生按拉普拉斯平滑比例分配'
      },
      items: predictions
    });
  })
);

app.get(
  '/api/meta',
  requirePermission('meta.read'),
  asyncHandler(async (req, res) => {
    const tenantId = currentTenantId(req);
    const [[tenant], campuses, academicYears, grades, subjects, combinations, rooms, timetableSlots] = await Promise.all([
      query('SELECT id, code, name, status FROM tenants WHERE id = :tenantId LIMIT 1', { tenantId }),
      query(
        `SELECT id, code, name, address, status
         FROM campuses
         WHERE tenant_id = :tenantId AND status = 'active'
         ORDER BY name`,
        { tenantId }
      ),
      query(
        `SELECT id, name, start_date AS startDate, end_date AS endDate, status, is_current AS isCurrent
         FROM academic_years
         WHERE tenant_id = :tenantId
         ORDER BY start_date DESC`,
        { tenantId }
      ),
      listGrades(req),
      query('SELECT code, name, category, gaokao_role AS gaokaoRole FROM subjects ORDER BY FIELD(category, "required", "preferred", "elective"), id'),
      query(
        `SELECT id, combination_key AS combinationKey, label, preferred_subject AS preferredSubject,
                elective_subjects AS electiveSubjects
         FROM subject_combinations
         WHERE tenant_id = :tenantId
         ORDER BY preferred_subject DESC, label`,
        { tenantId }
      ),
      query(
        `SELECT id, name, building, capacity, room_type AS roomType, campus_id AS campusId
         FROM rooms
         WHERE tenant_id = :tenantId
         ORDER BY name`,
        { tenantId }
      ),
      query(
        `SELECT id, weekday, period, slot_type AS slotType, COALESCE(label, CONCAT('第', period, '节')) AS label,
                start_time AS startTime, end_time AS endTime
         FROM timetable_slots
         ORDER BY weekday, period`
      )
    ]);
    res.json({
      tenant: tenant || { id: tenantId, name: '默认学校' },
      campuses,
      academicYears,
      currentCampusId: currentCampusId(req),
      currentAcademicYearId: currentAcademicYearId(req),
      grades,
      subjects,
      combinations,
      rooms,
      timetableSlots
    });
  })
);

app.get(
  '/api/teachers',
  requirePermission('teachers.read'),
  asyncHandler(async (req, res) => {
    const pagination = paginationFromQuery(req);
    const order = orderByFromQuery(
      req,
      {
        id: 't.id',
        employeeNo: 't.employee_no',
        name: 't.name',
        subject: 's.name',
        status: 't.status'
      },
      { key: 'id', order: 'desc' }
    );
    const filters = [];
    const params = {};
    appendOrgFilters(filters, params, req, 't', { campus: true });

    if (req.query.q) {
      appendFilter(filters, params, '(t.employee_no LIKE :q OR t.name LIKE :q OR t.phone LIKE :q OR t.email LIKE :q)', {
        q: likeParam(req.query.q)
      });
    }
    if (req.query.subjectCode) {
      appendFilter(filters, params, 't.subject_code = :subjectCode', { subjectCode: req.query.subjectCode });
    }
    if (req.query.status) {
      appendFilter(filters, params, 't.status = :status', { status: req.query.status });
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRows = await query(
      `SELECT COUNT(*) AS total
       FROM teachers t
       JOIN subjects s ON s.code = t.subject_code
       ${where}`,
      params
    );
    const rows = await query(
      `SELECT t.id, t.employee_no AS employeeNo, t.name, t.gender, t.subject_code AS subjectCode,
              s.name AS subjectName, t.campus_id AS campusId, campus.name AS campusName,
              t.title, t.phone, t.email, t.status,
              t.user_id AS userId, u.username AS accountUsername, u.enabled AS accountEnabled,
              u.must_change_password AS accountMustChangePassword
       FROM teachers t
       JOIN subjects s ON s.code = t.subject_code
       LEFT JOIN campuses campus ON campus.id = t.campus_id
       LEFT JOIN users u ON u.id = t.user_id
       ${where}
       ORDER BY ${order.sql}, t.id DESC
       ${limitClause(pagination)}`,
      params
    );
    const withDuties = await attachTeacherDuties(rows, currentTenantId(req));
    const items = hideAccountFields(withDuties, req.user.role, 'accounts.issue_teacher');
    res.json(pagedResponse(items, Number(countRows[0]?.total || 0), pagination, order));
  })
);

app.get(
  '/api/teacher-duties',
  requirePermission('teachers.read'),
  asyncHandler(async (req, res) => {
    const duties = await listTeacherDuties({
      tenantId: currentTenantId(req),
      filters: {
        teacherId: req.query.teacherId,
        roleType: req.query.roleType,
        gradeId: req.query.gradeId,
        subjectCode: req.query.subjectCode,
        classId: req.query.classId,
        teachingClassId: req.query.teachingClassId,
        campusId: req.query.campusId,
        academicYearId: req.query.academicYearId
      }
    });
    res.json(duties);
  })
);

app.post(
  '/api/teacher-duties',
  requirePermission('teachers.write'),
  validateBody(teacherDutySchema),
  asyncHandler(async (req, res) => {
    const duty = await resolveTeacherDutyContext(req, req.body);
    const id = await replaceTeacherDuty(duty);
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'teacher_duty_upsert',
      outcome: 'success',
      targetType: 'teacher_duty',
      targetId: id,
      details: { duty }
    });
    const [created] = await listTeacherDuties({ tenantId: currentTenantId(req), filters: { id } });
    res.status(201).json({ id, duty: created });
  })
);

app.delete(
  '/api/teacher-duties/:id',
  requirePermission('teachers.write'),
  asyncHandler(async (req, res) => {
    const tenantId = currentTenantId(req);
    const [duty] = await query(
      `SELECT id, teacher_id AS teacherId, role_type AS roleType, class_id AS classId, teaching_class_id AS teachingClassId
       FROM teacher_duties
       WHERE id = :id AND tenant_id = :tenantId
       LIMIT 1`,
      { id: req.params.id, tenantId }
    );
    if (!duty) return res.status(404).json({ message: '教师职务不存在' });

    if (duty.roleType === 'head_teacher' && duty.classId) {
      await query(
        `UPDATE classes
         SET head_teacher_id = NULL
         WHERE id = :classId AND tenant_id = :tenantId AND head_teacher_id = :teacherId`,
        { tenantId, classId: duty.classId, teacherId: duty.teacherId }
      );
    }
    if (duty.roleType === 'course_teacher' && duty.teachingClassId) {
      await query(
        `UPDATE teaching_classes
         SET teacher_id = NULL
         WHERE id = :teachingClassId AND tenant_id = :tenantId AND teacher_id = :teacherId`,
        { tenantId, teachingClassId: duty.teachingClassId, teacherId: duty.teacherId }
      );
    }

    await query('DELETE FROM teacher_duties WHERE id = :id AND tenant_id = :tenantId', { id: req.params.id, tenantId });
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'teacher_duty_delete',
      outcome: 'success',
      targetType: 'teacher_duty',
      targetId: req.params.id,
      details: { duty }
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/teachers/template',
  requirePermission('teachers.bulk'),
  asyncHandler(async (req, res) => {
    const buffer = await teacherTemplateWorkbook();
    sendExcel(res, '教师导入模板.xlsx', buffer);
  })
);

app.get(
  '/api/teachers/export',
  requirePermission('teachers.bulk'),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT t.employee_no AS employeeNo, t.name, t.gender, t.subject_code AS subjectCode,
              s.name AS subjectName, campus.name AS campusName, t.title, t.phone, t.email, t.status
       FROM teachers t
       JOIN subjects s ON s.code = t.subject_code
       LEFT JOIN campuses campus ON campus.id = t.campus_id
       WHERE t.tenant_id = :tenantId
       ORDER BY t.id DESC`,
      { tenantId: currentTenantId(req) }
    );
    const buffer = await teacherExportWorkbook(rows);
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'teacher_export',
      outcome: 'success',
      targetType: 'teacher',
      details: { count: rows.length }
    });
    sendExcel(res, '教师档案.xlsx', buffer);
  })
);

app.post(
  '/api/teachers/import',
  requirePermission('teachers.bulk'),
  asyncHandler(async (req, res) => {
    const dryRun = shouldDryRun(req);
    const buffer = await readRawBody(req);
    const result = await validateTeacherWorkbook(buffer, orgContext(req));

    if (result.report.invalid > 0 || dryRun) {
      if (!dryRun && result.report.invalid > 0) {
        return res.status(400).json(result.report);
      }
      return res.json(result.report);
    }

    const imported = await applyTeacherImport(result.validRows, orgContext(req));
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'teacher_bulk_import',
      outcome: 'success',
      targetType: 'teacher',
      details: {
        total: result.report.total,
        created: imported.created,
        updated: imported.updated
      }
    });
    return res.status(201).json({ ...result.report, imported });
  })
);

app.post(
  '/api/teachers',
  requirePermission('teachers.write'),
  validateBody(teacherSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['employeeNo', 'name', 'subjectCode']);
    const org = orgContext(req, req.body);
    const result = await query(
      `INSERT INTO teachers (tenant_id, campus_id, employee_no, name, gender, subject_code, title, phone, email, status)
       VALUES (:tenantId, :campusId, :employeeNo, :name, :gender, :subjectCode, :title, :phone, :email, :status)`,
      {
        ...org,
        employeeNo: req.body.employeeNo,
        name: req.body.name,
        gender: asNullable(req.body.gender),
        subjectCode: req.body.subjectCode,
        title: asNullable(req.body.title),
        phone: asNullable(req.body.phone),
        email: asNullable(req.body.email),
        status: req.body.status || 'active'
      }
    );
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'teacher_create',
      outcome: 'success',
      targetType: 'teacher',
      targetId: result.insertId,
      details: {
        teacher: req.body
      }
    });
    res.status(201).json({ id: result.insertId });
  })
);

app.put(
  '/api/teachers/:id',
  requirePermission('teachers.write'),
  validateBody(teacherSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['employeeNo', 'name', 'subjectCode']);
    const org = orgContext(req, req.body);
    await query(
      `UPDATE teachers
       SET campus_id = :campusId, employee_no = :employeeNo, name = :name, gender = :gender, subject_code = :subjectCode,
           title = :title, phone = :phone, email = :email, status = :status
       WHERE id = :id AND tenant_id = :tenantId`,
      {
        ...org,
        id: req.params.id,
        employeeNo: req.body.employeeNo,
        name: req.body.name,
        gender: asNullable(req.body.gender),
        subjectCode: req.body.subjectCode,
        title: asNullable(req.body.title),
        phone: asNullable(req.body.phone),
        email: asNullable(req.body.email),
        status: req.body.status || 'active'
      }
    );
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'teacher_update',
      outcome: 'success',
      targetType: 'teacher',
      targetId: req.params.id,
      details: {
        teacher: req.body
      }
    });
    res.json({ ok: true });
  })
);

app.delete(
  '/api/teachers/:id',
  requirePermission('teachers.delete'),
  asyncHandler(async (req, res) => {
    await query('DELETE FROM teachers WHERE id = :id AND tenant_id = :tenantId', { id: req.params.id, tenantId: currentTenantId(req) });
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'teacher_delete',
      outcome: 'success',
      targetType: 'teacher',
      targetId: req.params.id
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/classes',
  requirePermission('classes.read'),
  asyncHandler(async (req, res) => {
    const scope = await classScope(req, 'c');
    const pagination = paginationFromQuery(req);
    const order = orderByFromQuery(
      req,
      {
        grade: 'g.entry_year',
        name: 'c.name',
        trackType: 'c.track_type',
        capacity: 'c.capacity',
        studentCount: 'studentCount'
      },
      { key: 'grade', order: 'desc' }
    );
    const filters = [scope.where];
    const params = { ...scope.params };
    if (req.query.campusId) appendFilter(filters, params, 'c.campus_id = :campusId', { campusId: req.query.campusId });
    if (req.query.academicYearId) {
      appendFilter(filters, params, 'c.academic_year_id = :academicYearId', { academicYearId: req.query.academicYearId });
    }

    if (req.query.q) {
      appendFilter(filters, params, '(c.name LIKE :q OR c.room LIKE :q OR t.name LIKE :q)', { q: likeParam(req.query.q) });
    }
    if (req.query.gradeId) {
      appendFilter(filters, params, 'c.grade_id = :gradeId', { gradeId: req.query.gradeId });
    }
    if (req.query.trackType) {
      appendFilter(filters, params, 'c.track_type = :trackType', { trackType: req.query.trackType });
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    const countRows = await query(
      `SELECT COUNT(DISTINCT c.id) AS total
       FROM classes c
       JOIN grades g ON g.id = c.grade_id
       LEFT JOIN teachers t ON t.id = c.head_teacher_id
       ${where}`,
      params
    );
    const rows = await query(
      `SELECT c.id, c.grade_id AS gradeId, g.name AS gradeName, c.name, c.track_type AS trackType,
              c.campus_id AS campusId, campus.name AS campusName,
              c.academic_year_id AS academicYearId, ay.name AS academicYearName,
              c.head_teacher_id AS headTeacherId, t.name AS headTeacherName, c.capacity, c.room,
              COUNT(s.id) AS studentCount
       FROM classes c
       JOIN grades g ON g.id = c.grade_id
       LEFT JOIN campuses campus ON campus.id = c.campus_id
       LEFT JOIN academic_years ay ON ay.id = c.academic_year_id
       LEFT JOIN teachers t ON t.id = c.head_teacher_id
       LEFT JOIN students s ON s.class_id = c.id AND s.tenant_id = :tenantId AND s.status = '在读'
       ${where}
       GROUP BY c.id
       ORDER BY ${order.sql}, c.name ASC
       ${limitClause(pagination)}`,
      params
    );
    res.json(pagedResponse(rows, Number(countRows[0]?.total || 0), pagination, order));
  })
);

app.post(
  '/api/classes',
  requirePermission('classes.write'),
  validateBody(classSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['gradeId', 'name']);
    const org = orgContext(req, req.body);
    const result = await query(
      `INSERT INTO classes (tenant_id, campus_id, academic_year_id, grade_id, name, track_type, head_teacher_id, capacity, room)
       VALUES (:tenantId, :campusId, :academicYearId, :gradeId, :name, :trackType, :headTeacherId, :capacity, :room)`,
      {
        ...org,
        gradeId: req.body.gradeId,
        name: req.body.name,
        trackType: req.body.trackType || '综合',
        headTeacherId: asNullable(req.body.headTeacherId),
        capacity: Number(req.body.capacity || 50),
        room: asNullable(req.body.room)
      }
    );
    await syncHeadTeacherDuty({
      tenantId: org.tenantId,
      classId: result.insertId,
      teacherId: asNullable(req.body.headTeacherId)
    });
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'class_create',
      outcome: 'success',
      targetType: 'class',
      targetId: result.insertId,
      details: {
        class: req.body
      }
    });
    res.status(201).json({ id: result.insertId });
  })
);

app.put(
  '/api/classes/:id',
  requirePermission('classes.write'),
  validateBody(classSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['gradeId', 'name']);
    const org = orgContext(req, req.body);
    await query(
      `UPDATE classes
       SET campus_id = :campusId, academic_year_id = :academicYearId,
           grade_id = :gradeId, name = :name, track_type = :trackType, head_teacher_id = :headTeacherId,
           capacity = :capacity, room = :room
       WHERE id = :id AND tenant_id = :tenantId`,
      {
        ...org,
        id: req.params.id,
        gradeId: req.body.gradeId,
        name: req.body.name,
        trackType: req.body.trackType || '综合',
        headTeacherId: asNullable(req.body.headTeacherId),
        capacity: Number(req.body.capacity || 50),
        room: asNullable(req.body.room)
      }
    );
    await syncHeadTeacherDuty({
      tenantId: org.tenantId,
      classId: req.params.id,
      teacherId: asNullable(req.body.headTeacherId)
    });
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'class_update',
      outcome: 'success',
      targetType: 'class',
      targetId: req.params.id,
      details: {
        class: req.body
      }
    });
    res.json({ ok: true });
  })
);

app.delete(
  '/api/classes/:id',
  requirePermission('classes.delete'),
  asyncHandler(async (req, res) => {
    await query('DELETE FROM classes WHERE id = :id AND tenant_id = :tenantId', { id: req.params.id, tenantId: currentTenantId(req) });
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'class_delete',
      outcome: 'success',
      targetType: 'class',
      targetId: req.params.id
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/students',
  requirePermission('students.read'),
  asyncHandler(async (req, res) => {
    const scope = await studentScope(req, 's');
    const pagination = paginationFromQuery(req);
    const order = orderByFromQuery(
      req,
      {
        id: 's.id',
        studentNo: 's.student_no',
        name: 's.name',
        grade: 'g.entry_year',
        class: 'c.name',
        enrollmentYear: 's.enrollment_year',
        status: 's.status'
      },
      { key: 'id', order: 'desc' }
    );
    const filters = [scope.where];
    const params = { ...scope.params };
    if (req.query.campusId) appendFilter(filters, params, 's.campus_id = :campusId', { campusId: req.query.campusId });
    if (req.query.academicYearId) {
      appendFilter(filters, params, 's.academic_year_id = :academicYearId', { academicYearId: req.query.academicYearId });
    }

    if (req.query.q) {
      appendFilter(
        filters,
        params,
        '(s.student_no LIKE :q OR s.name LIKE :q OR s.phone LIKE :q OR s.guardian_name LIKE :q OR s.guardian_phone LIKE :q)',
        { q: likeParam(req.query.q) }
      );
    }
    if (req.query.gradeId) {
      appendFilter(filters, params, 's.grade_id = :gradeId', { gradeId: req.query.gradeId });
    }
    if (req.query.classId) {
      appendFilter(filters, params, 's.class_id = :classId', { classId: req.query.classId });
    }
    if (req.query.subjectComboId) {
      appendFilter(filters, params, 's.subject_combo_id = :subjectComboId', { subjectComboId: req.query.subjectComboId });
    }
    if (req.query.status) {
      appendFilter(filters, params, 's.status = :status', { status: req.query.status });
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    const countRows = await query(
      `SELECT COUNT(*) AS total
       FROM students s
       JOIN grades g ON g.id = s.grade_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN subject_combinations sc ON sc.id = s.subject_combo_id
       ${where}`,
      params
    );
    const rows = await query(
      `SELECT s.id, s.student_no AS studentNo, s.name, s.gender, s.birth_date AS birthDate,
              s.grade_id AS gradeId, g.name AS gradeName, s.class_id AS classId, c.name AS className,
              s.campus_id AS campusId, campus.name AS campusName,
              s.academic_year_id AS academicYearId, ay.name AS academicYearName,
              s.subject_combo_id AS subjectComboId, sc.label AS subjectComboLabel,
              s.enrollment_year AS enrollmentYear, s.phone, s.guardian_name AS guardianName,
              s.guardian_phone AS guardianPhone, s.status, s.user_id AS userId,
              u.username AS accountUsername, u.enabled AS accountEnabled,
              u.must_change_password AS accountMustChangePassword
       FROM students s
       JOIN grades g ON g.id = s.grade_id
       LEFT JOIN campuses campus ON campus.id = s.campus_id
       LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN subject_combinations sc ON sc.id = s.subject_combo_id
       LEFT JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY ${order.sql}, s.id DESC
       ${limitClause(pagination)}`,
      params
    );
    const items = hideAccountFields(rows, req.user.role, 'accounts.issue_student');
    res.json(pagedResponse(items, Number(countRows[0]?.total || 0), pagination, order));
  })
);

app.get(
  '/api/students/template',
  requirePermission('students.bulk'),
  asyncHandler(async (req, res) => {
    const buffer = await studentTemplateWorkbook();
    sendExcel(res, '学生导入模板.xlsx', buffer);
  })
);

app.get(
  '/api/students/export',
  requirePermission('students.bulk'),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT s.student_no AS studentNo, s.name, s.gender, s.birth_date AS birthDate,
              g.name AS gradeName, campus.name AS campusName, ay.name AS academicYearName, c.name AS className,
              sc.label AS subjectComboLabel, sc.combination_key AS subjectComboKey,
              s.enrollment_year AS enrollmentYear, s.phone,
              s.guardian_name AS guardianName, s.guardian_phone AS guardianPhone, s.status
       FROM students s
       JOIN grades g ON g.id = s.grade_id
       LEFT JOIN campuses campus ON campus.id = s.campus_id
       LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN subject_combinations sc ON sc.id = s.subject_combo_id
       WHERE s.tenant_id = :tenantId
       ORDER BY s.id DESC`,
      { tenantId: currentTenantId(req) }
    );
    const buffer = await studentExportWorkbook(rows);
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'student_export',
      outcome: 'success',
      targetType: 'student',
      details: { count: rows.length }
    });
    sendExcel(res, '学生档案.xlsx', buffer);
  })
);

app.post(
  '/api/students/import',
  requirePermission('students.bulk'),
  asyncHandler(async (req, res) => {
    const dryRun = shouldDryRun(req);
    const buffer = await readRawBody(req);
    const result = await validateStudentWorkbook(buffer, orgContext(req));

    if (result.report.invalid > 0 || dryRun) {
      if (!dryRun && result.report.invalid > 0) {
        return res.status(400).json(result.report);
      }
      return res.json(result.report);
    }

    const imported = await applyStudentImport(result.validRows, orgContext(req));
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'student_bulk_import',
      outcome: 'success',
      targetType: 'student',
      details: {
        total: result.report.total,
        created: imported.created,
        updated: imported.updated
      }
    });
    return res.status(201).json({ ...result.report, imported });
  })
);

app.post(
  '/api/students',
  requirePermission('students.write'),
  validateBody(studentSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['studentNo', 'name', 'gradeId', 'enrollmentYear']);
    await assertHeadTeacherCanWriteStudent(req, { classId: asNullable(req.body.classId) });
    const org = orgContext(req, req.body);
    const result = await query(
      `INSERT INTO students
       (tenant_id, campus_id, academic_year_id, student_no, name, gender, birth_date, grade_id, class_id, subject_combo_id, enrollment_year,
        phone, guardian_name, guardian_phone, status)
       VALUES (:tenantId, :campusId, :academicYearId, :studentNo, :name, :gender, :birthDate, :gradeId, :classId, :subjectComboId, :enrollmentYear,
        :phone, :guardianName, :guardianPhone, :status)`,
      {
        ...org,
        studentNo: req.body.studentNo,
        name: req.body.name,
        gender: asNullable(req.body.gender),
        birthDate: asNullable(req.body.birthDate),
        gradeId: req.body.gradeId,
        classId: asNullable(req.body.classId),
        subjectComboId: asNullable(req.body.subjectComboId),
        enrollmentYear: Number(req.body.enrollmentYear),
        phone: asNullable(req.body.phone),
        guardianName: asNullable(req.body.guardianName),
        guardianPhone: asNullable(req.body.guardianPhone),
        status: req.body.status || '在读'
      }
    );
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'student_create',
      outcome: 'success',
      targetType: 'student',
      targetId: result.insertId,
      details: {
        student: req.body
      }
    });
    res.status(201).json({ id: result.insertId });
  })
);

app.put(
  '/api/students/:id',
  requirePermission('students.write'),
  validateBody(studentSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['studentNo', 'name', 'gradeId', 'enrollmentYear']);
    await assertHeadTeacherCanWriteStudent(req, { studentId: req.params.id, classId: asNullable(req.body.classId) });
    const org = orgContext(req, req.body);
    await query(
      `UPDATE students
       SET campus_id = :campusId, academic_year_id = :academicYearId,
           student_no = :studentNo, name = :name, gender = :gender, birth_date = :birthDate,
           grade_id = :gradeId, class_id = :classId, subject_combo_id = :subjectComboId,
           enrollment_year = :enrollmentYear, phone = :phone, guardian_name = :guardianName,
           guardian_phone = :guardianPhone, status = :status
       WHERE id = :id AND tenant_id = :tenantId`,
      {
        ...org,
        id: req.params.id,
        studentNo: req.body.studentNo,
        name: req.body.name,
        gender: asNullable(req.body.gender),
        birthDate: asNullable(req.body.birthDate),
        gradeId: req.body.gradeId,
        classId: asNullable(req.body.classId),
        subjectComboId: asNullable(req.body.subjectComboId),
        enrollmentYear: Number(req.body.enrollmentYear),
        phone: asNullable(req.body.phone),
        guardianName: asNullable(req.body.guardianName),
        guardianPhone: asNullable(req.body.guardianPhone),
        status: req.body.status || '在读'
      }
    );
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'student_update',
      outcome: 'success',
      targetType: 'student',
      targetId: req.params.id,
      details: {
        student: req.body
      }
    });
    res.json({ ok: true });
  })
);

app.delete(
  '/api/students/:id',
  requirePermission('students.delete'),
  asyncHandler(async (req, res) => {
    await query('DELETE FROM students WHERE id = :id AND tenant_id = :tenantId', { id: req.params.id, tenantId: currentTenantId(req) });
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'student_delete',
      outcome: 'success',
      targetType: 'student',
      targetId: req.params.id
    });
    res.json({ ok: true });
  })
);

app.post(
  '/api/accounts/teachers/:id/issue-password',
  requirePermission('accounts.issue_teacher'),
  validateBody(issueAccountSchema),
  asyncHandler(async (req, res) => {
    const account = await issueLinkedAccount({
      entity: 'teacher',
      id: req.params.id,
      username: req.body.username,
      initialPassword: req.body.initialPassword,
      tenantId: currentTenantId(req)
    });
    await recordAuditLog(req, {
      eventType: 'permission',
      action: account.action === 'created' ? 'teacher_account_created' : 'teacher_account_reset',
      outcome: 'success',
      targetType: 'teacher',
      targetId: req.params.id,
      targetUsername: account.username,
      details: {
        userId: account.userId,
        role: 'teacher',
        mustChangePassword: account.mustChangePassword
      }
    });
    const sms = await maybeNotifyAccountBySms(req, account, 'teacher', req.params.id);
    const { notifyPhone, ...publicAccount } = account;
    res.status(account.action === 'created' ? 201 : 200).json({ ...publicAccount, sms });
  })
);

app.post(
  '/api/accounts/students/:id/issue-password',
  requirePermission('accounts.issue_student'),
  validateBody(issueAccountSchema),
  asyncHandler(async (req, res) => {
    const account = await issueLinkedAccount({
      entity: 'student',
      id: req.params.id,
      username: req.body.username,
      initialPassword: req.body.initialPassword,
      tenantId: currentTenantId(req)
    });
    await recordAuditLog(req, {
      eventType: 'permission',
      action: account.action === 'created' ? 'student_account_created' : 'student_account_reset',
      outcome: 'success',
      targetType: 'student',
      targetId: req.params.id,
      targetUsername: account.username,
      details: {
        userId: account.userId,
        role: 'student',
        mustChangePassword: account.mustChangePassword
      }
    });
    const sms = await maybeNotifyAccountBySms(req, account, 'student', req.params.id);
    const { notifyPhone, ...publicAccount } = account;
    res.status(account.action === 'created' ? 201 : 200).json({ ...publicAccount, sms });
  })
);

app.get(
  '/api/subject-combinations',
  requirePermission('subject_combinations.read'),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT sc.id, sc.combination_key AS combinationKey, sc.label,
              sc.preferred_subject AS preferredSubject, sc.elective_subjects AS electiveSubjects,
              COUNT(s.id) AS studentCount
       FROM subject_combinations sc
       LEFT JOIN students s ON s.subject_combo_id = sc.id AND s.tenant_id = :tenantId AND s.status = '在读'
       WHERE sc.tenant_id = :tenantId
       GROUP BY sc.id
       ORDER BY studentCount DESC, sc.preferred_subject DESC, sc.label`,
      { tenantId: currentTenantId(req) }
    );
    res.json(rows);
  })
);

app.post(
  '/api/subject-combinations',
  requirePermission('subject_combinations.write'),
  validateBody(subjectCombinationSchema),
  asyncHandler(async (req, res) => {
    const { preferredSubject, electiveSubjects: selectedElectives } = req.body;
    assertNewGaokaoSelection(preferredSubject, selectedElectives);

    const names = await query('SELECT code, name FROM subjects WHERE code IN (:preferredSubject, :electiveA, :electiveB)', {
      preferredSubject,
      electiveA: selectedElectives[0],
      electiveB: selectedElectives[1]
    });
    const nameByCode = Object.fromEntries(names.map((item) => [item.code, item.name]));
    const orderedElectives = selectedElectives.slice().sort();
    const key = buildCombinationKey(preferredSubject, selectedElectives);
    const label = `${nameByCode[preferredSubject]} + ${orderedElectives.map((code) => nameByCode[code]).join(' + ')}`;

    const result = await query(
      `INSERT INTO subject_combinations (tenant_id, combination_key, label, preferred_subject, elective_subjects)
       VALUES (:tenantId, :key, :label, :preferredSubject, CAST(:electiveSubjects AS JSON))
       ON DUPLICATE KEY UPDATE label = VALUES(label)`,
      {
        tenantId: currentTenantId(req),
        key,
        label,
        preferredSubject,
        electiveSubjects: JSON.stringify(orderedElectives)
      }
    );
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'subject_combination_create',
      outcome: 'success',
      targetType: 'subject_combination',
      targetId: result.insertId || key,
      details: {
        combinationKey: key,
        label,
        preferredSubject,
        electiveSubjects: orderedElectives
      }
    });
    res.status(201).json({ id: result.insertId, combinationKey: key, label });
  })
);

app.get(
  '/api/teaching-classes',
  requirePermission('teaching_classes.read'),
  asyncHandler(async (req, res) => {
    const scope = await teachingClassScope(req, 'tc');
    const pagination = paginationFromQuery(req);
    const order = orderByFromQuery(
      req,
      {
        grade: 'g.entry_year',
        subject: 's.name',
        name: 'tc.name',
        teacher: 't.name',
        capacity: 'tc.capacity',
        studentCount: 'studentCount'
      },
      { key: 'grade', order: 'desc' }
    );
    const filters = [scope.where];
    const params = { ...scope.params };
    if (req.query.campusId) appendFilter(filters, params, 'tc.campus_id = :campusId', { campusId: req.query.campusId });
    if (req.query.academicYearId) {
      appendFilter(filters, params, 'tc.academic_year_id = :academicYearId', { academicYearId: req.query.academicYearId });
    }

    if (req.query.q) {
      appendFilter(filters, params, '(tc.name LIKE :q OR t.name LIKE :q OR sc.label LIKE :q OR r.name LIKE :q)', {
        q: likeParam(req.query.q)
      });
    }
    if (req.query.gradeId) {
      appendFilter(filters, params, 'tc.grade_id = :gradeId', { gradeId: req.query.gradeId });
    }
    if (req.query.subjectCode) {
      appendFilter(filters, params, 'tc.subject_code = :subjectCode', { subjectCode: req.query.subjectCode });
    }
    if (req.query.teacherId) {
      appendFilter(filters, params, 'tc.teacher_id = :teacherId', { teacherId: req.query.teacherId });
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    const countRows = await query(
      `SELECT COUNT(DISTINCT tc.id) AS total
       FROM teaching_classes tc
       JOIN grades g ON g.id = tc.grade_id
       JOIN subjects s ON s.code = tc.subject_code
       LEFT JOIN teachers t ON t.id = tc.teacher_id
       LEFT JOIN subject_combinations sc ON sc.id = tc.subject_combo_id
       LEFT JOIN rooms r ON r.id = tc.room_id
       ${where}`,
      params
    );
    const rows = await query(
      `SELECT tc.id, tc.grade_id AS gradeId, g.name AS gradeName, tc.subject_code AS subjectCode,
              s.name AS subjectName, tc.name, tc.teacher_id AS teacherId, t.name AS teacherName,
              tc.campus_id AS campusId, campus.name AS campusName,
              tc.academic_year_id AS academicYearId, ay.name AS academicYearName,
              tc.subject_combo_id AS subjectComboId, sc.label AS subjectComboLabel,
              tc.capacity, tc.room_id AS roomId, r.name AS roomName, COUNT(tcs.student_id) AS studentCount
       FROM teaching_classes tc
       JOIN grades g ON g.id = tc.grade_id
       JOIN subjects s ON s.code = tc.subject_code
       LEFT JOIN campuses campus ON campus.id = tc.campus_id
       LEFT JOIN academic_years ay ON ay.id = tc.academic_year_id
       LEFT JOIN teachers t ON t.id = tc.teacher_id
       LEFT JOIN subject_combinations sc ON sc.id = tc.subject_combo_id
       LEFT JOIN rooms r ON r.id = tc.room_id
       LEFT JOIN teaching_class_students tcs ON tcs.teaching_class_id = tc.id
       ${where}
       GROUP BY tc.id
       ORDER BY ${order.sql}, tc.name ASC
       ${limitClause(pagination)}`,
      params
    );
    res.json(pagedResponse(rows, Number(countRows[0]?.total || 0), pagination, order));
  })
);

app.post(
  '/api/teaching-classes',
  requirePermission('teaching_classes.write'),
  validateBody(teachingClassSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['gradeId', 'subjectCode', 'name']);
    const org = orgContext(req, req.body);
    const result = await query(
      `INSERT INTO teaching_classes
       (tenant_id, campus_id, academic_year_id, grade_id, subject_code, name, teacher_id, subject_combo_id, capacity, room_id)
       VALUES (:tenantId, :campusId, :academicYearId, :gradeId, :subjectCode, :name, :teacherId, :subjectComboId, :capacity, :roomId)`,
      {
        ...org,
        gradeId: req.body.gradeId,
        subjectCode: req.body.subjectCode,
        name: req.body.name,
        teacherId: asNullable(req.body.teacherId),
        subjectComboId: asNullable(req.body.subjectComboId),
        capacity: Number(req.body.capacity || 45),
        roomId: asNullable(req.body.roomId)
      }
    );
    await syncCourseTeacherDuty({
      tenantId: org.tenantId,
      teachingClassId: result.insertId,
      teacherId: asNullable(req.body.teacherId)
    });
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'teaching_class_create',
      outcome: 'success',
      targetType: 'teaching_class',
      targetId: result.insertId,
      details: {
        teachingClass: req.body
      }
    });
    res.status(201).json({ id: result.insertId });
  })
);

app.post(
  '/api/teaching-classes/:id/enroll-by-combo',
  requirePermission('teaching_classes.enroll'),
  asyncHandler(async (req, res) => {
    const [teachingClass] = await query(
      `SELECT id, subject_combo_id AS subjectComboId, grade_id AS gradeId, tenant_id AS tenantId
       FROM teaching_classes
       WHERE id = :id AND tenant_id = :tenantId`,
      {
        id: req.params.id,
        tenantId: currentTenantId(req)
      }
    );
    if (!teachingClass) {
      return res.status(404).json({ message: '教学班不存在' });
    }
    if (!teachingClass.subjectComboId) {
      return res.status(400).json({ message: '教学班未绑定选科组合，无法自动编班' });
    }

    const result = await query(
      `INSERT IGNORE INTO teaching_class_students (teaching_class_id, student_id)
       SELECT :teachingClassId, id
       FROM students
       WHERE tenant_id = :tenantId AND grade_id = :gradeId AND subject_combo_id = :subjectComboId AND status = '在读'`,
      {
        teachingClassId: req.params.id,
        tenantId: currentTenantId(req),
        gradeId: teachingClass.gradeId,
        subjectComboId: teachingClass.subjectComboId
      }
    );
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'teaching_class_enroll_by_combo',
      outcome: 'success',
      targetType: 'teaching_class',
      targetId: req.params.id,
      details: {
        gradeId: teachingClass.gradeId,
        subjectComboId: teachingClass.subjectComboId,
        enrolled: result.affectedRows
      }
    });
    res.json({ enrolled: result.affectedRows });
  })
);

app.get(
  '/api/timetable',
  requirePermission('timetable.read'),
  asyncHandler(async (req, res) => {
    const semester = req.query.semester || '2026春';
    const scope = await timetableScope(req);
    const filters = [`te.semester = :semester`, scope.where];
    const params = { semester, ...scope.params };
    if (req.query.campusId) appendFilter(filters, params, 'te.campus_id = :campusId', { campusId: req.query.campusId });
    if (req.query.academicYearId) {
      appendFilter(filters, params, 'te.academic_year_id = :academicYearId', { academicYearId: req.query.academicYearId });
    }
    const rows = await query(
      `SELECT te.id, te.semester, ts.weekday, ts.period, ts.slot_type AS slotType,
              COALESCE(ts.label, CONCAT('第', ts.period, '节')) AS slotLabel,
              ts.start_time AS startTime, ts.end_time AS endTime,
              te.campus_id AS campusId, campus.name AS campusName,
              te.academic_year_id AS academicYearId, ay.name AS academicYearName,
              te.class_id AS classId, c.name AS className,
              te.teaching_class_id AS teachingClassId, tc.name AS teachingClassName,
              subj.name AS subjectName, teacher.name AS teacherName,
              te.room_id AS roomId, r.name AS roomName, te.note
       FROM timetable_entries te
       JOIN timetable_slots ts ON ts.id = te.slot_id
       LEFT JOIN classes c ON c.id = te.class_id
       LEFT JOIN teaching_classes tc ON tc.id = te.teaching_class_id
       LEFT JOIN subjects subj ON subj.code = tc.subject_code
       LEFT JOIN teachers teacher ON teacher.id = tc.teacher_id
       LEFT JOIN rooms r ON r.id = te.room_id
       LEFT JOIN campuses campus ON campus.id = te.campus_id
       LEFT JOIN academic_years ay ON ay.id = te.academic_year_id
       WHERE ${filters.join(' AND ')}
       ORDER BY ts.weekday, ts.period`,
      params
    );
    res.json(rows);
  })
);

app.get(
  '/api/timetable/teacher-workload',
  requirePermission('timetable.read'),
  asyncHandler(async (req, res) => {
    const semester = req.query.semester || '2026春';
    const filters = ['te.tenant_id = :tenantId', 'te.semester = :semester', 'tc.teacher_id IS NOT NULL'];
    const params = { tenantId: currentTenantId(req), semester };

    if (req.query.gradeId) {
      appendFilter(filters, params, 'tc.grade_id = :gradeId', { gradeId: req.query.gradeId });
    }
    if (req.query.campusId) appendFilter(filters, params, 'te.campus_id = :campusId', { campusId: req.query.campusId });
    if (req.query.academicYearId) {
      appendFilter(filters, params, 'te.academic_year_id = :academicYearId', { academicYearId: req.query.academicYearId });
    }

    if (!['admin', 'academic'].includes(req.user.role)) {
      const teacherId = await getTeacherIdForUser(req.user.id);
      if (!teacherId) return res.json([]);
      appendFilter(filters, params, 'tc.teacher_id = :scopeTeacherId', { scopeTeacherId: teacherId });
    }

    const rows = await query(
      `SELECT t.id AS teacherId, t.employee_no AS employeeNo, t.name AS teacherName,
              s.name AS subjectName,
              COUNT(DISTINCT tc.id) AS teachingClassCount,
              SUM(CASE WHEN ts.slot_type = 'evening' THEN 0 ELSE 1 END) AS regularPeriods,
              SUM(CASE WHEN ts.slot_type = 'evening' THEN 1 ELSE 0 END) AS eveningPeriods,
              COUNT(te.id) AS totalPeriods
       FROM timetable_entries te
       JOIN timetable_slots ts ON ts.id = te.slot_id
       JOIN teaching_classes tc ON tc.id = te.teaching_class_id
       JOIN teachers t ON t.id = tc.teacher_id
       JOIN subjects s ON s.code = t.subject_code
       WHERE ${filters.join(' AND ')}
       GROUP BY t.id
       ORDER BY totalPeriods DESC, t.name ASC`,
      params
    );

    res.json(rows.map((row) => ({
      ...row,
      teachingClassCount: Number(row.teachingClassCount || 0),
      regularPeriods: Number(row.regularPeriods || 0),
      eveningPeriods: Number(row.eveningPeriods || 0),
      totalPeriods: Number(row.totalPeriods || 0)
    })));
  })
);

app.post(
  '/api/timetable/conflicts',
  requirePermission('timetable.write'),
  validateBody(timetableSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['semester', 'weekday', 'period']);
    const payload = await buildTimetableEntryPayload(req.body, req);
    const conflicts = await findTimetableConflicts({
      tenantId: payload.tenantId,
      semester: payload.semester,
      slotId: payload.slot.id,
      classId: payload.classId,
      teachingClassId: payload.teachingClassId,
      roomId: payload.roomId
    });
    res.json({ ok: conflicts.length === 0, conflicts });
  })
);

app.post(
  '/api/timetable/auto-schedule',
  requirePermission('timetable.write'),
  validateBody(autoScheduleSchema),
  asyncHandler(async (req, res) => {
    const semester = req.body.semester;
    const includeEvening = Boolean(req.body.includeEvening);
    const maxDailyPeriods = Number(req.body.maxDailyPeriods || 6);
    const gradeId = asNullable(req.body.gradeId);
    const org = orgContext(req, req.body);
    const summary = {
      scheduled: 0,
      skipped: [],
      conflicts: []
    };

    if (req.body.overwrite) {
      const params = { semester, gradeId, ...org };
      await query(
        `DELETE te
         FROM timetable_entries te
         JOIN teaching_classes tc ON tc.id = te.teaching_class_id
         WHERE te.tenant_id = :tenantId
           AND te.semester = :semester
           AND te.campus_id = :campusId
           AND te.academic_year_id = :academicYearId
           AND (:gradeId IS NULL OR tc.grade_id = :gradeId)`,
        params
      );
    }

    const slots = await query(
      `SELECT id, weekday, period, slot_type AS slotType, COALESCE(label, CONCAT('第', period, '节')) AS label
       FROM timetable_slots
       WHERE weekday BETWEEN 1 AND 5
         AND (:includeEvening = 1 OR slot_type = 'regular')
       ORDER BY period, weekday`,
      { includeEvening: includeEvening ? 1 : 0 }
    );

    const teachingClasses = await query(
      `SELECT tc.id, tc.name, tc.grade_id AS gradeId, tc.subject_code AS subjectCode,
              tc.teacher_id AS teacherId, t.name AS teacherName, tc.room_id AS roomId,
              COALESCE(cp.weekly_hours, 2) AS weeklyHours
       FROM teaching_classes tc
       LEFT JOIN teachers t ON t.id = tc.teacher_id
       LEFT JOIN course_plans cp ON cp.tenant_id = :tenantId
        AND cp.grade_id = tc.grade_id
        AND cp.subject_code = tc.subject_code
        AND cp.semester = :semester
       WHERE tc.tenant_id = :tenantId
         AND tc.campus_id = :campusId
         AND tc.academic_year_id = :academicYearId
         AND (:gradeId IS NULL OR tc.grade_id = :gradeId)
       ORDER BY COALESCE(cp.weekly_hours, 2) DESC, tc.grade_id, tc.subject_code, tc.name`,
      { semester, gradeId, ...org }
    );

    for (const teachingClass of teachingClasses) {
      if (!teachingClass.teacherId) {
        summary.skipped.push({ teachingClassId: teachingClass.id, teachingClassName: teachingClass.name, reason: '未设置任课教师' });
        continue;
      }

      const weeklyHours = Math.max(1, Math.min(Number(teachingClass.weeklyHours || 2), includeEvening ? 11 : 8));
      for (let index = 0; index < weeklyHours; index += 1) {
        let placed = false;
        for (const slot of slots) {
          if (await teacherDailyLoad({ tenantId: org.tenantId, semester, teacherId: teachingClass.teacherId, weekday: slot.weekday }) >= maxDailyPeriods) {
            continue;
          }

          const conflicts = await findTimetableConflicts({
            tenantId: org.tenantId,
            semester,
            slotId: slot.id,
            teachingClassId: teachingClass.id,
            roomId: teachingClass.roomId
          });

          if (conflicts.length) {
            continue;
          }

          await query(
            `INSERT INTO timetable_entries
             (tenant_id, campus_id, academic_year_id, semester, slot_id, teaching_class_id, room_id, note)
             VALUES (:tenantId, :campusId, :academicYearId, :semester, :slotId, :teachingClassId, :roomId, :note)`,
            {
              ...org,
              semester,
              slotId: slot.id,
              teachingClassId: teachingClass.id,
              roomId: teachingClass.roomId || null,
              note: '自动排课'
            }
          );
          summary.scheduled += 1;
          placed = true;
          break;
        }

        if (!placed) {
          summary.skipped.push({
            teachingClassId: teachingClass.id,
            teachingClassName: teachingClass.name,
            reason: `第 ${index + 1} 课时无可用时段`
          });
        }
      }
    }

    await recordAuditLog(req, {
      eventType: 'data',
      action: 'timetable_auto_schedule',
      outcome: 'success',
      targetType: 'timetable',
      details: {
        semester,
        gradeId,
        includeEvening,
        maxDailyPeriods,
        scheduled: summary.scheduled,
        skipped: summary.skipped.length
      }
    });

    res.status(201).json(summary);
  })
);

app.post(
  '/api/timetable',
  requirePermission('timetable.write'),
  validateBody(timetableSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['semester', 'weekday', 'period']);
    const payload = await buildTimetableEntryPayload(req.body, req);
    const id = await insertTimetableEntry(payload);
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'timetable_entry_create',
      outcome: 'success',
      targetType: 'timetable_entry',
      targetId: id,
      details: {
        timetable: req.body
      }
    });
    res.status(201).json({ id });
  })
);

app.delete(
  '/api/timetable/:id',
  requirePermission('timetable.delete'),
  asyncHandler(async (req, res) => {
    await query('DELETE FROM timetable_entries WHERE id = :id AND tenant_id = :tenantId', { id: req.params.id, tenantId: currentTenantId(req) });
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'timetable_entry_delete',
      outcome: 'success',
      targetType: 'timetable_entry',
      targetId: req.params.id
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/exams',
  requirePermission('exams.read'),
  asyncHandler(async (req, res) => {
    const pagination = paginationFromQuery(req);
    const order = orderByFromQuery(
      req,
      {
        id: 'e.id',
        name: 'e.name',
        grade: 'g.entry_year',
        semester: 'e.semester',
        examDate: 'e.exam_date',
        examType: 'e.exam_type',
        scoreCount: 'scoreCount',
        averageScore: 'averageScore'
      },
      { key: 'examDate', order: 'desc' }
    );
    const filters = ['e.tenant_id = :tenantId'];
    const params = { tenantId: currentTenantId(req) };

    if (req.query.q) {
      appendFilter(filters, params, '(e.name LIKE :q OR e.semester LIKE :q)', { q: likeParam(req.query.q) });
    }
    if (req.query.gradeId) {
      appendFilter(filters, params, 'e.grade_id = :gradeId', { gradeId: req.query.gradeId });
    }
    if (req.query.examType) {
      appendFilter(filters, params, 'e.exam_type = :examType', { examType: req.query.examType });
    }
    if (req.query.academicYearId) {
      appendFilter(filters, params, 'e.academic_year_id = :academicYearId', { academicYearId: req.query.academicYearId });
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRows = await query(
      `SELECT COUNT(*) AS total
       FROM exams e
       JOIN grades g ON g.id = e.grade_id
       ${where}`,
      params
    );
    const rows = await query(
      `SELECT e.id, e.grade_id AS gradeId, g.name AS gradeName, e.name, e.semester,
              e.academic_year_id AS academicYearId, ay.name AS academicYearName,
              e.exam_date AS examDate, e.exam_type AS examType,
              COUNT(es.id) AS scoreCount, ROUND(AVG(es.raw_score), 1) AS averageScore
       FROM exams e
       JOIN grades g ON g.id = e.grade_id
       LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
       LEFT JOIN exam_scores es ON es.exam_id = e.id
       ${where}
       GROUP BY e.id
       ORDER BY ${order.sql}, e.id DESC
       ${limitClause(pagination)}`,
      params
    );
    res.json(pagedResponse(rows, Number(countRows[0]?.total || 0), pagination, order));
  })
);

app.post(
  '/api/exams',
  requirePermission('exams.write'),
  validateBody(examSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['gradeId', 'name', 'semester', 'examDate']);
    const org = orgContext(req, req.body);
    const result = await query(
      `INSERT INTO exams (tenant_id, academic_year_id, grade_id, name, semester, exam_date, exam_type)
       VALUES (:tenantId, :academicYearId, :gradeId, :name, :semester, :examDate, :examType)`,
      {
        tenantId: org.tenantId,
        academicYearId: org.academicYearId,
        gradeId: req.body.gradeId,
        name: req.body.name,
        semester: req.body.semester,
        examDate: req.body.examDate,
        examType: req.body.examType || '月考'
      }
    );
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'exam_create',
      outcome: 'success',
      targetType: 'exam',
      targetId: result.insertId,
      details: {
        exam: req.body
      }
    });
    res.status(201).json({ id: result.insertId });
  })
);

app.get(
  '/api/exam-scores',
  requirePermission('exam_scores.read'),
  asyncHandler(async (req, res) => {
    const scope = await examScoreScope(req);
    const pagination = paginationFromQuery(req, { defaultPageSize: 50, maxPageSize: 200 });
    const order = orderByFromQuery(
      req,
      {
        id: 'es.id',
        exam: 'e.name',
        studentNo: 'stu.student_no',
        studentName: 'stu.name',
        class: 'c.name',
        subject: 'subj.name',
        rawScore: 'es.raw_score',
        rankInGrade: 'es.rank_in_grade'
      },
      { key: 'id', order: 'desc' }
    );
    const filters = ['(:examId IS NULL OR es.exam_id = :examId)', scope.where];
    const params = { examId: asNullable(req.query.examId), ...scope.params };

    if (req.query.q) {
      appendFilter(filters, params, '(stu.student_no LIKE :q OR stu.name LIKE :q OR e.name LIKE :q)', {
        q: likeParam(req.query.q)
      });
    }
    if (req.query.subjectCode) {
      appendFilter(filters, params, 'es.subject_code = :subjectCode', { subjectCode: req.query.subjectCode });
    }
    if (req.query.classId) {
      appendFilter(filters, params, 'stu.class_id = :classId', { classId: req.query.classId });
    }
    if (req.query.academicYearId) {
      appendFilter(filters, params, 'e.academic_year_id = :academicYearId', { academicYearId: req.query.academicYearId });
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    const countRows = await query(
      `SELECT COUNT(*) AS total
       FROM exam_scores es
       JOIN exams e ON e.id = es.exam_id
       JOIN students stu ON stu.id = es.student_id
       LEFT JOIN classes c ON c.id = stu.class_id
       JOIN subjects subj ON subj.code = es.subject_code
       ${where}`,
      params
    );
    const rows = await query(
      `SELECT es.id, es.exam_id AS examId, e.name AS examName, es.student_id AS studentId,
              stu.student_no AS studentNo, stu.name AS studentName, c.name AS className,
              es.subject_code AS subjectCode, subj.name AS subjectName, es.raw_score AS rawScore,
              es.standard_score AS standardScore, es.rank_in_grade AS rankInGrade
       FROM exam_scores es
       JOIN exams e ON e.id = es.exam_id
       JOIN students stu ON stu.id = es.student_id
       LEFT JOIN classes c ON c.id = stu.class_id
       JOIN subjects subj ON subj.code = es.subject_code
       ${where}
       ORDER BY ${order.sql}, es.id DESC
       ${limitClause(pagination)}`,
      params
    );
    res.json(pagedResponse(rows, Number(countRows[0]?.total || 0), pagination, order));
  })
);

app.post(
  '/api/exam-scores',
  requirePermission('exam_scores.write'),
  validateBody(examScoreSchema),
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['examId', 'studentId', 'subjectCode', 'rawScore']);
    await assertTeacherCanWriteScore(req, {
      studentId: req.body.studentId,
      subjectCode: req.body.subjectCode
    });
    const [scoreTarget] = await query(
      `SELECT e.id
       FROM exams e
       JOIN students stu ON stu.id = :studentId
       WHERE e.id = :examId
         AND e.tenant_id = :tenantId
         AND stu.tenant_id = :tenantId
       LIMIT 1`,
      { examId: req.body.examId, studentId: req.body.studentId, tenantId: currentTenantId(req) }
    );
    if (!scoreTarget) {
      throw new AppError('考试或学生不存在', 404, 'RESOURCE_NOT_FOUND');
    }
    const rawScore = Number(req.body.rawScore);
    const result = await query(
      `INSERT INTO exam_scores (exam_id, student_id, subject_code, raw_score, standard_score, rank_in_grade)
       VALUES (:examId, :studentId, :subjectCode, :rawScore, :standardScore, :rankInGrade)
       ON DUPLICATE KEY UPDATE raw_score = VALUES(raw_score), standard_score = VALUES(standard_score),
       rank_in_grade = VALUES(rank_in_grade)`,
      {
        examId: req.body.examId,
        studentId: req.body.studentId,
        subjectCode: req.body.subjectCode,
        rawScore,
        standardScore: asNullable(req.body.standardScore),
        rankInGrade: asNullable(req.body.rankInGrade)
      }
    );
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'exam_score_upsert',
      outcome: 'success',
      targetType: 'exam_score',
      targetId: result.insertId || `${req.body.examId}:${req.body.studentId}:${req.body.subjectCode}`,
      details: {
        examId: req.body.examId,
        studentId: req.body.studentId,
        subjectCode: req.body.subjectCode,
        rawScore
      }
    });
    res.status(201).json({ id: result.insertId });
  })
);

app.post(
  '/api/exams/:id/recalculate-ranks',
  requirePermission('exam_scores.rank'),
  asyncHandler(async (req, res) => {
    await transaction(async (connection) => {
      const [subjects] = await connection.execute(
        `SELECT DISTINCT es.subject_code AS subjectCode
         FROM exam_scores es
         JOIN exams e ON e.id = es.exam_id
         WHERE es.exam_id = :examId AND e.tenant_id = :tenantId`,
        { examId: req.params.id, tenantId: currentTenantId(req) }
      );

      for (const subject of subjects) {
        await connection.execute(
          `UPDATE exam_scores es
           JOIN (
             SELECT id, RANK() OVER (ORDER BY raw_score DESC) AS gradeRank
             FROM exam_scores
             WHERE exam_id = :examId AND subject_code = :subjectCode
               AND exam_id IN (SELECT id FROM exams WHERE tenant_id = :tenantId)
           ) ranked ON ranked.id = es.id
           SET es.rank_in_grade = ranked.gradeRank
           WHERE es.exam_id = :examId AND es.subject_code = :subjectCode`,
          { examId: req.params.id, tenantId: currentTenantId(req), subjectCode: subject.subjectCode }
        );
      }
    });
    await recordAuditLog(req, {
      eventType: 'data',
      action: 'exam_rank_recalculate',
      outcome: 'success',
      targetType: 'exam',
      targetId: req.params.id
    });
    res.json({ ok: true });
  })
);

app.use('/api', notFoundHandler);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);

let server;

async function start() {
  await ensureDatabase();
  await assertProductionAdminPasswordPolicy();
  server = app.listen(port, () => {
    logger.info({ port }, `教务系统已启动：http://localhost:${port}`);
  });
  return server;
}

async function shutdown(signal) {
  logger.info({ signal }, '正在关闭服务');

  if (!server) {
    await closePool();
    process.exit(0);
  }

  server.close(async (error) => {
    if (error) {
      logger.error({ err: error }, 'HTTP 服务关闭失败');
      process.exit(1);
    }

    await closePool();
    logger.info('服务已安全关闭');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('关闭超时，强制退出');
    process.exit(1);
  }, 10000).unref();
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  start().catch((error) => {
    logger.fatal({ err: error }, '启动失败：无法连接或创建数据库，请检查环境变量中的 MySQL 配置');
    process.exit(1);
  });
}

export { app, shutdown, start };
