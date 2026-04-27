# 数据库迁移规范

迁移文件按版本号升序执行，文件名格式：

```text
YYYYMMDDNNNN_description.js
```

示例：

```text
202604240001_initial_schema.js
202604250001_add_audit_logs.js
```

当前迁移：

```text
202604240001_initial_schema.js
202604240002_user_accounts_password_policy.js
202604240003_audit_logs.js
202604240004_audit_alerts.js
202604250001_audit_operations_monitoring.js
202604260001_timetable_scheduling.js
202604260002_multi_org_isolation.js
202604260003_identity_sms_notifications.js
202604260004_teacher_duties.js
```

## 文件约定

每个迁移文件必须导出：

```js
export const version = '202604250001';
export const name = 'add_audit_logs';

export async function up({ execute }) {
  await execute('CREATE TABLE ...');
}

export async function down({ execute }) {
  await execute('DROP TABLE IF EXISTS ...');
}
```

## 规则

- 已应用到任何环境的迁移文件不得修改。
- 新结构变更只能新增迁移文件。
- 迁移脚本应尽量可重复执行，尤其是初始迁移和基线化场景。
- 回滚脚本必须谨慎处理数据丢失风险。
- 生产环境先备份，再执行迁移。

## 合规检查

新增数据库结构变更必须进入 `migrations/`，并通过版本文件发布。上线前执行：

```powershell
npm run db:migrate:check
```

检查内容：

- 迁移文件名必须符合 `YYYYMMDDNNNN_description.js`。
- 文件名中的版本号、名称必须与导出的 `version`、`name` 一致。
- 每个迁移必须导出 `up()` 和 `down()`。
- 已应用迁移的 checksum 必须与仓库文件一致，禁止修改历史迁移。
- 当前数据库不能存在未应用迁移，也不能存在仓库中已删除的孤儿迁移。
