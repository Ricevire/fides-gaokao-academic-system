// @ts-nocheck
import { escapeHtml } from './components/ui';
import type { AppState, ListState, NavItem } from './types';

const app = document.querySelector('#app');
const tokenKey = 'fides_gaokao_token';
const userKey = 'fides_gaokao_user';

const navItems: NavItem[] = [
  { view: 'dashboard', label: '工作台', permission: 'page.dashboard' },
  { view: 'students', label: '学生管理', permission: 'page.students' },
  { view: 'teachers', label: '教师管理', permission: 'page.teachers' },
  { view: 'classes', label: '行政班', permission: 'page.classes' },
  { view: 'combos', label: '选科组合', permission: 'page.combinations' },
  { view: 'timetable', label: '排课管理', permission: 'page.timetable' },
  { view: 'exams', label: '考试成绩', permission: 'page.exams' },
  { view: 'audit', label: '安全审计', permission: 'page.audit' }
];

const weekdays = ['周一', '周二', '周三', '周四', '周五'];
const state: AppState = {
  token: localStorage.getItem(tokenKey),
  user: JSON.parse(localStorage.getItem(userKey) || 'null'),
  view: 'dashboard',
  meta: null,
  lists: {}
};

const listDefaults: Record<string, ListState> = {
  teachers: { page: 1, pageSize: 20, sort: 'id', order: 'desc' },
  students: { page: 1, pageSize: 20, sort: 'id', order: 'desc' },
  classes: { page: 1, pageSize: 20, sort: 'grade', order: 'desc' },
  teachingClasses: { page: 1, pageSize: 20, sort: 'grade', order: 'desc' },
  exams: { page: 1, pageSize: 20, sort: 'examDate', order: 'desc' },
  examScores: { page: 1, pageSize: 50, sort: 'id', order: 'desc' },
  auditAlerts: { page: 1, pageSize: 20, sort: 'lastSeenAt', order: 'desc', status: 'open' },
  auditLogs: { page: 1, pageSize: 50, sort: 'id', order: 'desc' }
};

function can(permission) {
  return Boolean(state.user?.permissions?.includes(permission));
}

function visibleNavItems() {
  return navItems.filter((item) => can(item.permission));
}

function ensureViewAllowed() {
  const visible = visibleNavItems();
  if (!visible.some((item) => item.view === state.view)) {
    state.view = visible[0]?.view || 'dashboard';
  }
}

function actionHeader(permissions) {
  return permissions.some((permission) => can(permission)) ? ['操作'] : [];
}

function actionCell(actions) {
  const visibleActions = actions.filter(Boolean).join('');
  return visibleActions ? `<td>${visibleActions}</td>` : '';
}

const toOptions = (items, valueKey, labelKey, selected, allowEmpty = true) => {
  const empty = allowEmpty ? '<option value="">请选择</option>' : '';
  return (
    empty +
    items
      .map((item) => {
        const value = item[valueKey];
        const label = item[labelKey];
        return `<option value="${escapeHtml(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('')
  );
};

function campusOptions(meta) {
  return (meta.campuses || []).map((campus) => ({ value: campus.id, label: campus.name }));
}

function academicYearOptions(meta) {
  return (meta.academicYears || []).map((year) => ({ value: year.id, label: year.name }));
}

function defaultCampusId(meta) {
  return state.user?.campusId || meta.currentCampusId || meta.campuses?.[0]?.id || '';
}

function defaultAcademicYearId(meta) {
  return state.user?.academicYearId || meta.currentAcademicYearId || meta.academicYears?.find((year) => Number(year.isCurrent))?.id || meta.academicYears?.[0]?.id || '';
}

function parseJson(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function getListState(key) {
  if (!state.lists[key]) {
    state.lists[key] = { ...(listDefaults[key] || { page: 1, pageSize: 20, sort: 'id', order: 'desc' }) };
  }
  return state.lists[key];
}

function resetListState(key) {
  state.lists[key] = { ...(listDefaults[key] || { page: 1, pageSize: 20, sort: 'id', order: 'desc' }) };
}

function listItems(payload) {
  return Array.isArray(payload) ? payload : payload?.items || [];
}

function buildListPath(path, key, extra = {}) {
  const params = new URLSearchParams();
  const current = { ...getListState(key), ...extra };
  Object.entries(current).forEach(([name, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(name, value);
  });
  return `${path}?${params.toString()}`;
}

function listFieldValue(key, name) {
  return getListState(key)[name] ?? '';
}

function renderListToolbar(key, { filters = '', sortOptions = [] } = {}) {
  const current = getListState(key);
  return `
    <form class="list-controls" data-list-filter="${key}">
      <input name="q" value="${escapeHtml(current.q || '')}" placeholder="搜索" />
      ${filters}
      <select name="sort">
        ${sortOptions
          .map((option) => `<option value="${option.value}" ${current.sort === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
          .join('')}
      </select>
      <select name="order">
        <option value="desc" ${current.order !== 'asc' ? 'selected' : ''}>降序</option>
        <option value="asc" ${current.order === 'asc' ? 'selected' : ''}>升序</option>
      </select>
      <select name="pageSize">
        ${[10, 20, 50, 100]
          .map((size) => `<option value="${size}" ${Number(current.pageSize) === size ? 'selected' : ''}>每页 ${size}</option>`)
          .join('')}
      </select>
      <button class="btn" type="submit">筛选</button>
      <button class="btn ghost" type="button" data-reset-list="${key}">重置</button>
    </form>
  `;
}

function renderPagination(key, response) {
  const pagination = response?.pagination;
  if (!pagination) return '';
  return `
    <div class="pager">
      <span>共 ${pagination.total} 条，第 ${pagination.page} / ${pagination.totalPages} 页</span>
      <div class="toolbar">
        <button class="btn" type="button" data-page-list="${key}" data-page="${pagination.page - 1}" ${pagination.hasPrev ? '' : 'disabled'}>上一页</button>
        <button class="btn" type="button" data-page-list="${key}" data-page="${pagination.page + 1}" ${pagination.hasNext ? '' : 'disabled'}>下一页</button>
      </div>
    </div>
  `;
}

function bindListInteractions(key) {
  document.querySelectorAll(`[data-list-filter="${key}"]`).forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const next = { ...getListState(key), page: 1 };
      for (const [name, value] of formData.entries()) {
        next[name] = value;
      }
      next.pageSize = Number(next.pageSize || listDefaults[key]?.pageSize || 20);
      state.lists[key] = next;
      loadView();
    });
  });
  document.querySelectorAll(`[data-reset-list="${key}"]`).forEach((button) => {
    button.addEventListener('click', () => {
      resetListState(key);
      loadView();
    });
  });
  document.querySelectorAll(`[data-page-list="${key}"]`).forEach((button) => {
    button.addEventListener('click', () => {
      const page = Number(button.dataset.page);
      if (!Number.isInteger(page) || page < 1) return;
      state.lists[key] = { ...getListState(key), page };
      loadView();
    });
  });
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    logout();
    throw new Error('登录已过期');
  }

  if (response.status === 423 && payload.code === 'PASSWORD_CHANGE_REQUIRED') {
    state.user = { ...(state.user || {}), mustChangePassword: true };
    localStorage.setItem(userKey, JSON.stringify(state.user));
    renderPasswordChangeView();
    throw new Error(payload.message || '首次登录必须修改密码');
  }

  if (!response.ok) {
    throw new Error(payload.message || '请求失败');
  }
  return payload;
}

async function apiExcelUpload(path, file, { dryRun = true } = {}) {
  const params = path.includes('?') ? '&' : '?';
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(`/api${path}${params}dryRun=${dryRun ? '1' : '0'}`, {
    method: 'POST',
    headers,
    body: await file.arrayBuffer()
  });
  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    logout();
    throw new Error('登录已过期');
  }

  if (response.status === 423 && payload.code === 'PASSWORD_CHANGE_REQUIRED') {
    state.user = { ...(state.user || {}), mustChangePassword: true };
    localStorage.setItem(userKey, JSON.stringify(state.user));
    renderPasswordChangeView();
    throw new Error(payload.message || '首次登录必须修改密码');
  }

  if (!response.ok) {
    const details = payload.invalid ? `，${payload.invalid} 行未通过校验` : '';
    throw new Error((payload.message || '导入失败') + details);
  }

  return payload;
}

