import { ddl } from '../src/schema.js';

export const version = '202604240001';
export const name = 'initial_schema';
export const checksumPayload = JSON.stringify(ddl);

export async function up({ execute }) {
  for (const statement of ddl) {
    await execute(statement);
  }
}

export async function down({ execute }) {
  const tables = [
    'announcements',
    'exam_scores',
    'exams',
    'timetable_entries',
    'timetable_slots',
    'teaching_class_students',
    'teaching_classes',
    'course_plans',
    'rooms',
    'students',
    'classes',
    'teachers',
    'subject_combinations',
    'subjects',
    'grades',
    'users'
  ];

  await execute('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of tables) {
      await execute(`DROP TABLE IF EXISTS \`${table}\``);
    }
  } finally {
    await execute('SET FOREIGN_KEY_CHECKS = 1');
  }
}
