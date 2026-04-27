# 生产部署说明

## 部署前检查

- 不要在生产环境使用 MySQL `root` 账号连接业务应用。
- 生产应用建议设置 `DB_AUTO_CREATE=false`，数据库创建和授权由 DBA 或初始化流程完成。
- 首次初始化必须设置 `ADMIN_INITIAL_PASSWORD`，且不能使用 `admin123`。
- `JWT_SECRET` 必须使用独立生成的强随机字符串，至少 32 个字符。
- `CORS_ORIGINS` 必须填写正式域名，例如 `https://jw.example.edu.cn`。
- 只有部署在可信反向代理或负载均衡后方时才设置 `TRUST_PROXY=true`，否则来源 IP、限流和审计告警可能被伪造请求头干扰。
- `.env` 只用于本机开发，生产环境应使用服务器环境变量、容器 Secret 或 CI/CD Secret。
- 建议 MySQL 开启定时备份、慢查询日志和独立数据盘。

## Docker Compose 启动

创建生产环境变量文件，例如 `.env.production`：

```ini
MYSQL_ROOT_PASSWORD=replace-with-strong-root-password
DB_PASSWORD=replace-with-strong-app-password
ADMIN_INITIAL_PASSWORD=replace-with-first-admin-password
JWT_SECRET=replace-with-a-random-secret-at-least-32-chars
CORS_ORIGINS=https://your-domain.example
TRUST_PROXY=true
AUDIT_EVENT_LOG_ENABLED=true
AUDIT_SIEM_WEBHOOK_URL=https://siem.example.edu.cn/events
AUDIT_SIEM_WEBHOOK_TOKEN=replace-with-siem-token
AUDIT_ALERTS_ENABLED=true
AUDIT_ALERT_WEBHOOK_URL=https://alerts.example.edu.cn/events
AUDIT_ALERT_WEBHOOK_TOKEN=replace-with-alert-token
AUDIT_SLOW_API_ENABLED=true
AUDIT_SLOW_API_THRESHOLD_MS=1500
OIDC_ENABLED=true
OIDC_PROVIDER_CODE=oidc
OIDC_PROVIDER_NAME=学校统一身份认证
OIDC_TENANT_ID=1
OIDC_AUTHORIZATION_URL=https://sso.example.edu.cn/oauth2/authorize
OIDC_TOKEN_URL=https://sso.example.edu.cn/oauth2/token
OIDC_USERINFO_URL=https://sso.example.edu.cn/oauth2/userinfo
OIDC_CLIENT_ID=replace-with-client-id
OIDC_CLIENT_SECRET=replace-with-client-secret
OIDC_REDIRECT_URI=https://your-domain.example/api/auth/sso/oidc/callback
SMS_ENABLED=true
SMS_PROVIDER=webhook
SMS_WEBHOOK_URL=https://sms-gateway.example.edu.cn/send
SMS_WEBHOOK_TOKEN=replace-with-sms-token
SMS_ACCOUNT_NOTIFY_ENABLED=true
```

启动：

```powershell
docker compose --env-file .env.production up -d --build
docker compose exec app npm run db:migrate
docker compose exec app npm run db:migrate:check
docker compose exec app node scripts/init-db.js
```

Dockerfile 会在构建阶段执行 `npm run frontend:build`，从 `frontend/src` 生成 `public/app.js`，运行镜像只保留生产依赖。非 Docker 部署时，上线包发布前也应执行：

```powershell
npm run frontend:check
npm run frontend:build
```

如果生产环境只允许迁移结构，不需要写入演示种子数据，只执行：

```powershell
docker compose exec app npm run db:migrate
docker compose exec app npm run db:migrate:check
```

健康检查：

```powershell
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

## 数据库迁移

查看状态：

```powershell
npm run db:migrate:status
```

执行未应用迁移：

```powershell
npm run db:migrate
```

检查迁移合规：

```powershell
npm run db:migrate:check
```

已有数据库接入迁移体系但不希望重复执行结构脚本时，可以基线化：

```powershell
npm run db:migrate:baseline -- --yes
```

回滚最近一次迁移：

```powershell
npm run db:migrate:down -- --yes
```

生产环境回滚前必须备份数据库，并确认回滚脚本不会造成不可接受的数据丢失。

多租户、校区、学年隔离由 `202604260002_multi_org_isolation.js` 建立。迁移会创建默认租户、默认校区和默认学年，并把既有核心业务数据归入默认组织上下文。生产环境上线前应确认真实学校、校区、学年编码和默认管理员所属上下文。

## 备份恢复

```powershell
# 创建逻辑备份
npm run db:backup

# 执行恢复演练
npm run db:restore:drill