async function downloadApiFile(path, fallbackName) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api${path}`, { headers });

  if (response.status === 401) {
    logout();
    throw new Error('登录已过期');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || '文件下载失败');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function notifyError(error) {
  alert(error.message || String(error));
}

async function getMeta() {
  if (!state.meta) {
    state.meta = await api('/meta');
  }
  return state.meta;
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-view">
      <section class="login-panel">
        <div class="login-brand">
          <h1>新高考高中教务系统</h1>
          <p>覆盖 3+1+2 选科、行政班、教学班、课表与成绩数据。</p>
        </div>
        <form class="login-form" id="loginForm">
          <div class="field">
            <label for="username">账号</label>
            <input id="username" name="username" autocomplete="username" value="admin" required />
          </div>
          <div class="field">
            <label for="password">密码</label>
            <input id="password" name="password" type="password" autocomplete="current-password" value="admin123" required />
          </div>
          <button class="btn primary" type="submit">登录系统</button>
          <span class="muted">默认账号：admin / admin123</span>
        </form>
        <div class="sso-login" id="ssoLoginBox"></div>
      </section>
      <section class="login-side">
        <h2>面向新高考走班管理的教务数据中台</h2>
        <p>行政班保留日常管理，教学班支撑选科走班，成绩和课表围绕学期、年级与组合统一归档。</p>
      </section>
    </main>
  `;

  document.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api('/auth/login', { method: 'POST', body: data });
      state.token = result.token;
      state.user = result.user;
      localStorage.setItem(tokenKey, result.token);
      localStorage.setItem(userKey, JSON.stringify(result.user));
      if (result.user.mustChangePassword) {
        renderPasswordChangeView();
        return;
      }
      renderShell();
      loadView();
    } catch (error) {
      notifyError(error);
    }
  });
  renderSsoLoginOptions();
}

async function renderSsoLoginOptions() {
  const box = document.querySelector('#ssoLoginBox');
  if (!box) return;
  try {
    const result = await api('/auth/sso/config');
    if (!result.enabled || !result.providers?.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = result.providers
      .map((provider) => `<a class="btn" href="${escapeHtml(provider.startUrl)}">${escapeHtml(provider.name)}</a>`)
      .join('');
  } catch {
    box.innerHTML = '';
  }
}

function renderPasswordChangeView() {
  app.innerHTML = `
    <main class="login-view">
      <section class="login-panel">
        <div class="login-brand">
          <h1>首次登录修改密码</h1>
          <p>账号 ${escapeHtml(state.user?.username || '')} 必须修改初始密码后才能进入系统。</p>
        </div>
        <form class="login-form" id="passwordChangeForm">
          <div class="field">
            <label for="currentPassword">当前密码</label>
            <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label for="newPassword">新密码</label>
            <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" required />
          </div>
          <div class="field">
            <label for="confirmPassword">确认新密码</label>
            <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required />
          </div>
          <button class="btn primary" type="submit">修改密码并进入</button>
          <button class="btn ghost" type="button" id="backToLogin">返回登录</button>
          <span class="muted">密码至少 10 位，并包含大小写字母、数字和特殊字符。</span>
        </form>
      </section>
      <section class="login-side">
        <h2>初始密码只用于账号发放</h2>
        <p>修改后系统会重新签发登录凭证，原始密码不再可见。</p>
      </section>
    </main>
  `;

  document.querySelector('#backToLogin').addEventListener('click', logout);
  document.querySelector('#passwordChangeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api('/auth/change-password', { method: 'POST', body: data });
      state.token = result.token;
      state.user = result.user;
      localStorage.setItem(tokenKey, result.token);
      localStorage.setItem(userKey, JSON.stringify(result.user));
      renderShell();
      loadView();
    } catch (error) {
      notifyError(error);
    }
  });
}

function renderShell() {
  ensureViewAllowed();
  const visible = visibleNavItems();
  const activeTitle = visible.find((item) => item.view === state.view)?.label || '工作台';
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <strong>FIDES 教务</strong>
          <span>中国新高考高中版</span>
        </div>
        <nav class="nav">
          ${visible
            .map(
              (item) =>
                `<button type="button" data-view="${item.view}" class="${item.view === state.view ? 'active' : ''}"><span>${item.label}</span><span>›</span></button>`
            )
            .join('')}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <h1>${escapeHtml(activeTitle)}</h1>
          <div class="userbox">
            <span>${escapeHtml(state.user?.displayName || state.user?.username || '')}</span>
            <span class="muted">${escapeHtml([state.user?.tenantName, state.user?.campusName, state.user?.academicYearName].filter(Boolean).join(' / '))}</span>
            <button class="btn ghost" type="button" id="logoutBtn">退出</button>
          </div>
        </header>
        <section class="content" id="content">
          <div class="panel"><div class="empty">加载中...</div></div>
        </section>
      </main>
    </div>
  `;

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderShell();
      loadView();
    });
  });
  document.querySelector('#logoutBtn').addEventListener('click', logout);
}

function logout() {
  state.token = null;
  state.user = null;
  state.meta = null;
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(userKey);
  renderLogin();
}

function content() {
  return document.querySelector('#content');
}

function renderTable(headers, rows, emptyText = '暂无数据') {
  if (!rows.length) return `<div class="empty">${emptyText}</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}

