export const roleLabels = {
  admin: '管理员',
  academic: '教务',
  head_teacher: '班主任',
  teacher: '教师',
  student: '学生'
};

export const pages = [
  { view: 'dashboard', label: '工作台', permission: 'page.dashboard' },
  { view: 'students', label: '学生管理', permission: 'page.students' },
  { view: 'teachers', label: '教师管理', permission: 'page.teachers' },
  { view: 'classes', label: '行政班', permission: 'page.classes' },
  { view: 'combos', label: '选科组合', permission: 'page.combinations' },
  { view: 'timetable', label: '排课管理', permission: 'page.timetable' },
  { view: 'exams', label: '考试成绩', permission: 'page.exams' },
  { view: 'audit', label: '安全审计', permission: 'page.audit' }
];

const permissions = {
  admin: [
    'page.dashboard',
    'page.students',
    'page.teachers',
    'page.classes',
    'page.combinations',
    'page.timetable',
    'page.exams',
    'page.audit',
    'dashboard.read',
    'analytics.read',
    'meta.read',
    'teachers.read',
    'teachers.write',
    'teachers.delete',
    'teachers.bulk',
    'classes.read',
    'classes.write',
    'classes.delete',
    'students.read',
    'students.write',
    'students.delete',
    'students.bulk',
    'accounts.issue_teacher',
    'accounts.issue_student',
    'subject_combinations.read',
    'subject_combinations.write',
    'teaching_classes.read',
    'teaching_classes.write',
    'teaching_classes.enroll',
    'timetable.read',
    'timetable.write',
    'timetable.delete',
    'exams.read',
    'exams.write',
    'exam_scores.read',
    'exam_scores.write',
    'exam_scores.rank',
    'audit_logs.read',
    'audit_alerts.read',
    'audit_alerts.acknowledge',
    'sms_messages.read',
    'sms_messages.send'
  ],
  academic: [
    'page.dashboard',
    'page.students',
    'page.teachers',
    'page.classes',
    'page.combinations',
    'page.timetable',
    'page.exams',
    'dashboard.read',
    'analytics.read',
    'meta.read',
    'teachers.read',
    'teachers.write',
    'teachers.delete',
    'teachers.bulk',
    'classes.read',
    'classes.write',
    'classes.delete',
    'students.read',
    'students.write',
    'students.delete',
    'students.bulk',
    'subject_combinations.read',
    'subject_combinations.write',
    'teaching_classes.read',
    'teaching_classes.write',
    'teaching_classes.enroll',
    'timetable.read',
    'timetable.write',
    'timetable.delete',
    'exams.read',
    'exams.write',
    'exam_scores.read',
    'exam_scores.write',
    'exam_scores.rank',
    'sms_messages.send'
  ],
  head_teacher: [
    'page.dashboard',
    'page.students',
    'page.classes',
    'page.timetable',
    'page.exams',
    'dashboard.read',
    'analytics.read',
    'meta.read',
    'teachers.read',
    'classes.read',
    'students.read',
    'students.write',
    'subject_combinations.read',
    'teaching_classes.read',
    'timetable.read',
    'exams.read',
    'exam_scores.read'
  ],
  teacher: [
    'page.dashboard',
    'page.students',
    'page.timetable',
    'page.exams',
    'dashboard.read',
    'analytics.read',
    'meta.read',
    'teachers.read',
    'classes.read',
    'students.read',
    'subject_combinations.read',
    'teaching_classes.read',
    'timetable.read',
    'exams.read',
    'exam_scores.read',
    'exam_scores.write'
  ],
  student: [
    'page.dashboard',
    'page.timetable',
    'page.exams',
    'dashboard.read',
    'analytics.read',
    'meta.read',
    'classes.read',
    'students.read',
    'subject_combinations.read',
    'teaching_classes.read',
    'timetable.read',
    'exams.read',
    'exam_scores.read'
  ]
};

export function permissionsForRole(role) {
  return permissions[role] || [];
}

export function hasPermission(role, permission) {
  return permissionsForRole(role).includes(permission);
}

export function permissionContextForRole(role) {
  const granted = permissionsForRole(role);
  return {
    roleLabel: roleLabels[role] || role,
    permissions: granted,
    pages: pages.filter((page) => granted.includes(page.permission))
  };
}
