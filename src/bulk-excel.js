import ExcelJS from 'exceljs';
import { query, transaction } from './db.js';
import { AppError } from './errors.js';
import { studentSchema, teacherSchema } from './validators.js';

export const excelMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const maxImportRows = 1000;

const teacherColumns = [
  { key: 'employeeNo', header: '工号', aliases: ['employeeNo', 'employee_no'], width: 18, required: true },
  { key: 'name', header: '姓名', width: 16, required: true },
  { key: 'gender', header: '性别', width: 10 },
  { key: 'subjectCode', header: '学科代码', aliases: ['subjectCode', 'subject_code'], width: 16, required: true },
  { key: 'subjectName', header: '学科名称', aliases: ['subjectName'], width: 16 },
  { key: 'title', header: '职称', width: 18 },
  { key: 'phone', header: '电话', width: 18 },
  { key: 'email', header: '邮箱', width: 28 },
  { key: 'status', header: '状态', width: 14 }
];

const studentColumns = [
  { key: 'studentNo', header: '学号', aliases: ['studentNo', 'student_no'], width: 18, required: true },
  { key: 'name', header: '姓名', width: 16, required: true },
  { key: 'gender', header: '性别', width: 10 },
  { key: 'birthDate', header: '出生日期', aliases: ['birthDate', 'birth_date'], width: 14 },
  { key: 'gradeName', header: '年级', width: 14, required: true },
  { key: 'className', header: '行政班', width: 16 },
  { key: 'subjectComboLabel', header: '选科组合', aliases: ['subjectComboLabel'], width: 28 },
  { key: 'subjectComboKey', header: '选科组合代码', aliases: ['subjectComboKey', 'combinationKey'], width: 28 },
  { key: 'enrollmentYear', header: '入学年份', aliases: ['enrollmentYear'], width: 12, required: true },
  { key: 'phone', header: '学生电话', width: 18 },
  { key: 'guardianName', header: '监护人', aliases: ['guardianName'], width: 16 },
  { key: 'guardianPhone', header: '监护人电话', aliases: ['guardianPhone'], width: 18 },
  { key: 'status', header: '状态', width: 12 }
];

const teacherStatusLabels = {
  active: '在岗',
  inactive: '停用'
};

const teacherStatusValues = {
  active: 'active',
  inactive: 'inactive',
  在岗: 'active',
  停用: 'inactive',
  离职: 'inactive'
};

const studentStatusValues = new Set(['在读', '休学', '转出', '毕业']);
const genderValues = {
  男: '男',
  女: '女',
  male: '男',
  female: '女',
  m: '男',
  f: '女'
};

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function optionalText(value) {
  return normalizeText(value);
}

function normalizeGender(value) {
  const text = normalizeText(value);
  if (!text) return '';
  return genderValues[text] || genderValues[text.toLowerCase()] || text;
}

function normalizeTeacherStatus(value) {
  const text = normalizeText(value);
  if (!text) return 'active';
  return teacherStatusValues[text] || teacherStatusValues[text.toLowerCase()] || text;
}

function normalizeStudentStatus(value) {
  const text = normalizeText(value);
  return text || '在读';
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text || '').join('').trim();
    if (value.text !== undefined) return normalizeCellValue(value.text);
    if (value.result !== undefined) return normalizeCellValue(value.result);
    if (value.formula !== undefined) return normalizeCellValue(value.result ?? '');
  }
  return String(value).trim();
}

function headerLookup(columns) {
  const lookup = new Map();
  for (const column of columns) {
    for (const alias of [column.header, column.key, ...(column.aliases || [])]) {
      lookup.set(normalizeHeader(alias), column.key);
    }
  }
  return lookup;
}

function styleSheet(worksheet) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEFF3F7' }
  };
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD7DEE8' } },
        left: { style: 'thin', color: { argb: 'FFD7DEE8' } },
        bottom: { style: 'thin', color: { argb: 'FFD7DEE8' } },
        right: { style: 'thin', color: { argb: 'FFD7DEE8' } }
      };
      cell.alignment = { vertical: 'middle' };
    });
  });
}

