// Generated from frontend/src by scripts/build-frontend.js. Do not edit directly.

// frontend/src/components/ui.ts
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

// frontend/src/main.ts
var app = document.querySelector("#app");
var tokenKey = "fides_gaokao_token";
var userKey = "fides_gaokao_user";
var navItems = [
  { view: "dashboard", label: "\u5DE5\u4F5C\u53F0", permission: "page.dashboard" },
  { view: "students", label: "\u5B66\u751F\u7BA1\u7406", permission: "page.students" },
  { view: "teachers", label: "\u6559\u5E08\u7BA1\u7406", permission: "page.teachers" },
  { view: "classes", label: "\u884C\u653F\u73ED", permission: "page.classes" },
  { view: "combos", label: "\u9009\u79D1\u7EC4\u5408", permission: "page.combinations" },
  { view: "timetable", label: "\u6392\u8BFE\u7BA1\u7406", permission: "page.timetable" },
  { view: "exams", label: "\u8003\u8BD5\u6210\u7EE9", permission: "page.exams" },
  { view: "audit", label: "\u5B89\u5168\u5BA1\u8BA1", permission: "page.audit" }
];
var weekdays = ["\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94"];
var state = {
  token: localStorage.getItem(tokenKey),
  user: JSON.parse(localStorage.getItem(userKey) || "null"),
  view: "dashboard",
  meta: null,
  lists: {}
};
var listDefaults = {
  teachers: { page: 1, pageSize: 20, sort: "id", order: "desc" },
  students: { page: 1, pageSize: 20, sort: "id", order: "desc" },
  classes: { page: 1, pageSize: 20, sort: "grade", order: "desc" },
  teachingClasses: { page: 1, pageSize: 20, sort: "grade", order: "desc" },
  exams: { page: 1, pageSize: 20, sort: "examDate", order: "desc" },
  examScores: { page: 1, pageSize: 50, sort: "id", order: "desc" },
  auditAlerts: { page: 1, pageSize: 20, sort: "lastSeenAt", order: "desc", status: "open" },
  auditLogs: { page: 1, pageSize: 50, sort: "id", order: "desc" }
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
    state.view = visible[0]?.view || "dashboard";
  }
}
function actionHeader(permissions) {
  return permissions.some((permission) => can(permission)) ? ["\u64CD\u4F5C"] : [];
}
function actionCell(actions) {
  const visibleActions = actions.filter(Boolean).join("");
  return visibleActions ? `<td>${visibleActions}</td>` : "";
}
var toOptions = (items, valueKey, labelKey, selected, allowEmpty = true) => {
  const empty = allowEmpty ? '<option value="">\u8BF7\u9009\u62E9</option>' : "";
  return empty + items.map((item) => {
    const value = item[valueKey];
    const label = item[labelKey];
    return `<option value="${escapeHtml(value)}" ${String(value) === String(selected ?? "") ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
};
function campusOptions(meta) {
  return (meta.campuses || []).map((campus) => ({ value: campus.id, label: campus.name }));
}
function academicYearOptions(meta) {
  return (meta.academicYears || []).map((year) => ({ value: year.id, label: year.name }));
}
function defaultCampusId(meta) {
  return state.user?.campusId || meta.currentCampusId || meta.campuses?.[0]?.id || "";
}
function defaultAcademicYearId(meta) {
  return state.user?.academicYearId || meta.currentAcademicYearId || meta.academicYears?.find((year) => Number(year.isCurrent))?.id || meta.academicYears?.[0]?.id || "";
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
    state.lists[key] = { ...listDefaults[key] || { page: 1, pageSize: 20, sort: "id", order: "desc" } };
  }
  return state.lists[key];
}
function resetListState(key) {
  state.lists[key] = { ...listDefaults[key] || { page: 1, pageSize: 20, sort: "id", order: "desc" } };
}
function listItems(payload) {
  return Array.isArray(payload) ? payload : payload?.items || [];
}
function buildListPath(path, key, extra = {}) {
  const params = new URLSearchParams();
  const current = { ...getListState(key), ...extra };
  Object.entries(current).forEach(([name, value]) => {
    if (value !== void 0 && value !== null && value !== "") params.set(name, value);
  });
  return `${path}?${params.toString()}`;
}
function listFieldValue(key, name) {
  return getListState(key)[name] ?? "";
}
function renderListToolbar(key, { filters = "", sortOptions = [] } = {}) {
  const current = getListState(key);
  return `
    <form class="list-controls" data-list-filter="${key}">
      <input name="q" value="${escapeHtml(current.q || "")}" placeholder="\u641C\u7D22" />
      ${filters}
      <select name="sort">
        ${sortOptions.map((option) => `<option value="${option.value}" ${current.sort === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
      </select>
      <select name="order">
        <option value="desc" ${current.order !== "asc" ? "selected" : ""}>\u964D\u5E8F</option>
        <option value="asc" ${current.order === "asc" ? "selected" : ""}>\u5347\u5E8F</option>
      </select>
      <select name="pageSize">
        ${[10, 20, 50, 100].map((size) => `<option value="${size}" ${Number(current.pageSize) === size ? "selected" : ""}>\u6BCF\u9875 ${size}</option>`).join("")}
      </select>
      <button class="btn" type="submit">\u7B5B\u9009</button>
      <button class="btn ghost" type="button" data-reset-list="${key}">\u91CD\u7F6E</button>
    </form>
  `;
}
function renderPagination(key, response) {
  const pagination = response?.pagination;
  if (!pagination) return "";
  return `
    <div class="pager">
      <span>\u5171 ${pagination.total} \u6761\uFF0C\u7B2C ${pagination.page} / ${pagination.totalPages} \u9875</span>
      <div class="toolbar">
        <button class="btn" type="button" data-page-list="${key}" data-page="${pagination.page - 1}" ${pagination.hasPrev ? "" : "disabled"}>\u4E0A\u4E00\u9875</button>
        <button class="btn" type="button" data-page-list="${key}" data-page="${pagination.page + 1}" ${pagination.hasNext ? "" : "disabled"}>\u4E0B\u4E00\u9875</button>
      </div>
    </div>
  `;
}
function bindListInteractions(key) {
  document.querySelectorAll(`[data-list-filter="${key}"]`).forEach((form) => {
    form.addEventListener("submit", (event) => {
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
    button.addEventListener("click", () => {
      resetListState(key);
      loadView();
    });
  });
  document.querySelectorAll(`[data-page-list="${key}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      const page = Number(button.dataset.page);
      if (!Number.isInteger(page) || page < 1) return;
      state.lists[key] = { ...getListState(key), page };
      loadView();
    });
  });
}
async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers || {}
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : void 0
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    logout();
    throw new Error("\u767B\u5F55\u5DF2\u8FC7\u671F");
  }
  if (response.status === 423 && payload.code === "PASSWORD_CHANGE_REQUIRED") {
    state.user = { ...state.user || {}, mustChangePassword: true };
    localStorage.setItem(userKey, JSON.stringify(state.user));
    renderPasswordChangeView();
    throw new Error(payload.message || "\u9996\u6B21\u767B\u5F55\u5FC5\u987B\u4FEE\u6539\u5BC6\u7801");
  }
  if (!response.ok) {
    throw new Error(payload.message || "\u8BF7\u6C42\u5931\u8D25");
  }
  return payload;
}
async function apiExcelUpload(path, file, { dryRun = true } = {}) {
  const params = path.includes("?") ? "&" : "?";
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api${path}${params}dryRun=${dryRun ? "1" : "0"}`, {
    method: "POST",
    headers,
    body: await file.arrayBuffer()
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    logout();
    throw new Error("\u767B\u5F55\u5DF2\u8FC7\u671F");
  }
  if (response.status === 423 && payload.code === "PASSWORD_CHANGE_REQUIRED") {
    state.user = { ...state.user || {}, mustChangePassword: true };
    localStorage.setItem(userKey, JSON.stringify(state.user));
    renderPasswordChangeView();
    throw new Error(payload.message || "\u9996\u6B21\u767B\u5F55\u5FC5\u987B\u4FEE\u6539\u5BC6\u7801");
  }
  if (!response.ok) {
    const details = payload.invalid ? `\uFF0C${payload.invalid} \u884C\u672A\u901A\u8FC7\u6821\u9A8C` : "";
    throw new Error((payload.message || "\u5BFC\u5165\u5931\u8D25") + details);
  }
  return payload;
}
async function downloadApiFile(path, fallbackName) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api${path}`, { headers });
  if (response.status === 401) {
    logout();
    throw new Error("\u767B\u5F55\u5DF2\u8FC7\u671F");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "\u6587\u4EF6\u4E0B\u8F7D\u5931\u8D25");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
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
    state.meta = await api("/meta");
  }
  return state.meta;
}
function renderLogin() {
  app.innerHTML = `
    <main class="login-view">
      <section class="login-panel">
        <div class="login-brand">
          <h1>\u65B0\u9AD8\u8003\u9AD8\u4E2D\u6559\u52A1\u7CFB\u7EDF</h1>
          <p>\u8986\u76D6 3+1+2 \u9009\u79D1\u3001\u884C\u653F\u73ED\u3001\u6559\u5B66\u73ED\u3001\u8BFE\u8868\u4E0E\u6210\u7EE9\u6570\u636E\u3002</p>
        </div>
        <form class="login-form" id="loginForm">
          <div class="field">
            <label for="username">\u8D26\u53F7</label>
            <input id="username" name="username" autocomplete="username" value="admin" required />
          </div>
          <div class="field">
            <label for="password">\u5BC6\u7801</label>
            <input id="password" name="password" type="password" autocomplete="current-password" value="admin123" required />
          </div>
          <button class="btn primary" type="submit">\u767B\u5F55\u7CFB\u7EDF</button>
          <span class="muted">\u9ED8\u8BA4\u8D26\u53F7\uFF1Aadmin / admin123</span>
        </form>
        <div class="sso-login" id="ssoLoginBox"></div>
      </section>
      <section class="login-side">
        <h2>\u9762\u5411\u65B0\u9AD8\u8003\u8D70\u73ED\u7BA1\u7406\u7684\u6559\u52A1\u6570\u636E\u4E2D\u53F0</h2>
        <p>\u884C\u653F\u73ED\u4FDD\u7559\u65E5\u5E38\u7BA1\u7406\uFF0C\u6559\u5B66\u73ED\u652F\u6491\u9009\u79D1\u8D70\u73ED\uFF0C\u6210\u7EE9\u548C\u8BFE\u8868\u56F4\u7ED5\u5B66\u671F\u3001\u5E74\u7EA7\u4E0E\u7EC4\u5408\u7EDF\u4E00\u5F52\u6863\u3002</p>
      </section>
    </main>
  `;
  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api("/auth/login", { method: "POST", body: data });
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
  const box = document.querySelector("#ssoLoginBox");
  if (!box) return;
  try {
    const result = await api("/auth/sso/config");
    if (!result.enabled || !result.providers?.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = result.providers.map((provider) => `<a class="btn" href="${escapeHtml(provider.startUrl)}">${escapeHtml(provider.name)}</a>`).join("");
  } catch {
    box.innerHTML = "";
  }
}
function renderPasswordChangeView() {
  app.innerHTML = `
    <main class="login-view">
      <section class="login-panel">
        <div class="login-brand">
          <h1>\u9996\u6B21\u767B\u5F55\u4FEE\u6539\u5BC6\u7801</h1>
          <p>\u8D26\u53F7 ${escapeHtml(state.user?.username || "")} \u5FC5\u987B\u4FEE\u6539\u521D\u59CB\u5BC6\u7801\u540E\u624D\u80FD\u8FDB\u5165\u7CFB\u7EDF\u3002</p>
        </div>
        <form class="login-form" id="passwordChangeForm">
          <div class="field">
            <label for="currentPassword">\u5F53\u524D\u5BC6\u7801</label>
            <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label for="newPassword">\u65B0\u5BC6\u7801</label>
            <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" required />
          </div>
          <div class="field">
            <label for="confirmPassword">\u786E\u8BA4\u65B0\u5BC6\u7801</label>
            <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required />
          </div>
          <button class="btn primary" type="submit">\u4FEE\u6539\u5BC6\u7801\u5E76\u8FDB\u5165</button>
          <button class="btn ghost" type="button" id="backToLogin">\u8FD4\u56DE\u767B\u5F55</button>
          <span class="muted">\u5BC6\u7801\u81F3\u5C11 10 \u4F4D\uFF0C\u5E76\u5305\u542B\u5927\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u7279\u6B8A\u5B57\u7B26\u3002</span>
        </form>
      </section>
      <section class="login-side">
        <h2>\u521D\u59CB\u5BC6\u7801\u53EA\u7528\u4E8E\u8D26\u53F7\u53D1\u653E</h2>
        <p>\u4FEE\u6539\u540E\u7CFB\u7EDF\u4F1A\u91CD\u65B0\u7B7E\u53D1\u767B\u5F55\u51ED\u8BC1\uFF0C\u539F\u59CB\u5BC6\u7801\u4E0D\u518D\u53EF\u89C1\u3002</p>
      </section>
    </main>
  `;
  document.querySelector("#backToLogin").addEventListener("click", logout);
  document.querySelector("#passwordChangeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api("/auth/change-password", { method: "POST", body: data });
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
  const activeTitle = visible.find((item) => item.view === state.view)?.label || "\u5DE5\u4F5C\u53F0";
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <strong>FIDES \u6559\u52A1</strong>
          <span>\u4E2D\u56FD\u65B0\u9AD8\u8003\u9AD8\u4E2D\u7248</span>
        </div>
        <nav class="nav">
          ${visible.map(
    (item) => `<button type="button" data-view="${item.view}" class="${item.view === state.view ? "active" : ""}"><span>${item.label}</span><span>\u203A</span></button>`
  ).join("")}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <h1>${escapeHtml(activeTitle)}</h1>
          <div class="userbox">
            <span>${escapeHtml(state.user?.displayName || state.user?.username || "")}</span>
            <span class="muted">${escapeHtml([state.user?.tenantName, state.user?.campusName, state.user?.academicYearName].filter(Boolean).join(" / "))}</span>
            <button class="btn ghost" type="button" id="logoutBtn">\u9000\u51FA</button>
          </div>
        </header>
        <section class="content" id="content">
          <div class="panel"><div class="empty">\u52A0\u8F7D\u4E2D...</div></div>
        </section>
      </main>
    </div>
  `;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      renderShell();
      loadView();
    });
  });
  document.querySelector("#logoutBtn").addEventListener("click", logout);
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
  return document.querySelector("#content");
}
function renderTable(headers, rows, emptyText = "\u6682\u65E0\u6570\u636E") {
  if (!rows.length) return `<div class="empty">${emptyText}</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}
function openForm({ title, fields, initial = {}, onSubmit }) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `
    <form method="dialog" id="modalForm">
      <div class="dialog-head">
        <h2>${escapeHtml(title)}</h2>
        <button class="btn ghost" value="cancel" type="button" data-close>\u5173\u95ED</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          ${fields.map((field) => {
    const value = initial[field.name] ?? field.value ?? "";
    const required = field.required ? "required" : "";
    const full = field.full ? " full" : "";
    if (field.type === "select") {
      return `
                  <div class="field${full}">
                    <label>${escapeHtml(field.label)}</label>
                    <select name="${field.name}" ${required}>${toOptions(field.options, "value", "label", value, field.allowEmpty !== false)}</select>
                  </div>
                `;
    }
    if (field.type === "textarea") {
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
                  <input name="${field.name}" type="${field.type || "text"}" value="${escapeHtml(value)}" ${required} />
                </div>
              `;
  }).join("")}
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn" value="cancel" type="button" data-close>\u53D6\u6D88</button>
        <button class="btn primary" value="default" type="submit">\u4FDD\u5B58</button>
      </div>
    </form>
  `;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("#modalForm").addEventListener("submit", async (event) => {
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
    const result = await api(`/accounts/${entity}/${id}/issue-password`, { method: "POST", body: {} });
    alert(`\u8D26\u53F7\uFF1A${result.username}
\u521D\u59CB\u5BC6\u7801\uFF1A${result.initialPassword}
\u9996\u6B21\u767B\u5F55\u5FC5\u987B\u4FEE\u6539\u5BC6\u7801\u3002`);
    await loadView();
  } catch (error) {
    notifyError(error);
  }
}
function renderBulkResult(report) {
  if (!report) return "";
  const rows = (report.rows || []).slice(0, 80);
  return `
    <div class="bulk-summary">
      <span class="tag">\u603B\u884C\u6570 ${report.total}</span>
      <span class="tag green">\u53EF\u5BFC\u5165 ${report.valid}</span>
      <span class="tag ${report.invalid ? "orange" : "green"}">\u9519\u8BEF ${report.invalid}</span>
      <span class="tag">\u65B0\u589E ${report.create}</span>
      <span class="tag">\u66F4\u65B0 ${report.update}</span>
    </div>
    ${renderTable(
    ["\u884C\u53F7", "\u72B6\u6001", "\u52A8\u4F5C", "\u9519\u8BEF"],
    rows.map(
      (row) => `
          <tr>
            <td>${row.rowNumber}</td>
            <td><span class="tag ${row.status === "valid" ? "green" : "orange"}">${row.status === "valid" ? "\u901A\u8FC7" : "\u9519\u8BEF"}</span></td>
            <td>${row.action === "create" ? "\u65B0\u589E" : row.action === "update" ? "\u66F4\u65B0" : "-"}</td>
            <td class="wrap">${escapeHtml((row.errors || []).join("\uFF1B") || "-")}</td>
          </tr>
        `
    ),
    "\u6682\u65E0\u6821\u9A8C\u7ED3\u679C"
  )}
  `;
}
function openBulkImportDialog({ title, endpoint }) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `
    <form id="bulkImportForm">
      <div class="dialog-head">
        <h2>${escapeHtml(title)}</h2>
        <button class="btn ghost" type="button" data-close>\u5173\u95ED</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field full">
            <label>Excel \u6587\u4EF6</label>
            <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
          </div>
        </div>
        <div class="bulk-result" id="bulkImportResult"></div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>\u53D6\u6D88</button>
        <button class="btn" type="submit" id="validateBulk">\u6821\u9A8C</button>
        <button class="btn primary" type="button" id="applyBulk" disabled>\u786E\u8BA4\u5BFC\u5165</button>
      </div>
    </form>
  `;
  let lastReport = null;
  const resultBox = dialog.querySelector("#bulkImportResult");
  const applyButton = dialog.querySelector("#applyBulk");
  const fileInput = dialog.querySelector('input[name="file"]');
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove());
  fileInput.addEventListener("change", () => {
    lastReport = null;
    applyButton.disabled = true;
    resultBox.innerHTML = "";
  });
  dialog.querySelector("#bulkImportForm").addEventListener("submit", async (event) => {
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
  applyButton.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file || !lastReport || lastReport.invalid) return;
    if (!confirm(`\u786E\u8BA4\u5BFC\u5165 ${lastReport.valid} \u884C\u6570\u636E\uFF1F`)) return;
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
      content().innerHTML = '<div class="panel"><div class="empty error">\u5F53\u524D\u8D26\u53F7\u6CA1\u6709\u6743\u9650\u8BBF\u95EE\u8BE5\u9875\u9762</div></div>';
      return;
    }
    if (state.view === "dashboard") return renderDashboard();
    if (state.view === "students") return renderStudents();
    if (state.view === "teachers") return renderTeachers();
    if (state.view === "classes") return renderClasses();
    if (state.view === "combos") return renderCombos();
    if (state.view === "timetable") return renderTimetable();
    if (state.view === "exams") return renderExams();
    if (state.view === "audit") return renderAudit();
  } catch (error) {
    content().innerHTML = `<div class="panel"><div class="empty error">${escapeHtml(error.message)}</div></div>`;
  }
}
async function renderDashboard() {
  const [data, analytics, trends, comboPrediction] = await Promise.all([
    api("/dashboard"),
    api("/analytics/dashboard"),
    api("/analytics/score-trends"),
    api("/analytics/subject-combo-predictions")
  ]);
  const maxCombo = Math.max(...data.combos.map((item) => Number(item.count)), 1);
  const scoreBands = analytics.scoreBands || { excellent: 0, passed: 0, needSupport: 0 };
  const totalBands = Number(scoreBands.excellent || 0) + Number(scoreBands.passed || 0) + Number(scoreBands.needSupport || 0);
  const predictions = comboPrediction.items || [];
  const recentTrends = (trends || []).slice(-8).reverse();
  const riskTone = (risk) => risk === "high" ? "orange" : risk === "low" ? "green" : "";
  content().innerHTML = `
    <section class="grid-4">
      ${[
    ["\u5728\u8BFB\u5B66\u751F", data.stats.students],
    ["\u5728\u5C97\u6559\u5E08", data.stats.teachers],
    ["\u884C\u653F\u73ED", data.stats.classes],
    ["\u6559\u5B66\u73ED", data.stats.teachingClasses]
  ].map(([label, value]) => `<div class="panel metric"><span>${label}</span><strong>${value}</strong></div>`).join("")}
    </section>
    <section class="grid-4">
      ${[
    ["\u8003\u8BD5\u573A\u6B21", analytics.scoreSummary.examCount],
    ["\u6210\u7EE9\u8BB0\u5F55", analytics.scoreSummary.scoreCount],
    ["\u5E73\u5747\u5206", analytics.scoreSummary.averageScore ?? "-"],
    ["\u6700\u9AD8\u5206", analytics.scoreSummary.highestScore ?? "-"]
  ].map(([label, value]) => `<div class="panel metric"><span>${label}</span><strong>${value}</strong></div>`).join("")}
    </section>
    <section class="split">
      <div class="panel">
        <div class="panel-header"><h2>\u9009\u79D1\u7EC4\u5408\u5206\u5E03</h2><span class="tag green">3+1+2</span></div>
        <div class="panel-body">
          <div class="bar-list">
            ${data.combos.length ? data.combos.map(
    (item) => `
                        <div class="bar-item">
                          <div class="bar-row"><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong></div>
                          <div class="bar-track"><div class="bar-fill" style="width:${Number(item.count) / maxCombo * 100}%"></div></div>
                        </div>
                      `
  ).join("") : '<div class="empty">\u6682\u65E0\u9009\u79D1\u6570\u636E</div>'}
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>\u6210\u7EE9\u5206\u6BB5</h2><span class="tag">\u6700\u8FD1\u6210\u7EE9</span></div>
        <div class="panel-body">
          <div class="bar-list">
            ${[
    ["\u4F18\u79C0 90+", scoreBands.excellent],
    ["\u5408\u683C 60-89", scoreBands.passed],
    ["\u9700\u5173\u6CE8 <60", scoreBands.needSupport]
  ].map(
    ([label, value]) => `
                  <div class="bar-item">
                    <div class="bar-row"><span>${label}</span><strong>${value}</strong></div>
                    <div class="bar-track"><div class="bar-fill" style="width:${totalBands ? Number(value) / totalBands * 100 : 0}%"></div></div>
                  </div>
                `
  ).join("")}
          </div>
        </div>
      </div>
    </section>
    <section class="split">
      <div class="panel">
        <div class="panel-header"><h2>\u6559\u52A1\u63D0\u9192</h2></div>
        <div class="panel-body timeline">
          ${data.announcements.length ? data.announcements.map(
    (item) => `
                      <div class="notice">
                        <strong>${escapeHtml(item.title)}</strong>
                        <p>${escapeHtml(item.content)}</p>
                      </div>
                    `
  ).join("") : '<div class="empty">\u6682\u65E0\u63D0\u9192</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>\u5B66\u79D1\u5747\u5206</h2></div>
        ${renderTable(
    ["\u5B66\u79D1", "\u5E73\u5747\u5206", "\u6210\u7EE9\u6570"],
    analytics.subjectAverages.map(
      (item) => `<tr><td>${escapeHtml(item.subjectName)}</td><td>${escapeHtml(item.averageScore ?? "-")}</td><td>${escapeHtml(item.scoreCount)}</td></tr>`
    ),
    "\u6682\u65E0\u6210\u7EE9\u6570\u636E"
  )}
      </div>
    </section>
    <section class="panel">
      <div class="panel-header"><h2>\u6210\u7EE9\u8D8B\u52BF\u5206\u6790</h2></div>
      ${renderTable(
    ["\u8003\u8BD5", "\u5E74\u7EA7", "\u5B66\u79D1", "\u5E73\u5747/\u6700\u4F4E/\u6700\u9AD8", "\u6210\u7EE9\u6570"],
    recentTrends.map(
      (item) => `
            <tr>
              <td>${escapeHtml(item.examName)}<br><span class="muted">${escapeHtml(item.examDate)}</span></td>
              <td>${escapeHtml(item.gradeName)}</td>
              <td>${escapeHtml(item.subjectName)}</td>
              <td>${escapeHtml(item.averageScore ?? "-")} / ${escapeHtml(item.lowestScore ?? "-")} / ${escapeHtml(item.highestScore ?? "-")}</td>
              <td>${escapeHtml(item.scoreCount)}</td>
            </tr>
          `
    ),
    "\u6682\u65E0\u8D8B\u52BF\u6570\u636E"
  )}
    </section>
    <section class="panel">
      <div class="panel-header">
        <h2>\u9009\u79D1\u7EC4\u5408\u9884\u6D4B</h2>
        <span class="tag">\u672A\u9009\u79D1 ${escapeHtml(comboPrediction.summary?.unselectedStudents ?? 0)}</span>
      </div>
      ${renderTable(
    ["\u7EC4\u5408", "\u5F53\u524D\u4EBA\u6570", "\u9884\u6D4B\u4EBA\u6570", "\u5360\u6BD4", "\u5EFA\u8BAE\u6559\u5B66\u73ED", "\u7F6E\u4FE1\u5EA6", "\u98CE\u9669"],
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
    "\u6682\u65E0\u9884\u6D4B\u6570\u636E"
  )}
    </section>
    <section class="panel">
      <div class="panel-header"><h2>\u6700\u8FD1\u8003\u8BD5</h2></div>
      ${renderTable(
    ["\u8003\u8BD5", "\u5E74\u7EA7", "\u7C7B\u578B", "\u65E5\u671F", "\u5E73\u5747\u5206"],
    data.exams.map(
      (exam) => `<tr><td>${escapeHtml(exam.name)}</td><td>${escapeHtml(exam.gradeName)}</td><td>${escapeHtml(exam.examType)}</td><td>${escapeHtml(exam.examDate)}</td><td>${escapeHtml(exam.averageScore ?? "-")}</td></tr>`
    )
  )}
    </section>
  `;
}
async function renderTeachers() {
  const canWrite = can("teachers.write");
  const [meta, teacherPage, classPage, teachingClassPage] = await Promise.all([
    getMeta(),
    api(buildListPath("/teachers", "teachers")),
    canWrite ? api("/classes?pageSize=200&sort=name&order=asc") : Promise.resolve({ items: [] }),
    canWrite ? api("/teaching-classes?pageSize=200&sort=name&order=asc") : Promise.resolve({ items: [] })
  ]);
  const teachers = listItems(teacherPage);
  const canDelete = can("teachers.delete");
  const canIssue = can("accounts.issue_teacher");
  const canBulk = can("teachers.bulk");
  const classes = listItems(classPage);
  const teachingClasses = listItems(teachingClassPage);
  const subjectOptions = meta.subjects.map((subject) => ({ value: subject.code, label: subject.name }));
  const campuses = campusOptions(meta);
  const academicYears = academicYearOptions(meta);
  const teacherOptions = teachers.map((teacher) => ({ value: teacher.id, label: `${teacher.name}\uFF08${teacher.employeeNo}\uFF09` }));
  const dutyFields = [
    { name: "teacherId", label: "\u6559\u5E08", type: "select", options: teacherOptions, required: true, allowEmpty: false },
    {
      name: "roleType",
      label: "\u804C\u52A1",
      type: "select",
      options: [
        { value: "grade_leader", label: "\u6BB5\u957F" },
        { value: "deputy_grade_leader", label: "\u526F\u6BB5\u957F" },
        { value: "grade_subject_leader", label: "\u5E74\u7EA7\u5B66\u79D1\u8D1F\u8D23\u4EBA" },
        { value: "head_teacher", label: "\u73ED\u4E3B\u4EFB" },
        { value: "course_teacher", label: "\u4EFB\u8BFE\u8001\u5E08" }
      ],
      required: true,
      allowEmpty: false
    },
    { name: "campusId", label: "\u6821\u533A", type: "select", options: campuses, allowEmpty: true },
    { name: "academicYearId", label: "\u5B66\u5E74", type: "select", options: academicYears, allowEmpty: true },
    { name: "gradeId", label: "\u5E74\u7EA7", type: "select", options: meta.grades.map((g) => ({ value: g.id, label: g.name })), allowEmpty: true },
    { name: "subjectCode", label: "\u5B66\u79D1", type: "select", options: subjectOptions, allowEmpty: true },
    { name: "classId", label: "\u884C\u653F\u73ED", type: "select", options: classes.map((item) => ({ value: item.id, label: `${item.gradeName} ${item.name}` })), allowEmpty: true },
    {
      name: "teachingClassId",
      label: "\u6559\u5B66\u73ED",
      type: "select",
      options: teachingClasses.map((item) => ({ value: item.id, label: `${item.gradeName} ${item.name}` })),
      allowEmpty: true
    },
    { name: "note", label: "\u5907\u6CE8" }
  ];
  const fields = [
    { name: "employeeNo", label: "\u5DE5\u53F7", required: true },
    { name: "name", label: "\u59D3\u540D", required: true },
    { name: "gender", label: "\u6027\u522B", type: "select", options: ["\u7537", "\u5973"].map((x) => ({ value: x, label: x })) },
    { name: "subjectCode", label: "\u4EFB\u6559\u5B66\u79D1", type: "select", options: subjectOptions, required: true, allowEmpty: false },
    { name: "campusId", label: "\u6821\u533A", type: "select", options: campuses, required: true, allowEmpty: false },
    { name: "title", label: "\u804C\u79F0" },
    { name: "phone", label: "\u7535\u8BDD" },
    { name: "email", label: "\u90AE\u7BB1" },
    { name: "status", label: "\u72B6\u6001", type: "select", options: [{ value: "active", label: "\u5728\u5C97" }, { value: "inactive", label: "\u505C\u7528" }], allowEmpty: false }
  ];
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>\u6559\u5E08\u6863\u6848</h2>
        <div class="toolbar">
          ${canBulk ? '<button class="btn" id="teacherTemplate">\u6A21\u677F</button>' : ""}
          ${canBulk ? '<button class="btn" id="teacherExport">\u5BFC\u51FA</button>' : ""}
          ${canBulk ? '<button class="btn" id="teacherImport">\u5BFC\u5165\u6821\u9A8C</button>' : ""}
          ${canWrite ? '<button class="btn primary" id="addTeacher">\u65B0\u589E\u6559\u5E08</button>' : ""}
        </div>
      </div>
      ${renderListToolbar("teachers", {
    filters: `
          <select name="subjectCode">
            ${toOptions(subjectOptions, "value", "label", listFieldValue("teachers", "subjectCode"))}
          </select>
          <select name="campusId">
            ${toOptions(campuses, "value", "label", listFieldValue("teachers", "campusId"))}
          </select>
          <select name="status">
            ${toOptions(
      [
        { value: "active", label: "\u5728\u5C97" },
        { value: "inactive", label: "\u505C\u7528" }
      ],
      "value",
      "label",
      listFieldValue("teachers", "status")
    )}
          </select>
        `,
    sortOptions: [
      { value: "id", label: "\u521B\u5EFA\u65F6\u95F4" },
      { value: "employeeNo", label: "\u5DE5\u53F7" },
      { value: "name", label: "\u59D3\u540D" },
      { value: "subject", label: "\u5B66\u79D1" },
      { value: "status", label: "\u72B6\u6001" }
    ]
  })}
      ${renderTable(
    ["\u5DE5\u53F7", "\u59D3\u540D", "\u5B66\u79D1", "\u6821\u533A", "\u804C\u52A1", "\u804C\u79F0", "\u7535\u8BDD", "\u72B6\u6001", "\u8D26\u53F7", ...actionHeader(["teachers.write", "teachers.delete", "accounts.issue_teacher"])],
    teachers.map(
      (teacher) => `
            <tr>
              <td>${escapeHtml(teacher.employeeNo)}</td>
              <td>${escapeHtml(teacher.name)}</td>
              <td>${escapeHtml(teacher.subjectName)}</td>
              <td>${escapeHtml(teacher.campusName || "-")}</td>
              <td>${teacher.duties?.length ? teacher.duties.slice(0, 5).map((duty) => `<span class="tag">${escapeHtml(duty.roleLabel)}</span>`).join(" ") : "-"}</td>
              <td>${escapeHtml(teacher.title || "-")}</td>
              <td>${escapeHtml(teacher.phone || "-")}</td>
              <td><span class="tag ${teacher.status === "active" ? "green" : "orange"}">${teacher.status === "active" ? "\u5728\u5C97" : "\u505C\u7528"}</span></td>
              <td>${teacher.accountUsername ? `<span class="tag green">${escapeHtml(teacher.accountUsername)}</span>` : '<span class="tag orange">\u672A\u751F\u6210</span>'}</td>
              ${actionCell([
        canWrite ? `<button class="btn" data-duty-teacher="${teacher.id}">\u804C\u52A1</button>` : "",
        canWrite ? `<button class="btn" data-edit-teacher="${teacher.id}">\u7F16\u8F91</button>` : "",
        canIssue ? `<button class="btn success" data-issue-teacher="${teacher.id}">${teacher.accountUsername ? "\u91CD\u7F6E\u8D26\u53F7" : "\u751F\u6210\u8D26\u53F7"}</button>` : "",
        canDelete ? `<button class="btn danger" data-delete-teacher="${teacher.id}">\u5220\u9664</button>` : ""
      ])}
            </tr>
          `
    )
  )}
      ${renderPagination("teachers", teacherPage)}
    </section>
  `;
  bindListInteractions("teachers");
  document.querySelector("#teacherTemplate")?.addEventListener("click", async () => {
    try {
      await downloadApiFile("/teachers/template", "\u6559\u5E08\u5BFC\u5165\u6A21\u677F.xlsx");
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelector("#teacherExport")?.addEventListener("click", async () => {
    try {
      await downloadApiFile("/teachers/export", "\u6559\u5E08\u6863\u6848.xlsx");
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelector("#teacherImport")?.addEventListener(
    "click",
    () => openBulkImportDialog({ title: "\u6559\u5E08\u6279\u91CF\u5BFC\u5165", endpoint: "/teachers/import" })
  );
  document.querySelector("#addTeacher")?.addEventListener(
    "click",
    () => openForm({ title: "\u65B0\u589E\u6559\u5E08", fields, initial: { status: "active", campusId: defaultCampusId(meta) }, onSubmit: (payload) => api("/teachers", { method: "POST", body: payload }) })
  );
  document.querySelectorAll("[data-edit-teacher]").forEach((button) => {
    button.addEventListener("click", () => {
      const teacher = teachers.find((item) => String(item.id) === button.dataset.editTeacher);
      openForm({
        title: "\u7F16\u8F91\u6559\u5E08",
        fields,
        initial: teacher,
        onSubmit: (payload) => api(`/teachers/${teacher.id}`, { method: "PUT", body: payload })
      });
    });
  });
  document.querySelectorAll("[data-duty-teacher]").forEach((button) => {
    button.addEventListener("click", () => {
      const teacher = teachers.find((item) => String(item.id) === button.dataset.dutyTeacher);
      openForm({
        title: "\u6559\u5E08\u804C\u52A1",
        fields: dutyFields,
        initial: {
          teacherId: teacher.id,
          campusId: teacher.campusId || defaultCampusId(meta),
          academicYearId: defaultAcademicYearId(meta),
          gradeId: meta.grades[0]?.id || ""
        },
        onSubmit: (payload) => api("/teacher-duties", { method: "POST", body: payload })
      });
    });
  });
  document.querySelectorAll("[data-issue-teacher]").forEach((button) => {
    button.addEventListener("click", async () => {
      const teacher = teachers.find((item) => String(item.id) === button.dataset.issueTeacher);
      if (!confirm(`${teacher.accountUsername ? "\u786E\u8BA4\u91CD\u7F6E" : "\u786E\u8BA4\u751F\u6210"}\u6559\u5E08\u8D26\u53F7\uFF1F`)) return;
      await issueAccount("teachers", button.dataset.issueTeacher);
    });
  });
  document.querySelectorAll("[data-delete-teacher]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("\u786E\u8BA4\u5220\u9664\u8BE5\u6559\u5E08\u6863\u6848\uFF1F")) return;
      try {
        await api(`/teachers/${button.dataset.deleteTeacher}`, { method: "DELETE" });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
}
async function renderClasses() {
  const canWrite = can("classes.write");
  const canDelete = can("classes.delete");
  const [meta, teacherPage, classPage] = await Promise.all([
    getMeta(),
    canWrite ? api("/teachers?pageSize=200&sort=name&order=asc") : Promise.resolve({ items: [] }),
    api(buildListPath("/classes", "classes"))
  ]);
  const teachers = listItems(teacherPage);
  const classes = listItems(classPage);
  const campuses = campusOptions(meta);
  const academicYears = academicYearOptions(meta);
  const fields = [
    { name: "gradeId", label: "\u5E74\u7EA7", type: "select", options: meta.grades.map((g) => ({ value: g.id, label: g.name })), required: true, allowEmpty: false },
    { name: "campusId", label: "\u6821\u533A", type: "select", options: campuses, required: true, allowEmpty: false },
    { name: "academicYearId", label: "\u5B66\u5E74", type: "select", options: academicYears, required: true, allowEmpty: false },
    { name: "name", label: "\u73ED\u7EA7\u540D\u79F0", required: true },
    { name: "trackType", label: "\u73ED\u7EA7\u7C7B\u578B", type: "select", options: ["\u884C\u653F\u73ED", "\u7269\u7406\u65B9\u5411", "\u5386\u53F2\u65B9\u5411", "\u7EFC\u5408"].map((x) => ({ value: x, label: x })), allowEmpty: false },
    { name: "headTeacherId", label: "\u73ED\u4E3B\u4EFB", type: "select", options: teachers.map((t) => ({ value: t.id, label: `${t.name}\uFF08${t.subjectName}\uFF09` })) },
    { name: "capacity", label: "\u5BB9\u91CF", type: "number" },
    { name: "room", label: "\u56FA\u5B9A\u6559\u5BA4" }
  ];
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>\u884C\u653F\u73ED\u7BA1\u7406</h2>
        ${canWrite ? '<button class="btn primary" id="addClass">\u65B0\u589E\u884C\u653F\u73ED</button>' : ""}
      </div>
      ${renderListToolbar("classes", {
    filters: `
          <select name="gradeId">
            ${toOptions(meta.grades.map((g) => ({ value: g.id, label: g.name })), "value", "label", listFieldValue("classes", "gradeId"))}
          </select>
          <select name="campusId">
            ${toOptions(campuses, "value", "label", listFieldValue("classes", "campusId"))}
          </select>
          <select name="academicYearId">
            ${toOptions(academicYears, "value", "label", listFieldValue("classes", "academicYearId"))}
          </select>
          <select name="trackType">
            ${toOptions(["\u884C\u653F\u73ED", "\u7269\u7406\u65B9\u5411", "\u5386\u53F2\u65B9\u5411", "\u7EFC\u5408"].map((x) => ({ value: x, label: x })), "value", "label", listFieldValue("classes", "trackType"))}
          </select>
        `,
    sortOptions: [
      { value: "grade", label: "\u5E74\u7EA7" },
      { value: "name", label: "\u73ED\u7EA7" },
      { value: "trackType", label: "\u7C7B\u578B" },
      { value: "studentCount", label: "\u4EBA\u6570" },
      { value: "capacity", label: "\u5BB9\u91CF" }
    ]
  })}
      ${renderTable(
    ["\u5E74\u7EA7", "\u6821\u533A", "\u5B66\u5E74", "\u73ED\u7EA7", "\u7C7B\u578B", "\u73ED\u4E3B\u4EFB", "\u4EBA\u6570/\u5BB9\u91CF", "\u6559\u5BA4", ...actionHeader(["classes.write", "classes.delete"])],
    classes.map(
      (item) => `
            <tr>
              <td>${escapeHtml(item.gradeName)}</td>
              <td>${escapeHtml(item.campusName || "-")}</td>
              <td>${escapeHtml(item.academicYearName || "-")}</td>
              <td>${escapeHtml(item.name)}</td>
              <td><span class="tag">${escapeHtml(item.trackType)}</span></td>
              <td>${escapeHtml(item.headTeacherName || "-")}</td>
              <td>${item.studentCount}/${item.capacity}</td>
              <td>${escapeHtml(item.room || "-")}</td>
              ${actionCell([
        canWrite ? `<button class="btn" data-edit-class="${item.id}">\u7F16\u8F91</button>` : "",
        canDelete ? `<button class="btn danger" data-delete-class="${item.id}">\u5220\u9664</button>` : ""
      ])}
            </tr>
          `
    )
  )}
      ${renderPagination("classes", classPage)}
    </section>
  `;
  bindListInteractions("classes");
  document.querySelector("#addClass")?.addEventListener(
    "click",
    () => openForm({
      title: "\u65B0\u589E\u884C\u653F\u73ED",
      fields,
      initial: { campusId: defaultCampusId(meta), academicYearId: defaultAcademicYearId(meta), trackType: "\u7EFC\u5408", capacity: 50 },
      onSubmit: (payload) => api("/classes", { method: "POST", body: payload })
    })
  );
  document.querySelectorAll("[data-edit-class]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = classes.find((row) => String(row.id) === button.dataset.editClass);
      openForm({ title: "\u7F16\u8F91\u884C\u653F\u73ED", fields, initial: item, onSubmit: (payload) => api(`/classes/${item.id}`, { method: "PUT", body: payload }) });
    });
  });
  document.querySelectorAll("[data-delete-class]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("\u786E\u8BA4\u5220\u9664\u8BE5\u884C\u653F\u73ED\uFF1F\u73ED\u7EA7\u4E0B\u6709\u5B66\u751F\u65F6\u6570\u636E\u5E93\u4F1A\u963B\u6B62\u5220\u9664\u3002")) return;
      try {
        await api(`/classes/${button.dataset.deleteClass}`, { method: "DELETE" });
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
    api("/classes?pageSize=200&sort=name&order=asc"),
    api(buildListPath("/students", "students"))
  ]);
  const classes = listItems(classPage);
  const students = listItems(studentPage);
  const canWrite = can("students.write");
  const canDelete = can("students.delete");
  const canIssue = can("accounts.issue_student");
  const canBulk = can("students.bulk");
  const campuses = campusOptions(meta);
  const academicYears = academicYearOptions(meta);
  const fields = [
    { name: "studentNo", label: "\u5B66\u53F7", required: true },
    { name: "name", label: "\u59D3\u540D", required: true },
    { name: "gender", label: "\u6027\u522B", type: "select", options: ["\u7537", "\u5973"].map((x) => ({ value: x, label: x })) },
    { name: "birthDate", label: "\u51FA\u751F\u65E5\u671F", type: "date" },
    { name: "gradeId", label: "\u5E74\u7EA7", type: "select", options: meta.grades.map((g) => ({ value: g.id, label: g.name })), required: true, allowEmpty: false },
    { name: "campusId", label: "\u6821\u533A", type: "select", options: campuses, required: true, allowEmpty: false },
    { name: "academicYearId", label: "\u5B66\u5E74", type: "select", options: academicYears, required: true, allowEmpty: false },
    { name: "classId", label: "\u884C\u653F\u73ED", type: "select", options: classes.map((c) => ({ value: c.id, label: `${c.gradeName} ${c.name}` })) },
    { name: "subjectComboId", label: "\u9009\u79D1\u7EC4\u5408", type: "select", options: meta.combinations.map((c) => ({ value: c.id, label: c.label })) },
    { name: "enrollmentYear", label: "\u5165\u5B66\u5E74\u4EFD", type: "number", required: true },
    { name: "phone", label: "\u5B66\u751F\u7535\u8BDD" },
    { name: "guardianName", label: "\u76D1\u62A4\u4EBA" },
    { name: "guardianPhone", label: "\u76D1\u62A4\u4EBA\u7535\u8BDD" },
    { name: "status", label: "\u72B6\u6001", type: "select", options: ["\u5728\u8BFB", "\u4F11\u5B66", "\u8F6C\u51FA", "\u6BD5\u4E1A"].map((x) => ({ value: x, label: x })), allowEmpty: false }
  ];
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>\u5B66\u751F\u6863\u6848</h2>
        <div class="toolbar">
          ${canBulk ? '<button class="btn" id="studentTemplate">\u6A21\u677F</button>' : ""}
          ${canBulk ? '<button class="btn" id="studentExport">\u5BFC\u51FA</button>' : ""}
          ${canBulk ? '<button class="btn" id="studentImport">\u5BFC\u5165\u6821\u9A8C</button>' : ""}
          ${canWrite ? '<button class="btn primary" id="addStudent">\u65B0\u589E\u5B66\u751F</button>' : ""}
        </div>
      </div>
      ${renderListToolbar("students", {
    filters: `
          <select name="gradeId">
            ${toOptions(meta.grades.map((g) => ({ value: g.id, label: g.name })), "value", "label", listFieldValue("students", "gradeId"))}
          </select>
          <select name="campusId">
            ${toOptions(campuses, "value", "label", listFieldValue("students", "campusId"))}
          </select>
          <select name="academicYearId">
            ${toOptions(academicYears, "value", "label", listFieldValue("students", "academicYearId"))}
          </select>
          <select name="classId">
            ${toOptions(classes.map((c) => ({ value: c.id, label: `${c.gradeName} ${c.name}` })), "value", "label", listFieldValue("students", "classId"))}
          </select>
          <select name="status">
            ${toOptions(["\u5728\u8BFB", "\u4F11\u5B66", "\u8F6C\u51FA", "\u6BD5\u4E1A"].map((x) => ({ value: x, label: x })), "value", "label", listFieldValue("students", "status"))}
          </select>
        `,
    sortOptions: [
      { value: "id", label: "\u521B\u5EFA\u65F6\u95F4" },
      { value: "studentNo", label: "\u5B66\u53F7" },
      { value: "name", label: "\u59D3\u540D" },
      { value: "grade", label: "\u5E74\u7EA7" },
      { value: "class", label: "\u884C\u653F\u73ED" },
      { value: "status", label: "\u72B6\u6001" }
    ]
  })}
      ${renderTable(
    ["\u5B66\u53F7", "\u59D3\u540D", "\u5E74\u7EA7", "\u6821\u533A", "\u5B66\u5E74", "\u884C\u653F\u73ED", "\u9009\u79D1\u7EC4\u5408", "\u72B6\u6001", "\u8D26\u53F7", ...actionHeader(["students.write", "students.delete", "accounts.issue_student"])],
    students.map(
      (student) => `
            <tr>
              <td>${escapeHtml(student.studentNo)}</td>
              <td>${escapeHtml(student.name)}</td>
              <td>${escapeHtml(student.gradeName)}</td>
              <td>${escapeHtml(student.campusName || "-")}</td>
              <td>${escapeHtml(student.academicYearName || "-")}</td>
              <td>${escapeHtml(student.className || "-")}</td>
              <td>${student.subjectComboLabel ? `<span class="tag green">${escapeHtml(student.subjectComboLabel)}</span>` : "-"}</td>
              <td><span class="tag ${student.status === "\u5728\u8BFB" ? "green" : "orange"}">${escapeHtml(student.status)}</span></td>
              <td>${student.accountUsername ? `<span class="tag green">${escapeHtml(student.accountUsername)}</span>` : '<span class="tag orange">\u672A\u751F\u6210</span>'}</td>
              ${actionCell([
        canWrite ? `<button class="btn" data-edit-student="${student.id}">\u7F16\u8F91</button>` : "",
        canIssue ? `<button class="btn success" data-issue-student="${student.id}">${student.accountUsername ? "\u91CD\u7F6E\u8D26\u53F7" : "\u751F\u6210\u8D26\u53F7"}</button>` : "",
        canDelete ? `<button class="btn danger" data-delete-student="${student.id}">\u5220\u9664</button>` : ""
      ])}
            </tr>
          `
    )
  )}
      ${renderPagination("students", studentPage)}
    </section>
  `;
  bindListInteractions("students");
  document.querySelector("#studentTemplate")?.addEventListener("click", async () => {
    try {
      await downloadApiFile("/students/template", "\u5B66\u751F\u5BFC\u5165\u6A21\u677F.xlsx");
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelector("#studentExport")?.addEventListener("click", async () => {
    try {
      await downloadApiFile("/students/export", "\u5B66\u751F\u6863\u6848.xlsx");
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelector("#studentImport")?.addEventListener(
    "click",
    () => openBulkImportDialog({ title: "\u5B66\u751F\u6279\u91CF\u5BFC\u5165", endpoint: "/students/import" })
  );
  document.querySelector("#addStudent")?.addEventListener(
    "click",
    () => openForm({
      title: "\u65B0\u589E\u5B66\u751F",
      fields,
      initial: { campusId: defaultCampusId(meta), academicYearId: defaultAcademicYearId(meta), enrollmentYear: (/* @__PURE__ */ new Date()).getFullYear(), status: "\u5728\u8BFB" },
      onSubmit: (payload) => api("/students", { method: "POST", body: payload })
    })
  );
  document.querySelectorAll("[data-edit-student]").forEach((button) => {
    button.addEventListener("click", () => {
      const student = students.find((item) => String(item.id) === button.dataset.editStudent);
      openForm({
        title: "\u7F16\u8F91\u5B66\u751F",
        fields,
        initial: student,
        onSubmit: (payload) => api(`/students/${student.id}`, { method: "PUT", body: payload })
      });
    });
  });
  document.querySelectorAll("[data-issue-student]").forEach((button) => {
    button.addEventListener("click", async () => {
      const student = students.find((item) => String(item.id) === button.dataset.issueStudent);
      if (!confirm(`${student.accountUsername ? "\u786E\u8BA4\u91CD\u7F6E" : "\u786E\u8BA4\u751F\u6210"}\u5B66\u751F\u8D26\u53F7\uFF1F`)) return;
      await issueAccount("students", button.dataset.issueStudent);
    });
  });
  document.querySelectorAll("[data-delete-student]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("\u786E\u8BA4\u5220\u9664\u8BE5\u5B66\u751F\u6863\u6848\uFF1F")) return;
      try {
        await api(`/students/${button.dataset.deleteStudent}`, { method: "DELETE" });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
}
async function renderCombos() {
  const combos = await api("/subject-combinations");
  const canWrite = can("subject_combinations.write");
  const maxCount = Math.max(...combos.map((item) => Number(item.studentCount)), 1);
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>3+1+2 \u9009\u79D1\u7EC4\u5408</h2>
        ${canWrite ? '<button class="btn primary" id="addCombo">\u65B0\u589E\u7EC4\u5408</button>' : ""}
      </div>
      ${renderTable(
    ["\u7EC4\u5408", "\u9996\u9009", "\u518D\u9009", "\u5B66\u751F\u6570", "\u5360\u6BD4"],
    combos.map((combo) => {
      const electives = parseJson(combo.electiveSubjects).join(" / ");
      const percent = Math.round(Number(combo.studentCount) / maxCount * 100);
      return `
            <tr>
              <td><span class="tag green">${escapeHtml(combo.label)}</span></td>
              <td>${combo.preferredSubject === "physics" ? "\u7269\u7406" : "\u5386\u53F2"}</td>
              <td>${escapeHtml(electives)}</td>
              <td>${combo.studentCount}</td>
              <td><div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div></td>
            </tr>
          `;
    })
  )}
    </section>
  `;
  document.querySelector("#addCombo")?.addEventListener("click", openComboForm);
}
function openComboForm() {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `
    <form id="comboForm">
      <div class="dialog-head">
        <h2>\u65B0\u589E\u9009\u79D1\u7EC4\u5408</h2>
        <button class="btn ghost" type="button" data-close>\u5173\u95ED</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field full">
            <label>\u9996\u9009\u79D1\u76EE</label>
            <select name="preferredSubject" required>
              <option value="physics">\u7269\u7406</option>
              <option value="history">\u5386\u53F2</option>
            </select>
          </div>
          <div class="field full">
            <label>\u518D\u9009\u79D1\u76EE</label>
            <div class="checkbox-row">
              ${[
    ["chemistry", "\u5316\u5B66"],
    ["biology", "\u751F\u7269"],
    ["politics", "\u601D\u60F3\u653F\u6CBB"],
    ["geography", "\u5730\u7406"]
  ].map(([value, label]) => `<label><input type="checkbox" name="electiveSubjects" value="${value}" /> ${label}</label>`).join("")}
            </div>
          </div>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="btn" type="button" data-close>\u53D6\u6D88</button>
        <button class="btn primary" type="submit">\u4FDD\u5B58</button>
      </div>
    </form>
  `;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("#comboForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      preferredSubject: form.get("preferredSubject"),
      electiveSubjects: form.getAll("electiveSubjects")
    };
    try {
      await api("/subject-combinations", { method: "POST", body: payload });
      state.meta = null;
      dialog.close();
      await loadView();
    } catch (error) {
      notifyError(error);
    }
  });
}
async function renderTimetable() {
  const canWriteTeachingClass = can("teaching_classes.write");
  const canEnroll = can("teaching_classes.enroll");
  const canWriteTimetable = can("timetable.write");
  const canDeleteTimetable = can("timetable.delete");
  const needsFormOptions = canWriteTeachingClass || canWriteTimetable;
  const semester = "2026\u6625";
  const [meta, teacherPage, classPage, teachingClassOptionsPage, teachingClassPage, entries, workload] = await Promise.all([
    getMeta(),
    needsFormOptions ? api("/teachers?pageSize=200&sort=name&order=asc") : Promise.resolve({ items: [] }),
    needsFormOptions ? api("/classes?pageSize=200&sort=name&order=asc") : Promise.resolve({ items: [] }),
    needsFormOptions ? api("/teaching-classes?pageSize=200&sort=name&order=asc") : Promise.resolve({ items: [] }),
    api(buildListPath("/teaching-classes", "teachingClasses")),
    api(`/timetable?semester=${encodeURIComponent(semester)}`),
    api(`/timetable/teacher-workload?semester=${encodeURIComponent(semester)}`)
  ]);
  const teachers = listItems(teacherPage);
  const classes = listItems(classPage);
  const teachingClassOptions = listItems(teachingClassOptionsPage);
  const teachingClasses = listItems(teachingClassPage);
  const campuses = campusOptions(meta);
  const academicYears = academicYearOptions(meta);
  const slotOptions = (meta.timetableSlots || []).filter((slot) => slot.weekday === 1).sort((a, b) => a.period - b.period).map((slot) => ({
    value: slot.period,
    label: `${slot.label || `\u7B2C ${slot.period} \u8282`} ${slot.slotType === "evening" ? "\uFF08\u665A\u81EA\u4E60\uFF09" : ""}`
  }));
  const teachingFields = [
    { name: "gradeId", label: "\u5E74\u7EA7", type: "select", options: meta.grades.map((g) => ({ value: g.id, label: g.name })), required: true, allowEmpty: false },
    { name: "campusId", label: "\u6821\u533A", type: "select", options: campuses, required: true, allowEmpty: false },
    { name: "academicYearId", label: "\u5B66\u5E74", type: "select", options: academicYears, required: true, allowEmpty: false },
    { name: "subjectCode", label: "\u5B66\u79D1", type: "select", options: meta.subjects.map((s) => ({ value: s.code, label: s.name })), required: true, allowEmpty: false },
    { name: "name", label: "\u6559\u5B66\u73ED\u540D\u79F0", required: true },
    { name: "teacherId", label: "\u4EFB\u8BFE\u6559\u5E08", type: "select", options: teachers.map((t) => ({ value: t.id, label: `${t.name}\uFF08${t.subjectName}\uFF09` })) },
    { name: "subjectComboId", label: "\u7ED1\u5B9A\u9009\u79D1\u7EC4\u5408", type: "select", options: meta.combinations.map((c) => ({ value: c.id, label: c.label })) },
    { name: "capacity", label: "\u5BB9\u91CF", type: "number" },
    { name: "roomId", label: "\u6559\u5BA4", type: "select", options: meta.rooms.map((r) => ({ value: r.id, label: `${r.name}\uFF08${r.roomType}\uFF09` })) }
  ];
  const timetableFields = [
    { name: "semester", label: "\u5B66\u671F", required: true },
    { name: "campusId", label: "\u6821\u533A", type: "select", options: campuses, required: true, allowEmpty: false },
    { name: "academicYearId", label: "\u5B66\u5E74", type: "select", options: academicYears, required: true, allowEmpty: false },
    { name: "weekday", label: "\u661F\u671F", type: "select", options: weekdays.map((day, index) => ({ value: index + 1, label: day })), required: true, allowEmpty: false },
    { name: "period", label: "\u8282\u6B21", type: "select", options: slotOptions, required: true, allowEmpty: false },
    { name: "classId", label: "\u884C\u653F\u73ED", type: "select", options: classes.map((c) => ({ value: c.id, label: `${c.gradeName} ${c.name}` })) },
    { name: "teachingClassId", label: "\u6559\u5B66\u73ED", type: "select", options: teachingClassOptions.map((c) => ({ value: c.id, label: `${c.gradeName} ${c.name}` })) },
    { name: "roomId", label: "\u6559\u5BA4", type: "select", options: meta.rooms.map((r) => ({ value: r.id, label: r.name })) },
    { name: "note", label: "\u5907\u6CE8", full: true }
  ];
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>\u6559\u5B66\u73ED</h2>
        ${canWriteTeachingClass ? '<button class="btn primary" id="addTeachingClass">\u65B0\u589E\u6559\u5B66\u73ED</button>' : ""}
      </div>
      ${renderListToolbar("teachingClasses", {
    filters: `
          <select name="gradeId">
            ${toOptions(meta.grades.map((g) => ({ value: g.id, label: g.name })), "value", "label", listFieldValue("teachingClasses", "gradeId"))}
          </select>
          <select name="campusId">
            ${toOptions(campuses, "value", "label", listFieldValue("teachingClasses", "campusId"))}
          </select>
          <select name="academicYearId">
            ${toOptions(academicYears, "value", "label", listFieldValue("teachingClasses", "academicYearId"))}
          </select>
          <select name="subjectCode">
            ${toOptions(meta.subjects.map((s) => ({ value: s.code, label: s.name })), "value", "label", listFieldValue("teachingClasses", "subjectCode"))}
          </select>
        `,
    sortOptions: [
      { value: "grade", label: "\u5E74\u7EA7" },
      { value: "subject", label: "\u5B66\u79D1" },
      { value: "name", label: "\u6559\u5B66\u73ED" },
      { value: "teacher", label: "\u6559\u5E08" },
      { value: "studentCount", label: "\u4EBA\u6570" },
      { value: "capacity", label: "\u5BB9\u91CF" }
    ]
  })}
      ${renderTable(
    ["\u6559\u5B66\u73ED", "\u5E74\u7EA7", "\u6821\u533A", "\u5B66\u5E74", "\u5B66\u79D1", "\u6559\u5E08", "\u7EC4\u5408", "\u4EBA\u6570/\u5BB9\u91CF", "\u6559\u5BA4", ...actionHeader(["teaching_classes.enroll"])],
    teachingClasses.map(
      (item) => `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.gradeName)}</td>
              <td>${escapeHtml(item.campusName || "-")}</td>
              <td>${escapeHtml(item.academicYearName || "-")}</td>
              <td>${escapeHtml(item.subjectName)}</td>
              <td>${escapeHtml(item.teacherName || "-")}</td>
              <td>${escapeHtml(item.subjectComboLabel || "-")}</td>
              <td>${item.studentCount}/${item.capacity}</td>
              <td>${escapeHtml(item.roomName || "-")}</td>
              ${actionCell([canEnroll ? `<button class="btn success" data-enroll="${item.id}">\u6309\u7EC4\u5408\u7F16\u73ED</button>` : ""])}
            </tr>
          `
    )
  )}
      ${renderPagination("teachingClasses", teachingClassPage)}
    </section>
    <section class="panel">
      <div class="panel-header">
        <h2>2026\u6625\u8BFE\u8868</h2>
        <div class="toolbar">
          ${canWriteTimetable ? '<button class="btn success" id="autoSchedule">\u81EA\u52A8\u6392\u8BFE</button>' : ""}
          ${canWriteTimetable ? '<button class="btn primary" id="addTimetable">\u65B0\u589E\u8BFE\u8868\u9879</button>' : ""}
        </div>
      </div>
      <div class="panel-body">${renderTimetableGrid(entries, meta.timetableSlots || [], canDeleteTimetable)}</div>
    </section>
    <section class="panel">
      <div class="panel-header"><h2>\u6559\u5E08\u8BFE\u65F6\u7EDF\u8BA1</h2></div>
      ${renderTable(
    ["\u6559\u5E08", "\u5B66\u79D1", "\u6559\u5B66\u73ED\u6570", "\u666E\u901A\u8BFE\u65F6", "\u665A\u81EA\u4E60", "\u603B\u8BFE\u65F6"],
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
    "\u6682\u65E0\u8BFE\u65F6\u7EDF\u8BA1"
  )}
    </section>
  `;
  bindListInteractions("teachingClasses");
  document.querySelector("#addTeachingClass")?.addEventListener(
    "click",
    () => openForm({
      title: "\u65B0\u589E\u6559\u5B66\u73ED",
      fields: teachingFields,
      initial: { campusId: defaultCampusId(meta), academicYearId: defaultAcademicYearId(meta), capacity: 45 },
      onSubmit: (payload) => api("/teaching-classes", { method: "POST", body: payload })
    })
  );
  document.querySelector("#addTimetable")?.addEventListener(
    "click",
    () => openForm({
      title: "\u65B0\u589E\u8BFE\u8868\u9879",
      fields: timetableFields,
      initial: { semester, campusId: defaultCampusId(meta), academicYearId: defaultAcademicYearId(meta) },
      onSubmit: (payload) => api("/timetable", { method: "POST", body: payload })
    })
  );
  document.querySelector("#autoSchedule")?.addEventListener("click", async () => {
    const overwrite = confirm("\u662F\u5426\u6E05\u7A7A\u672C\u5B66\u671F\u6559\u5B66\u73ED\u8BFE\u8868\u540E\u91CD\u65B0\u6392\u8BFE\uFF1F\u70B9\u51FB\u201C\u53D6\u6D88\u201D\u5C06\u53EA\u8865\u5145\u7A7A\u4F59\u65F6\u6BB5\u3002");
    try {
      const result = await api("/timetable/auto-schedule", {
        method: "POST",
        body: {
          semester,
          campusId: defaultCampusId(meta),
          academicYearId: defaultAcademicYearId(meta),
          overwrite,
          includeEvening: false,
          maxDailyPeriods: 6
        }
      });
      alert(`\u81EA\u52A8\u6392\u8BFE\u5B8C\u6210\uFF1A\u65B0\u589E ${result.scheduled} \u8282\uFF0C\u672A\u6392\u5165 ${result.skipped?.length || 0} \u9879`);
      await loadView();
    } catch (error) {
      notifyError(error);
    }
  });
  document.querySelectorAll("[data-enroll]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const result = await api(`/teaching-classes/${button.dataset.enroll}/enroll-by-combo`, { method: "POST", body: {} });
        alert(`\u5DF2\u7F16\u5165 ${result.enrolled} \u540D\u5B66\u751F`);
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
  document.querySelectorAll("[data-delete-entry]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("\u786E\u8BA4\u5220\u9664\u8BE5\u8BFE\u8868\u9879\uFF1F")) return;
      try {
        await api(`/timetable/${button.dataset.deleteEntry}`, { method: "DELETE" });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
}
function renderTimetableGrid(entries, slots, canDelete = false) {
  const byCell = /* @__PURE__ */ new Map();
  entries.forEach((entry) => {
    const key = `${entry.weekday}-${entry.period}`;
    byCell.set(key, [...byCell.get(key) || [], entry]);
  });
  const periodRows = slots.filter((slot) => slot.weekday === 1).sort((a, b) => a.period - b.period);
  const cells = ['<div class="tt-cell tt-head">\u8282\u6B21</div>', ...weekdays.map((day) => `<div class="tt-cell tt-head">${day}</div>`)];
  for (const slot of periodRows) {
    cells.push(`<div class="tt-cell tt-period ${slot.slotType === "evening" ? "evening" : ""}">${escapeHtml(slot.label || `\u7B2C ${slot.period} \u8282`)}<span>${escapeHtml(slot.startTime || "")}-${escapeHtml(slot.endTime || "")}</span></div>`);
    for (let weekday = 1; weekday <= 5; weekday += 1) {
      const cellEntries = byCell.get(`${weekday}-${slot.period}`) || [];
      cells.push(`
        <div class="tt-cell">
          ${cellEntries.map(
        (entry) => `<div class="tt-course ${entry.slotType === "evening" ? "evening" : ""}">
                <strong>${escapeHtml(entry.teachingClassName || entry.className || "\u8BFE\u7A0B")}</strong>
                <span>${escapeHtml(entry.subjectName || entry.note || "")} ${escapeHtml(entry.teacherName || "")}</span>
                <span>${escapeHtml(entry.roomName || "")}</span>
                ${canDelete ? `<button class="btn danger" data-delete-entry="${entry.id}" type="button">\u5220\u9664</button>` : ""}
              </div>`
      ).join("")}
        </div>
      `);
    }
  }
  return `<div class="timetable">${cells.join("")}</div>`;
}
async function renderExams() {
  const canWriteExam = can("exams.write");
  const canWriteScore = can("exam_scores.write");
  const canRankScores = can("exam_scores.rank");
  const [meta, studentPage, examPage] = await Promise.all([
    getMeta(),
    canWriteScore ? api("/students?pageSize=200&sort=name&order=asc") : Promise.resolve({ items: [] }),
    api(buildListPath("/exams", "exams"))
  ]);
  const students = listItems(studentPage);
  const exams = listItems(examPage);
  const academicYears = academicYearOptions(meta);
  const selectedExamId = exams[0]?.id || "";
  const scorePage = selectedExamId ? await api(buildListPath("/exam-scores", "examScores", { examId: selectedExamId })) : { items: [], pagination: null };
  const scores = listItems(scorePage);
  const examFields = [
    { name: "gradeId", label: "\u5E74\u7EA7", type: "select", options: meta.grades.map((g) => ({ value: g.id, label: g.name })), required: true, allowEmpty: false },
    { name: "academicYearId", label: "\u5B66\u5E74", type: "select", options: academicYears, required: true, allowEmpty: false },
    { name: "name", label: "\u8003\u8BD5\u540D\u79F0", required: true },
    { name: "semester", label: "\u5B66\u671F", required: true },
    { name: "examDate", label: "\u8003\u8BD5\u65E5\u671F", type: "date", required: true },
    { name: "examType", label: "\u8003\u8BD5\u7C7B\u578B", type: "select", options: ["\u6708\u8003", "\u671F\u4E2D", "\u671F\u672B", "\u8054\u8003", "\u6A21\u62DF\u8003"].map((x) => ({ value: x, label: x })), allowEmpty: false }
  ];
  const scoreFields = [
    { name: "examId", label: "\u8003\u8BD5", type: "select", options: exams.map((e) => ({ value: e.id, label: e.name })), required: true, allowEmpty: false },
    { name: "studentId", label: "\u5B66\u751F", type: "select", options: students.map((s) => ({ value: s.id, label: `${s.name}\uFF08${s.studentNo}\uFF09` })), required: true, allowEmpty: false },
    { name: "subjectCode", label: "\u5B66\u79D1", type: "select", options: meta.subjects.map((s) => ({ value: s.code, label: s.name })), required: true, allowEmpty: false },
    { name: "rawScore", label: "\u539F\u59CB\u5206", type: "number", required: true },
    { name: "standardScore", label: "\u8D4B\u5206/\u6807\u51C6\u5206", type: "number" },
    { name: "rankInGrade", label: "\u5E74\u7EA7\u6392\u540D", type: "number" }
  ];
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>\u8003\u8BD5\u7BA1\u7406</h2>
        ${canWriteExam || canWriteScore || canRankScores && selectedExamId ? `<div class="toolbar">
                ${canWriteExam ? '<button class="btn primary" id="addExam">\u65B0\u589E\u8003\u8BD5</button>' : ""}
                ${canWriteScore ? '<button class="btn" id="addScore">\u5F55\u5165\u6210\u7EE9</button>' : ""}
                ${canRankScores && selectedExamId ? '<button class="btn success" id="rankScores">\u91CD\u7B97\u6392\u540D</button>' : ""}
              </div>` : ""}
      </div>
      ${renderListToolbar("exams", {
    filters: `
          <select name="gradeId">
            ${toOptions(meta.grades.map((g) => ({ value: g.id, label: g.name })), "value", "label", listFieldValue("exams", "gradeId"))}
          </select>
          <select name="academicYearId">
            ${toOptions(academicYears, "value", "label", listFieldValue("exams", "academicYearId"))}
          </select>
          <select name="examType">
            ${toOptions(["\u6708\u8003", "\u671F\u4E2D", "\u671F\u672B", "\u8054\u8003", "\u6A21\u62DF\u8003"].map((x) => ({ value: x, label: x })), "value", "label", listFieldValue("exams", "examType"))}
          </select>
        `,
    sortOptions: [
      { value: "examDate", label: "\u8003\u8BD5\u65E5\u671F" },
      { value: "name", label: "\u8003\u8BD5\u540D\u79F0" },
      { value: "grade", label: "\u5E74\u7EA7" },
      { value: "scoreCount", label: "\u6210\u7EE9\u6570" },
      { value: "averageScore", label: "\u5E73\u5747\u5206" }
    ]
  })}
      ${renderTable(
    ["\u8003\u8BD5", "\u5E74\u7EA7", "\u5B66\u5E74", "\u5B66\u671F", "\u7C7B\u578B", "\u65E5\u671F", "\u6210\u7EE9\u6570", "\u5E73\u5747\u5206"],
    exams.map(
      (exam) => `
            <tr>
              <td>${escapeHtml(exam.name)}</td>
              <td>${escapeHtml(exam.gradeName)}</td>
              <td>${escapeHtml(exam.academicYearName || "-")}</td>
              <td>${escapeHtml(exam.semester)}</td>
              <td>${escapeHtml(exam.examType)}</td>
              <td>${escapeHtml(exam.examDate)}</td>
              <td>${exam.scoreCount}</td>
              <td>${escapeHtml(exam.averageScore ?? "-")}</td>
            </tr>
          `
    )
  )}
      ${renderPagination("exams", examPage)}
    </section>
    <section class="panel">
      <div class="panel-header"><h2>\u6700\u8FD1\u8003\u8BD5\u6210\u7EE9</h2></div>
      ${renderListToolbar("examScores", {
    filters: `
          <select name="subjectCode">
            ${toOptions(meta.subjects.map((s) => ({ value: s.code, label: s.name })), "value", "label", listFieldValue("examScores", "subjectCode"))}
          </select>
        `,
    sortOptions: [
      { value: "id", label: "\u5F55\u5165\u65F6\u95F4" },
      { value: "studentNo", label: "\u5B66\u53F7" },
      { value: "studentName", label: "\u59D3\u540D" },
      { value: "subject", label: "\u5B66\u79D1" },
      { value: "rawScore", label: "\u539F\u59CB\u5206" },
      { value: "rankInGrade", label: "\u6392\u540D" }
    ]
  })}
      ${renderTable(
    ["\u8003\u8BD5", "\u5B66\u751F", "\u884C\u653F\u73ED", "\u5B66\u79D1", "\u539F\u59CB\u5206", "\u8D4B\u5206", "\u6392\u540D"],
    scores.map(
      (score) => `
            <tr>
              <td>${escapeHtml(score.examName)}</td>
              <td>${escapeHtml(score.studentName)}<br><span class="muted">${escapeHtml(score.studentNo)}</span></td>
              <td>${escapeHtml(score.className || "-")}</td>
              <td>${escapeHtml(score.subjectName)}</td>
              <td>${escapeHtml(score.rawScore)}</td>
              <td>${escapeHtml(score.standardScore ?? "-")}</td>
              <td>${escapeHtml(score.rankInGrade ?? "-")}</td>
            </tr>
          `
    ),
    "\u5F53\u524D\u8003\u8BD5\u6682\u65E0\u6210\u7EE9"
  )}
      ${renderPagination("examScores", scorePage)}
    </section>
  `;
  bindListInteractions("exams");
  bindListInteractions("examScores");
  document.querySelector("#addExam")?.addEventListener(
    "click",
    () => openForm({
      title: "\u65B0\u589E\u8003\u8BD5",
      fields: examFields,
      initial: { academicYearId: defaultAcademicYearId(meta), semester: "2026\u6625", examType: "\u6708\u8003" },
      onSubmit: (payload) => api("/exams", { method: "POST", body: payload })
    })
  );
  document.querySelector("#addScore")?.addEventListener(
    "click",
    () => openForm({
      title: "\u5F55\u5165\u6210\u7EE9",
      fields: scoreFields,
      initial: { examId: selectedExamId },
      onSubmit: (payload) => api("/exam-scores", { method: "POST", body: payload })
    })
  );
  const rankButton = document.querySelector("#rankScores");
  if (rankButton) {
    rankButton.addEventListener("click", async () => {
      try {
        await api(`/exams/${selectedExamId}/recalculate-ranks`, { method: "POST", body: {} });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  }
}
async function renderAudit() {
  const [alertPage, logPage] = await Promise.all([
    api(buildListPath("/audit-alerts", "auditAlerts")),
    api(buildListPath("/audit-logs", "auditLogs"))
  ]);
  const alerts = listItems(alertPage);
  const logs = listItems(logPage);
  content().innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>\u5B89\u5168\u544A\u8B66</h2></div>
      ${renderListToolbar("auditAlerts", {
    filters: `
          <select name="status">
            ${toOptions(
      [
        { value: "open", label: "\u672A\u5904\u7406" },
        { value: "acknowledged", label: "\u5DF2\u786E\u8BA4" },
        { value: "closed", label: "\u5DF2\u5173\u95ED" },
        { value: "all", label: "\u5168\u90E8\u72B6\u6001" }
      ],
      "value",
      "label",
      listFieldValue("auditAlerts", "status"),
      false
    )}
          </select>
          <select name="severity">
            ${toOptions(
      [
        { value: "info", label: "\u4FE1\u606F" },
        { value: "warning", label: "\u8B66\u544A" },
        { value: "critical", label: "\u4E25\u91CD" }
      ],
      "value",
      "label",
      listFieldValue("auditAlerts", "severity")
    )}
          </select>
          <select name="alertType">
            ${toOptions(
      [
        { value: "failed_login_burst", label: "\u9AD8\u9891\u5931\u8D25\u767B\u5F55" },
        { value: "account_reset_burst", label: "\u9AD8\u9891\u8D26\u53F7\u91CD\u7F6E" },
        { value: "new_ip_login", label: "\u5F02\u5E38 IP \u767B\u5F55" },
        { value: "slow_api", label: "\u6162\u63A5\u53E3" }
      ],
      "value",
      "label",
      listFieldValue("auditAlerts", "alertType")
    )}
          </select>
        `,
    sortOptions: [
      { value: "lastSeenAt", label: "\u6700\u8FD1\u65F6\u95F4" },
      { value: "severity", label: "\u7B49\u7EA7" },
      { value: "status", label: "\u72B6\u6001" },
      { value: "eventCount", label: "\u6B21\u6570" },
      { value: "alertType", label: "\u7C7B\u578B" }
    ]
  })}
      ${renderTable(
    ["\u7C7B\u578B", "\u7B49\u7EA7", "\u72B6\u6001", "\u5BF9\u8C61", "IP", "\u6B21\u6570", "\u6700\u8FD1\u65F6\u95F4", "\u5907\u6CE8", ...actionHeader(["audit_alerts.acknowledge"])],
    alerts.map(
      (alert2) => `
            <tr>
              <td>${escapeHtml(alert2.alertType)}</td>
              <td><span class="tag ${alert2.severity === "critical" ? "orange" : alert2.severity === "warning" ? "" : "green"}">${escapeHtml(alert2.severity)}</span></td>
              <td><span class="tag ${alert2.status === "open" ? "orange" : "green"}">${escapeHtml(alert2.status)}</span></td>
              <td>${escapeHtml(alert2.targetUsername || alert2.actorUsername || "-")}</td>
              <td>${escapeHtml(alert2.ipAddress || "-")}</td>
              <td>${escapeHtml(alert2.eventCount)}</td>
              <td>${escapeHtml(alert2.lastSeenAt)}</td>
              <td class="wrap">${escapeHtml(alert2.dispositionNote || "-")}</td>
              ${actionCell([
        can("audit_alerts.acknowledge") && alert2.status === "open" ? `<button class="btn success" data-ack-alert="${alert2.id}">\u786E\u8BA4</button>` : "",
        can("audit_alerts.acknowledge") && alert2.status !== "closed" ? `<button class="btn danger" data-close-alert="${alert2.id}">\u5173\u95ED</button>` : ""
      ])}
            </tr>
          `
    ),
    "\u6682\u65E0\u544A\u8B66"
  )}
      ${renderPagination("auditAlerts", alertPage)}
    </section>
    <section class="panel">
      <div class="panel-header"><h2>\u64CD\u4F5C\u65E5\u5FD7\u68C0\u7D22</h2></div>
      ${renderListToolbar("auditLogs", {
    filters: `
          <select name="eventType">
            ${toOptions(
      ["auth", "data", "permission", "audit", "performance"].map((x) => ({ value: x, label: x })),
      "value",
      "label",
      listFieldValue("auditLogs", "eventType")
    )}
          </select>
          <select name="outcome">
            ${toOptions(
      [
        { value: "success", label: "success" },
        { value: "failure", label: "failure" }
      ],
      "value",
      "label",
      listFieldValue("auditLogs", "outcome")
    )}
          </select>
          <input name="from" type="date" value="${escapeHtml(listFieldValue("auditLogs", "from"))}" />
          <input name="to" type="date" value="${escapeHtml(listFieldValue("auditLogs", "to"))}" />
        `,
    sortOptions: [
      { value: "id", label: "\u8BB0\u5F55\u65F6\u95F4" },
      { value: "eventType", label: "\u7C7B\u578B" },
      { value: "action", label: "\u52A8\u4F5C" },
      { value: "outcome", label: "\u7ED3\u679C" },
      { value: "actorUsername", label: "\u64CD\u4F5C\u8005" },
      { value: "ipAddress", label: "IP" }
    ]
  })}
      ${renderTable(
    ["\u65F6\u95F4", "\u7C7B\u578B", "\u52A8\u4F5C", "\u7ED3\u679C", "\u64CD\u4F5C\u8005", "\u5BF9\u8C61", "IP"],
    logs.map(
      (log) => `
            <tr>
              <td>${escapeHtml(log.createdAt)}</td>
              <td>${escapeHtml(log.eventType)}</td>
              <td>${escapeHtml(log.action)}</td>
              <td><span class="tag ${log.outcome === "success" ? "green" : "orange"}">${escapeHtml(log.outcome)}</span></td>
              <td>${escapeHtml(log.actorUsername || "-")}</td>
              <td>${escapeHtml(log.targetUsername || log.targetId || "-")}</td>
              <td>${escapeHtml(log.ipAddress || "-")}</td>
            </tr>
          `
    ),
    "\u6682\u65E0\u5BA1\u8BA1\u65E5\u5FD7"
  )}
      ${renderPagination("auditLogs", logPage)}
    </section>
  `;
  bindListInteractions("auditAlerts");
  bindListInteractions("auditLogs");
  document.querySelectorAll("[data-ack-alert]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const note = prompt("\u786E\u8BA4\u5907\u6CE8\uFF08\u53EF\u9009\uFF09") || "";
        await api(`/audit-alerts/${button.dataset.ackAlert}/acknowledge`, { method: "POST", body: { note } });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
  document.querySelectorAll("[data-close-alert]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const note = prompt("\u5173\u95ED\u539F\u56E0") || "";
        await api(`/audit-alerts/${button.dataset.closeAlert}/dispose`, { method: "POST", body: { status: "closed", note } });
        await loadView();
      } catch (error) {
        notifyError(error);
      }
    });
  });
}
async function refreshSession() {
  try {
    const result = await api("/auth/me");
    state.user = result.user;
    localStorage.setItem(userKey, JSON.stringify(result.user));
    if (result.user.mustChangePassword) {
      renderPasswordChangeView();
      return;
    }
    renderShell();
    loadView();
  } catch {
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
//# sourceMappingURL=app.js.map
