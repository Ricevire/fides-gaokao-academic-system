# 灾备部署、灰度发布、回滚与容量压测

本文定义 FIDES 教务系统正式运行时的灾备、发布、回滚和容量压测流程。所有生产发布必须留下备份清单、发布门禁报告和容量压测报告。

## 目标

| 项目 | 建议目标 |
| --- | --- |
| RPO | 常规教学期不超过 24 小时；选科、排课、考试成绩录入期不超过 4 小时。 |
| RTO | 单库逻辑恢复 30 分钟内完成；跨机房恢复按数据量和网络带宽评估。 |
| 灰度策略 | 1% -> 5% -> 20% -> 50% -> 100%，每阶段至少观察 10 分钟。 |
| 回滚触发 | `/health/ready` 失败、5xx 升高、登录失败异常升高、p95 超阈值、审计告警异常。 |
| 容量门禁 | 成功率不低于 99%，核心接口 p95 不高于 1500ms；实际阈值按学校规模调整。 |

## 灾备部署

推荐拓扑：

- 主站点：Nginx/负载均衡 + 2 个以上应用实例 + 主 MySQL。
- 备站点：同版本应用镜像 + 独立 MySQL + 定时接收备份或 binlog。
- 日志与告警：主备站点都输出 JSON 日志到集中日志平台或 SIEM。
- 备份：保留本地 7 天、异地 30 天、月度归档 12 个月。

生产例行任务：

```powershell
# 生成逻辑备份和 manifest
npm run db:backup

# 至少每月执行恢复演练
npm run db:restore:drill
```

备站点恢复：

```powershell
npm run db:restore -- --file backups/fides_gaokao_xxx.sql --target-db fides_gaokao_standby --yes
npm run db:migrate:status
npm run ops:release-check -- --base-url https://standby.example.edu.cn --backup-manifest backups/fides_gaokao_xxx.sql.manifest.json --require-backup
```

切换到备站点前，必须暂停主站点写入或切换维护页，确认最新备份已恢复并校验通过，再切换 DNS、负载均衡或网关路由。

## 灰度发布

灰度发布使用蓝绿实例池：

- `blue`：当前稳定版本。
- `green`：候选版本。
- Nginx 灰度模板：`ops/nginx/fides-canary.conf`。

发布步骤：

1. 构建候选版本镜像，并部署到 `green` 实例池。
2. 对 `green` 直连地址执行健康检查：

   ```powershell
   npm run ops:release-check -- --phase canary --version 1.0.0 --base-url http://green-internal:3000
   ```

3. 运行迁移检查。只有向前兼容的迁移才能进入灰度：

   ```powershell
   npm run db:migrate:check
   npm run db:migrate
   ```

4. 调整 Nginx 灰度比例：1%、5%、20%、50%、100%。
5. 每个阶段观察健康检查、5xx、慢接口告警、登录失败、账号重置告警和数据库连接数。
6. 100% 后保留 `blue` 至少一个业务观察窗口，确认稳定后再下线。

## 回滚流程

优先顺序：

1. 应用回滚：把 Nginx 权重切回 `blue=100`、`green=0`。
2. 配置回滚：恢复上一版环境变量或 Secret。
3. 数据回滚：仅在数据损坏或不可兼容迁移时执行，必须使用备份恢复流程。

应用回滚门禁：

```powershell
npm run ops:release-check -- --phase rollback --base-url http://blue-internal:3000
```

数据库回滚前必须先备份当前生产库：

```powershell
npm run db:backup
npm run db:restore -- --file backups/fides_gaokao_xxx.sql --target-db fides_gaokao_restore_check --yes
```

若确认要覆盖当前业务库，必须显式添加 `--allow-current-db`：

```powershell
npm run db:restore -- --file backups/fides_gaokao_xxx.sql --target-db fides_gaokao --yes --allow-current-db
```

数据库结构回滚只用于明确支持 `down` 的迁移：

```powershell
npm run db:migrate:down -- --steps=1 --yes
```

## 容量压测

项目内置无依赖压测脚本，适合上线前冒烟压测和容量基线采集。

公开健康接口压测：

```powershell
npm run ops:capacity -- --base-url http://localhost:3000 --duration-ms 30000 --concurrency 20 --paths /health/live,/health/ready
```

携带账号访问业务接口：

```powershell
npm run ops:capacity -- --base-url https://jw.example.edu.cn `
  --duration-ms 120000 `
  --concurrency 50 `
  --auth-username admin `
  --auth-password "replace-with-password" `
  --paths /api/auth/me,/api/dashboard,/api/analytics/dashboard,/api/students?pageSize=20,/api/exams?pageSize=20
```

脚本会输出 `reports/capacity/*.json`，字段包含总请求数、成功率、RPS、p50、p95、p99、状态码分布和错误分布。

发布门禁可以消费容量报告：

```powershell
npm run ops:release-check -- --phase promote `
  --base-url https://jw.example.edu.cn `
  --capacity-report reports/capacity/capacity-xxx.json `
  --require-capacity `
  --min-success-rate 0.99 `
  --max-p95-ms 1500
```

## 发布证据归档

每次生产发布至少归档：

- `backups/*.manifest.json`
- `reports/capacity/*.json`
- `reports/releases/*.json`
- 迁移状态输出：`npm run db:migrate:status`
- 发布版本、镜像摘要、发布时间、操作人、回滚窗口

`reports/` 和 `backups/` 已加入 `.gitignore` 和 `.dockerignore`，不会进入代码仓库或镜像。