async function workbookBuffer(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function addReferenceSheet(workbook, references) {
  const sheet = workbook.addWorksheet('字段说明');
  sheet.columns = [
    { header: '字段', key: 'field', width: 18 },
    { header: '要求', key: 'rule', width: 76 }
  ];
  sheet.addRows(references);
  styleSheet(sheet);
}

function addDataValidation(worksheet, columns, rules) {
  for (const [key, formula] of Object.entries(rules)) {
    const index = columns.findIndex((column) => column.key === key) + 1;
    if (!index) continue;
    for (let row = 2; row <= maxImportRows + 1; row += 1) {
      worksheet.getCell(row, index).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${formula}"`]
      };
    }
  }
}

async function buildWorkbook({ sheetName, columns, rows = [], references = [], validation = {} }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FIDES';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width || 18
  }));
  sheet.addRows(rows);
  addDataValidation(sheet, columns, validation);
  styleSheet(sheet);
  if (references.length) addReferenceSheet(workbook, references);
  return workbookBuffer(workbook);
}

async function parseRows(buffer, columns, sheetLabel) {
  if (!buffer?.length) {
    throw new AppError('请上传 Excel 文件', 400, 'EMPTY_IMPORT_FILE');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new AppError('无法解析 Excel 文件，请上传 .xlsx 工作簿', 400, 'INVALID_EXCEL_FILE');
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new AppError('Excel 文件中没有工作表', 400, 'EMPTY_WORKBOOK');
  }

  const expected = headerLookup(columns);
  const headerRow = worksheet.getRow(1);
  const columnIndexByKey = new Map();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = expected.get(normalizeHeader(normalizeCellValue(cell.value)));
    if (key && !columnIndexByKey.has(key)) columnIndexByKey.set(key, colNumber);
  });

  const missing = columns.filter((column) => column.required && !columnIndexByKey.has(column.key));
  if (missing.length) {
    throw new AppError(`${sheetLabel} Excel 缺少必填表头：${missing.map((column) => column.header).join('、')}`, 400, 'MISSING_EXCEL_HEADERS');
  }

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const excelRow = worksheet.getRow(rowNumber);
    const values = {};
    let hasValue = false;

    for (const column of columns) {
      const columnIndex = columnIndexByKey.get(column.key);
      const value = columnIndex ? normalizeCellValue(excelRow.getCell(columnIndex).value) : '';
      values[column.key] = value;
      if (value) hasValue = true;
    }

    if (!hasValue) continue;
    rows.push({ rowNumber, values });

    if (rows.length > maxImportRows) {
      throw new AppError(`单次最多导入 ${maxImportRows} 行`, 400, 'IMPORT_ROWS_LIMIT');
    }
  }

  if (!rows.length) {
    throw new AppError('Excel 文件中没有可导入数据', 400, 'EMPTY_IMPORT_ROWS');
  }

  return rows;
}

