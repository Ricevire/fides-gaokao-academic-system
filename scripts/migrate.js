import { closePool } from '../src/db.js';
import { baselineMigrations, getMigrationStatus, migrateDown, migrateUp } from '../src/migrator.js';

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'up',
    yes: argv.includes('--yes'),
    steps: 1,
    targetVersion: undefined
  };

  for (const arg of argv.slice(3)) {
    if (arg.startsWith('--steps=')) {
      args.steps = Number(arg.slice('--steps='.length));
    }
    if (arg.startsWith('--to=')) {
      args.targetVersion = arg.slice('--to='.length);
    }
  }

  return args;
}

function printRows(rows) {
  if (!rows.length) {
    console.log('没有记录。');
    return;
  }
  console.table(rows);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.command === 'up') {
    const applied = await migrateUp({ targetVersion: args.targetVersion });
    if (!applied.length) {
      console.log('数据库结构已是最新版本。');
    } else {
      console.log('已应用迁移：');
      printRows(applied);
    }
    return;
  }

  if (args.command === 'status') {
    const status = await getMigrationStatus();
    printRows(
      status.map((item) => ({
        version: item.version,
        name: item.name,
        applied: item.applied ? 'yes' : 'no',
        checksum: item.checksum === null ? '-' : item.checksum ? 'ok' : 'changed',
        appliedAt: item.appliedAt || '-'
      }))
    );
    return;
  }

  if (args.command === 'baseline') {
    if (!args.yes) {
      throw new Error('baseline 会直接标记迁移为已应用，请追加 --yes 确认');
    }
    const baselined = await baselineMigrations();
    console.log('已基线化迁移：');
    printRows(baselined);
    return;
  }

  if (args.command === 'down') {
    if (!args.yes) {
      throw new Error('down 会回滚数据库结构，请追加 --yes 确认');
    }
    if (!Number.isInteger(args.steps) || args.steps < 1) {
      throw new Error('--steps 必须是正整数');
    }
    const reverted = await migrateDown({ steps: args.steps });
    console.log('已回滚迁移：');
    printRows(reverted);
    return;
  }

  throw new Error(`未知迁移命令：${args.command}`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
