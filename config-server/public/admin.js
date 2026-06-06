/* ===== Memora Admin Panel ===== */
const API_BASE = window.location.origin;
let token = localStorage.getItem('memora_admin_token') || '';
let currentUser = null;
let orgsData = [];
let usersData = [];
let currentConfig = {};
let selectedOrgId = '';

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    validateToken();
  }
  bindEvents();
});

function bindEvents() {
  // Login
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Config tabs
  document.querySelectorAll('.config-tab').forEach(btn => {
    btn.addEventListener('click', () => switchConfigTab(btn.dataset.section));
  });

  // Org/User actions
  document.getElementById('btn-create-org').addEventListener('click', () => showCreateOrgModal());
  document.getElementById('btn-create-user').addEventListener('click', () => showCreateUserModal());
  document.getElementById('btn-save-config').addEventListener('click', saveConfig);

  // Config org select
  document.getElementById('config-org-select').addEventListener('change', (e) => {
    selectedOrgId = e.target.value;
    if (selectedOrgId) loadOrgConfig(selectedOrgId);
  });

  // Modal close on overlay click
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

// ===== Auth =====
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.message || '登录失败';
      errEl.style.display = 'block';
      return;
    }
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('memora_admin_token', token);
    enterAdmin();
    showToast('登录成功', 'success');
  } catch (err) {
    errEl.textContent = '网络错误';
    errEl.style.display = 'block';
  }
}

async function validateToken() {
  try {
    const res = await fetch(`${API_BASE}/auth/validate`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      token = '';
      localStorage.removeItem('memora_admin_token');
      return;
    }
    const data = await res.json();
    currentUser = data.user;
    enterAdmin();
  } catch {
    token = '';
    localStorage.removeItem('memora_admin_token');
  }
}

function handleLogout() {
  token = '';
  currentUser = null;
  localStorage.removeItem('memora_admin_token');
  document.getElementById('admin-page').classList.remove('active');
  document.getElementById('login-page').classList.add('active');
  document.getElementById('login-password').value = '';
}

function enterAdmin() {
  document.getElementById('login-page').classList.remove('active');
  document.getElementById('admin-page').classList.add('active');
  document.getElementById('user-info').textContent = `${currentUser.name || currentUser.email}`;
  loadDashboard();
}

// ===== API Helper =====
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (res.status === 401) {
    handleLogout();
    showToast('登录已过期，请重新登录', 'error');
    throw new Error('Unauthorized');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '请求失败');
  return data;
}

// ===== Tabs =====
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === `tab-${tab}`));

  if (tab === 'dashboard') loadDashboard();
  if (tab === 'orgs') loadOrgs();
  if (tab === 'users') loadUsers();
  if (tab === 'config') loadConfigPage();
}

// ===== Dashboard =====
async function loadDashboard() {
  try {
    const [orgs, users] = await Promise.all([api('/admin/orgs'), api('/admin/users')]);
    document.getElementById('stat-users').textContent = users.length;
    document.getElementById('stat-orgs').textContent = orgs.length;
    document.getElementById('stat-admins').textContent = users.filter(u => u.role === 'admin').length;
    document.getElementById('stat-configs').textContent = orgs.length; // all orgs have config
  } catch (err) {
    showToast('加载数据失败', 'error');
  }
}

// ===== Orgs =====
async function loadOrgs() {
  try {
    orgsData = await api('/admin/orgs');
    renderOrgs();
  } catch (err) {
    showToast('加载组织失败', 'error');
  }
}

function renderOrgs() {
  const el = document.getElementById('orgs-list');
  if (orgsData.length === 0) {
    el.innerHTML = `<div class="empty-state"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#aeaeb2" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg><p>暂无组织</p></div>`;
    return;
  }
  el.innerHTML = orgsData.map(org => `
    <div class="data-card">
      <div class="data-card-header">
        <span class="data-card-title">${esc(org.name)}</span>
        <div class="data-card-actions">
          <button class="btn-secondary btn-sm" onclick="showOrgDetail('${org.id}')">详情</button>
          <button class="btn-secondary btn-sm" onclick="editOrgConfig('${org.id}')">配置</button>
        </div>
      </div>
      <div class="data-card-meta">
        <span>编码: ${esc(org.code)}</span>
        <span>成员: ${countOrgMembers(org.id)}</span>
        <span title="${org.updated_at}">${timeAgo(org.updated_at)}</span>
      </div>
    </div>
  `).join('');
}

