import bcrypt from 'bcryptjs';
import { closePool, getPool } from '../src/db.js';
import { migrateUp } from '../src/migrator.js';
import { seedDatabase } from '../src/schema.js';
import { config } from '../src/config.js';

const defaultAdminPassword = 'admin123';

async function main() {
  await migrateUp();
  const pool = getPool();

  const [admins] = await pool.execute('SELECT id, password_hash AS passwordHash FROM users WHERE username = ? LIMIT 1', ['admin']);
  const adminInitialPassword = config.account.initialAdminPassword || (config.isProduction ? '' : defaultAdminPassword);

  if (config.isProduction && adminInitialPassword === defaultAdminPassword) {
    throw new Error('生产环境禁止使用默认管理员初始密码 admin123');
  }

  if (admins.length === 0 && !adminInitialPassword) {
    throw new Error('首次初始化必须提供 ADMIN_INITIAL_PASSWORD');
  }

  if (admins.length > 0 && (await bcrypt.compare(defaultAdminPassword, admins[0].passwordHash))) {
    if (config.isProduction) {
      throw new Error('生产环境检测到默认管理员密码，请先重置后再启动');
    }
    await pool.execute('UPDATE users SET must_change_password = 1 WHERE id = ?', [admins[0].id]);
  }

  const adminPasswordHash = adminInitialPassword ? await bcrypt.hash(adminInitialPassword, 10) : null;
  await seedDatabase(pool, { adminPasswordHash, forceAdminPasswordChange: true });

  await closePool();
  console.log('数据库初始化完成：已创建表结构并写入示例数据。');
  if (config.isProduction) {
    console.log('默认管理员账号：admin；初始密码来自 ADMIN_INITIAL_PASSWORD，首次登录必须修改。');
  } else {
    console.log('默认账号：admin / admin123；首次登录必须修改密码。');
  }
}

main().catch(async (error) => {
  await closePool();
  console.error('数据库初始化失败：');
  console.error(error);
  process.exit(1);
});
