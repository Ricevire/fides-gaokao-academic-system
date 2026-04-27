# 中国新高考高中教务系统

面向中国新高考 `3+1+2` 模式的高中教务管理系统，覆盖学生、教师、行政班、教学班、选科组合、排课、晚自习、考试成绩、数据看板、审计日志、权限控制、备份恢复和生产部署流程。

本项目已经完成一轮企业级基础建设：数据库迁移、权限矩阵、审计告警、多租户隔离、前端工程化、自动化测试、Docker 部署、灾备/灰度/回滚/容量压测文档均已落地。

## 目录

- [项目定位](#项目定位)
- [核心功能](#核心功能)
- [技术栈](#技术栈)
- [运行要求](#运行要求)
- [本地开发启动](#本地开发启动)
- [生产部署要求](#生产部署要求)
- [Docker Compose 生产部署](#docker-compose-生产部署)
- [传统服务器部署](#传统服务器部署)
- [初始化和账号](#初始化和账号)
- [常用命令](#常用命令)
- [关键业务接口](#关键业务接口)
- [安全和运维能力](#安全和运维能力)
- [数据库迁移](#数据库迁移)
- [测试和上线检查](#测试和上线检查)
- [项目结构](#项目结构)

## 项目定位

本系统适用于高中教务处在新高考场景下管理以下业务：

- 新高考 `3+1+2` 选科组合管理。
- 行政班保留日常管理，教学班支撑选科走班。
- 教师可同时担任段长、副段长、年级学科负责人、班主任、任课老师等多个职务。
- 课表支持行政班课表、教学班课表、晚自习课表。
- 成绩数据支持录入、排名重算、趋势分析和看板统计。
- 管理员可发放教师、学生账号，首次登录强制改密。
- 系统支持多租户、多校区、多学年数据隔离。

当前项目适合作为正式系统的基础版本继续对接真实学校数据、统一身份认证、短信网关、生产域名、HTTPS 和监控告警平台。

## 核心功能

### 账号与权限

- 登录认证、JWT 会话、首次登录强制修改密码。
- 管理员生成或重置教师、学生账号。
- 管理员、教务、班主任、教师、学生分层授权。
- 页面、按钮、接口使用同一套能力点控制。
- OIDC 统一身份认证入口，可对接学校统一认证平台。

### 教师与组织

- 教师档案、学生档案、行政班、教学班管理。
- 教师多职务：段长、副段长、年级学科负责人、班主任、任课老师可叠加。
- 班主任职务同步行政班 `head_teacher_id`。
- 任课老师职务同步教学班 `teacher_id`。
- 多租户、多校区、多学年组织上下文隔离。

### 新高考业务

- `3+1+2` 选科组合维护。
- 按选科组合自动编入教学班。
- 自动排课、冲突检测、教师课时统计。
- 晚自习时段与普通课表统一管理。
- 考试管理、成绩录入、排名重算。
- 数据看板、成绩趋势分析、选科组合预测。

### 批量和报表

- 教师 Excel 模板、导出、导入预检、确认导入。
- 学生 Excel 模板、导出、导入预检、确认导入。
- 教师工号、学生学号作为幂等导入键。
- 列表分页、筛选、排序，避免大数据量一次性加载。

### 安全和审计

- Helmet 安全头、CORS 白名单、API 限流、登录限流。
- JSON 结构化日志与 `x-request-id` 请求追踪。
- 审计日志覆盖登录、失败登录、改密、账号发放、敏感数据写操作、权限拒绝。
- 审计告警覆盖异常 IP 登录、高频失败登录、账号重置高频操作、慢接口。
- 审计事件可通过 Webhook 接入集中日志平台或 SIEM。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 后端 | Node.js 22、Express、mysql2 |
| 前端 | TypeScript、esbuild、原生 HTML/CSS、内部 UI 组件函数 |
| 数据库 | MySQL 8.x / 8.4 |
| 安全 | Helmet、CORS、express-rate-limit、Zod 校验 |
| 日志 | Pino JSON 日志、Pino HTTP |
| 批量导入 | ExcelJS |
| 部署 | Docker、Docker Compose、Nginx/负载均衡 |
| 测试 | Node.js test runner、隔离测试库 |

## 运行要求

### 本地开发

| 组件 | 要求 |
| --- | --- |
| Node.js | 建议 Node.js 22 LTS，最低使用支持 `fetch` 和 ESM 的现代 Node.js 版本。 |
| npm | 随 Node.js 安装。 |
| MySQL | MySQL 8.x，开发环境可以使用本机 MySQL。 |
| PowerShell | Windows 推荐 PowerShell；Linux/macOS 可使用等价 shell 命令。 |

### 生产环境

| 组件 | 建议 |
| --- | --- |
| CPU | 小规模学校 2 核起步；并发较高时 4 核以上。 |
| 内存 | 应用实例 1GB 起步；MySQL 视数据量建议 4GB 以上。 |
| 磁盘 | MySQL 独立数据盘，开启定期快照或备份。 |
| 数据库 | 不要使用 MySQL `root` 账号连接业务应用。 |
| 网络 | 生产必须使用 HTTPS，前置 Nginx、云负载均衡或网关。 |
| 日志 | 采集标准输出 JSON 日志到 ELK、Loki、Splunk、Wazuh 或云日志平台。 |
| 备份 | 至少每日全量逻辑备份；选科、排课、考试期建议提高频率。 |

## 本地开发启动

1. 安装依赖：

   ```powershell
   npm install
   ```

2. 准备本地 `.env`。可以从 `.env.example` 复制：

   ```powershell
   Copy-Item .env.example .env
   ```

   本地开发可使用自己的 MySQL 用户和库名。不要把 `.env` 提交到 GitHub。

3. 初始化数据库并写入示例数据：

   ```powershell
   npm run db:init
   ```

4. 启动开发服务：

   ```powershell
   npm run dev
   ```

5. 浏览器访问：

   ```text
   http://localhost:3000
   ```

## 初始化和账号

开发环境初始化后可使用示例账号：

```text
管理员：admin / admin123
教师：t_t2026001 / Teacher@20260424!
学生：s_s20260001 / Student@20260424!
```

这些示例账号仅用于本地开发和演示，首次登录会要求修改密码。

生产环境必须设置 `ADMIN_INITIAL_PASSWORD`，且不能使用 `admin123`。生产初始化完成后，建议立即使用管理员账号登录并修改密码，再由管理员发放教师、学生账号。

## 生产部署要求

生产部署前必须满足以下条件：

- 已准备正式域名，例如 `https://jw.example.edu.cn`。
- 已启用 HTTPS，反向代理或负载均衡正确转发 `X-Forwarded-*`。
- 已创建业务 MySQL 用户，例如 `fides_app`，不要用 `root` 连接应用。
- 已设置强 `JWT_SECRET`，至少 32 个字符。
- 已设置 `CORS_ORIGINS` 为正式域名。
- 已设置 `DB_AUTO_CREATE=false`。
- 已确认是否启用 OIDC 统一身份认证。
- 已确认是否启用短信网关。
- 已配置备份、日志采集和告警。
- 上线前执行 `npm run ci`、`npm run db:migrate:check`、恢复演练和容量压测。

生产环境变量建议使用服务器环境变量、Docker Secret、CI/CD Secret 或云平台 Secret，不要把真实 `.env.production` 提交到 GitHub。

## Docker Compose 生产部署

推荐优先使用 Docker Compose 进行单机或小规模部署。

1. 创建 `.env.production`：

   ```ini
   MYSQL_ROOT_PASSWORD=replace-with-strong-root-password
   DB_PASSWORD=replace-with-strong-app-password
   ADMIN_INITIAL_PASSWORD=replace-with-first-admin-password
   JWT_SECRET=replace-with-a-random-secret-at-least-32-chars
   CORS_ORIGINS=https://jw.example.edu.cn
   AUDIT_SIEM_WEBHOOK_URL=
   AUDIT_SIEM_WEBHOOK_TOKEN=
   AUDIT_ALERT_WEBHOOK_URL=
   AUDIT_ALERT_WEBHOOK_TOKEN=
   ```

2. 构建并启动：

   ```powershell
   docker compose --env-file .env.production up -d --build
   ```

3. 执行数据库迁移：

   ```powershell
   docker compose exec app npm run db:migrate
   docker compose exec app npm run db:migrate:check
   ```

4. 初始化管理员和示例基础数据：

   ```powershell
   docker compose exec app node scripts/init-db.js
   ```

   如果生产环境只允许迁移结构，不希望写入示例数据，可以跳过 `scripts/init-db.js`，由正式数据导入流程初始化基础数据。

5. 检查健康状态：

   ```powershell
   curl http://localhost:3000/health/live
   curl http://localhost:3000/health/ready
   ```

6. 配置 Nginx 或云负载均衡，把外部 HTTPS 流量转发到应用容器 `3000` 端口。

更多生产部署细节见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 传统服务器部署

如果不使用 Docker，可以按以下方式部署到 Linux/Windows Server：

1. 安装 Node.js 22 和 MySQL 8。
2. 创建业务数据库和业务用户：

   ```sql
   CREATE DATABASE fides_gaokao CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'fides_app'@'%' IDENTIFIED BY 'replace-with-strong-password';
   GRANT ALL PRIVILEGES ON fides_gaokao.* TO 'fides_app'@'%';
   FLUSH PRIVILEGES;
   ```

3. 安装依赖并构建前端：

   ```powershell
   npm ci
   npm run frontend:build
   ```

4. 配置生产环境变量：

   ```powershell
   $env:NODE_ENV="production"
   $env:DB_HOST="127.0.0.1"
   $env:DB_USER="fides_app"
   $env:DB_PASSWORD="replace-with-strong-password"
   $env:DB_NAME="fides_gaokao"
   $env:DB_AUTO_CREATE="false"
   $env:JWT_SECRET="replace-with-a-random-secret-at-least-32-chars"
   $env:CORS_ORIGINS="https://jw.example.edu.cn"
   ```

5. 执行迁移：

   ```powershell
   npm run db:migrate
   npm run db:migrate:check
   ```

6. 启动服务：

   ```powershell
   npm run start
   ```

7. 生产建议使用进程管理器或服务管理工具托管，例如 systemd、PM2、Windows Service 或容器平台。

## 常用命令

```powershell
# 开发启动
npm run dev

# 生产启动，要求已提前构建 public/app.js
npm run start

# 前端类型检查
npm run frontend:check

# 前端构建
npm run frontend:build

# 执行数据库迁移
npm run db:migrate

# 查看迁移状态
npm run db:migrate:status

# 检查迁移合规
npm run db:migrate:check

# 初始化数据库和演示数据
npm run db:init

# 创建逻辑备份
npm run db:backup

# 恢复演练
npm run db:restore:drill

# 容量压测
npm run ops:capacity -- --duration-ms 30000 --concurrency 20 --paths /health/live,/health/ready

# 发布/回滚门禁检查
npm run ops:release-check -- --phase canary --base-url http://localhost:3000

# 静态和语法检查
npm run check

# API 自动化测试
npm run test:api

# 完整 CI
npm run ci
```

## 关键业务接口

### Excel 导入导出

```text
GET  /api/teachers/template
GET  /api/teachers/export
POST /api/teachers/import?dryRun=1
POST /api/teachers/import?dryRun=0

GET  /api/students/template
GET  /api/students/export
POST /api/students/import?dryRun=1
POST /api/students/import?dryRun=0
```

### 数据分析

```text
GET /api/analytics/dashboard
GET /api/analytics/score-trends?gradeId=1&subjectCode=physics
GET /api/analytics/subject-combo-predictions?gradeId=1&academicYearId=1
```

### 教师多职务

```text
GET    /api/teacher-duties?teacherId=1
POST   /api/teacher-duties
DELETE /api/teacher-duties/:id
```

### 排课

```text
GET  /api/timetable?semester=2026春
POST /api/timetable
POST /api/timetable/conflicts
POST /api/timetable/auto-schedule
GET  /api/timetable/teacher-workload?semester=2026春
```

### 审计日志和告警

```text
GET  /api/audit-logs?page=1&pageSize=50&q=admin
GET  /api/audit-alerts?page=1&pageSize=20&status=all
POST /api/audit-alerts/:id/acknowledge
POST /api/audit-alerts/:id/dispose
```

## 安全和运维能力

### 权限矩阵

权限矩阵见 [docs/PERMISSION_MATRIX.md](docs/PERMISSION_MATRIX.md)。后端接口使用 `requirePermission(...)` 校验，前端页面和按钮也按相同能力点渲染。

### 审计与 SIEM

审计事件写入 `audit_logs`，同时可通过 JSON 日志和 `AUDIT_SIEM_WEBHOOK_URL` 推送到集中日志平台或 SIEM。安全告警写入 `audit_alerts`，可通过 `AUDIT_ALERT_WEBHOOK_URL` 推送到告警平台。

### 备份恢复

备份恢复流程见 [docs/BACKUP_RECOVERY.md](docs/BACKUP_RECOVERY.md)。

```powershell
npm run db:backup
npm run db:restore -- --file backups/fides_gaokao_xxx.sql --target-db fides_gaokao_restore --yes
npm run db:restore:drill
```

### 灾备、灰度、回滚、容量压测

完整流程见 [docs/RELEASE_OPERATIONS.md](docs/RELEASE_OPERATIONS.md)。Nginx 蓝绿灰度模板位于 [ops/nginx/fides-canary.conf](ops/nginx/fides-canary.conf)。

发布建议流程：

1. 发布前备份数据库。
2. 执行 `npm run ci`。
3. 执行 `npm run db:migrate:check`。
4. 对候选实例执行 `npm run ops:release-check`。
5. 灰度放量：1% -> 5% -> 20% -> 50% -> 100%。
6. 观察健康检查、5xx、慢接口、登录失败、数据库连接数和审计告警。
7. 异常时切回旧版本，并执行回滚门禁检查。

## 数据库迁移

迁移文件位于 `migrations/`。已应用到任何环境的迁移文件不得修改，新的结构变更必须新增迁移文件。迁移规范见 [migrations/README.md](migrations/README.md)。

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

生产环境迁移前必须先备份：

```powershell
npm run db:backup
npm run db:migrate
npm run db:migrate:check
```

## 测试和上线检查

上线前至少执行：

```powershell
npm run frontend:build
npm run check
npm run db:migrate
npm run db:migrate:check
npm run test:api
npm run ops:capacity -- --duration-ms 30000 --concurrency 20 --paths /health/live,/health/ready
```

`npm run test:api` 会创建独立测试库，执行迁移和种子数据，覆盖认证、选科、学生、课表、自动排课、冲突检测、晚自习、教师课时统计、教师多职务、成绩和数据分析核心接口，测试结束后自动清理测试库。

## 环境变量

完整示例见 [.env.example](.env.example)。关键变量如下：

```ini
NODE_ENV=production
PORT=3000
TRUST_PROXY=true
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=fides_app
DB_PASSWORD=replace-with-strong-db-password
DB_NAME=fides_gaokao
DB_AUTO_CREATE=false
JWT_SECRET=replace-with-a-long-random-string-at-least-32-chars
CORS_ORIGINS=https://jw.example.edu.cn
ADMIN_INITIAL_PASSWORD=replace-with-first-admin-password
AUDIT_EVENT_LOG_ENABLED=true
AUDIT_ALERTS_ENABLED=true
AUDIT_SLOW_API_ENABLED=true
OIDC_ENABLED=false
SMS_ENABLED=false
LOG_LEVEL=info
```

启用 OIDC 时必须配置：

```ini
OIDC_AUTHORIZATION_URL=https://sso.example.edu.cn/oauth2/authorize
OIDC_TOKEN_URL=https://sso.example.edu.cn/oauth2/token
OIDC_USERINFO_URL=https://sso.example.edu.cn/oauth2/userinfo
OIDC_CLIENT_ID=replace-with-client-id
OIDC_CLIENT_SECRET=replace-with-client-secret
OIDC_REDIRECT_URI=https://jw.example.edu.cn/api/auth/sso/oidc/callback
```

启用短信 Webhook 时必须配置：

```ini
SMS_ENABLED=true
SMS_PROVIDER=webhook
SMS_WEBHOOK_URL=https://sms-gateway.example.edu.cn/send
SMS_WEBHOOK_TOKEN=replace-with-sms-token
SMS_ACCOUNT_NOTIFY_ENABLED=true
```

## 项目结构

```text
src/
  audit.js               审计日志、SIEM 推送与告警规则
  bulk-excel.js          Excel 导入导出与批量校验
  config.js              环境变量校验与集中配置
  db.js                  数据库连接池
  errors.js              统一错误处理
  identity.js            OIDC 统一身份认证
  logger.js              结构化日志
  migrator.js            数据库迁移执行器
  permissions.js         角色权限矩阵
  schema.js              表结构与种子数据
  server.js              API 与静态资源服务
  sms.js                 短信发送服务
  validators.js          请求体验证规则
  middleware/
    security.js          安全头、CORS、限流
    validate.js          请求体验证中间件

frontend/
  src/
    main.ts              前端业务入口
    components/          内部 UI 组件库
    types.ts             前端共享类型

public/
  index.html
  styles.css
  app.js                 前端构建产物
  app.js.map

migrations/
  202604240001_initial_schema.js
  202604240002_user_accounts_password_policy.js
  202604240003_audit_logs.js
  202604240004_audit_alerts.js
  202604250001_audit_operations_monitoring.js
  202604260001_timetable_scheduling.js
  202604260002_multi_org_isolation.js
  202604260003_identity_sms_notifications.js
  202604260004_teacher_duties.js

scripts/
  build-frontend.js
  capacity-test.js
  db-backup.js
  init-db.js
  migration-policy.js
  migrate.js
  release-check.js

docs/
  BACKUP_RECOVERY.md
  DEPLOYMENT.md
  ENTERPRISE_ROADMAP.md
  PERMISSION_MATRIX.md
  RELEASE_OPERATIONS.md

ops/
  nginx/
    fides-canary.conf
```

## 文档索引

- [生产部署说明](docs/DEPLOYMENT.md)
- [备份恢复流程](docs/BACKUP_RECOVERY.md)
- [权限矩阵](docs/PERMISSION_MATRIX.md)
- [企业级演进路线](docs/ENTERPRISE_ROADMAP.md)
- [灾备、灰度、回滚与容量压测](docs/RELEASE_OPERATIONS.md)

## 许可

当前仓库未附带开源许可证。发布到公开 GitHub 仓库前，请根据你的实际使用目标选择并添加许可证文件，例如 `MIT`、`Apache-2.0` 或私有闭源说明。
