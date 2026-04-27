export const version = '202604260001';
export const name = 'timetable_scheduling';

async function columnExists(query, tableName, columnName) {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function indexExists(query, tableName, indexName) {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND table_name = ? AND index_name = ?
     LIMIT 1`,
    [tableName, tableName, indexName]
  );
  return rows.length > 0;
}

async function addIndexIfMissing({ execute, query }, tableName, indexName, sql) {
  if (!(await indexExists(query, tableName, indexName))) {
    await execute(sql);
  }
}

export async function up({ execute, query }) {
  if (!(await columnExists(query, 'timetable_slots', 'slot_type'))) {
    await execute("ALTER TABLE timetable_slots ADD COLUMN slot_type ENUM('regular', 'evening') NOT NULL DEFAULT 'regular' AFTER period");
  }

  if (!(await columnExists(query, 'timetable_slots', 'label'))) {
    await execute('ALTER TABLE timetable_slots ADD COLUMN label VARCHAR(30) NULL AFTER slot_type');
  }

  await execute("UPDATE timetable_slots SET slot_type = 'regular', label = COALESCE(label, CONCAT('第', period, '节')) WHERE period BETWEEN 1 AND 8");

  const eveningSlots = [
    [9, '晚自习一', '18:40:00', '19:20:00'],
    [10, '晚自习二', '19:30:00', '20:10:00'],
    [11, '晚自习三', '20:20:00', '21:00:00']
  ];

  for (let weekday = 1; weekday <= 5; weekday += 1) {
    for (const [period, label, startTime, endTime] of eveningSlots) {
      await execute(
        `INSERT INTO timetable_slots (weekday, period, slot_type, label, start_time, end_time)
         VALUES (?, ?, 'evening', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           slot_type = VALUES(slot_type),
           label = VALUES(label),
           start_time = VALUES(start_time),
           end_time = VALUES(end_time)`,
        [weekday, period, label, startTime, endTime]
      );
    }
  }

  await addIndexIfMissing(
    { execute, query },
    'timetable_entries',
    'idx_timetable_semester_slot',
    'CREATE INDEX idx_timetable_semester_slot ON timetable_entries (semester, slot_id)'
  );
  await addIndexIfMissing(
    { execute, query },
    'timetable_entries',
    'idx_timetable_class',
    'CREATE INDEX idx_timetable_class ON timetable_entries (semester, class_id)'
  );
  await addIndexIfMissing(
    { execute, query },
    'timetable_entries',
    'idx_timetable_teaching_class',
    'CREATE INDEX idx_timetable_teaching_class ON timetable_entries (semester, teaching_class_id)'
  );
  await addIndexIfMissing(
    { execute, query },
    'timetable_entries',
    'idx_timetable_room',
    'CREATE INDEX idx_timetable_room ON timetable_entries (semester, room_id)'
  );
}

export async function down({ execute, query }) {
  for (const indexName of ['idx_timetable_room', 'idx_timetable_teaching_class', 'idx_timetable_class', 'idx_timetable_semester_slot']) {
    if (await indexExists(query, 'timetable_entries', indexName)) {
      await execute(`DROP INDEX ${indexName} ON timetable_entries`);
    }
  }

  if (await columnExists(query, 'timetable_slots', 'slot_type')) {
    await execute("DELETE FROM timetable_slots WHERE slot_type = 'evening'");
  } else {
    await execute('DELETE FROM timetable_slots WHERE period BETWEEN 9 AND 11');
  }

  if (await columnExists(query, 'timetable_slots', 'label')) {
    await execute('ALTER TABLE timetable_slots DROP COLUMN label');
  }

  if (await columnExists(query, 'timetable_slots', 'slot_type')) {
    await execute('ALTER TABLE timetable_slots DROP COLUMN slot_type');
  }
}
