export const ddl = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    role ENUM('admin', 'academic', 'teacher', 'head_teacher', 'student') NOT NULL DEFAULT 'academic',
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS grades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(30) NOT NULL UNIQUE,
    entry_year INT NOT NULL,
    status ENUM('active', 'graduated') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS subjects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(30) NOT NULL,
    category ENUM('required', 'preferred', 'elective') NOT NULL,
    gaokao_role VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS subject_combinations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    combination_key VARCHAR(80) NOT NULL UNIQUE,
    label VARCHAR(80) NOT NULL,
    preferred_subject VARCHAR(30) NOT NULL,
    elective_subjects JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS teachers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    employee_no VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(60) NOT NULL,
    gender ENUM('男', '女') NULL,
    subject_code VARCHAR(30) NOT NULL,
    title VARCHAR(50) NULL,
    phone VARCHAR(30) NULL,
    email VARCHAR(100) NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_teachers_subject FOREIGN KEY (subject_code) REFERENCES subjects(code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS classes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    grade_id INT NOT NULL,
    name VARCHAR(40) NOT NULL,
    track_type ENUM('行政班', '物理方向', '历史方向', '综合') NOT NULL DEFAULT '综合',
    head_teacher_id INT NULL,
    capacity INT NOT NULL DEFAULT 50,
    room VARCHAR(30) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_grade_class_name (grade_id, name),
    CONSTRAINT fk_classes_grade FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE,
    CONSTRAINT fk_classes_head_teacher FOREIGN KEY (head_teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_no VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(60) NOT NULL,
    gender ENUM('男', '女') NULL,
    birth_date DATE NULL,
    grade_id INT NOT NULL,
    class_id INT NULL,
    subject_combo_id INT NULL,
    enrollment_year INT NOT NULL,
    phone VARCHAR(30) NULL,
    guardian_name VARCHAR(60) NULL,
    guardian_phone VARCHAR(30) NULL,
    status ENUM('在读', '休学', '转出', '毕业') NOT NULL DEFAULT '在读',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_students_grade FOREIGN KEY (grade_id) REFERENCES grades(id),
    CONSTRAINT fk_students_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
    CONSTRAINT fk_students_combo FOREIGN KEY (subject_combo_id) REFERENCES subject_combinations(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(40) NOT NULL UNIQUE,
    building VARCHAR(40) NULL,
    capacity INT NOT NULL DEFAULT 50,
    room_type ENUM('普通教室', '实验室', '机房', '功能教室') NOT NULL DEFAULT '普通教室'
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS course_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    grade_id INT NOT NULL,
    subject_code VARCHAR(30) NOT NULL,
    semester VARCHAR(20) NOT NULL,
    weekly_hours INT NOT NULL DEFAULT 2,
    level ENUM('基础', '合格考', '选择性考试') NOT NULL DEFAULT '基础',
    UNIQUE KEY uk_course_plan (grade_id, subject_code, semester),
    CONSTRAINT fk_course_plans_grade FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE,
    CONSTRAINT fk_course_plans_subject FOREIGN KEY (subject_code) REFERENCES subjects(code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS teaching_classes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    grade_id INT NOT NULL,
    subject_code VARCHAR(30) NOT NULL,
    name VARCHAR(60) NOT NULL,
    teacher_id INT NULL,
    subject_combo_id INT NULL,
    capacity INT NOT NULL DEFAULT 45,
    room_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_teaching_class (grade_id, subject_code, name),
    CONSTRAINT fk_teaching_classes_grade FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE,
    CONSTRAINT fk_teaching_classes_subject FOREIGN KEY (subject_code) REFERENCES subjects(code),
    CONSTRAINT fk_teaching_classes_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
    CONSTRAINT fk_teaching_classes_combo FOREIGN KEY (subject_combo_id) REFERENCES subject_combinations(id) ON DELETE SET NULL,
    CONSTRAINT fk_teaching_classes_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS teaching_class_students (
    teaching_class_id INT NOT NULL,
    student_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (teaching_class_id, student_id),
    CONSTRAINT fk_tcs_teaching_class FOREIGN KEY (teaching_class_id) REFERENCES teaching_classes(id) ON DELETE CASCADE,
    CONSTRAINT fk_tcs_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS timetable_slots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    weekday TINYINT NOT NULL,
    period TINYINT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    UNIQUE KEY uk_slot (weekday, period)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS timetable_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    semester VARCHAR(20) NOT NULL,
    slot_id INT NOT NULL,
    class_id INT NULL,
    teaching_class_id INT NULL,
    room_id INT NULL,
    note VARCHAR(120) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_timetable_slot FOREIGN KEY (slot_id) REFERENCES timetable_slots(id) ON DELETE CASCADE,
    CONSTRAINT fk_timetable_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    CONSTRAINT fk_timetable_teaching_class FOREIGN KEY (teaching_class_id) REFERENCES teaching_classes(id) ON DELETE CASCADE,
    CONSTRAINT fk_timetable_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS exams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    grade_id INT NOT NULL,
    name VARCHAR(80) NOT NULL,
    semester VARCHAR(20) NOT NULL,
    exam_date DATE NOT NULL,
    exam_type ENUM('月考', '期中', '期末', '联考', '模拟考') NOT NULL DEFAULT '月考',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_exams_grade FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS exam_scores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    exam_id INT NOT NULL,
    student_id INT NOT NULL,
    subject_code VARCHAR(30) NOT NULL,
    raw_score DECIMAL(5,1) NOT NULL,
    standard_score DECIMAL(5,1) NULL,
    rank_in_grade INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_exam_score (exam_id, student_id, subject_code),
    CONSTRAINT fk_scores_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    CONSTRAINT fk_scores_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT fk_scores_subject FOREIGN KEY (subject_code) REFERENCES subjects(code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS announcements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    target_role VARCHAR(40) NOT NULL DEFAULT 'all',
    published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

const subjectSeeds = [
  ['chinese', '语文', 'required', '统一高考'],
  ['math', '数学', 'required', '统一高考'],
  ['english', '外语', 'required', '统一高考'],
  ['physics', '物理', 'preferred', '首选科目'],
  ['history', '历史', 'preferred', '首选科目'],
  ['chemistry', '化学', 'elective', '再选科目'],
  ['biology', '生物', 'elective', '再选科目'],
  ['politics', '思想政治', 'elective', '再选科目'],
  ['geography', '地理', 'elective', '再选科目'],
  ['pe', '体育', 'required', '综合素质'],
  ['information', '信息技术', 'required', '综合素质']
];

const preferredSubjectNames = {
  physics: '物理',
  history: '历史'
};

const electiveSubjectNames = {
  chemistry: '化学',
  biology: '生物',
  politics: '政治',
  geography: '地理'
};

export function buildCombination(preferredSubject, electiveSubjects) {
  const electives = [...electiveSubjects].sort();
  const key = [preferredSubject, ...electives].join('+');
  const label = `${preferredSubjectNames[preferredSubject]} + ${electives.map((code) => electiveSubjectNames[code]).join(' + ')}`;
  return { key, label, preferredSubject, electives };
}

export function allNewGaokaoCombinations() {
  const electiveCodes = Object.keys(electiveSubjectNames);
  const pairs = [];
  for (let i = 0; i < electiveCodes.length; i += 1) {
    for (let j = i + 1; j < electiveCodes.length; j += 1) {
      pairs.push([electiveCodes[i], electiveCodes[j]]);
    }
  }

  return ['physics', 'history'].flatMap((preferredSubject) =>
    pairs.map((pair) => buildCombination(preferredSubject, pair))
  );
}

async function seedColumnExists(pool, tableName, columnName) {
  const [rows] = await pool.execute(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function seedTableExists(pool, tableName) {
  const [rows] = await pool.execute(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function applyDefaultOrgContext(pool) {
  if (!(await seedColumnExists(pool, 'users', 'tenant_id'))) return;

  for (const tableName of [
    'users',
    'grades',
    'subject_combinations',
    'teachers',
    'classes',
    'students',
    'rooms',
    'course_plans',
    'teaching_classes',
    'timetable_entries',
    'exams',
    'announcements'
  ]) {
    await pool.execute(`UPDATE ${tableName} SET tenant_id = 1 WHERE tenant_id IS NULL`);
  }

  for (const tableName of ['users', 'teachers', 'classes', 'students', 'rooms', 'teaching_classes', 'timetable_entries']) {
    await pool.execute(`UPDATE ${tableName} SET campus_id = 1 WHERE campus_id IS NULL`);
  }

  for (const tableName of ['users', 'grades', 'classes', 'students', 'course_plans', 'teaching_classes', 'timetable_entries', 'exams']) {
    await pool.execute(`UPDATE ${tableName} SET academic_year_id = 1 WHERE academic_year_id IS NULL`);
  }
}

async function seedTeacherDuties(pool) {
  if (!(await seedTableExists(pool, 'teacher_duties'))) return;

  await pool.execute(
    `INSERT INTO teacher_duties
       (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, note)
     SELECT t.tenant_id, t.campus_id, g.academic_year_id, t.id, 'grade_leader', g.id, '示例段长'
     FROM teachers t
     JOIN grades g ON g.tenant_id = t.tenant_id AND g.name = '高一'
     WHERE t.employee_no = 'T2026001'
       AND NOT EXISTS (
         SELECT 1 FROM teacher_duties existing
         WHERE existing.tenant_id = t.tenant_id
           AND existing.teacher_id = t.id
           AND existing.role_type = 'grade_leader'
           AND existing.grade_id = g.id
       )`
  );

  await pool.execute(
    `INSERT INTO teacher_duties
       (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, note)
     SELECT t.tenant_id, t.campus_id, g.academic_year_id, t.id, 'deputy_grade_leader', g.id, '示例副段长'
     FROM teachers t
     JOIN grades g ON g.tenant_id = t.tenant_id AND g.name = '高一'
     WHERE t.employee_no = 'T2026002'
       AND NOT EXISTS (
         SELECT 1 FROM teacher_duties existing
         WHERE existing.tenant_id = t.tenant_id
           AND existing.teacher_id = t.id
           AND existing.role_type = 'deputy_grade_leader'
           AND existing.grade_id = g.id
       )`
  );

  await pool.execute(
    `INSERT INTO teacher_duties
       (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, subject_code, note)
     SELECT t.tenant_id, t.campus_id, g.academic_year_id, t.id, 'grade_subject_leader', g.id, 'physics', '示例年级学科负责人'
     FROM teachers t
     JOIN grades g ON g.tenant_id = t.tenant_id AND g.name = '高一'
     WHERE t.employee_no = 'T2026004'
       AND NOT EXISTS (
         SELECT 1 FROM teacher_duties existing
         WHERE existing.tenant_id = t.tenant_id
           AND existing.teacher_id = t.id
           AND existing.role_type = 'grade_subject_leader'
           AND existing.grade_id = g.id
           AND existing.subject_code = 'physics'
       )`
  );

  await pool.execute(
    `INSERT INTO teacher_duties
       (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, class_id, note)
     SELECT c.tenant_id, c.campus_id, c.academic_year_id, c.head_teacher_id, 'head_teacher', c.grade_id, c.id, '行政班班主任'
     FROM classes c
     WHERE c.head_teacher_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM teacher_duties existing
         WHERE existing.tenant_id = c.tenant_id
           AND existing.role_type = 'head_teacher'
           AND existing.class_id = c.id
       )`
  );

  await pool.execute(
    `INSERT INTO teacher_duties
       (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, subject_code, teaching_class_id, note)
     SELECT tc.tenant_id, tc.campus_id, tc.academic_year_id, tc.teacher_id, 'course_teacher', tc.grade_id, tc.subject_code, tc.id, '教学班任课老师'
     FROM teaching_classes tc
     WHERE tc.teacher_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM teacher_duties existing
         WHERE existing.tenant_id = tc.tenant_id
           AND existing.role_type = 'course_teacher'
           AND existing.teaching_class_id = tc.id
       )`
  );
}

export async function seedDatabase(pool, { adminPasswordHash, forceAdminPasswordChange = true } = {}) {
  const [admins] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', ['admin']);

  if (admins.length === 0) {
    if (!adminPasswordHash) {
      throw new Error('初始化管理员账号需要提供初始密码');
    }

    await pool.execute(
      `INSERT INTO users (username, password_hash, display_name, role, enabled, must_change_password)
       VALUES ('admin', ?, '系统管理员', 'admin', 1, ?)`,
      [adminPasswordHash, forceAdminPasswordChange ? 1 : 0]
    );
  } else {
    await pool.execute(
      `UPDATE users
       SET display_name = '系统管理员', role = 'admin', enabled = 1
       WHERE username = 'admin'`
    );
  }

  await pool.execute(
    `INSERT INTO grades (name, entry_year, status)
     VALUES ('高一', 2026, 'active'), ('高二', 2025, 'active'), ('高三', 2024, 'active')
     ON DUPLICATE KEY UPDATE entry_year = VALUES(entry_year), status = VALUES(status)`
  );

  for (const subject of subjectSeeds) {
    await pool.execute(
      `INSERT INTO subjects (code, name, category, gaokao_role)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), gaokao_role = VALUES(gaokao_role)`,
      subject
    );
  }

  for (const combo of allNewGaokaoCombinations()) {
    await pool.execute(
      `INSERT INTO subject_combinations (combination_key, label, preferred_subject, elective_subjects)
       VALUES (?, ?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE label = VALUES(label), preferred_subject = VALUES(preferred_subject), elective_subjects = VALUES(elective_subjects)`,
      [combo.key, combo.label, combo.preferredSubject, JSON.stringify(combo.electives)]
    );
  }

  const teachers = [
    ['T2026001', '王立新', '男', 'chinese', '高级教师', '13800000001', 'wanglx@example.edu'],
    ['T2026002', '李敏', '女', 'math', '一级教师', '13800000002', 'limin@example.edu'],
    ['T2026003', '张启航', '男', 'english', '一级教师', '13800000003', 'zhangqh@example.edu'],
    ['T2026004', '周蕾', '女', 'physics', '高级教师', '13800000004', 'zhoulei@example.edu'],
    ['T2026005', '陈思远', '男', 'history', '高级教师', '13800000005', 'chensy@example.edu'],
    ['T2026006', '赵青', '女', 'chemistry', '一级教师', '13800000006', 'zhaoqing@example.edu']
  ];

  for (const teacher of teachers) {
    await pool.execute(
      `INSERT INTO teachers (employee_no, name, gender, subject_code, title, phone, email)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), gender = VALUES(gender), subject_code = VALUES(subject_code),
       title = VALUES(title), phone = VALUES(phone), email = VALUES(email)`,
      teacher
    );
  }

  await pool.execute(
    `INSERT INTO rooms (name, building, capacity, room_type)
     VALUES
       ('明德楼101', '明德楼', 50, '普通教室'),
       ('明德楼102', '明德楼', 50, '普通教室'),
       ('格物楼301', '格物楼', 48, '实验室'),
       ('致知楼201', '致知楼', 45, '功能教室')
     ON DUPLICATE KEY UPDATE building = VALUES(building), capacity = VALUES(capacity), room_type = VALUES(room_type)`
  );

  await pool.execute(
    `INSERT INTO classes (grade_id, name, track_type, head_teacher_id, capacity, room)
     SELECT g.id, '高一1班', '综合', t.id, 50, '明德楼101'
     FROM grades g LEFT JOIN teachers t ON t.employee_no = 'T2026001'
     WHERE g.name = '高一'
     ON DUPLICATE KEY UPDATE head_teacher_id = VALUES(head_teacher_id), capacity = VALUES(capacity), room = VALUES(room)`
  );
  await pool.execute(
    `INSERT INTO classes (grade_id, name, track_type, head_teacher_id, capacity, room)
     SELECT g.id, '高一2班', '综合', t.id, 50, '明德楼102'
     FROM grades g LEFT JOIN teachers t ON t.employee_no = 'T2026002'
     WHERE g.name = '高一'
     ON DUPLICATE KEY UPDATE head_teacher_id = VALUES(head_teacher_id), capacity = VALUES(capacity), room = VALUES(room)`
  );

  const coursePlans = [
    ['chinese', '2026春', 5, '基础'],
    ['math', '2026春', 5, '基础'],
    ['english', '2026春', 4, '基础'],
    ['physics', '2026春', 3, '选择性考试'],
    ['history', '2026春', 3, '选择性考试'],
    ['chemistry', '2026春', 3, '选择性考试'],
    ['biology', '2026春', 3, '选择性考试'],
    ['politics', '2026春', 2, '选择性考试'],
    ['geography', '2026春', 2, '选择性考试']
  ];
  for (const [subjectCode, semester, weeklyHours, level] of coursePlans) {
    await pool.execute(
      `INSERT INTO course_plans (grade_id, subject_code, semester, weekly_hours, level)
       SELECT id, ?, ?, ?, ? FROM grades WHERE name = '高一'
       ON DUPLICATE KEY UPDATE weekly_hours = VALUES(weekly_hours), level = VALUES(level)`,
      [subjectCode, semester, weeklyHours, level]
    );
  }

  const slots = [
    ['08:00:00', '08:40:00'],
    ['08:50:00', '09:30:00'],
    ['09:50:00', '10:30:00'],
    ['10:40:00', '11:20:00'],
    ['14:00:00', '14:40:00'],
    ['14:50:00', '15:30:00'],
    ['15:50:00', '16:30:00'],
    ['16:40:00', '17:20:00']
  ];
  for (let weekday = 1; weekday <= 5; weekday += 1) {
    for (let period = 1; period <= slots.length; period += 1) {
      await pool.execute(
        `INSERT INTO timetable_slots (weekday, period, start_time, end_time)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time)`,
        [weekday, period, slots[period - 1][0], slots[period - 1][1]]
      );
    }
  }

  const students = [
    ['S20260001', '刘一诺', '女', '2009-03-12', '高一1班', 'physics+biology+chemistry', '13900000001', '刘女士', '13700000001'],
    ['S20260002', '陈宇航', '男', '2009-07-08', '高一1班', 'history+geography+politics', '13900000002', '陈先生', '13700000002'],
    ['S20260003', '赵雨桐', '女', '2009-11-20', '高一2班', 'physics+chemistry+geography', '13900000003', '赵女士', '13700000003'],
    ['S20260004', '孙泽', '男', '2009-05-16', '高一2班', 'history+biology+politics', '13900000004', '孙先生', '13700000004']
  ];

  for (const student of students) {
    await pool.execute(
      `INSERT INTO students
       (student_no, name, gender, birth_date, grade_id, class_id, subject_combo_id, enrollment_year, phone, guardian_name, guardian_phone)
       SELECT ?, ?, ?, ?, g.id, c.id, sc.id, 2026, ?, ?, ?
       FROM grades g
       JOIN classes c ON c.grade_id = g.id AND c.name = ?
       JOIN subject_combinations sc ON sc.combination_key = ?
       WHERE g.name = '高一'
       ON DUPLICATE KEY UPDATE name = VALUES(name), gender = VALUES(gender), birth_date = VALUES(birth_date),
       class_id = VALUES(class_id), subject_combo_id = VALUES(subject_combo_id), phone = VALUES(phone),
       guardian_name = VALUES(guardian_name), guardian_phone = VALUES(guardian_phone)`,
      [
        student[0],
        student[1],
        student[2],
        student[3],
        student[6],
        student[7],
        student[8],
        student[4],
        student[5]
      ]
    );
  }

  await pool.execute(
    `INSERT INTO teaching_classes (grade_id, subject_code, name, teacher_id, capacity, room_id)
     SELECT g.id, 'physics', '高一物理A班', t.id, 45, r.id
     FROM grades g
     LEFT JOIN teachers t ON t.employee_no = 'T2026004'
     LEFT JOIN rooms r ON r.name = '格物楼301'
     WHERE g.name = '高一'
     ON DUPLICATE KEY UPDATE teacher_id = VALUES(teacher_id), capacity = VALUES(capacity), room_id = VALUES(room_id)`
  );

  await pool.execute(
    `INSERT INTO exams (grade_id, name, semester, exam_date, exam_type)
     SELECT id, '高一第一次月考', '2026春', '2026-03-28', '月考'
     FROM grades WHERE name = '高一' AND NOT EXISTS (
       SELECT 1 FROM exams WHERE name = '高一第一次月考' AND semester = '2026春'
     )`
  );

  await pool.execute(
    `INSERT INTO announcements (title, content, target_role)
     SELECT '新高考选科确认', '请班主任在本周内完成高一学生 3+1+2 选科确认与异常组合核对。', 'academic'
     WHERE NOT EXISTS (SELECT 1 FROM announcements WHERE title = '新高考选科确认')`
  );

  await applyDefaultOrgContext(pool);
  await seedTeacherDuties(pool);
}
