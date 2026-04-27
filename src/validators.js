import { z } from 'zod';

const requiredText = (max = 120) => z.string().trim().min(1).max(max);
const optionalText = (max = 120) => z.union([z.string().trim().max(max), z.literal('')]).optional();
const requiredId = z.coerce.number().int().positive();
const optionalId = z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional();
const optionalDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional();
const subjectCode = z.string().regex(/^[a-z_]+$/);
const optionalSubjectCode = z.union([subjectCode, z.literal(''), z.null()]).optional();

export const loginSchema = z
  .object({
    username: requiredText(50),
    password: requiredText(128)
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: requiredText(128),
    newPassword: requiredText(128),
    confirmPassword: requiredText(128)
  })
  .strict()
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: '两次输入的新密码不一致'
  });

export const issueAccountSchema = z
  .object({
    username: z
      .union([z.string().trim().regex(/^[A-Za-z0-9_.-]{3,50}$/), z.literal('')])
      .optional(),
    initialPassword: z.union([z.string().min(10).max(128), z.literal('')]).optional()
  })
  .strict();

export const smsSendSchema = z
  .object({
    recipientPhone: requiredText(40),
    templateCode: optionalText(60),
    message: optionalText(500),
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    targetType: optionalText(60),
    targetId: optionalText(80)
  })
  .strict();

export const teacherSchema = z
  .object({
    employeeNo: requiredText(30),
    name: requiredText(60),
    gender: z.union([z.enum(['男', '女']), z.literal('')]).optional(),
    subjectCode,
    campusId: optionalId,
    title: optionalText(50),
    phone: optionalText(30),
    email: z.union([z.email().max(100), z.literal('')]).optional(),
    status: z.enum(['active', 'inactive']).optional()
  })
  .strict();

export const teacherDutySchema = z
  .object({
    teacherId: requiredId,
    roleType: z.enum(['grade_leader', 'deputy_grade_leader', 'grade_subject_leader', 'head_teacher', 'course_teacher']),
    campusId: optionalId,
    academicYearId: optionalId,
    gradeId: optionalId,
    subjectCode: optionalSubjectCode,
    classId: optionalId,
    teachingClassId: optionalId,
    note: optionalText(120)
  })
  .strict();

export const classSchema = z
  .object({
    gradeId: requiredId,
    campusId: optionalId,
    academicYearId: optionalId,
    name: requiredText(40),
    trackType: z.enum(['行政班', '物理方向', '历史方向', '综合']).optional(),
    headTeacherId: optionalId,
    capacity: z.coerce.number().int().positive().max(200).optional(),
    room: optionalText(30)
  })
  .strict();

export const studentSchema = z
  .object({
    studentNo: requiredText(30),
    name: requiredText(60),
    gender: z.union([z.enum(['男', '女']), z.literal('')]).optional(),
    birthDate: optionalDate,
    gradeId: requiredId,
    campusId: optionalId,
    academicYearId: optionalId,
    classId: optionalId,
    subjectComboId: optionalId,
    enrollmentYear: z.coerce.number().int().min(2000).max(2100),
    phone: optionalText(30),
    guardianName: optionalText(60),
    guardianPhone: optionalText(30),
    status: z.enum(['在读', '休学', '转出', '毕业']).optional()
  })
  .strict();

export const subjectCombinationSchema = z
  .object({
    preferredSubject: z.enum(['physics', 'history']),
    electiveSubjects: z.array(z.enum(['chemistry', 'biology', 'politics', 'geography'])).length(2)
  })
  .strict();

export const teachingClassSchema = z
  .object({
    gradeId: requiredId,
    campusId: optionalId,
    academicYearId: optionalId,
    subjectCode,
    name: requiredText(60),
    teacherId: optionalId,
    subjectComboId: optionalId,
    capacity: z.coerce.number().int().positive().max(200).optional(),
    roomId: optionalId
  })
  .strict();

export const timetableSchema = z
  .object({
    semester: requiredText(20),
    campusId: optionalId,
    academicYearId: optionalId,
    weekday: z.coerce.number().int().min(1).max(7),
    period: z.coerce.number().int().min(1).max(12),
    classId: optionalId,
    teachingClassId: optionalId,
    roomId: optionalId,
    note: optionalText(120)
  })
  .strict();

export const autoScheduleSchema = z
  .object({
    semester: requiredText(20),
    gradeId: optionalId,
    campusId: optionalId,
    academicYearId: optionalId,
    overwrite: z.boolean().optional(),
    includeEvening: z.boolean().optional(),
    maxDailyPeriods: z.coerce.number().int().min(1).max(12).optional()
  })
  .strict();

export const examSchema = z
  .object({
    gradeId: requiredId,
    academicYearId: optionalId,
    name: requiredText(80),
    semester: requiredText(20),
    examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    examType: z.enum(['月考', '期中', '期末', '联考', '模拟考']).optional()
  })
  .strict();

export const examScoreSchema = z
  .object({
    examId: requiredId,
    studentId: requiredId,
    subjectCode,
    rawScore: z.coerce.number().min(0).max(750),
    standardScore: z.union([z.coerce.number().min(0).max(750), z.literal(''), z.null()]).optional(),
    rankInGrade: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional()
  })
  .strict();
