export const version = '202604240002';
export const name = 'user_accounts_password_policy';

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
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function constraintExists(query, constraintName) {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE() AND constraint_name = ?
     LIMIT 1`,
    [constraintName]
  );
  return rows.length > 0;
}

export async function up({ execute, query }) {
  if (!(await columnExists(query, 'users', 'must_change_password'))) {
    await execute('ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER enabled');
  }

  if (!(await columnExists(query, 'users', 'password_changed_at'))) {
    await execute('ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL AFTER must_change_password');
  }

  if (!(await columnExists(query, 'users', 'last_login_at'))) {
    await execute('ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL AFTER password_changed_at');
  }

  if (!(await columnExists(query, 'students', 'user_id'))) {
    await execute('ALTER TABLE students ADD COLUMN user_id INT NULL AFTER id');
  }

  if (!(await indexExists(query, 'students', 'uk_students_user_id'))) {
    await execute('ALTER TABLE students ADD UNIQUE KEY uk_students_user_id (user_id)');
  }

  if (!(await indexExists(query, 'teachers', 'uk_teachers_user_id'))) {
    await execute('ALTER TABLE teachers ADD UNIQUE KEY uk_teachers_user_id (user_id)');
  }

  if (!(await constraintExists(query, 'fk_students_user'))) {
    await execute(
      'ALTER TABLE students ADD CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL'
    );
  }
}

export async function down({ execute, query }) {
  if (await constraintExists(query, 'fk_students_user')) {
    await execute('ALTER TABLE students DROP FOREIGN KEY fk_students_user');
  }

  if (await indexExists(query, 'students', 'uk_students_user_id')) {
    await execute('ALTER TABLE students DROP INDEX uk_students_user_id');
  }

  if (await indexExists(query, 'teachers', 'uk_teachers_user_id')) {
    await execute('ALTER TABLE teachers DROP INDEX uk_teachers_user_id');
  }

  if (await columnExists(query, 'students', 'user_id')) {
    await execute('ALTER TABLE students DROP COLUMN user_id');
  }

  if (await columnExists(query, 'users', 'last_login_at')) {
    await execute('ALTER TABLE users DROP COLUMN last_login_at');
  }

  if (await columnExists(query, 'users', 'password_changed_at')) {
    await execute('ALTER TABLE users DROP COLUMN password_changed_at');
  }

  if (await columnExists(query, 'users', 'must_change_password')) {
    await execute('ALTER TABLE users DROP COLUMN must_change_password');
  }
}