function countOrgMembers(orgId) {
  return usersData.filter(u => u.org_id === orgId).length || '-';
}

async function showOrgDetail(orgId) {
  try {
    const org = await api(`/admin/orgs/${orgId}`);
    let membersHtml = '';
    if (org.members && org.members.length > 0) {
      membersHtml = org.members.map(m => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--gray4)">
          <span>${esc(m.name || m.email)}</span>
          <span class="badge badge-${m.role}">${m.role === 'admin' ? '管理员' : '成员'}</span>
        </div>
      `).join('');
    } else {
      membersHtml = '<p style="color:var(--gray3);padding:8px 0">暂无成员</p>';
    }
    showModal(`
      <div class="modal-header"><h3>${esc(org.name)}</h3></div>
      <div class="modal-body">
        <div class="config-field"><label>组织编码</label><input value="${esc(org.code)}" readonly style="background:#f5f5f7"></div>
        <div class="config-field"><label>成员列表</label>${membersHtml}</div>
        <div class="config-field"><label>创建时间</label><input value="${org.created_at || '-'}" readonly style="background:#f5f5f7"></div>
      </div>
      <div class="modal-footer"><button class="btn-cancel" onclick="closeModal()">关闭</button></div>
    `);
  } catch (err) {
    showToast('加载组织详情失败', 'error');
  }
}

function editOrgConfig(orgId) {
  switchTab('config');
  document.getElementById('config-org-select').value = orgId;
  selectedOrgId = orgId;
  loadOrgConfig(orgId);
}

function showCreateOrgModal() {
  showModal(`
    <div class="modal-header"><h3>新建组织</h3></div>
    <div class="modal-body">
      <div class="config-field"><label>组织名称</label><input id="new-org-name" placeholder="输入组织名称"></div>
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-confirm" onclick="createOrg()">创建</button>
    </div>
  `);
}

async function createOrg() {
  const name = document.getElementById('new-org-name').value.trim();
  if (!name) { showToast('请输入组织名称', 'error'); return; }
  try {
    await api('/admin/orgs', { method: 'POST', body: JSON.stringify({ name }) });
    closeModal();
    showToast('组织创建成功', 'success');
    loadOrgs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== Users =====
async function loadUsers() {
  try {
    usersData = await api('/admin/users');
    renderUsers();
  } catch (err) {
    showToast('加载用户失败', 'error');
  }
}

function renderUsers() {
  const el = document.getElementById('users-list');
  if (usersData.length === 0) {
    el.innerHTML = `<div class="empty-state"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#aeaeb2" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><p>暂无用户</p></div>`;
    return;
  }
  el.innerHTML = usersData.map(u => `
    <div class="data-card">
      <div class="data-card-header">
        <span class="data-card-title">${esc(u.name || u.email)}</span>
        <div class="data-card-actions">
          <span class="badge badge-${u.role}">${u.role === 'admin' ? '管理员' : '成员'}</span>
          <span class="badge badge-${u.status}">${u.status === 'active' ? '正常' : '禁用'}</span>
          <button class="btn-secondary btn-sm" onclick="showEditUserModal('${u.id}')">编辑</button>
          <button class="btn-danger" onclick="toggleUserStatus('${u.id}','${u.status}')">${u.status === 'active' ? '禁用' : '启用'}</button>
        </div>
      </div>
      <div class="data-card-meta">
        <span>${esc(u.email)}</span>
        <span>组织: ${esc(u.org_name || '无')}</span>
        <span title="${u.created_at}">${timeAgo(u.created_at)}</span>
      </div>
    </div>
  `).join('');
}

function showCreateUserModal() {
  const orgOptions = orgsData.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  showModal(`
    <div class="modal-header"><h3>新建用户</h3></div>
    <div class="modal-body">
      <div class="config-field"><label>邮箱</label><input id="new-user-email" type="email" placeholder="user@example.com"></div>
      <div class="config-field"><label>密码</label><input id="new-user-password" type="password" placeholder="设置密码"></div>
      <div class="config-field"><label>姓名</label><input id="new-user-name" placeholder="用户姓名"></div>
      <div class="config-field"><label>组织</label><select id="new-user-org" class="select-input" style="width:100%"><option value="">无</option>${orgOptions}</select></div>
      <div class="config-field"><label>角色</label><select id="new-user-role" class="select-input" style="width:100%"><option value="member">成员</option><option value="admin">管理员</option></select></div>
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-confirm" onclick="createUser()">创建</button>
    </div>
  `);
}

async function createUser() {
  const email = document.getElementById('new-user-email').value.trim();
  const password = document.getElementById('new-user-password').value;
  const name = document.getElementById('new-user-name').value.trim();
  const org_id = document.getElementById('new-user-org').value || null;
  const role = document.getElementById('new-user-role').value;
  if (!email || !password) { showToast('邮箱和密码必填', 'error'); return; }
  try {
    await api('/admin/users', { method: 'POST', body: JSON.stringify({ email, password, name, org_id, role }) });
    closeModal();
    showToast('用户创建成功', 'success');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showEditUserModal(userId) {
  const user = usersData.find(u => u.id === userId);
  if (!user) return;
  const orgOptions = orgsData.map(o => `<option value="${o.id}" ${o.id === user.org_id ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  showModal(`
    <div class="modal-header"><h3>编辑用户</h3></div>
    <div class="modal-body">
      <div class="config-field"><label>邮箱</label><input value="${esc(user.email)}" readonly style="background:#f5f5f7"></div>
      <div class="config-field"><label>姓名</label><input id="edit-user-name" value="${esc(user.name || '')}"></div>
      <div class="config-field"><label>组织</label><select id="edit-user-org" class="select-input" style="width:100%"><option value="">无</option>${orgOptions}</select></div>
      <div class="config-field"><label>角色</label><select id="edit-user-role" class="select-input" style="width:100%"><option value="member" ${user.role === 'member' ? 'selected' : ''}>成员</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option></select></div>
      <div class="config-field"><label>重置密码（留空不修改）</label><input id="edit-user-password" type="password" placeholder="新密码"></div>
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-confirm" onclick="updateUser('${userId}')">保存</button>
    </div>
  `);
}

async function updateUser(userId) {
  const name = document.getElementById('edit-user-name').value.trim();
  const org_id = document.getElementById('edit-user-org').value || null;
  const role = document.getElementById('edit-user-role').value;
  const password = document.getElementById('edit-user-password').value || undefined;
  try {
    await api(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ name, org_id, role, password }) });
    closeModal();
    showToast('用户更新成功', 'success');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleUserStatus(userId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
  const label = newStatus === 'active' ? '启用' : '禁用';
  if (!confirm(`确定要${label}该用户吗？`)) return;
  try {
    await api(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
    showToast(`用户已${label}`, 'success');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== Config =====
async function loadConfigPage() {
  if (orgsData.length === 0) {
    orgsData = await api('/admin/orgs');
  }
  const select = document.getElementById('config-org-select');
  select.innerHTML = '<option value="">选择组织</option>' + orgsData.map(o => `<option value="${o.id}" ${o.id === selectedOrgId ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  if (selectedOrgId) loadOrgConfig(selectedOrgId);
  else {
    document.getElementById('config-editor-wrap').style.display = 'none';
    document.getElementById('config-empty').style.display = 'flex';
  }
}

async function loadOrgConfig(orgId) {
  try {
    const org = await api(`/admin/orgs/${orgId}`);
    currentConfig = org.config || {};
    document.getElementById('config-editor-wrap').style.display = 'block';
    document.getElementById('config-empty').style.display = 'none';
    renderConfigSections();
  } catch (err) {
    showToast('加载配置失败', 'error');
  }
}

function switchConfigTab(section) {
  document.querySelectorAll('.config-tab').forEach(b => b.classList.toggle('active', b.dataset.section === section));
  document.querySelectorAll('.config-section').forEach(s => s.classList.toggle('active', s.dataset.section === section));
  if (section === 'raw') {
    document.getElementById('raw-json').value = JSON.stringify(currentConfig, null, 2);
  }
}

function renderConfigSections() {
  const c = currentConfig;
  const container = document.getElementById('config-sections');

  container.innerHTML = `
    <!-- API Section -->
    <div class="config-section active" data-section="api">
      <div class="config-field"><label>API Key</label><input type="password" data-path="api.api_key" value="${esc(c.api?.api_key || '')}"></div>
      <div class="config-field"><label>Base URL</label><input data-path="api.base_url" value="${esc(c.api?.base_url || '')}"></div>
      <div class="config-field"><label>模型</label><input data-path="api.model" value="${esc(c.api?.model || '')}"></div>
      <div class="config-field"><label>每日限额</label><input type="number" data-path="api.daily_limit" value="${c.api?.daily_limit || 0}"></div>
    </div>

    <!-- ADP Section -->
    <div class="config-section" data-section="adp">
      <div class="config-field"><label>App Key</label><input data-path="adp.app_key" value="${esc(c.adp?.app_key || '')}"></div>
      <div class="config-field"><label>知识库 App Key</label><input data-path="adp.knowledge_app_key" value="${esc(c.adp?.knowledge_app_key || '')}"></div>
      <div class="config-field"><label>搜索 App Key</label><input data-path="adp.search_app_key" value="${esc(c.adp?.search_app_key || '')}"></div>
      <div class="config-field"><label>ADP URL</label><input data-path="adp.url" value="${esc(c.adp?.url || '')}"></div>
      <div class="config-field"><label>助手名称</label><input data-path="adp.agent_name" value="${esc(c.adp?.agent_name || '')}"></div>
    </div>

    <!-- Prompts Section -->
    <div class="config-section" data-section="prompts">
      <div class="config-field"><label>AI 提示词</label><textarea data-path="prompts.ai_prompt">${esc(c.prompts?.ai_prompt || '')}</textarea></div>
      <div class="config-field"><label>记忆提示词</label><textarea data-path="prompts.memory_prompt">${esc(c.prompts?.memory_prompt || '')}</textarea></div>
      <div class="config-field"><label>剪贴板提示词</label><textarea data-path="prompts.clipboard_prompt">${esc(c.prompts?.clipboard_prompt || '')}</textarea></div>
    </div>

    <!-- Policies Section -->
    <div class="config-section" data-section="policies">
      <div class="toggle-wrap">
        <span class="toggle-label">锁定配置（禁止客户端本地修改）</span>
        <label class="toggle"><input type="checkbox" data-path="policies.lock_config" ${c.policies?.lock_config ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div class="toggle-wrap">
        <span class="toggle-label">允许本地覆盖</span>
        <label class="toggle"><input type="checkbox" data-path="policies.allow_local_override" ${c.policies?.allow_local_override !== false ? 'checked' : ''}><span class="slider"></span></label>
      </div>
    </div>

    <!-- Raw JSON Section -->
    <div class="config-section" data-section="raw">
      <textarea id="raw-json" class="raw-json-area">${esc(JSON.stringify(c, null, 2))}</textarea>
    </div>
  `;
}

async function saveConfig() {
  if (!selectedOrgId) { showToast('请先选择组织', 'error'); return; }

  // Collect values from form fields
  const inputs = document.querySelectorAll('#config-sections [data-path]');
  inputs.forEach(el => {
    const path = el.dataset.path;
    const keys = path.split('.');
    let obj = currentConfig;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    const lastKey = keys[keys.length - 1];
    if (el.type === 'checkbox') {
      obj[lastKey] = el.checked;
    } else if (el.type === 'number') {
      obj[lastKey] = parseInt(el.value) || 0;
    } else {
      obj[lastKey] = el.value;
    }
  });

  // If raw JSON tab is active, use its content
  const rawEl = document.getElementById('raw-json');
  if (rawEl) {
    try {
      currentConfig = JSON.parse(rawEl.value);
    } catch {
      showToast('JSON 格式错误', 'error');
      return;
    }
  }

  // Remove _meta
  const configToSave = { ...currentConfig };
  delete configToSave._meta;

  try {
    await api(`/admin/orgs/${selectedOrgId}/config`, {
      method: 'PUT',
      body: JSON.stringify(configToSave)
    });
    showToast('配置保存成功', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== Modal =====
function showModal(html) {
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// ===== Toast =====
function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = '0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

// ===== Helpers =====
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`;
  return date.toLocaleDateString('zh-CN');
}
