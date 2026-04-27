# 备份恢复流程

本项目提供 MySQL 逻辑备份、指定库恢复和恢复演练脚本。脚本不会依赖系统 `mysqldump`，直接使用项目的 MySQL 连接配置和 `mysql2` 执行。

## 目标

- RPO：正式环境建议每日全量逻辑备份，并结合 MySQL binlog 将数据丢失窗口控制在 24 小时以内；关键学校业务期可提高到每 4 小时一次。
- RTO：逻辑备份恢复演练目标为 30 分钟内完成；生产恢复时间取决于数据量和 MySQL 性能。
- 保留策略：本地保留最近 7 天，异地或对象存储保留最近 30 天，月度归档保留 12 个月。

## 命令

```powershell
# 创建逻辑备份，输出到 backups/
npm run db:backup

# 恢复到指定数据库。必须显式 --yes，默认禁止覆盖当前业务库
npm run db:restore -- --file backups/fides_gaokao_xxx.sql --target-db fides_gaokao_restore --yes

# 恢复演练：备份当前库 -> 还原到临时库 -> 比对所有表行数 -> 清理临时库
npm run db:restore:drill

# 保留演练库便于人工检查
npm run db:restore:drill -- --keep-db
```

## 产物

- `backups/*.sql`：逻辑备份文件。
- `backups/*.manifest.json`：备份清单，包含来源库、表数量、行数、文件大小和 SHA-256。
- `backups/restore-drills/*.json`：恢复演练报告，包含演练库名、校验表数、源/恢复总行数和差异。

`backups/` 已加入 `.gitignore` 和 `.dockerignore`，不会提交到代码仓库或打入镜像。

## 生产恢复步骤

1. 暂停写入入口或切换到维护页，避免恢复过程中产生新写入。
2. 确认备份文件和清单：

   ```powershell
   Get-FileHash backups/fides_gaokao_xxx.sql -Algorithm SHA256
   ```

3. 先恢复到临时库并验证：

   ```powershell
   npm run db:restore -- --file backups/fides_gaokao_xxx.sql --target-db fides_gaokao_restore_check --yes
   ```

4. 对临时库执行抽样检查：管理员账号、学生数、课程表、成绩记录、`schema_migrations`。
5. 备份当前生产库，保留回退点。
6. 确认后恢复到正式目标库。若目标库就是当前 `DB_NAME`，必须额外添加 `--allow-current-db`：

   ```powershell
   npm run db:restore -- --file backups/fides_gaokao_xxx.sql --target-db fides_gaokao --yes --allow-current-db
   ```

7. 执行：

   ```powershell
   npm run db:migrate:status
   npm run test:api
   ```

8. 恢复应用入口，并观察 `/health/ready`、错误日志和审计告警。

## 恢复演练结果

最近一次演练结果：

```text
时间：2026-04-25 22:34:47 Asia/Shanghai
状态：通过
备份文件：backups/fides_gaokao_2026-04-25T14-34-47-405Z.sql
演练报告：backups/restore-drills/restore-drill-2026-04-25T14-34-48-321Z.json
校验表数：19
源总行数：184
恢复总行数：184
临时演练库：fides_gaokao_drill_moefxvjg，已清理
```

## 运维要求

- 生产备份文件必须加密后上传到异地存储或对象存储。
- 备份任务失败必须进入告警平台。
- 至少每月执行一次恢复演练，开学、选科、期中期末考试前额外执行一次。
- 恢复演练报告应归档，作为上线和审计验收材料。
- 灾备站点应定期使用最近备份恢复到独立数据库，并通过 `npm run ops:release-check -- --require-backup` 做健康和备份清单校验。

完整灾备部署、灰度发布、回滚与容量压测流程见 [RELEASE_OPERATIONS.md](RELEASE_OPERATIONS.md)。
