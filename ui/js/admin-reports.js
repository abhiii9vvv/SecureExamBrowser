import { navigateTo, navigateToLogin } from './router.js'

document.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.nav)))
document.getElementById('logoutBtn').addEventListener('click', async () => { try { await window.electronAPI.logout() } catch {} await navigateToLogin() })
document.getElementById('refreshBtn').addEventListener('click', () => load())

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return s }
}

const sevBadge  = { high: 'badge-danger', medium: 'badge-warning', low: 'badge-info' }
const statBadge = { open: 'badge-warning', resolved: 'badge-success', dismissed: 'badge-default' }

function esc(s) {
  if (!s) return '—'
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').slice(0, 80)
}

async function load() {
  // Submissions
  const subBody = document.getElementById('submissionsBody')
  subBody.innerHTML = `<tr><td colspan="5"><div class="flex items-center gap-2 text-mute text-sm" style="padding:var(--sp-4)"><div class="spinner"></div> Loading...</div></td></tr>`
  try {
    const r = await window.electronAPI.getRecentSubmissions()
    const subs = r?.data || []
    if (!subs.length) {
      subBody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-title">No submissions yet</div></div></td></tr>`
    } else {
      subBody.innerHTML = subs.map(s => `
        <tr>
          <td class="fw">${s.studentName || `#${s.userId}`}</td>
          <td>${s.examTitle || `#${s.examId}`}</td>
          <td>${fmtDate(s.submittedAt)}</td>
          <td>${s.score !== undefined ? `${s.score}%` : '—'}</td>
          <td><span class="badge ${s.passed ? 'badge-success' : 'badge-danger'}">${s.passed ? 'Passed' : 'Failed'}</span></td>
        </tr>
      `).join('')
    }
  } catch (err) {
    subBody.innerHTML = `<tr><td colspan="5" class="text-err text-sm" style="padding:var(--sp-4)">${err.message}</td></tr>`
  }

  // Incidents
  const incBody = document.getElementById('incidentsBody')
  incBody.innerHTML = `<tr><td colspan="7"><div class="flex items-center gap-2 text-mute text-sm" style="padding:var(--sp-4)"><div class="spinner"></div> Loading...</div></td></tr>`
  try {
    const r = await window.electronAPI.getRecentIncidents()
    const incs = r?.data || []
    if (!incs.length) {
      incBody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-title">No incidents recorded</div></div></td></tr>`
    } else {
      incBody.innerHTML = incs.map(i => `
        <tr>
          <td>${fmtDate(i.createdAt)}</td>
          <td class="fw">${i.studentName || `#${i.userId}`}</td>
          <td>${i.sessionId ? `#${i.sessionId}` : '—'}</td>
          <td class="fw-500">${i.type || '—'}</td>
          <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.message)}</td>
          <td><span class="badge ${sevBadge[i.severity] || 'badge-default'}">${i.severity || '—'}</span></td>
          <td><span class="badge ${statBadge[i.status] || 'badge-warning'}">${i.status || 'open'}</span></td>
        </tr>
      `).join('')
    }
  } catch (err) {
    incBody.innerHTML = `<tr><td colspan="7" class="text-err text-sm" style="padding:var(--sp-4)">${err.message}</td></tr>`
  }
}

load()