function openForm({ title, fields, initial = {}, onSubmit }) {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <form method="dialog" id="modalForm">
      <div class="dialog-head">
        <h2>${escapeHtml(title)}</h2>
        <button class="btn ghost" value="cancel" type="button" data-close>关闭</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          ${fields
            .map((field) => {
              const value = initial[field.name] ?? field.value ?? '';
              const required = field.required ? 'required' : '';
              const full = field.full ? ' full' : '';
              if (field.type === 'select') {
                return `
                  <div class="field${full}">
                    <label>${escapeHtml(field.label)}</label>
                    <select name="${field.name}" ${required}>${toOptions(field.options, 'value', 'label', value, field.allowEmpty !== false)}</select>
                  </div>
                `;
              }
              if (field.type === 'textarea') {
                return `
                  <div class="field${full}">
                    <label>${escapeHtml(field.label)}</label>
                    <textarea name="${field.name}" ${required}>${escapeHtml(value)}</textarea>
                  </div>
                `;
              }
              return `
                <div class="field${full}">
                  <label>${escapeHtml(field.label)}</label>
                  <input name="${field.name}" type="${field.type || 'text'}" value="${escapeHtml(value)}" ${required} />
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn" value="cancel" type="button" data-close>取消</button>
        <button class="btn primary" value="default" type="submit">保存</button>
      </div>
    </form>
  `;

  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('#modalForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await onSubmit(payload);
      dialog.close();
      await loadView();
    } catch (error) {
      notifyError(error);
    }
  });
}

async function issueAccount(entity, id) {
  try {
    const result = await api(`/accounts/${entity}/${id}/issue-password`, { method: 'POST', body: {} });
    alert(`账号：${result.username}\n初始密码：${result.initialPassword}\n首次登录必须修改密码。`);
    await loadView();
  } catch (error) {
    notifyError(error);
  }
}

function renderBulkResult(report) {
  if (!report) return '';
  const rows = (report.rows || []).slice(0, 80);
  return `
    <div class="bulk-summary">
      <span class="tag">总行数 ${report.total}</span>
      <span class="tag green">可导入 ${report.valid}</span>
      <span class="tag ${report.invalid ? 'orange' : 'green'}">错误 ${report.invalid}</span>
      <span class="tag">新增 ${report.create}</span>
      <span class="tag">更新 ${report.update}</span>
    </div>
    ${renderTable(
      ['行号', '状态', '动作', '错误'],
      rows.map(
        (row) => `
          <tr>
            <td>${row.rowNumber}</td>
            <td><span class="tag ${row.status === 'valid' ? 'green' : 'orange'}">${row.status === 'valid' ? '通过' : '错误'}</span></td>
            <td>${row.action === 'create' ? '新增' : row.action === 'update' ? '更新' : '-'}</td>
            <td class="wrap">${escapeHtml((row.errors || []).join('；') || '-')}</td>
          </tr>
        `
      ),
      '暂无校验结果'
    )}
  `;
}

function openBulkImportDialog({ title, endpoint }) {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <form id="bulkImportForm">
      <div class="dialog-head">
        <h2>${escapeHtml(title)}</h2>
        <button class="btn ghost" type="button" data-close>关闭</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field full">
            <label>Excel 文件</label>
            <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
          </div>
        </div>
        <div class="bulk-result" id="bulkImportResult"></div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn" type="submit" id="validateBulk">校验</button>
        <button class="btn primary" type="button" id="applyBulk" disabled>确认导入</button>
      </div>
    </form>
  `;

  let lastReport = null;
  const resultBox = dialog.querySelector('#bulkImportResult');
  const applyButton = dialog.querySelector('#applyBulk');
  const fileInput = dialog.querySelector('input[name="file"]');

  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove());
  fileInput.addEventListener('change', () => {
    lastReport = null;
    applyButton.disabled = true;
    resultBox.innerHTML = '';
  });
  dialog.querySelector('#bulkImportForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      lastReport = await apiExcelUpload(endpoint, file, { dryRun: true });
      resultBox.innerHTML = renderBulkResult(lastReport);
      applyButton.disabled = Boolean(lastReport.invalid);
    } catch (error) {
      applyButton.disabled = true;
      notifyError(error);
    }
  });
  applyButton.addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file || !lastReport || lastReport.invalid) return;
    if (!confirm(`确认导入 ${lastReport.valid} 行数据？`)) return;
    try {
      const imported = await apiExcelUpload(endpoint, file, { dryRun: false });
      resultBox.innerHTML = renderBulkResult(imported);
      applyButton.disabled = true;
      await loadView();
    } catch (error) {
      notifyError(error);
    }
  });
}

async function loadView() {
  try {
    ensureViewAllowed();
    const navItem = navItems.find((item) => item.view === state.view);
    if (navItem && !can(navItem.permission)) {
      content().innerHTML = '<div class="panel"><div class="empty error">当前账号没有权限访问该页面</div></div>';
      return;
    }
    if (state.view === 'dashboard') return renderDashboard();
    if (state.view === 'students') return renderStudents();
    if (state.view === 'teachers') return renderTeachers();
    if (state.view === 'classes') return renderClasses();
    if (state.view === 'combos') return renderCombos();
    if (state.view === 'timetable') return renderTimetable();
    if (state.view === 'exams') return renderExams();
    if (state.view === 'audit') return renderAudit();
  } catch (error) {
    content().innerHTML = `<div class="panel"><div class="empty error">${escapeHtml(error.message)}</div></div>`;
  }
}

async function renderDashboard() {
  const [data, analytics, trends, comboPrediction] = await Promise.all([
    api('/dashboard'),
    api('/analytics/dashboard'),
    api('/analytics/score-trends'),
    api('/analytics/subject-combo-predictions')
  ]);
  const maxCombo = Math.max(...data.combos.map((item) => Number(item.count)), 1);
  const scoreBands = analytics.scoreBands || { excellent: 0, passed: 0, needSupport: 0 };
  const totalBands = Number(scoreBands.excellent || 0) + Number(scoreBands.passed || 0) + Number(scoreBands.needSupport || 0);
  const predictions = comboPrediction.items || [];
  const recentTrends = (trends || []).slice(-8).reverse();
  const riskTone = (risk) => (risk === 'high' ? 'orange' : risk === 'low' ? 'green' : '');
  content().innerHTML = `
    <section class="grid-4">
      ${[
        ['在读学生', data.stats.students],
        ['在岗教师', data.stats.teachers],
        ['行政班', data.stats.classes],
        ['教学班', data.stats.teachingClasses]
      ]
        .map(([label, value]) => `<div class="panel metric"><span>${label}</span><strong>${value}</strong></div>`)
        .join('')}
    </section>
    <section class="grid-4">
      ${[
        ['考试场次', analytics.scoreSummary.examCount],
        ['成绩记录', analytics.scoreSummary.scoreCount],
        ['平均分', analytics.scoreSummary.averageScore ?? '-'],
        ['最高分', analytics.scoreSummary.highestScore ?? '-']
      ]
        .map(([label, value]) => `<div class="panel metric"><span>${label}</span><strong>${value}</strong></div>`)
        .join('')}
    </section>
    <section class="split">
      <div class="panel">
        <div class="panel-header"><h2>选科组合分布</h2><span class="tag green">3+1+2</span></div>
        <div class="panel-body">
          <div class="bar-list">
            ${
              data.combos.length
                ? data.combos
                    .map(
                      (item) => `
                        <div class="bar-item">
                          <div class="bar-row"><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong></div>
                          <div class="bar-track"><div class="bar-fill" style="width:${(Number(item.count) / maxCombo) * 100}%"></div></div>
                        </div>
                      `
                    )
                    .join('')
                : '<div class="empty">暂无选科数据</div>'
            }
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>成绩分段</h2><span class="tag">最近成绩</span></div>
        <div class="panel-body">
          <div class="bar-list">
            ${[
              ['优秀 90+', scoreBands.excellent],
              ['合格 60-89', scoreBands.passed],
              ['需关注 <60', scoreBands.needSupport]
            ]
              .map(
                ([label, value]) => `
                  <div class="bar-item">
                    <div class="bar-row"><span>${label}</span><strong>${value}</strong></div>
                    <div class="bar-track"><div class="bar-fill" style="width:${totalBands ? (Number(value) / totalBands) * 100 : 0}%"></div></div>
                  </div>
                `
              )
              .join('')}
          </div>
        </div>
      </div>
    </section>
    <section class="split">
      <div class="panel">
        <div class="panel-header"><h2>教务提醒</h2></div>
        <div class="panel-body timeline">
          ${
            data.announcements.length
              ? data.announcements
                  .map(
                    (item) => `
                      <div class="notice">
                        <strong>${escapeHtml(item.title)}</strong>
                        <p>${escapeHtml(item.content)}</p>
                      </div>
                    `
                  )
                  .join('')
              : '<div class="empty">暂无提醒</div>'
          }
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>学科均分</h2></div>
        ${renderTable(
          ['学科', '平均分', '成绩数'],
          analytics.subjectAverages.map(
            (item) =>
              `<tr><td>${escapeHtml(item.subjectName)}</td><td>${escapeHtml(item.averageScore ?? '-')}</td><td>${escapeHtml(item.scoreCount)}</td></tr>`
          ),
          '暂无成绩数据'
        )}
      </div>
    </section>
    <section class="panel">
      <div class="panel-header"><h2>成绩趋势分析</h2></div>
      ${renderTable(
        ['考试', '年级', '学科', '平均/最低/最高', '成绩数'],
        recentTrends.map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.examName)}<br><span class="muted">${escapeHtml(item.examDate)}</span></td>
              <td>${escapeHtml(item.gradeName)}</td>
              <td>${escapeHtml(item.subjectName)}</td>
              <td>${escapeHtml(item.averageScore ?? '-')} / ${escapeHtml(item.lowestScore ?? '-')} / ${escapeHtml(item.highestScore ?? '-')}</td>
              <td>${escapeHtml(item.scoreCount)}</td>
            </tr>
          `
        ),
        '暂无趋势数据'
      )}
    </section>
    <section class="panel">
      <div class="panel-header">
        <h2>选科组合预测</h2>
        <span class="tag">未选科 ${escapeHtml(comboPrediction.summary?.unselectedStudents ?? 0)}</span>
      </div>
      ${renderTable(
        ['组合', '当前人数', '预测人数', '占比', '建议教学班', '置信度', '风险'],
        predictions.slice(0, 10).map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.label)}<br><span class="muted">${escapeHtml(item.combinationKey)}</span></td>
              <td>${escapeHtml(item.currentStudents)}</td>
              <td>${escapeHtml(item.projectedStudents)}</td>
              <td>${escapeHtml(item.share)}%</td>
              <td>${escapeHtml(item.suggestedTeachingClasses)}</td>
              <td>${escapeHtml(item.confidence)}</td>
              <td><span class="tag ${riskTone(item.riskLevel)}">${escapeHtml(item.riskLevel)}</span></td>
            </tr>
          `
        ),
        '暂无预测数据'
      )}
    </section>
    <section class="panel">
      <div class="panel-header"><h2>最近考试</h2></div>
      ${renderTable(
        ['考试', '年级', '类型', '日期', '平均分'],
        data.exams.map(
          (exam) =>
            `<tr><td>${escapeHtml(exam.name)}</td><td>${escapeHtml(exam.gradeName)}</td><td>${escapeHtml(exam.examType)}</td><td>${escapeHtml(exam.examDate)}</td><td>${escapeHtml(exam.averageScore ?? '-')}</td></tr>`
        )
      )}
    </section>
  `;
}

async function renderTeachers() {
  const canWrite = can('teachers.write');
  const [meta, teacherPage, classPage, teachingClassPage] = await Promise.all([
    getMeta(),
    api(buildListPath('/teachers', 'teachers')),
    canWrite ? api('/classes?pageSize=200&sort=name&order=asc') : Promise.resolve({ items: [] }),
    canWrite ? api('/teaching-classes?pageSize=200&sort=name&order=asc') : Promise.resolve({ items: [] })
  ]);
  const teachers = listItems(teacherPage);
  const canDelete = can('teachers.delete');
  const canIssue = can('accounts.issue_teacher');
  const canBulk = can('teachers.bulk');
  const classes = listItems(classPage);
  const teachingClasses = listItems(teachingClassPage);
  const subjectOptions = meta.subjects.map((subject) => ({ value: subject.code, label: subject.name }));
  const campuses = campusOptions(meta);
  const academicYears = academicYearOptions(meta);
  const teacherOptions = teachers.map((teacher) => ({ value: teacher.id, label: `${teacher.name}（${teacher.employeeNo}）` }));
  const dutyFields = [
    { name: 'teacherId', label: '教师', type: 'select', options: teacherOptions, required: true, allowEmpty: false },
    {
      name: 'roleType',
      label: '职务',
      type: 'select',
      options: [
        { value: 'grade_leader', label: '段长' },
        { value: 'deputy_grade_leader', label: '副段长' },
        { value: 'grade_subject_leader', label: '年级学科负责人' },
        { value: 'head_teacher', label: '班主任' },
        { value: 'course_teacher', label: '任课老师' }
      ],
      required: true,
      allowEmpty: false
    },
    { name: 'campusId', label: '校区', type: 'select', options: campuses, allowEmpty: true },
    { name: 'academicYearId', label: '学年', type: 'select', options: academicYears, allowEmpty: true },
    { name: 'gradeId', label: '年级', type: 'select', options: meta.grades.map((g) => ({ value: g.id, label: g.name })), allowEmpty: true },
    { name: 'subjectCode', label: '学科', type: 'select', options: subjectOptions, allowEmpty: true },
    { name: 'classId', label: '行政班', type: 'select', options: classes.map((item) => ({ value: item.id, label: `${item.gradeName} ${item.name}` })), allowEmpty: true },
    {
      name: 'teachingClassId',
      label: '教学班',
      type: 'select',
      options: teachingClasses.map((item) => ({ value: item.id, label: `${item.gradeName} ${item.name}` })),
      allowEmpty: true
    },
    { name: 'note', label: '备注' }
  ];
  const fields = [
    { name: 'employeeNo', label: '工号', required: true },
    { name: 'name', label: '姓名', required: true },
    { name: 'gender', label: '性别', type: 'select', options: ['男', '女'].map((x) => ({ value: x, label: x })) },
    { name: 'subjectCode', label: '任教学科', type: 'select', options: subjectOptions, required: true, allowEmpty: false },
    { name: 'campusId', label: '校区', type: 'select', options: campuses, required: true, allowEmpty: false },
    { name: 'title', label: '职称' },
    { name: 'phone', label: '电话' },
    { name: 'email', label: '邮箱' },
    { name: 'status', label: '状态', type: 'select', options: [{ value: 'active', label: '在岗' }, { value: 'inactive', label: '停用' }], allowEmpty: false }
  ];
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>教师档案</h2>
        <div class="toolbar">
          ${canBulk ? '<button class="btn" id="teacherTemplate">模板</button>' : ''}
          ${canBulk ? '<button class="btn" id="teacherExport">导出</button>' : ''}
          ${canBulk ? '<button class="btn" id="teacherImport">导入校验</button>' : ''}
          ${canWrite ? '<button class="btn primary" id="addTeacher">新增教师</button>' : ''}
        </div>
      </div>
      ${renderListToolbar('teachers', {
        filters: `
          <select name="subjectCode">
            ${toOptions(subjectOptions, 'value', 'label', listFieldValue('teachers', 'subjectCode'))}
          </select>
          <select name="campusId">
            ${toOptions(campuses, 'value', 'label', listFieldValue('teachers', 'campusId'))}
          </select>
          <select name="status">
            ${toOptions(
              [
                { value: 'active', label: '在岗' },
                { value: 'inactive', label: '停用' }
              ],
              'value',
              'label',
              listFieldValue('teachers', 'status')
            )}
          </select>
        `,
        sortOptions: [
          { value: 'id', label: '创建时间' },
          { value: 'employeeNo', label: '工号' },
          { value: 'name', label: '姓名' },
          { value: 'subject', label: '学科' },
          { value: 'status', label: '状态' }
        ]
      })}
      ${renderTable(
        ['工号', '姓名', '学科', '校区', '职务', '职称', '电话', '状态', '账号', ...actionHeader(['teachers.write', 'teachers.delete', 'accounts.issue_teacher'])],
        teachers.map(
          (teacher) => `
            <tr>
              <td>${escapeHtml(teacher.employeeNo)}</td>
              <td>${escapeHtml(teacher.name)}</td>
              <td>${escapeHtml(teacher.subjectName)}</td>
              <td>${escapeHtml(teacher.campusName || '-')}</td>
              <td>${
                teacher.duties?.length
                  ? teacher.duties
                      .slice(0, 5)
                      .map((duty) => `<span class="tag">${escapeHtml(duty.roleLabel)}</span>`)
                      .join(' ')
                  : '-'
              }</td>
              <td>${escapeHtml(teacher.title || '-')}</td>
              <td>${escapeHtml(teacher.phone || '-')}</td>
              <td><span class="tag ${teacher.status === 'active' ? 'green' : 'orange'}">${teacher.status === 'active' ? '在岗' : '停用'}</span></td>
              <td>${teacher.accountUsername ? `<span class="tag green">${escapeHtml(teacher.accountUsername)}</span>` : '<span class="tag orange">未生成</span>'}</td>
              ${actionCell([
                canWrite ? `<button class="btn" data-duty-teacher="${teacher.id}">职务</button>` : '',
                canWrite ? `<button class="btn" data-edit-teacher="${teacher.id}">编辑</button>` : '',
                canIssue ? `<button class="btn success" data-issue-teacher="${teacher.id}">${teacher.accountUsername ? '重置账号' : '生成账号'}</button>` : '',
                canDelete ? `<button class="btn danger" data-delete-teacher="${teacher.id}">删除</button>` : ''
              ])}
            </tr>
          `
        )
      )}
      ${renderPagination('teachers', teacherPage)}
    </section>
  `;
  bindListInteractions('teachers');
  document.querySelector('#teacherTemplate')?.addEventListener('click', async () => {
    try {
      await downloadApiFile('/teachers/template', '教师导入模板.xlsx');
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelector('#teacherExport')?.addEventListener('click', async () => {
    try {
      await downloadApiFile('/teachers/export', '教师档案.xlsx');
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelector('#teacherImport')?.addEventListener('click', () =>
    openBulkImportDialog({ title: '教师批量导入', endpoint: '/teachers/import' })
  );
  document.querySelector('#addTeacher')?.addEventListener('click', () =>
    openForm({ title: '新增教师', fields, initial: { status: 'active', campusId: defaultCampusId(meta) }, onSubmit: (payload) => api('/teachers', { method: 'POST', body: payload }) })
  );
  document.querySelectorAll('[data-edit-teacher]').forEach((button) => {
    button.addEventListener('click', () => {
      const teacher = teachers.find((item) => String(item.id) === button.dataset.editTeacher);
      openForm({
        title: '编辑教师',
        fields,
        initial: teacher,
        onSubmit: (payload) => api(`/teachers/${teacher.id}`, { method: 'PUT', body: payload })
      });
    });
  });
  document.querySelectorAll('[data-duty-teacher]').forEach((button) => {
    button.addEventListener('click', () => {
      const teacher = teachers.find((item) => String(item.id) === button.dataset.dutyTeacher);
      openForm({
        title: '教师职务',
        fields: dutyFields,
        initial: {
          teacherId: teacher.id,
          campusId: teacher.campusId || defaultCampusId(meta),
          academicYearId: defaultAcademicYearId(meta),
          gradeId: meta.grades[0]?.id || ''
        },
        onSubmit: (payload) => api('/teacher-duties', { method: 'POST', body: payload })
      });
    });
  });
  document.querySelectorAll('[data-issue-teacher]').forEach((button) => {
    button.addEventListener('click', async () => {
      const teacher = teachers.find((item) => String(item.id) === button.dataset.issueTeacher);
      if (!confirm(`${teacher.accountUsername ? '确认重置' : '确认生成'}教师账号？`)) return;
      await issueAccount('teachers', button.dataset.issueTeacher);
    });
  });
  document.querySelectorAll('[data-delete-teacher]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('确认删除该教师档案？')) return;
      try {
        await api(`/teachers/${button.dataset.deleteTeacher}`, { method: 'DELETE' });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
}

async function renderClasses() {
  const canWrite = can('classes.write');
  const canDelete = can('classes.delete');
  const [meta, teacherPage, classPage] = await Promise.all([
    getMeta(),
    canWrite ? api('/teachers?pageSize=200&sort=name&order=asc') : Promise.resolve({ items: [] }),
    api(buildListPath('/classes', 'classes'))
  ]);
  const teachers = listItems(teacherPage);
  const classes = listItems(classPage);
  const campuses = campusOptions(meta);
  const academicYears = academicYearOptions(meta);
  const fields = [
    { name: 'gradeId', label: '年级', type: 'select', options: meta.grades.map((g) => ({ value: g.id, label: g.name })), required: true, allowEmpty: false },
    { name: 'campusId', label: '校区', type: 'select', options: campuses, required: true, allowEmpty: false },
    { name: 'academicYearId', label: '学年', type: 'select', options: academicYears, required: true, allowEmpty: false },
    { name: 'name', label: '班级名称', required: true },
    { name: 'trackType', label: '班级类型', type: 'select', options: ['行政班', '物理方向', '历史方向', '综合'].map((x) => ({ value: x, label: x })), allowEmpty: false },
    { name: 'headTeacherId', label: '班主任', type: 'select', options: teachers.map((t) => ({ value: t.id, label: `${t.name}（${t.subjectName}）` })) },
    { name: 'capacity', label: '容量', type: 'number' },
    { name: 'room', label: '固定教室' }
  ];
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>行政班管理</h2>
        ${canWrite ? '<button class="btn primary" id="addClass">新增行政班</button>' : ''}
      </div>
      ${renderListToolbar('classes', {
        filters: `
          <select name="gradeId">
            ${toOptions(meta.grades.map((g) => ({ value: g.id, label: g.name })), 'value', 'label', listFieldValue('classes', 'gradeId'))}
          </select>
          <select name="campusId">
            ${toOptions(campuses, 'value', 'label', listFieldValue('classes', 'campusId'))}
          </select>
          <select name="academicYearId">
            ${toOptions(academicYears, 'value', 'label', listFieldValue('classes', 'academicYearId'))}
          </select>
          <select name="trackType">
            ${toOptions(['行政班', '物理方向', '历史方向', '综合'].map((x) => ({ value: x, label: x })), 'value', 'label', listFieldValue('classes', 'trackType'))}
          </select>
        `,
        sortOptions: [
          { value: 'grade', label: '年级' },
          { value: 'name', label: '班级' },
          { value: 'trackType', label: '类型' },
          { value: 'studentCount', label: '人数' },
          { value: 'capacity', label: '容量' }
        ]
      })}
      ${renderTable(
        ['年级', '校区', '学年', '班级', '类型', '班主任', '人数/容量', '教室', ...actionHeader(['classes.write', 'classes.delete'])],
        classes.map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.gradeName)}</td>
              <td>${escapeHtml(item.campusName || '-')}</td>
              <td>${escapeHtml(item.academicYearName || '-')}</td>
              <td>${escapeHtml(item.name)}</td>
              <td><span class="tag">${escapeHtml(item.trackType)}</span></td>
              <td>${escapeHtml(item.headTeacherName || '-')}</td>
              <td>${item.studentCount}/${item.capacity}</td>
              <td>${escapeHtml(item.room || '-')}</td>
              ${actionCell([
                canWrite ? `<button class="btn" data-edit-class="${item.id}">编辑</button>` : '',
                canDelete ? `<button class="btn danger" data-delete-class="${item.id}">删除</button>` : ''
              ])}
            </tr>
          `
        )
      )}
      ${renderPagination('classes', classPage)}
    </section>
  `;
  bindListInteractions('classes');
  document.querySelector('#addClass')?.addEventListener('click', () =>
    openForm({
      title: '新增行政班',
      fields,
      initial: { campusId: defaultCampusId(meta), academicYearId: defaultAcademicYearId(meta), trackType: '综合', capacity: 50 },
      onSubmit: (payload) => api('/classes', { method: 'POST', body: payload })
    })
  );
  document.querySelectorAll('[data-edit-class]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = classes.find((row) => String(row.id) === button.dataset.editClass);
      openForm({ title: '编辑行政班', fields, initial: item, onSubmit: (payload) => api(`/classes/${item.id}`, { method: 'PUT', body: payload }) });
    });
  });
  document.querySelectorAll('[data-delete-class]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('确认删除该行政班？班级下有学生时数据库会阻止删除。')) return;
      try {
        await api(`/classes/${button.dataset.deleteClass}`, { method: 'DELETE' });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
}

async function renderStudents() {
  const [meta, classPage, studentPage] = await Promise.all([
    getMeta(),
    api('/classes?pageSize=200&sort=name&order=asc'),
    api(buildListPath('/students', 'students'))
  ]);
  const classes = listItems(classPage);
  const students = listItems(studentPage);
  const canWrite = can('students.write');
  const canDelete = can('students.delete');
  const canIssue = can('accounts.issue_student');
  const canBulk = can('students.bulk');
  const campuses = campusOptions(meta);
  const academicYears = academicYearOptions(meta);
  const fields = [
    { name: 'studentNo', label: '学号', required: true },
    { name: 'name', label: '姓名', required: true },
    { name: 'gender', label: '性别', type: 'select', options: ['男', '女'].map((x) => ({ value: x, label: x })) },
    { name: 'birthDate', label: '出生日期', type: 'date' },
    { name: 'gradeId', label: '年级', type: 'select', options: meta.grades.map((g) => ({ value: g.id, label: g.name })), required: true, allowEmpty: false },
    { name: 'campusId', label: '校区', type: 'select', options: campuses, required: true, allowEmpty: false },
    { name: 'academicYearId', label: '学年', type: 'select', options: academicYears, required: true, allowEmpty: false },
    { name: 'classId', label: '行政班', type: 'select', options: classes.map((c) => ({ value: c.id, label: `${c.gradeName} ${c.name}` })) },
    { name: 'subjectComboId', label: '选科组合', type: 'select', options: meta.combinations.map((c) => ({ value: c.id, label: c.label })) },
    { name: 'enrollmentYear', label: '入学年份', type: 'number', required: true },
    { name: 'phone', label: '学生电话' },
    { name: 'guardianName', label: '监护人' },
    { name: 'guardianPhone', label: '监护人电话' },
    { name: 'status', label: '状态', type: 'select', options: ['在读', '休学', '转出', '毕业'].map((x) => ({ value: x, label: x })), allowEmpty: false }
  ];
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>学生档案</h2>
        <div class="toolbar">
          ${canBulk ? '<button class="btn" id="studentTemplate">模板</button>' : ''}
          ${canBulk ? '<button class="btn" id="studentExport">导出</button>' : ''}
          ${canBulk ? '<button class="btn" id="studentImport">导入校验</button>' : ''}
          ${canWrite ? '<button class="btn primary" id="addStudent">新增学生</button>' : ''}
        </div>
      </div>
      ${renderListToolbar('students', {
        filters: `
          <select name="gradeId">
            ${toOptions(meta.grades.map((g) => ({ value: g.id, label: g.name })), 'value', 'label', listFieldValue('students', 'gradeId'))}
          </select>
          <select name="campusId">
            ${toOptions(campuses, 'value', 'label', listFieldValue('students', 'campusId'))}
          </select>
          <select name="academicYearId">
            ${toOptions(academicYears, 'value', 'label', listFieldValue('students', 'academicYearId'))}
          </select>
          <select name="classId">
            ${toOptions(classes.map((c) => ({ value: c.id, label: `${c.gradeName} ${c.name}` })), 'value', 'label', listFieldValue('students', 'classId'))}
          </select>
          <select name="status">
            ${toOptions(['在读', '休学', '转出', '毕业'].map((x) => ({ value: x, label: x })), 'value', 'label', listFieldValue('students', 'status'))}
          </select>
        `,
        sortOptions: [
          { value: 'id', label: '创建时间' },
          { value: 'studentNo', label: '学号' },
          { value: 'name', label: '姓名' },
          { value: 'grade', label: '年级' },
          { value: 'class', label: '行政班' },
          { value: 'status', label: '状态' }
        ]
      })}
      ${renderTable(
        ['学号', '姓名', '年级', '校区', '学年', '行政班', '选科组合', '状态', '账号', ...actionHeader(['students.write', 'students.delete', 'accounts.issue_student'])],
        students.map(
          (student) => `
            <tr>
              <td>${escapeHtml(student.studentNo)}</td>
              <td>${escapeHtml(student.name)}</td>
              <td>${escapeHtml(student.gradeName)}</td>
              <td>${escapeHtml(student.campusName || '-')}</td>
              <td>${escapeHtml(student.academicYearName || '-')}</td>
              <td>${escapeHtml(student.className || '-')}</td>
              <td>${student.subjectComboLabel ? `<span class="tag green">${escapeHtml(student.subjectComboLabel)}</span>` : '-'}</td>
              <td><span class="tag ${student.status === '在读' ? 'green' : 'orange'}">${escapeHtml(student.status)}</span></td>
              <td>${student.accountUsername ? `<span class="tag green">${escapeHtml(student.accountUsername)}</span>` : '<span class="tag orange">未生成</span>'}</td>
              ${actionCell([
                canWrite ? `<button class="btn" data-edit-student="${student.id}">编辑</button>` : '',
                canIssue ? `<button class="btn success" data-issue-student="${student.id}">${student.accountUsername ? '重置账号' : '生成账号'}</button>` : '',
                canDelete ? `<button class="btn danger" data-delete-student="${student.id}">删除</button>` : ''
              ])}
            </tr>
          `
        )
      )}
      ${renderPagination('students', studentPage)}
    </section>
  `;
  bindListInteractions('students');
  document.querySelector('#studentTemplate')?.addEventListener('click', async () => {
    try {
      await downloadApiFile('/students/template', '学生导入模板.xlsx');
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelector('#studentExport')?.addEventListener('click', async () => {
    try {
      await downloadApiFile('/students/export', '学生档案.xlsx');
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelector('#studentImport')?.addEventListener('click', () =>
    openBulkImportDialog({ title: '学生批量导入', endpoint: '/students/import' })
  );
  document.querySelector('#addStudent')?.addEventListener('click', () =>
    openForm({
      title: '新增学生',
      fields,
      initial: { campusId: defaultCampusId(meta), academicYearId: defaultAcademicYearId(meta), enrollmentYear: new Date().getFullYear(), status: '在读' },
      onSubmit: (payload) => api('/students', { method: 'POST', body: payload })
    })
  );
  document.querySelectorAll('[data-edit-student]').forEach((button) => {
    button.addEventListener('click', () => {
      const student = students.find((item) => String(item.id) === button.dataset.editStudent);
      openForm({
        title: '编辑学生',
        fields,
        initial: student,
        onSubmit: (payload) => api(`/students/${student.id}`, { method: 'PUT', body: payload })
      });
    });
  });
  document.querySelectorAll('[data-issue-student]').forEach((button) => {
    button.addEventListener('click', async () => {
      const student = students.find((item) => String(item.id) === button.dataset.issueStudent);
      if (!confirm(`${student.accountUsername ? '确认重置' : '确认生成'}学生账号？`)) return;
      await issueAccount('students', button.dataset.issueStudent);
    });
  });
  document.querySelectorAll('[data-delete-student]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('确认删除该学生档案？')) return;
      try {
        await api(`/students/${button.dataset.deleteStudent}`, { method: 'DELETE' });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
}

async function renderCombos() {
  const combos = await api('/subject-combinations');
  const canWrite = can('subject_combinations.write');
  const maxCount = Math.max(...combos.map((item) => Number(item.studentCount)), 1);
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>3+1+2 选科组合</h2>
        ${canWrite ? '<button class="btn primary" id="addCombo">新增组合</button>' : ''}
      </div>
      ${renderTable(
        ['组合', '首选', '再选', '学生数', '占比'],
        combos.map((combo) => {
          const electives = parseJson(combo.electiveSubjects).join(' / ');
          const percent = Math.round((Number(combo.studentCount) / maxCount) * 100);
          return `
            <tr>
              <td><span class="tag green">${escapeHtml(combo.label)}</span></td>
              <td>${combo.preferredSubject === 'physics' ? '物理' : '历史'}</td>
              <td>${escapeHtml(electives)}</td>
              <td>${combo.studentCount}</td>
              <td><div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div></td>
            </tr>
          `;
        })
      )}
    </section>
  `;
  document.querySelector('#addCombo')?.addEventListener('click', openComboForm);
}

function openComboForm() {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `
    <form id="comboForm">
      <div class="dialog-head">
        <h2>新增选科组合</h2>
        <button class="btn ghost" type="button" data-close>关闭</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field full">
            <label>首选科目</label>
            <select name="preferredSubject" required>
              <option value="physics">物理</option>
              <option value="history">历史</option>
            </select>
          </div>
          <div class="field full">
            <label>再选科目</label>
            <div class="checkbox-row">
              ${[
                ['chemistry', '化学'],
                ['biology', '生物'],
                ['politics', '思想政治'],
                ['geography', '地理']
              ]
                .map(([value, label]) => `<label><input type="checkbox" name="electiveSubjects" value="${value}" /> ${label}</label>`)
                .join('')}
            </div>
          </div>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn primary" type="submit">保存</button>
      </div>
    </form>
  `;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('#comboForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      preferredSubject: form.get('preferredSubject'),
      electiveSubjects: form.getAll('electiveSubjects')
    };
    try {
      await api('/subject-combinations', { method: 'POST', body: payload });
      state.meta = null;
      dialog.close();
      await loadView();
    } catch (error) {
      notifyError(error);
    }
  });
}

async function renderTimetable() {
  const canWriteTeachingClass = can('teaching_classes.write');
  const canEnroll = can('teaching_classes.enroll');
  const canWriteTimetable = can('timetable.write');
  const canDeleteTimetable = can('timetable.delete');
  const needsFormOptions = canWriteTeachingClass || canWriteTimetable;
  const semester = '2026春';
  const [meta, teacherPage, classPage, teachingClassOptionsPage, teachingClassPage, entries, workload] = await Promise.all([
    getMeta(),
    needsFormOptions ? api('/teachers?pageSize=200&sort=name&order=asc') : Promise.resolve({ items: [] }),
    needsFormOptions ? api('/classes?pageSize=200&sort=name&order=asc') : Promise.resolve({ items: [] }),
    needsFormOptions ? api('/teaching-classes?pageSize=200&sort=name&order=asc') : Promise.resolve({ items: [] }),
    api(buildListPath('/teaching-classes', 'teachingClasses')),
    api(`/timetable?semester=${encodeURIComponent(semester)}`),
    api(`/timetable/teacher-workload?semester=${encodeURIComponent(semester)}`)
  ]);
  const teachers = listItems(teacherPage);
  const classes = listItems(classPage);
  const teachingClassOptions = listItems(teachingClassOptionsPage);
  const teachingClasses = listItems(teachingClassPage);
  const campuses = campusOptions(meta);
  const academicYears = academicYearOptions(meta);
  const slotOptions = (meta.timetableSlots || [])
    .filter((slot) => slot.weekday === 1)
    .sort((a, b) => a.period - b.period)
    .map((slot) => ({
      value: slot.period,
      label: `${slot.label || `第 ${slot.period} 节`} ${slot.slotType === 'evening' ? '（晚自习）' : ''}`
    }));

  const teachingFields = [
    { name: 'gradeId', label: '年级', type: 'select', options: meta.grades.map((g) => ({ value: g.id, label: g.name })), required: true, allowEmpty: false },
    { name: 'campusId', label: '校区', type: 'select', options: campuses, required: true, allowEmpty: false },
    { name: 'academicYearId', label: '学年', type: 'select', options: academicYears, required: true, allowEmpty: false },
    { name: 'subjectCode', label: '学科', type: 'select', options: meta.subjects.map((s) => ({ value: s.code, label: s.name })), required: true, allowEmpty: false },
    { name: 'name', label: '教学班名称', required: true },
    { name: 'teacherId', label: '任课教师', type: 'select', options: teachers.map((t) => ({ value: t.id, label: `${t.name}（${t.subjectName}）` })) },
    { name: 'subjectComboId', label: '绑定选科组合', type: 'select', options: meta.combinations.map((c) => ({ value: c.id, label: c.label })) },
    { name: 'capacity', label: '容量', type: 'number' },
    { name: 'roomId', label: '教室', type: 'select', options: meta.rooms.map((r) => ({ value: r.id, label: `${r.name}（${r.roomType}）` })) }
  ];

  const timetableFields = [
    { name: 'semester', label: '学期', required: true },
    { name: 'campusId', label: '校区', type: 'select', options: campuses, required: true, allowEmpty: false },
    { name: 'academicYearId', label: '学年', type: 'select', options: academicYears, required: true, allowEmpty: false },
    { name: 'weekday', label: '星期', type: 'select', options: weekdays.map((day, index) => ({ value: index + 1, label: day })), required: true, allowEmpty: false },
    { name: 'period', label: '节次', type: 'select', options: slotOptions, required: true, allowEmpty: false },
    { name: 'classId', label: '行政班', type: 'select', options: classes.map((c) => ({ value: c.id, label: `${c.gradeName} ${c.name}` })) },
    { name: 'teachingClassId', label: '教学班', type: 'select', options: teachingClassOptions.map((c) => ({ value: c.id, label: `${c.gradeName} ${c.name}` })) },
    { name: 'roomId', label: '教室', type: 'select', options: meta.rooms.map((r) => ({ value: r.id, label: r.name })) },
    { name: 'note', label: '备注', full: true }
  ];

  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>教学班</h2>
        ${canWriteTeachingClass ? '<button class="btn primary" id="addTeachingClass">新增教学班</button>' : ''}
      </div>
      ${renderListToolbar('teachingClasses', {
        filters: `
          <select name="gradeId">
            ${toOptions(meta.grades.map((g) => ({ value: g.id, label: g.name })), 'value', 'label', listFieldValue('teachingClasses', 'gradeId'))}
          </select>
          <select name="campusId">
            ${toOptions(campuses, 'value', 'label', listFieldValue('teachingClasses', 'campusId'))}
          </select>
          <select name="academicYearId">
            ${toOptions(academicYears, 'value', 'label', listFieldValue('teachingClasses', 'academicYearId'))}
          </select>
          <select name="subjectCode">
            ${toOptions(meta.subjects.map((s) => ({ value: s.code, label: s.name })), 'value', 'label', listFieldValue('teachingClasses', 'subjectCode'))}
          </select>
        `,
        sortOptions: [
          { value: 'grade', label: '年级' },
          { value: 'subject', label: '学科' },
          { value: 'name', label: '教学班' },
          { value: 'teacher', label: '教师' },
          { value: 'studentCount', label: '人数' },
          { value: 'capacity', label: '容量' }
        ]
      })}
      ${renderTable(
        ['教学班', '年级', '校区', '学年', '学科', '教师', '组合', '人数/容量', '教室', ...actionHeader(['teaching_classes.enroll'])],
        teachingClasses.map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.gradeName)}</td>
              <td>${escapeHtml(item.campusName || '-')}</td>
              <td>${escapeHtml(item.academicYearName || '-')}</td>
              <td>${escapeHtml(item.subjectName)}</td>
              <td>${escapeHtml(item.teacherName || '-')}</td>
              <td>${escapeHtml(item.subjectComboLabel || '-')}</td>
              <td>${item.studentCount}/${item.capacity}</td>
              <td>${escapeHtml(item.roomName || '-')}</td>
              ${actionCell([canEnroll ? `<button class="btn success" data-enroll="${item.id}">按组合编班</button>` : ''])}
            </tr>
          `
        )
      )}
      ${renderPagination('teachingClasses', teachingClassPage)}
    </section>
    <section class="panel">
      <div class="panel-header">
        <h2>2026春课表</h2>
        <div class="toolbar">
          ${canWriteTimetable ? '<button class="btn success" id="autoSchedule">自动排课</button>' : ''}
          ${canWriteTimetable ? '<button class="btn primary" id="addTimetable">新增课表项</button>' : ''}
        </div>
      </div>
      <div class="panel-body">${renderTimetableGrid(entries, meta.timetableSlots || [], canDeleteTimetable)}</div>
    </section>
    <section class="panel">
      <div class="panel-header"><h2>教师课时统计</h2></div>
      ${renderTable(
        ['教师', '学科', '教学班数', '普通课时', '晚自习', '总课时'],
        workload.map(
          (item) => `
            <tr>
              <td>${escapeHtml(item.teacherName)}<br><span class="muted">${escapeHtml(item.employeeNo)}</span></td>
              <td>${escapeHtml(item.subjectName)}</td>
              <td>${escapeHtml(item.teachingClassCount)}</td>
              <td>${escapeHtml(item.regularPeriods)}</td>
              <td>${escapeHtml(item.eveningPeriods)}</td>
              <td><strong>${escapeHtml(item.totalPeriods)}</strong></td>
            </tr>
          `
        ),
        '暂无课时统计'
      )}
    </section>
  `;
  bindListInteractions('teachingClasses');
  document.querySelector('#addTeachingClass')?.addEventListener('click', () =>
    openForm({
      title: '新增教学班',
      fields: teachingFields,
      initial: { campusId: defaultCampusId(meta), academicYearId: defaultAcademicYearId(meta), capacity: 45 },
      onSubmit: (payload) => api('/teaching-classes', { method: 'POST', body: payload })
    })
  );
  document.querySelector('#addTimetable')?.addEventListener('click', () =>
    openForm({
      title: '新增课表项',
      fields: timetableFields,
      initial: { semester, campusId: defaultCampusId(meta), academicYearId: defaultAcademicYearId(meta) },
      onSubmit: (payload) => api('/timetable', { method: 'POST', body: payload })
    })
  );
  document.querySelector('#autoSchedule')?.addEventListener('click', async () => {
    const overwrite = confirm('是否清空本学期教学班课表后重新排课？点击“取消”将只补充空余时段。');
    try {
      const result = await api('/timetable/auto-schedule', {
        method: 'POST',
        body: {
          semester,
          campusId: defaultCampusId(meta),
          academicYearId: defaultAcademicYearId(meta),
          overwrite,
          includeEvening: false,
          maxDailyPeriods: 6
        }
      });
      alert(`自动排课完成：新增 ${result.scheduled} 节，未排入 ${result.skipped?.length || 0} 项`);
      await loadView();
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelectorAll('[data-enroll]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const result = await api(`/teaching-classes/${button.dataset.enroll}/enroll-by-combo`, { method: 'POST', body: {} });
        alert(`已编入 ${result.enrolled} 名学生`);
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
  document.querySelectorAll('[data-delete-entry]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('确认删除该课表项？')) return;
      try {
        await api(`/timetable/${button.dataset.deleteEntry}`, { method: 'DELETE' });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
}

function renderTimetableGrid(entries, slots, canDelete = false) {
  const byCell = new Map();
  entries.forEach((entry) => {
    const key = `${entry.weekday}-${entry.period}`;
    byCell.set(key, [...(byCell.get(key) || []), entry]);
  });
  const periodRows = slots
    .filter((slot) => slot.weekday === 1)
    .sort((a, b) => a.period - b.period);
  const cells = ['<div class="tt-cell tt-head">节次</div>', ...weekdays.map((day) => `<div class="tt-cell tt-head">${day}</div>`)];
  for (const slot of periodRows) {
    cells.push(`<div class="tt-cell tt-period ${slot.slotType === 'evening' ? 'evening' : ''}">${escapeHtml(slot.label || `第 ${slot.period} 节`)}<span>${escapeHtml(slot.startTime || '')}-${escapeHtml(slot.endTime || '')}</span></div>`);
    for (let weekday = 1; weekday <= 5; weekday += 1) {
      const cellEntries = byCell.get(`${weekday}-${slot.period}`) || [];
      cells.push(`
        <div class="tt-cell">
          ${cellEntries
            .map(
              (entry) => `<div class="tt-course ${entry.slotType === 'evening' ? 'evening' : ''}">
                <strong>${escapeHtml(entry.teachingClassName || entry.className || '课程')}</strong>
                <span>${escapeHtml(entry.subjectName || entry.note || '')} ${escapeHtml(entry.teacherName || '')}</span>
                <span>${escapeHtml(entry.roomName || '')}</span>
                ${canDelete ? `<button class="btn danger" data-delete-entry="${entry.id}" type="button">删除</button>` : ''}
              </div>`
            )
            .join('')}
        </div>
      `);
    }
  }
  return `<div class="timetable">${cells.join('')}</div>`;
}

async function renderExams() {
  const canWriteExam = can('exams.write');
  const canWriteScore = can('exam_scores.write');
  const canRankScores = can('exam_scores.rank');
  const [meta, studentPage, examPage] = await Promise.all([
    getMeta(),
    canWriteScore ? api('/students?pageSize=200&sort=name&order=asc') : Promise.resolve({ items: [] }),
    api(buildListPath('/exams', 'exams'))
  ]);
  const students = listItems(studentPage);
  const exams = listItems(examPage);
  const academicYears = academicYearOptions(meta);
  const selectedExamId = exams[0]?.id || '';
  const scorePage = selectedExamId ? await api(buildListPath('/exam-scores', 'examScores', { examId: selectedExamId })) : { items: [], pagination: null };
  const scores = listItems(scorePage);
  const examFields = [
    { name: 'gradeId', label: '年级', type: 'select', options: meta.grades.map((g) => ({ value: g.id, label: g.name })), required: true, allowEmpty: false },
    { name: 'academicYearId', label: '学年', type: 'select', options: academicYears, required: true, allowEmpty: false },
    { name: 'name', label: '考试名称', required: true },
    { name: 'semester', label: '学期', required: true },
    { name: 'examDate', label: '考试日期', type: 'date', required: true },
    { name: 'examType', label: '考试类型', type: 'select', options: ['月考', '期中', '期末', '联考', '模拟考'].map((x) => ({ value: x, label: x })), allowEmpty: false }
  ];
  const scoreFields = [
    { name: 'examId', label: '考试', type: 'select', options: exams.map((e) => ({ value: e.id, label: e.name })), required: true, allowEmpty: false },
    { name: 'studentId', label: '学生', type: 'select', options: students.map((s) => ({ value: s.id, label: `${s.name}（${s.studentNo}）` })), required: true, allowEmpty: false },
    { name: 'subjectCode', label: '学科', type: 'select', options: meta.subjects.map((s) => ({ value: s.code, label: s.name })), required: true, allowEmpty: false },
    { name: 'rawScore', label: '原始分', type: 'number', required: true },
    { name: 'standardScore', label: '赋分/标准分', type: 'number' },
    { name: 'rankInGrade', label: '年级排名', type: 'number' }
  ];
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>考试管理</h2>
        ${
          canWriteExam || canWriteScore || (canRankScores && selectedExamId)
            ? `<div class="toolbar">
                ${canWriteExam ? '<button class="btn primary" id="addExam">新增考试</button>' : ''}
                ${canWriteScore ? '<button class="btn" id="addScore">录入成绩</button>' : ''}
                ${canRankScores && selectedExamId ? '<button class="btn success" id="rankScores">重算排名</button>' : ''}
              </div>`
            : ''
        }
      </div>
      ${renderListToolbar('exams', {
        filters: `
          <select name="gradeId">
            ${toOptions(meta.grades.map((g) => ({ value: g.id, label: g.name })), 'value', 'label', listFieldValue('exams', 'gradeId'))}
          </select>
          <select name="academicYearId">
            ${toOptions(academicYears, 'value', 'label', listFieldValue('exams', 'academicYearId'))}
          </select>
          <select name="examType">
            ${toOptions(['月考', '期中', '期末', '联考', '模拟考'].map((x) => ({ value: x, label: x })), 'value', 'label', listFieldValue('exams', 'examType'))}
          </select>
        `,
        sortOptions: [
          { value: 'examDate', label: '考试日期' },
          { value: 'name', label: '考试名称' },
          { value: 'grade', label: '年级' },
          { value: 'scoreCount', label: '成绩数' },
          { value: 'averageScore', label: '平均分' }
        ]
      })}
      ${renderTable(
        ['考试', '年级', '学年', '学期', '类型', '日期', '成绩数', '平均分'],
        exams.map(
          (exam) => `
            <tr>
              <td>${escapeHtml(exam.name)}</td>
              <td>${escapeHtml(exam.gradeName)}</td>
              <td>${escapeHtml(exam.academicYearName || '-')}</td>
              <td>${escapeHtml(exam.semester)}</td>
              <td>${escapeHtml(exam.examType)}</td>
              <td>${escapeHtml(exam.examDate)}</td>
              <td>${exam.scoreCount}</td>
              <td>${escapeHtml(exam.averageScore ?? '-')}</td>
            </tr>
          `
        )
      )}
      ${renderPagination('exams', examPage)}
    </section>
    <section class="panel">
      <div class="panel-header"><h2>最近考试成绩</h2></div>
      ${renderListToolbar('examScores', {
        filters: `
          <select name="subjectCode">
            ${toOptions(meta.subjects.map((s) => ({ value: s.code, label: s.name })), 'value', 'label', listFieldValue('examScores', 'subjectCode'))}
          </select>
        `,
        sortOptions: [
          { value: 'id', label: '录入时间' },
          { value: 'studentNo', label: '学号' },
          { value: 'studentName', label: '姓名' },
          { value: 'subject', label: '学科' },
          { value: 'rawScore', label: '原始分' },
          { value: 'rankInGrade', label: '排名' }
        ]
      })}
      ${renderTable(
        ['考试', '学生', '行政班', '学科', '原始分', '赋分', '排名'],
        scores.map(
          (score) => `
            <tr>
              <td>${escapeHtml(score.examName)}</td>
              <td>${escapeHtml(score.studentName)}<br><span class="muted">${escapeHtml(score.studentNo)}</span></td>
              <td>${escapeHtml(score.className || '-')}</td>
              <td>${escapeHtml(score.subjectName)}</td>
              <td>${escapeHtml(score.rawScore)}</td>
              <td>${escapeHtml(score.standardScore ?? '-')}</td>
              <td>${escapeHtml(score.rankInGrade ?? '-')}</td>
            </tr>
          `
        ),
        '当前考试暂无成绩'
      )}
      ${renderPagination('examScores', scorePage)}
    </section>
  `;
  bindListInteractions('exams');
  bindListInteractions('examScores');
  document.querySelector('#addExam')?.addEventListener('click', () =>
    openForm({
      title: '新增考试',
      fields: examFields,
      initial: { academicYearId: defaultAcademicYearId(meta), semester: '2026春', examType: '月考' },
      onSubmit: (payload) => api('/exams', { method: 'POST', body: payload })
    })
  );
  document.querySelector('#addScore')?.addEventListener('click', () =>
    openForm({
      title: '录入成绩',
      fields: scoreFields,
      initial: { examId: selectedExamId },
      onSubmit: (payload) => api('/exam-scores', { method: 'POST', body: payload })
    })
  );
  const rankButton = document.querySelector('#rankScores');
  if (rankButton) {
    rankButton.addEventListener('click', async () => {
      try {
        await api(`/exams/${selectedExamId}/recalculate-ranks`, { method: 'POST', body: {} });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  }
}

async function renderAudit() {
  const [alertPage, logPage] = await Promise.all([
    api(buildListPath('/audit-alerts', 'auditAlerts')),
    api(buildListPath('/audit-logs', 'auditLogs'))
  ]);
  const alerts = listItems(alertPage);
  const logs = listItems(logPage);
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>安全告警</h2></div>
      ${renderListToolbar('auditAlerts', {
        filters: `
          <select name="status">
            ${toOptions(
              [
                { value: 'open', label: '未处理' },
                { value: 'acknowledged', label: '已确认' },
                { value: 'closed', label: '已关闭' },
                { value: 'all', label: '全部状态' }
              ],
              'value',
              'label',
              listFieldValue('auditAlerts', 'status'),
              false
            )}
          </select>
          <select name="severity">
            ${toOptions(
              [
                { value: 'info', label: '信息' },
                { value: 'warning', label: '警告' },
                { value: 'critical', label: '严重' }
              ],
              'value',
              'label',
              listFieldValue('auditAlerts', 'severity')
            )}
          </select>
          <select name="alertType">
            ${toOptions(
              [
                { value: 'failed_login_burst', label: '高频失败登录' },
                { value: 'account_reset_burst', label: '高频账号重置' },
                { value: 'new_ip_login', label: '异常 IP 登录' },
                { value: 'slow_api', label: '慢接口' }
              ],
              'value',
              'label',
              listFieldValue('auditAlerts', 'alertType')
            )}
          </select>
        `,
        sortOptions: [
          { value: 'lastSeenAt', label: '最近时间' },
          { value: 'severity', label: '等级' },
          { value: 'status', label: '状态' },
          { value: 'eventCount', label: '次数' },
          { value: 'alertType', label: '类型' }
        ]
      })}
      ${renderTable(
        ['类型', '等级', '状态', '对象', 'IP', '次数', '最近时间', '备注', ...actionHeader(['audit_alerts.acknowledge'])],
        alerts.map(
          (alert) => `
            <tr>
              <td>${escapeHtml(alert.alertType)}</td>
              <td><span class="tag ${alert.severity === 'critical' ? 'orange' : alert.severity === 'warning' ? '' : 'green'}">${escapeHtml(alert.severity)}</span></td>
              <td><span class="tag ${alert.status === 'open' ? 'orange' : 'green'}">${escapeHtml(alert.status)}</span></td>
              <td>${escapeHtml(alert.targetUsername || alert.actorUsername || '-')}</td>
              <td>${escapeHtml(alert.ipAddress || '-')}</td>
              <td>${escapeHtml(alert.eventCount)}</td>
              <td>${escapeHtml(alert.lastSeenAt)}</td>
              <td class="wrap">${escapeHtml(alert.dispositionNote || '-')}</td>
              ${actionCell([
                can('audit_alerts.acknowledge') && alert.status === 'open' ? `<button class="btn success" data-ack-alert="${alert.id}">确认</button>` : '',
                can('audit_alerts.acknowledge') && alert.status !== 'closed' ? `<button class="btn danger" data-close-alert="${alert.id}">关闭</button>` : ''
              ])}
            </tr>
          `
        ),
        '暂无告警'
      )}
      ${renderPagination('auditAlerts', alertPage)}
    </section>
    <section class="panel">
      <div class="panel-header"><h2>操作日志检索</h2></div>
      ${renderListToolbar('auditLogs', {
        filters: `
          <select name="eventType">
            ${toOptions(
              ['auth', 'data', 'permission', 'audit', 'performance'].map((x) => ({ value: x, label: x })),
              'value',
              'label',
              listFieldValue('auditLogs', 'eventType')
            )}
          </select>
          <select name="outcome">
            ${toOptions(
              [
                { value: 'success', label: 'success' },
                { value: 'failure', label: 'failure' }
              ],
              'value',
              'label',
              listFieldValue('auditLogs', 'outcome')
            )}
          </select>
          <input name="from" type="date" value="${escapeHtml(listFieldValue('auditLogs', 'from'))}" />
          <input name="to" type="date" value="${escapeHtml(listFieldValue('auditLogs', 'to'))}" />
        `,
        sortOptions: [
          { value: 'id', label: '记录时间' },
          { value: 'eventType', label: '类型' },
          { value: 'action', label: '动作' },
          { value: 'outcome', label: '结果' },
          { value: 'actorUsername', label: '操作者' },
          { value: 'ipAddress', label: 'IP' }
        ]
      })}
      ${renderTable(
        ['时间', '类型', '动作', '结果', '操作者', '对象', 'IP'],
        logs.map(
          (log) => `
            <tr>
              <td>${escapeHtml(log.createdAt)}</td>
              <td>${escapeHtml(log.eventType)}</td>
              <td>${escapeHtml(log.action)}</td>
              <td><span class="tag ${log.outcome === 'success' ? 'green' : 'orange'}">${escapeHtml(log.outcome)}</span></td>
              <td>${escapeHtml(log.actorUsername || '-')}</td>
              <td>${escapeHtml(log.targetUsername || log.targetId || '-')}</td>
              <td>${escapeHtml(log.ipAddress || '-')}</td>
            </tr>
          `
        ),
        '暂无审计日志'
      )}
      ${renderPagination('auditLogs', logPage)}
    </section>
  `;
  bindListInteractions('auditAlerts');
  bindListInteractions('auditLogs');

  document.querySelectorAll('[data-ack-alert]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const note = prompt('确认备注（可选）') || '';
        await api(`/audit-alerts/${button.dataset.ackAlert}/acknowledge`, { method: 'POST', body: { note } });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
  document.querySelectorAll('[data-close-alert]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const note = prompt('关闭原因') || '';
        await api(`/audit-alerts/${button.dataset.closeAlert}/dispose`, { method: 'POST', body: { status: 'closed', note } });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
}

async function refreshSession() {
  try {
    const result = await api('/auth/me');
    state.user = result.user;
    localStorage.setItem(userKey, JSON.stringify(result.user));
    if (result.user.mustChangePassword) {
      renderPasswordChangeView();
      return;
    }
    renderShell();
    loadView();
  } catch {
    // api() already clears invalid sessions.
  }
}

if (state.token) {
  if (state.user?.mustChangePassword) {
    renderPasswordChangeView();
  } else {
    refreshSession();
  }
} else {
  renderLogin();
}