# 恢复到指定库
npm run db:restore -- --file backups/fides_gaokao_xxx.sql --target-db fides_gaokao_restore --yes
```

备份会输出到 `backups/`，恢复演练报告会输出到 `backups/restore-drills/`。最近一次演练已通过：19 张表、184 行源数据恢复后一致，临时演练库已清理。完整流程见 [备份恢复流程](BACKUP_RECOVERY.md)。

## 推荐上线架构

- 入口：Nginx 或云负载均衡终止 HTTPS。
- 应用：至少 2 个实例，使用无状态部署。
- 数据库：托管 MySQL 或主从架构，开启每日全量备份和 binlog。
- 日志：采集 JSON 日志到 ELK、Loki、云日志服务或 SIEM。
- 监控：采集 `/health/ready`、进程 CPU/内存、MySQL 连接数、慢查询和系统内置 `slow_api` 告警。

## 灾备、灰度与回滚

生产环境建议以蓝绿实例池部署应用，`blue` 保持当前稳定版本，`green` 部署候选版本，并通过 Nginx、云负载均衡或 API 网关逐步放量。Nginx 灰度模板见 [ops/nginx/fides-canary.conf](../ops/nginx/fides-canary.conf)。

发布前执行门禁检查：

```powershell
npm run ops:release-check -- --phase canary --version 1.0.0 --base-url http://green-internal:3000
```

放量顺序建议为 1%、5%、20%、50%、100%，每阶段观察 `/health/ready`、5xx、慢接口告警、登录失败告警、数据库连接数和审计异常。发现异常时立即把流量切回 `blue=100`、`green=0`，再执行：

```powershell
npm run ops:release-check -- --phase rollback --base-url http://blue-internal:3000
```

灾备部署、灰度发布、回滚和容量压测完整流程见 [灾备部署、灰度发布、回滚与容量压测](RELEASE_OPERATIONS.md)。

## 容量压测

上线前使用内置压测脚本生成容量报告：

```powershell
npm run ops:capacity -- --base-url https://your-domain.example --duration-ms 120000 --concurrency 50 --paths /health/live,/health/ready,/api/dashboard
```

业务接口需要登录态时可传入压测账号：

```powershell
npm run ops:capacity -- --base-url https://your-domain.example `
  --auth-username admin `
  --auth-password "replace-with-password" `
  --paths /api/auth/me,/api/dashboard,/api/analytics/dashboard,/api/students?pageSize=20
```

报告输出到 `reports/capacity/`，发布门禁报告输出到 `reports/releases/`。生产发布建议要求成功率不低于 99%，核心接口 p95 不高于 1500ms，并按真实学校规模调整阈值。

## 审计接入与告警

审计事件会写入 `audit_logs`，并以 JSON 日志字段 `audit_event` 输出。生产环境建议同时完成两类接入：

- 日志采集器采集应用标准输出，将 `audit_event` 和 `audit_alert` 字段送入 ELK、Loki、Splunk、Wazuh 或云日志平台。
- 配置 `AUDIT_SIEM_WEBHOOK_URL`，让系统把每条审计事件以 Webhook 推送到 SIEM；配置 `AUDIT_ALERT_WEBHOOK_URL`，让安全告警直接进入告警平台。

内置告警规则：

- `failed_login_burst`：同一账号和 IP 在 `AUDIT_FAILED_LOGIN_WINDOW_MS` 内失败登录达到 `AUDIT_FAILED_LOGIN_THRESHOLD`。
- `account_reset_burst`：同一管理员在 `AUDIT_ACCOUNT_RESET_WINDOW_MS` 内账号生成或重置达到 `AUDIT_ACCOUNT_RESET_THRESHOLD`。
- `new_ip_login`：账号从 `AUDIT_NEW_IP_LOOKBACK_DAYS` 内未出现过的 IP 登录。
- `slow_api`：接口耗时超过 `AUDIT_SLOW_API_THRESHOLD_MS`，系统会记录操作日志并生成 warning/critical 告警。

管理员可通过接口查询和确认告警：

```text
GET /api/audit-alerts?limit=100&offset=0&status=open
GET /api/audit-logs?page=1&pageSize=50&eventType=audit&outcome=success
GET /api/audit-alerts?page=1&pageSize=20&status=all&severity=warning&alertType=slow_api
POST /api/audit-alerts/:id/acknowledge
POST /api/audit-alerts/:id/dispose
```

告警处置支持 `open`、`acknowledged`、`closed` 三种状态，支持把级别调整为 `info`、`warning`、`critical`，并保存处置备注、处置人和处置时间。

## 统一身份认证与短信

统一身份认证使用 OIDC 授权码模式。生产环境需要在学校统一认证平台登记回调地址：

```text
https://your-domain.example/api/auth/sso/oidc/callback
```

本系统不会自动创建新账号。OIDC 回调成功后，系统会先查找 `external_identities` 绑定关系；如果没有绑定，会按 `OIDC_USERNAME_CLAIM` 与本地 `users.username` 自动绑定。上线前应确认统一认证返回的用户名与本地账号一致，或提前写入绑定关系。

短信通知通过 `SMS_PROVIDER` 选择网关。`log` 适合开发环境，只记录发送结果；`webhook` 会向 `SMS_WEBHOOK_URL` POST：

```json
{
  "messageId": 1,
  "recipientPhone": "13900000000",
  "templateCode": "account_initial_password",
  "message": "短信内容",
  "variables": {}
}
```

账号发放短信由 `SMS_ACCOUNT_NOTIFY_ENABLED` 控制。启用后，管理员生成或重置教师、学生账号时，会根据档案手机号发送初始密码或重置密码通知，并在 `sms_messages` 保留发送记录。

## 上线前自动化检查

```powershell
npm run frontend:build
npm run check
npm run db:migrate:check
npm run test:api
npm run ops:capacity -- --duration-ms 30000 --concurrency 20 --paths /health/live,/health/ready
```

`test:api` 会创建独立的 `fides_gaokao_api_test_*` 测试库，执行迁移和种子数据，覆盖认证、选科、学生、课表、自动排课、冲突检测、晚自习、教师课时统计、成绩和数据分析核心接口，测试结束后自动删除测试库。

## 生产化待办

- 完成统一身份认证 claim 映射和账号绑定验收。
- 按 [权限矩阵](PERMISSION_MATRIX.md) 完成真实账号绑定和业务验收。
- 确认数据看板、成绩趋势和选科预测的统计口径符合学校教务规则。
- 补充单元测试和端到端测试。
- 增加多校区、多学年业务验收。
