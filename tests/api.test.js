import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import mysql from 'mysql2/promise';

const runId = Date.now().toString(36);
const testDatabase = `fides_gaokao_api_test_${runId}`;
const adminPassword = 'ApiTestAdmin@20260424!';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = testDatabase;
process.env.DB_AUTO_CREATE = 'true';
process.env.ADMIN_INITIAL_PASSWORD = adminPassword;
process.env.JWT_SECRET = 'fides-local-dev-secret-change-before-production';
process.env.LOG_LEVEL = 'silent';
process.env.AUDIT_EVENT_LOG_ENABLED = 'false';
process.env.AUDIT_ALERTS_ENABLED = 'true';
process.env.AUDIT_SIEM_WEBHOOK_URL = '';
process.env.AUDIT_ALERT_WEBHOOK_URL = '';
process.env.AUDIT_SLOW_API_ENABLED = 'true';
process.env.AUDIT_SLOW_API_THRESHOLD_MS = '1';
process.env.OIDC_ENABLED = 'false';
process.env.SMS_ENABLED = 'true';
process.env.SMS_PROVIDER = 'log';
process.env.SMS_ACCOUNT_NOTIFY_ENABLED = 'true';

let app;
let closePool;
let config;
let getPool;
let migrateUp;
let seedDatabase;
let server;
let baseUrl;
let adminToken;

function quoteIdentifier(value) {
  assert.match(value, /^[A-Za-z0-9_]+$/);
  return `\`${value}\``;
}

async function api(path, { method = 'GET', token = adminToken, body, expectedStatus = 200 } = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));

  assert.equal(response.status, expectedStatus, `${method} ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function items(payload) {
  return Array.isArray(payload) ? payload : payload.items || [];
}

async function apiExcelDownload(path, { token = adminToken, expectedStatus = 200 } = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });
  const payload = response.ok ? null : await response.json().catch(() => ({}));
  assert.equal(response.status, expectedStatus, `GET ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  assert.match(response.headers.get('content-type') || '', /spreadsheetml\.sheet/);
  return Buffer.from(await response.arrayBuffer());
}