function zodMessages(result) {
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join('.') || '字段'}：${issue.message}`);
}

function report(entity, checkedRows) {
  const invalidRows = checkedRows.filter((row) => row.errors.length);
  const validRows = checkedRows.filter((row) => !row.errors.length);
  const createRows = validRows.filter((row) => row.action === 'create');
  const updateRows = validRows.filter((row) => row.action === 'update');

  return {
    entity,
    total: checkedRows.length,
    valid: validRows.length,
    invalid: invalidRows.length,
    create: createRows.length,
    update: updateRows.length,
    rows: checkedRows.map((row) => ({
      rowNumber: row.rowNumber,
      status: row.errors.length ? 'invalid' : 'valid',
      action: row.errors.length ? '-' : row.action,
      errors: row.errors,
      values: row.values
    }))
  };
}

async function referenceMaps({ tenantId = 1 } = {}) {
  const [subjects, grades, classes, combinations, teachers, students] = await Promise.all([
    query('SELECT code, name FROM subjects'),
    query('SELECT id, name FROM grades WHERE tenant_id = :tenantId', { tenantId }),
    query(
      `SELECT c.id, c.name, c.grade_id AS gradeId, g.name AS gradeName
       FROM classes c
       JOIN grades g ON g.id = c.grade_id
       WHERE c.tenant_id = :tenantId`,
      { tenantId }
    ),
    query('SELECT id, combination_key AS combinationKey, label FROM subject_combinations WHERE tenant_id = :tenantId', { tenantId }),
    query('SELECT employee_no AS employeeNo FROM teachers WHERE tenant_id = :tenantId', { tenantId }),
    query('SELECT student_no AS studentNo FROM students WHERE tenant_id = :tenantId', { tenantId })
  ]);

  return {
    subjectsByCode: new Map(subjects.map((item) => [item.code, item])),
    subjectsByName: new Map(subjects.map((item) => [item.name, item])),
    gradesByName: new Map(grades.map((item) => [item.name, item])),
    classesByGradeAndName: new Map(classes.map((item) => [`${item.gradeId}:${item.name}`, item])),
    combinationsByLabel: new Map(combinations.map((item) => [item.label, item])),
    combinationsByKey: new Map(combinations.map((item) => [item.combinationKey, item])),
    existingTeachers: new Set(teachers.map((item) => item.employeeNo)),
    existingStudents: new Set(students.map((item) => item.studentNo))
  };
}

function normalizeTeacherPayload(values, refs) {
  const subject = refs.subjectsByCode.get(values.subjectCode) || refs.subjectsByName.get(values.subjectName);
  return {
    employeeNo: normalizeText(values.employeeNo),
    name: normalizeText(values.name),
    gender: normalizeGender(values.gender),
    subjectCode: subject?.code || normalizeText(values.subjectCode),
    title: optionalText(values.title),
    phone: optionalText(values.phone),
    email: optionalText(values.email),
    status: normalizeTeacherStatus(values.status)
  };
}

function normalizeStudentPayload(values, refs) {
  const grade = refs.gradesByName.get(values.gradeName);
  const classRecord = grade && values.className ? refs.classesByGradeAndName.get(`${grade.id}:${values.className}`) : null;
  const combination =
    refs.combinationsByKey.get(values.subjectComboKey) ||
    refs.combinationsByLabel.get(values.subjectComboLabel);

  return {
    studentNo: normalizeText(values.studentNo),
    name: normalizeText(values.name),
    gender: normalizeGender(values.gender),
    birthDate: optionalText(values.birthDate),
    gradeId: grade?.id || '',
    classId: classRecord?.id || '',
    subjectComboId: combination?.id || '',
    enrollmentYear: values.enrollmentYear,
    phone: optionalText(values.phone),
    guardianName: optionalText(values.guardianName),
    guardianPhone: optionalText(values.guardianPhone),
    status: normalizeStudentStatus(values.status)
  };
}

function duplicateError(rowNumber, value, seen, label) {
  if (!value) return null;
  const firstRow = seen.get(value);
  if (firstRow) return `${label} 在文件内重复，首次出现在第 ${firstRow} 行`;
  seen.set(value, rowNumber);
  return null;
}

export async function teacherTemplateWorkbook() {
  return buildWorkbook({
    sheetName: '教师导入',
    columns: teacherColumns,
    rows: [
      {
        employeeNo: 'T2026001',
        name: '示例教师',
        gender: '女',
        subjectCode: 'math',
        subjectName: '数学',
        title: '一级教师',
        phone: '13800000000',
        email: 'teacher@example.edu',
        status: 'active'
      }
    ],
    validation: {
      gender: '男,女',
      status: 'active,inactive,在岗,停用'
    },
    references: [
      { field: '工号', rule: '必填，唯一；导入时按工号新增或更新。' },
      { field: '学科代码', rule: '必填，必须是系统 subjects.code，例如 chinese、math、physics。也可填写学科名称辅助核对。' },
      { field: '状态', rule: '可填 active/inactive，也可填 在岗/停用；空值默认 active。' }
    ]
  });
}

export async function studentTemplateWorkbook() {
  return buildWorkbook({
    sheetName: '学生导入',
    columns: studentColumns,
    rows: [
      {
        studentNo: 'S20260001',
        name: '示例学生',
        gender: '男',
        birthDate: '2009-09-01',
        gradeName: '高一',
        className: '高一1班',
        subjectComboLabel: '物理 + 化学 + 生物',
        subjectComboKey: 'physics+biology+chemistry',
        enrollmentYear: 2026,
        phone: '13900000000',
        guardianName: '示例监护人',
        guardianPhone: '13800000000',
        status: '在读'
      }
    ],
    validation: {
      gender: '男,女',
      status: '在读,休学,转出,毕业'
    },
    references: [
      { field: '学号', rule: '必填，唯一；导入时按学号新增或更新。' },
      { field: '年级', rule: '必填，必须与系统年级名称一致。' },
      { field: '行政班', rule: '选填；填写时必须属于对应年级。' },
      { field: '选科组合', rule: '选填；可填写组合名称或组合代码。' },
      { field: '状态', rule: '可填 在读、休学、转出、毕业；空值默认 在读。' }
    ]
  });
}

export async function teacherExportWorkbook(rows) {
  return buildWorkbook({
    sheetName: '教师档案',
    columns: teacherColumns,
    rows: rows.map((teacher) => ({
      employeeNo: teacher.employeeNo,
      name: teacher.name,
      gender: teacher.gender || '',
      subjectCode: teacher.subjectCode,
      subjectName: teacher.subjectName,
      title: teacher.title || '',
      phone: teacher.phone || '',
      email: teacher.email || '',
      status: teacherStatusLabels[teacher.status] || teacher.status
    }))
  });
}

export async function studentExportWorkbook(rows) {
  return buildWorkbook({
    sheetName: '学生档案',
    columns: studentColumns,
    rows: rows.map((student) => ({
      studentNo: student.studentNo,
      name: student.name,
      gender: student.gender || '',
      birthDate: student.birthDate || '',
      gradeName: student.gradeName,
      className: student.className || '',
      subjectComboLabel: student.subjectComboLabel || '',
      subjectComboKey: student.subjectComboKey || '',
      enrollmentYear: student.enrollmentYear,
      phone: student.phone || '',
      guardianName: student.guardianName || '',
      guardianPhone: student.guardianPhone || '',
      status: student.status
    }))
  });
}

export async function validateTeacherWorkbook(buffer, org = {}) {
  const rows = await parseRows(buffer, teacherColumns, '教师');
  const refs = await referenceMaps(org);
  const seen = new Map();
  const checkedRows = rows.map((row) => {
    const payload = normalizeTeacherPayload(row.values, refs);
    const errors = [];
    const duplicate = duplicateError(row.rowNumber, payload.employeeNo, seen, '工号');
    if (duplicate) errors.push(duplicate);
    if (!refs.subjectsByCode.has(payload.subjectCode)) errors.push('学科代码不存在');
    if (!['男', '女', ''].includes(payload.gender)) errors.push('性别只能填写男或女');
    if (!['active', 'inactive'].includes(payload.status)) errors.push('状态只能填写 active/inactive 或 在岗/停用');
    errors.push(...zodMessages(teacherSchema.safeParse(payload)));

    return {
      rowNumber: row.rowNumber,
      values: payload,
      payload,
      action: refs.existingTeachers.has(payload.employeeNo) ? 'update' : 'create',
      errors
    };
  });

  return {
    report: report('teachers', checkedRows),
    validRows: checkedRows.filter((row) => !row.errors.length)
  };
}

export async function validateStudentWorkbook(buffer, org = {}) {
  const rows = await parseRows(buffer, studentColumns, '学生');
  const refs = await referenceMaps(org);
  const seen = new Map();
  const checkedRows = rows.map((row) => {
    const payload = normalizeStudentPayload(row.values, refs);
    const errors = [];
    const duplicate = duplicateError(row.rowNumber, payload.studentNo, seen, '学号');
    if (duplicate) errors.push(duplicate);

    const grade = refs.gradesByName.get(row.values.gradeName);
    if (!grade) errors.push('年级不存在');
    if (row.values.className && !payload.classId) errors.push('行政班不存在或不属于该年级');
    if ((row.values.subjectComboLabel || row.values.subjectComboKey) && !payload.subjectComboId) errors.push('选科组合不存在');
    if (!['男', '女', ''].includes(payload.gender)) errors.push('性别只能填写男或女');
    if (!studentStatusValues.has(payload.status)) errors.push('状态只能填写在读、休学、转出、毕业');
    errors.push(...zodMessages(studentSchema.safeParse(payload)));

    return {
      rowNumber: row.rowNumber,
      values: payload,
      payload,
      action: refs.existingStudents.has(payload.studentNo) ? 'update' : 'create',
      errors
    };
  });

  return {
    report: report('students', checkedRows),
    validRows: checkedRows.filter((row) => !row.errors.length)
  };
}

export async function applyTeacherImport(validRows, { tenantId = 1, campusId = 1 } = {}) {
  let created = 0;
  let updated = 0;
  await transaction(async (connection) => {
    for (const row of validRows) {
      const teacher = row.payload;
      await connection.execute(
        `INSERT INTO teachers (tenant_id, campus_id, employee_no, name, gender, subject_code, title, phone, email, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           campus_id = VALUES(campus_id),
           name = VALUES(name),
           gender = VALUES(gender),
           subject_code = VALUES(subject_code),
           title = VALUES(title),
           phone = VALUES(phone),
           email = VALUES(email),
           status = VALUES(status)`,
        [
          tenantId,
          campusId,
          teacher.employeeNo,
          teacher.name,
          teacher.gender || null,
          teacher.subjectCode,
          teacher.title || null,
          teacher.phone || null,
          teacher.email || null,
          teacher.status || 'active'
        ]
      );
      if (row.action === 'create') created += 1;
      if (row.action === 'update') updated += 1;
    }
  });
  return { created, updated };
}

export async function applyStudentImport(validRows, { tenantId = 1, campusId = 1, academicYearId = 1 } = {}) {
  let created = 0;
  let updated = 0;
  await transaction(async (connection) => {
    for (const row of validRows) {
      const student = row.payload;
      await connection.execute(
        `INSERT INTO students
           (tenant_id, campus_id, academic_year_id, student_no, name, gender, birth_date, grade_id, class_id, subject_combo_id, enrollment_year,
            phone, guardian_name, guardian_phone, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           campus_id = VALUES(campus_id),
           academic_year_id = VALUES(academic_year_id),
           name = VALUES(name),
           gender = VALUES(gender),
           birth_date = VALUES(birth_date),
           grade_id = VALUES(grade_id),
           class_id = VALUES(class_id),
           subject_combo_id = VALUES(subject_combo_id),
           enrollment_year = VALUES(enrollment_year),
           phone = VALUES(phone),
           guardian_name = VALUES(guardian_name),
           guardian_phone = VALUES(guardian_phone),
           status = VALUES(status)`,
        [
          tenantId,
          campusId,
          academicYearId,
          student.studentNo,
          student.name,
          student.gender || null,
          student.birthDate || null,
          student.gradeId,
          student.classId || null,
          student.subjectComboId || null,
          Number(student.enrollmentYear),
          student.phone || null,
          student.guardianName || null,
          student.guardianPhone || null,
          student.status || '在读'
        ]
      );
      if (row.action === 'create') created += 1;
      if (row.action === 'update') updated += 1;
    }
  });
  return { created, updated };
}
