import { navigateTo, navigateToLogin, showToast } from './router.js'

document.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.nav)))
document.getElementById('logoutBtn').addEventListener('click', async () => { try { await window.electronAPI.logout() } catch {} await navigateToLogin() })
document.getElementById('refreshBtn').addEventListener('click', () => load())

const statusBadge = { active: 'badge-success', inactive: 'badge-default', scheduled: 'badge-info', ended: 'badge-default' }

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) } catch { return s }
}

async function load() {
  const tbody = document.getElementById('examsBody')
  tbody.innerHTML = `<tr><td colspan="6"><div class="flex items-center gap-2 text-mute text-sm" style="padding:var(--sp-4)"><div class="spinner"></div> Loading...</div></td></tr>`
  try {
    const r = await window.electronAPI.getAdminExams()
    const exams = r?.data || []
    if (!exams.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No exams found</div></div></td></tr>`
      return
    }
    tbody.innerHTML = exams.map(e => `
      <tr>
        <td class="fw">#${e.id}</td>
        <td class="fw">${e.title || '—'}</td>
        <td><span class="badge ${statusBadge[e.status] || 'badge-default'}"><span class="badge-dot"></span>${e.status || '—'}</span></td>
        <td>${e.durationMinutes ? `${e.durationMinutes} min` : '—'}</td>
        <td>${fmtDate(e.createdAt)}</td>
        <td>${e.submissionCount ?? '—'}</td>
      </tr>
    `).join('')
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="alert alert-danger" style="margin:var(--sp-4)">${err.message}</div></td></tr>`
  }
}

load()
