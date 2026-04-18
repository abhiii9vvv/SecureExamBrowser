import { navigateTo, navigateToLogin } from './router.js'

document.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.nav)))
document.getElementById('logoutBtn').addEventListener('click', async () => { try { await window.electronAPI.logout() } catch {} await navigateToLogin() })
document.getElementById('refreshBtn').addEventListener('click', () => load())

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) } catch { return s }
}

const roleBadge = { admin: 'badge-accent', student: 'badge-default' }

async function load() {
  const tbody = document.getElementById('usersBody')
  tbody.innerHTML = `<tr><td colspan="6"><div class="flex items-center gap-2 text-mute text-sm" style="padding:var(--sp-4)"><div class="spinner"></div> Loading...</div></td></tr>`
  try {
    const r = await window.electronAPI.getAdminUsers()
    const users = r?.data || []
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No users found</div></div></td></tr>`
      return
    }
    tbody.innerHTML = users.map(u => `
      <tr>
        <td class="fw">#${u.id}</td>
        <td class="fw">${u.username || '—'}</td>
        <td>${u.name || '—'}</td>
        <td>${u.email || '—'}</td>
        <td><span class="badge ${roleBadge[u.role] || 'badge-default'}">${u.role || '—'}</span></td>
        <td>${fmtDate(u.createdAt)}</td>
      </tr>
    `).join('')
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-danger" style="margin:var(--sp-4)">${err.message}</div></td></tr>`
  }
}

load()