async function apiExcelImport(path, buffer, { token = adminToken, dryRun = true, expectedStatus = 200 } = {}) {
  const response = await fetch(`${baseUrl}/api${path}?dryRun=${dryRun ? '1' : '0'}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: buffer
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.status, expectedStatus, `POST ${path} -> ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function workbookFromBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

async function workbookBuffer(headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('导入');
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function waitFor(assertion, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError;
}

async function login(username, password, expectedStatus = 200) {
  return api('/auth/login', {
    method: 'POST',
    token: null,
    body: { username, password },
    expectedStatus
  });
}

before(async () => {
  ({ config } = await import('../src/config.js'));
  ({ closePool, getPool } = await import('../src/db.js'));
  ({ migrateUp } = await import('../src/migrator.js'));
  ({ seedDatabase } = await import('../src/schema.js'));
  ({ app } = await import('../src/server.js'));

  await migrateUp();
  await seedDatabase(getPool(), {
    adminPasswordHash: await bcrypt.hash(adminPassword, 10),
    forceAdminPasswordChange: false
  });

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await closePool?.();

  if (config?.db?.database === testDatabase) {
    const connection = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password
    });
    await connection.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(testDatabase)}`);
    await connection.end();
  }
});

test('接口自动化覆盖认证、选科、学生、课表、成绩核心链路', async (t) => {
  const context = {};

  await t.test('认证链路', async () => {
    await login('admin', 'wrong-password', 401);

    const result = await login('admin', adminPassword);
    assert.ok(result.token);
    assert.equal(result.user.username, 'admin');
    assert.equal(result.user.mustChangePassword, false);
    assert.equal(result.user.tenantId, 1);
    assert.ok(result.user.permissions.includes('students.write'));

    adminToken = result.token;

    const me = await api('/auth/me');
    assert.equal(me.user.role, 'admin');
    assert.ok(me.user.pages.some((page) => page.view === 'dashboard'));
    assert.ok(me.user.permissions.includes('analytics.read'));
  });

  await t.test('统一身份认证配置与短信通知', async () => {
    const sso = await api('/auth/sso/config', { token: null });
    assert.equal(sso.enabled, false);
    assert.deepEqual(sso.providers, []);

    const sms = await api('/sms/send', {
      method: 'POST',
      body: {
        recipientPhone: '13900001111',
        message: `接口测试短信 ${runId}`,
        targetType: 'api_test',
        targetId: runId
      },
      expectedStatus: 201
    });
    assert.equal(sms.status, 'sent');

    const smsMessages = await api(`/sms/messages?q=${encodeURIComponent(runId)}&pageSize=10`);
    assert.ok(items(smsMessages).some((message) => message.id === sms.id && message.status === 'sent'));

    const teachers = items(await api('/teachers?pageSize=50'));
    const teacher = teachers[0];
    assert.ok(teacher?.id);
    const issued = await api(`/accounts/teachers/${teacher.id}/issue-password`, {
      method: 'POST',
      body: {
        username: `sms_${runId}`.slice(0, 30),
        initialPassword: 'TeacherSms@20260426!'
      },
      expectedStatus: teacher.accountUsername ? 200 : 201
    });
    assert.equal(issued.sms.status, 'sent');
  });

  await t.test('操作日志检索、告警分级处置和慢接口监控', async () => {
    const logs = await api('/audit-logs?eventType=auth&action=login&outcome=success&q=admin&pageSize=5&sort=createdAt&order=desc');
    assert.equal(logs.pagination.pageSize, 5);
    assert.ok(items(logs).some((log) => log.eventType === 'auth' && log.action === 'login' && log.actorUsername === 'admin'));

    const slowAlert = await waitFor(async () => {
      const alerts = await api('/audit-alerts?status=all&alertType=slow_api&pageSize=20');
      const alert = items(alerts).find((item) => item.alertType === 'slow_api');
      assert.ok(alert, 'should create slow_api alert');
      assert.ok(['warning', 'critical'].includes(alert.severity));
      return alert;
    });
    config.audit.slowApiEnabled = false;

    const disposed = await api(`/audit-alerts/${slowAlert.id}/dispose`, {
      method: 'POST',
      body: {
        status: 'closed',
        severity: 'info',
        note: '接口自动化处置'
      }
    });
    assert.equal(disposed.ok, true);

    const closedAlerts = await api('/audit-alerts?status=closed&severity=info&alertType=slow_api&q=接口自动化&pageSize=20');
    assert.ok(items(closedAlerts).some((alert) => alert.id === slowAlert.id && alert.dispositionNote === '接口自动化处置'));
  });

  await t.test('选科链路', async () => {
    const meta = await api('/meta');
    assert.equal(meta.tenant.id, 1);
    assert.ok(meta.campuses.length > 0);
    assert.ok(meta.academicYears.length > 0);
    assert.ok(meta.grades.length > 0);
    assert.ok(meta.subjects.some((subject) => subject.code === 'physics'));
    assert.ok(meta.combinations.length >= 12);
    context.campusId = meta.campuses[0].id;
    context.academicYearId = (meta.academicYears.find((item) => Number(item.isCurrent)) || meta.academicYears[0]).id;

    const combo = await api('/subject-combinations', {
      method: 'POST',
      body: {
        preferredSubject: 'physics',
        electiveSubjects: ['chemistry', 'biology']
      },
      expectedStatus: 201
    });
    assert.ok(Object.prototype.hasOwnProperty.call(combo, 'combinationKey'));

    await api('/subject-combinations', {
      method: 'POST',
      body: {
        preferredSubject: 'physics',
        electiveSubjects: ['chemistry']
      },
      expectedStatus: 400
    });

    const combinations = await api('/subject-combinations');
    const selected = combinations.find((item) => item.combinationKey === 'physics+biology+chemistry');
    assert.ok(selected);
    context.comboId = selected.id;
  });

  await t.test('学生链路', async () => {
    const [meta, classesPayload] = await Promise.all([api('/meta'), api('/classes')]);
    const classes = items(classesPayload);
    const grade = meta.grades.find((item) => item.name === '高一') || meta.grades[0];
    const clazz = classes[0];
    assert.ok(grade?.id);
    assert.ok(clazz?.id);

    const studentNo = `API${runId.toUpperCase()}`.slice(0, 30);
    const studentPayload = {
      studentNo,
      name: '接口测试学生',
      gender: '男',
      birthDate: '2009-09-09',
      gradeId: grade.id,
      campusId: context.campusId,
      academicYearId: context.academicYearId,
      classId: clazz.id,
      subjectComboId: context.comboId,
      enrollmentYear: 2026,
      phone: '13999990000',
      guardianName: '测试监护人',
      guardianPhone: '13899990000',
      status: '在读'
    };
    const created = await api('/students', {
      method: 'POST',
      body: studentPayload,
      expectedStatus: 201
    });
    assert.ok(created.id);

    context.gradeId = grade.id;
    context.classId = clazz.id;
    context.studentId = created.id;

    const students = items(await api('/students'));
    const student = students.find((item) => item.id === created.id);
    assert.equal(student.studentNo, studentNo);

    await api(`/students/${created.id}`, {
      method: 'PUT',
      body: {
        ...studentPayload,
        phone: '13999991111',
        guardianPhone: '13899991111'
      }
    });

    const updated = items(await api('/students')).find((item) => item.id === created.id);
    assert.equal(updated.phone, '13999991111');
  });

  await t.test('Excel 导入导出与批量校验', async () => {
    const me = await api('/auth/me');
    assert.ok(me.user.permissions.includes('teachers.bulk'));
    assert.ok(me.user.permissions.includes('students.bulk'));

    const teacherTemplate = await apiExcelDownload('/teachers/template');
    const teacherTemplateWorkbook = await workbookFromBuffer(teacherTemplate);
    assert.ok(teacherTemplateWorkbook.getWorksheet('教师导入'));

    const teacherExport = await apiExcelDownload('/teachers/export');
    const teacherExportWorkbook = await workbookFromBuffer(teacherExport);
    assert.ok(teacherExportWorkbook.worksheets[0].rowCount >= 1);

    const teacherHeaders = ['工号', '姓名', '性别', '学科代码', '学科名称', '职称', '电话', '邮箱', '状态'];
    const teacherNo = `TB${runId.toUpperCase()}`.slice(0, 30);
    const invalidTeachers = await workbookBuffer(teacherHeaders, [[teacherNo, '批量教师', '男', 'missing_subject', '', '', '', '', 'active']]);
    const invalidTeacherReport = await apiExcelImport('/teachers/import', invalidTeachers);
    assert.equal(invalidTeacherReport.invalid, 1);

    const validTeachers = await workbookBuffer(teacherHeaders, [[teacherNo, '批量教师', '男', 'math', '数学', '一级教师', '13600000000', 'bulk.teacher@example.edu', 'active']]);
    const teacherReport = await apiExcelImport('/teachers/import', validTeachers);
    assert.equal(teacherReport.invalid, 0);
    assert.equal(teacherReport.create, 1);

    const teacherImport = await apiExcelImport('/teachers/import', validTeachers, { dryRun: false, expectedStatus: 201 });
    assert.equal(teacherImport.imported.created, 1);
    const teachers = items(await api('/teachers'));
    assert.ok(teachers.some((teacher) => teacher.employeeNo === teacherNo));

    const [meta, classesPayload] = await Promise.all([api('/meta'), api('/classes')]);
    const classes = items(classesPayload);
    const grade = meta.grades.find((item) => item.id === context.gradeId) || meta.grades[0];
    const clazz = classes.find((item) => item.id === context.classId) || classes[0];
    const combo = meta.combinations.find((item) => item.id === context.comboId) || meta.combinations[0];
    const studentTemplate = await apiExcelDownload('/students/template');
    const studentTemplateWorkbook = await workbookFromBuffer(studentTemplate);
    assert.ok(studentTemplateWorkbook.getWorksheet('学生导入'));

    const studentHeaders = ['学号', '姓名', '性别', '出生日期', '年级', '行政班', '选科组合', '选科组合代码', '入学年份', '学生电话', '监护人', '监护人电话', '状态'];
    const studentNo = `SB${runId.toUpperCase()}`.slice(0, 30);
    const duplicateStudents = await workbookBuffer(studentHeaders, [
      [studentNo, '批量学生', '女', '2009-10-01', grade.name, clazz.name, combo.label, combo.combinationKey, 2026, '13910000000', '批量监护人', '13810000000', '在读'],
      [studentNo, '批量学生2', '女', '2009-10-02', grade.name, clazz.name, combo.label, combo.combinationKey, 2026, '13910000001', '批量监护人', '13810000001', '在读']
    ]);
    const duplicateReport = await apiExcelImport('/students/import', duplicateStudents);
    assert.equal(duplicateReport.invalid, 1);

    const validStudents = await workbookBuffer(studentHeaders, [
      [studentNo, '批量学生', '女', '2009-10-01', grade.name, clazz.name, combo.label, combo.combinationKey, 2026, '13910000000', '批量监护人', '13810000000', '在读']
    ]);
    const studentReport = await apiExcelImport('/students/import', validStudents);
    assert.equal(studentReport.invalid, 0);
    assert.equal(studentReport.create, 1);

    const studentImport = await apiExcelImport('/students/import', validStudents, { dryRun: false, expectedStatus: 201 });
    assert.equal(studentImport.imported.created, 1);
    const students = items(await api('/students'));
    assert.ok(students.some((student) => student.studentNo === studentNo));

    const studentExport = await apiExcelDownload('/students/export');
    const studentExportWorkbook = await workbookFromBuffer(studentExport);
    assert.ok(studentExportWorkbook.worksheets[0].rowCount >= 1);
  });

  await t.test('分页筛选排序链路', async () => {
    const teacherPage = await api('/teachers?page=1&pageSize=2&sort=name&order=asc&q=批量');
    assert.equal(teacherPage.pagination.page, 1);
    assert.equal(teacherPage.pagination.pageSize, 2);
    assert.ok(teacherPage.pagination.total >= 1);
    assert.ok(items(teacherPage).every((teacher) => teacher.name.includes('批量') || teacher.employeeNo.includes('批量')));
    assert.equal(teacherPage.sort.key, 'name');
    assert.equal(teacherPage.sort.order, 'asc');

    const studentPage = await api('/students?page=1&pageSize=1&sort=studentNo&order=asc&status=在读');
    assert.equal(studentPage.pagination.pageSize, 1);
    assert.ok(studentPage.pagination.total >= 1);
    assert.ok(items(studentPage).every((student) => student.status === '在读'));

    const classPage = await api(`/classes?page=1&pageSize=1&gradeId=${context.gradeId}&sort=name&order=asc`);
    assert.equal(classPage.pagination.pageSize, 1);
    assert.ok(classPage.pagination.total >= 1);
    assert.ok(items(classPage).every((item) => item.gradeId === context.gradeId));

    const studentOrgPage = await api(`/students?page=1&pageSize=5&campusId=${context.campusId}&academicYearId=${context.academicYearId}`);
    assert.ok(items(studentOrgPage).every((student) => student.campusId === context.campusId && student.academicYearId === context.academicYearId));
  });

  await t.test('课表链路', async () => {
    const [teachersPayload, meta] = await Promise.all([api('/teachers?pageSize=100'), api('/meta')]);
    const teachers = items(teachersPayload);
    const physicsTeacher = teachers.find((teacher) => teacher.subjectCode === 'physics') || teachers[0];
    const room = meta.rooms[0];
    assert.ok(physicsTeacher?.id);
    context.teacherId = physicsTeacher.id;

    const teachingClass = await api('/teaching-classes', {
      method: 'POST',
      body: {
        gradeId: context.gradeId,
        campusId: context.campusId,
        academicYearId: context.academicYearId,
        subjectCode: 'physics',
        name: `接口物理班${runId}`,
        teacherId: physicsTeacher.id,
        subjectComboId: context.comboId,
        capacity: 45,
        roomId: room?.id || ''
      },
      expectedStatus: 201
    });
    assert.ok(teachingClass.id);
    context.teachingClassId = teachingClass.id;

    const enroll = await api(`/teaching-classes/${teachingClass.id}/enroll-by-combo`, {
      method: 'POST',
      body: {}
    });
    assert.ok(Number(enroll.enrolled) >= 1);

    const timetable = await api('/timetable', {
      method: 'POST',
      body: {
        semester: `接口测试${runId}`,
        campusId: context.campusId,
        academicYearId: context.academicYearId,
        weekday: 5,
        period: 8,
        classId: '',
        teachingClassId: teachingClass.id,
        roomId: room?.id || '',
        note: '接口自动化测试'
      },
      expectedStatus: 201
    });
    assert.ok(timetable.id);

    const entries = await api(`/timetable?semester=${encodeURIComponent(`接口测试${runId}`)}`);
    assert.ok(entries.some((entry) => entry.id === timetable.id));

    const conflicts = await api('/timetable/conflicts', {
      method: 'POST',
      body: {
        semester: `接口测试${runId}`,
        campusId: context.campusId,
        academicYearId: context.academicYearId,
        weekday: 5,
        period: 8,
        classId: '',
        teachingClassId: teachingClass.id,
        roomId: room?.id || '',
        note: '冲突检测'
      }
    });
    assert.equal(conflicts.ok, false);
    assert.ok(conflicts.conflicts.some((conflict) => ['teaching_class', 'teacher', 'room', 'student'].includes(conflict.type)));

    await api('/timetable', {
      method: 'POST',
      body: {
        semester: `接口测试${runId}`,
        campusId: context.campusId,
        academicYearId: context.academicYearId,
        weekday: 5,
        period: 8,
        classId: '',
        teachingClassId: teachingClass.id,
        roomId: room?.id || '',
        note: '冲突写入'
      },
      expectedStatus: 409
    });

    const evening = await api('/timetable', {
      method: 'POST',
      body: {
        semester: `接口测试${runId}`,
        campusId: context.campusId,
        academicYearId: context.academicYearId,
        weekday: 1,
        period: 9,
        classId: context.classId,
        teachingClassId: '',
        roomId: '',
        note: '晚自习'
      },
      expectedStatus: 201
    });
    assert.ok(evening.id);

    const eveningEntries = await api(`/timetable?semester=${encodeURIComponent(`接口测试${runId}`)}`);
    assert.ok(eveningEntries.some((entry) => entry.id === evening.id && entry.slotType === 'evening' && entry.note === '晚自习'));

    const autoSchedule = await api('/timetable/auto-schedule', {
      method: 'POST',
      body: {
        semester: `自动排课${runId}`,
        gradeId: context.gradeId,
        campusId: context.campusId,
        academicYearId: context.academicYearId,
        overwrite: true,
        includeEvening: false,
        maxDailyPeriods: 6
      },
      expectedStatus: 201
    });
    assert.ok(Number(autoSchedule.scheduled) > 0);

    const workload = await api(`/timetable/teacher-workload?semester=${encodeURIComponent(`自动排课${runId}`)}&gradeId=${context.gradeId}`);
    assert.ok(workload.some((item) => Number(item.totalPeriods) > 0 && Number(item.regularPeriods) > 0));

    const teachingClassPage = await api(`/teaching-classes?page=1&pageSize=1&sort=name&order=asc&q=${encodeURIComponent(`接口物理班${runId}`)}`);
    assert.equal(teachingClassPage.pagination.pageSize, 1);
    assert.ok(items(teachingClassPage).some((item) => item.id === teachingClass.id));
  });

  await t.test('教师多职务链路', async () => {
    const gradeLeader = await api('/teacher-duties', {
      method: 'POST',
      body: {
        teacherId: context.teacherId,
        roleType: 'grade_leader',
        campusId: context.campusId,
        academicYearId: context.academicYearId,
        gradeId: context.gradeId,
        note: '接口测试段长'
      },
      expectedStatus: 201
    });
    assert.ok(gradeLeader.id);

    const headTeacher = await api('/teacher-duties', {
      method: 'POST',
      body: {
        teacherId: context.teacherId,
        roleType: 'head_teacher',
        classId: context.classId,
        note: '接口测试班主任'
      },
      expectedStatus: 201
    });
    assert.ok(headTeacher.id);

    const courseTeacher = await api('/teacher-duties', {
      method: 'POST',
      body: {
        teacherId: context.teacherId,
        roleType: 'course_teacher',
        teachingClassId: context.teachingClassId,
        note: '接口测试任课老师'
      },
      expectedStatus: 201
    });
    assert.ok(courseTeacher.id);

    const duties = await api(`/teacher-duties?teacherId=${context.teacherId}`);
    const roleTypes = duties.map((duty) => duty.roleType);
    assert.ok(roleTypes.includes('grade_leader'));
    assert.ok(roleTypes.includes('head_teacher'));
    assert.ok(roleTypes.includes('course_teacher'));

    const teacherPage = await api(`/teachers?page=1&pageSize=50&sort=id&order=desc`);
    const teacher = items(teacherPage).find((item) => item.id === context.teacherId);
    assert.ok(teacher.duties.some((duty) => duty.roleLabel === '段长'));
    assert.ok(teacher.duties.some((duty) => duty.roleLabel === '班主任'));
    assert.ok(teacher.duties.some((duty) => duty.roleLabel === '任课老师'));

    const classPage = await api(`/classes?page=1&pageSize=20&gradeId=${context.gradeId}&sort=name&order=asc`);
    assert.ok(items(classPage).some((item) => item.id === context.classId && item.headTeacherId === context.teacherId));
  });

  await t.test('成绩链路', async () => {
    const exam = await api('/exams', {
      method: 'POST',
      body: {
        gradeId: context.gradeId,
        academicYearId: context.academicYearId,
        name: `接口测试考试${runId}`,
        semester: `接口测试${runId}`,
        examDate: '2026-05-12',
        examType: '月考'
      },
      expectedStatus: 201
    });
    assert.ok(exam.id);
    context.examId = exam.id;

    await api('/exam-scores', {
      method: 'POST',
      body: {
        examId: exam.id,
        studentId: context.studentId,
        subjectCode: 'physics',
        rawScore: 91.5,
        standardScore: 94,
        rankInGrade: 1
      },
      expectedStatus: 201
    });

    let scores = items(await api(`/exam-scores?examId=${exam.id}&pageSize=20`));
    let score = scores.find((item) => item.studentId === context.studentId && item.subjectCode === 'physics');
    assert.equal(Number(score.rawScore), 91.5);

    await api(`/exams/${exam.id}/recalculate-ranks`, {
      method: 'POST',
      body: {}
    });

    scores = items(await api(`/exam-scores?examId=${exam.id}&pageSize=20&sort=rankInGrade&order=asc`));
    score = scores.find((item) => item.studentId === context.studentId && item.subjectCode === 'physics');
    assert.equal(Number(score.rankInGrade), 1);

    const examPage = await api(`/exams?page=1&pageSize=1&q=${encodeURIComponent(`接口测试考试${runId}`)}&sort=examDate&order=desc`);
    assert.equal(examPage.pagination.total, 1);
    assert.equal(items(examPage)[0].id, exam.id);
  });

  await t.test('数据看板、成绩趋势和选科预测', async () => {
    const dashboard = await api(`/analytics/dashboard?gradeId=${context.gradeId}&academicYearId=${context.academicYearId}`);
    assert.ok(Number(dashboard.scoreSummary.examCount) >= 1);
    assert.ok(Number(dashboard.scoreSummary.scoreCount) >= 1);
    assert.ok(Array.isArray(dashboard.statusDistribution));
    assert.ok(dashboard.subjectAverages.some((item) => item.subjectCode === 'physics' && Number(item.scoreCount) >= 1));
    assert.equal(
      Number(dashboard.scoreBands.excellent) + Number(dashboard.scoreBands.passed) + Number(dashboard.scoreBands.needSupport) >= 1,
      true
    );

    const trends = await api(`/analytics/score-trends?gradeId=${context.gradeId}&subjectCode=physics`);
    assert.ok(
      trends.some(
        (item) => item.examId === context.examId && item.subjectCode === 'physics' && Number(item.averageScore) === 91.5 && Number(item.scoreCount) >= 1
      )
    );

    const predictions = await api(`/analytics/subject-combo-predictions?gradeId=${context.gradeId}&academicYearId=${context.academicYearId}`);
    assert.ok(Number(predictions.summary.totalStudents) >= 1);
    assert.ok(Array.isArray(predictions.items));
    const selectedCombo = predictions.items.find((item) => item.comboId === context.comboId);
    assert.ok(selectedCombo);
    assert.ok(Number(selectedCombo.projectedStudents) >= Number(selectedCombo.currentStudents));
    assert.ok(['high', 'medium', 'low'].includes(selectedCombo.confidence));
    assert.ok(['high', 'medium', 'low'].includes(selectedCombo.riskLevel));
  });
});
