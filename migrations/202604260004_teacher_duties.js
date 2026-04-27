export const version = '202604260004';
export const name = 'teacher_duties';

export async function up({ execute }) {
  await execute(`
    CREATE TABLE IF NOT EXISTS teacher_duties (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      campus_id INT NULL,
      academic_year_id INT NULL,
      teacher_id INT NOT NULL,
      role_type ENUM('grade_leader', 'deputy_grade_leader', 'grade_subject_leader', 'head_teacher', 'course_teacher') NOT NULL,
      grade_id INT NULL,
      subject_code VARCHAR(30) NULL,
      class_id INT NULL,
      teaching_class_id INT NULL,
      note VARCHAR(120) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_teacher_duties_teacher (tenant_id, teacher_id),
      KEY idx_teacher_duties_role (tenant_id, role_type),
      KEY idx_teacher_duties_grade_subject (tenant_id, academic_year_id, grade_id, subject_code),
      KEY idx_teacher_duties_class (tenant_id, class_id),
      KEY idx_teacher_duties_teaching_class (tenant_id, teaching_class_id),
      CONSTRAINT fk_teacher_duties_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_teacher_duties_campus FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL,
      CONSTRAINT fk_teacher_duties_academic_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL,
      CONSTRAINT fk_teacher_duties_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
      CONSTRAINT fk_teacher_duties_grade FOREIGN KEY (grade_id) REFERENCES grades(id) ON DELETE SET NULL,
      CONSTRAINT fk_teacher_duties_subject FOREIGN KEY (subject_code) REFERENCES subjects(code) ON DELETE SET NULL,
      CONSTRAINT fk_teacher_duties_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      CONSTRAINT fk_teacher_duties_teaching_class FOREIGN KEY (teaching_class_id) REFERENCES teaching_classes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await execute(`
    INSERT INTO teacher_duties
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
      )
  `);

  await execute(`
    INSERT INTO teacher_duties
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
      )
  `);

  await execute(`
    INSERT INTO teacher_duties
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
      )
  `);

  await execute(`
    INSERT INTO teacher_duties
      (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, class_id, note)
    SELECT c.tenant_id, c.campus_id, c.academic_year_id, c.head_teacher_id, 'head_teacher', c.grade_id, c.id, '行政班班主任'
    FROM classes c
    WHERE c.head_teacher_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM teacher_duties existing
        WHERE existing.tenant_id = c.tenant_id
          AND existing.role_type = 'head_teacher'
          AND existing.class_id = c.id
      )
  `);

  await execute(`
    INSERT INTO teacher_duties
      (tenant_id, campus_id, academic_year_id, teacher_id, role_type, grade_id, subject_code, teaching_class_id, note)
    SELECT tc.tenant_id, tc.campus_id, tc.academic_year_id, tc.teacher_id, 'course_teacher', tc.grade_id, tc.subject_code, tc.id, '教学班任课老师'
    FROM teaching_classes tc
    WHERE tc.teacher_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM teacher_duties existing
        WHERE existing.tenant_id = tc.tenant_id
          AND existing.role_type = 'course_teacher'
          AND existing.teaching_class_id = tc.id
      )
  `);
}

export async function down({ execute }) {
  await execute('DROP TABLE IF EXISTS teacher_duties');
}
