# 发布到 GitHub 指南

本文档说明如何把当前 `FIDES` 项目发布到 GitHub。当前目录还不是 Git 仓库，因此需要先初始化 Git，再创建远程仓库并推送。

## 1. 发布前检查

在发布前先确认项目能通过本地检查：

```powershell
npm run ci
```

如果只想快速检查代码语法和迁移状态：

```powershell
npm run check
npm run db:migrate:check
```

确认本地服务正常：

```powershell
Invoke-WebRequest -UseBasicParsing "http://localhost:3000/health/ready"
```

正常返回：

```json
{"ok":true,"database":"ready"}
```

## 2. 确认不要提交敏感文件

以下文件和目录不应该提交到 GitHub：

```text
.env
.env.production
.env.local
node_modules/
backups/
reports/
logs/
server.out.log
server.err.log
```

当前 `.gitignore` 已排除这些内容，并保留 `.env.example` 作为公开配置模板。

发布前可以检查是否存在明显敏感内容：

```powershell
Select-String -Path .env -Pattern "PASSWORD|SECRET|TOKEN|ROOT" -CaseSensitive:$false
```

这个命令只用于提醒你 `.env` 里确实有敏感配置；不要把 `.env` 加入 Git。

## 3. 建议先补充许可证

如果你要开源发布，需要添加许可证文件：

- `MIT`：宽松开源，适合学习和通用开源项目。
- `Apache-2.0`：宽松开源，并包含专利授权条款。
- 私有项目：可以不添加开源许可证，并把 GitHub 仓库设为 Private。

如果暂时不确定，建议先创建 Private 仓库。

## 4. 初始化 Git 仓库

在项目根目录执行：

```powershell
git init
git branch -M main
```

查看将要提交的文件：

```powershell
git status --short
```

如果看到 `.env`、`node_modules/`、`backups/`、`reports/`、日志文件出现在待提交列表里，先停止提交并检查 `.gitignore`。

加入文件：

```powershell
git add .
git status --short
```

提交：

```powershell
git commit -m "Initial release"
```

## 5. 在 GitHub 创建远程仓库

### 方式 A：网页创建

1. 打开 GitHub。
2. 点击右上角 `+`。
3. 选择 `New repository`。
4. 填写仓库名，例如：

   ```text
   fides-gaokao-academic-system
   ```

5. 选择可见性：

   - 不确定是否要公开：选择 `Private`。
   - 已确认可公开：选择 `Public`。

6. 不要勾选 `Add a README file`，因为本地项目已经有 README。
7. 不要勾选 `.gitignore`，因为本地已经有。
8. 创建仓库。

创建后，GitHub 会显示远程地址，例如：

```text
https://github.com/your-name/fides-gaokao-academic-system.git
```

把远程地址加入本地仓库：

```powershell
git remote add origin https://github.com/your-name/fides-gaokao-academic-system.git
git push -u origin main
```

### 方式 B：GitHub CLI 创建

如果你安装了 GitHub CLI：

```powershell
gh auth login
gh repo create your-name/fides-gaokao-academic-system --private --source . --remote origin --push
```

如果你确定要公开：

```powershell
gh repo create your-name/fides-gaokao-academic-system --public --source . --remote origin --push
```

## 6. 推送后检查 GitHub 页面

推送完成后，在 GitHub 仓库页面检查：

- README 是否正常显示。
- `.env` 没有出现在仓库中。
- `node_modules/` 没有出现在仓库中。
- `backups/`、`reports/`、日志文件没有出现在仓库中。
- `docs/`、`migrations/`、`src/`、`frontend/`、`public/`、`scripts/` 都已提交。

可以在本地查看远程地址：

```powershell
git remote -v
```

## 7. 建议配置仓库信息

在 GitHub 仓库页面设置：

- Description：

  ```text
  中国新高考 3+1+2 高中教务系统，覆盖选科、排课、成绩、审计和生产部署。
  ```

- Topics：

  ```text
  education
  gaokao
  academic-system
  nodejs
  express
  mysql
  typescript
  docker
  ```

- Website：如果你部署了演示地址，可以填写正式 URL。

## 8. 创建首个 Release

当你确认代码可发布后，可以打标签：

```powershell
git tag v1.0.0
git push origin v1.0.0
```

然后在 GitHub 页面：

1. 点击 `Releases`。
2. 点击 `Draft a new release`。
3. 选择标签 `v1.0.0`。
4. Release title 填：

   ```text
   v1.0.0 初始版本
   ```

5. Release notes 可以写：

   ```text
   - 完成新高考教务核心业务：学生、教师、行政班、教学班、选科、排课、成绩。
   - 完成教师多职务、晚自习课表、自动排课、冲突检测。
   - 完成审计日志、告警、备份恢复、迁移体系、Docker 部署文档。
   - 完成 API 自动化测试和生产化运维文档。
   ```

6. 如果是正式可用版本，点击 `Publish release`。

## 9. 后续开发流程建议

建议采用简单分支模型：

```text
main        稳定可发布分支
feature/*   功能开发分支
fix/*       Bug 修复分支
```

开发新功能：

```powershell
git checkout -b feature/teacher-duty-improvements
# 修改代码
npm run ci
git add .
git commit -m "Improve teacher duty management"
git push -u origin feature/teacher-duty-improvements
```

然后在 GitHub 上创建 Pull Request，检查通过后合并到 `main`。

## 10. 推荐开启的 GitHub 设置

如果仓库用于正式项目，建议开启：

- Branch protection：保护 `main` 分支。
- Require pull request before merging：要求 PR 合并。
- Require status checks：要求 CI 通过后才能合并。
- Secret scanning：开启密钥扫描。
- Dependabot alerts：开启依赖安全提醒。
- Private 仓库：如果包含学校定制业务或不准备开源，保持私有。

## 11. 可选：添加 GitHub Actions CI

当前项目本地已有：

```powershell
npm run ci
```

如果后续要让 GitHub 自动跑 CI，可以新增 `.github/workflows/ci.yml`，并配置 MySQL 服务。暂时不建议在未确认 GitHub runner、数据库服务和测试耗时前强行加入工作流，以免首次发布后出现不必要的红色失败记录。

## 12. 常见问题

### GitHub 提示 push 被拒绝

如果远程仓库不是空仓库，可能需要先拉取：

```powershell
git pull origin main --allow-unrelated-histories
```

解决冲突后再推送。

### 不小心提交了 `.env`

立即停止推送。如果已经推送：

1. 立刻更换所有泄露的密码、Token、密钥。
2. 从 Git 历史中清理敏感文件。
3. 确认 GitHub Secret scanning 没有继续报警。

仅从最新 commit 删除 `.env` 不等于安全，因为历史记录里仍然存在。

### 想改成公开仓库

先确认：

- 没有真实学校数据。
- 没有真实账号密码。
- 没有真实短信网关 Token。
- 没有真实 OIDC Client Secret。
- 没有生产数据库地址和密码。

确认后再从 GitHub 仓库设置中把 Private 改为 Public。

## 13. 发布前最终清单

发布前逐项确认：

- [ ] `npm run ci` 通过。
- [ ] `.env`、`.env.production` 未提交。
- [ ] `node_modules/` 未提交。
- [ ] `backups/`、`reports/`、日志文件未提交。
- [ ] README 能正常展示项目定位、部署方法和运维要求。
- [ ] `docs/DEPLOYMENT.md`、`docs/PERMISSION_MATRIX.md`、`docs/RELEASE_OPERATIONS.md` 已提交。
- [ ] 已决定仓库是 Public 还是 Private。
- [ ] 如公开发布，已添加合适许可证。
