import { navigateTo, navigateToLogin, showToast, formatDateTime } from './router.js'

/* ----- Sidebar nav ----- */
document.querySelectorAll('[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.nav))
})

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await window.electronAPI.logout() } catch {}
  await navigateToLogin()
})

document.getElementById('refreshBtn').addEventListener('click', () => load())

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

const severityBadge = { high: 'badge-danger', medium: 'badge-warning', low: 'badge-info' }
const statusBadge   = { active: 'badge-success', ended: 'badge-default', submitted: 'badge-accent' }

async function load() {
  document.getElementById('lastRefresh').textContent = 'Refreshing...'

  // Stats
  try {
    const r = await window.electronAPI.getDashboardStats()
    const stats = r?.data || r
    const statsGrid = document.getElementById('statsGrid')
    statsGrid.innerHTML = [
      { label: 'Total Students', val: stats?.totalStudents ?? '—' },
      { label: 'Total Exams',    val: stats?.totalExams    ?? '—' },
      { label: 'Active Sessions',val: stats?.activeSessions ?? '—', hi: true },
      { label: 'Total Submissions', val: stats?.totalSubmissions ?? '—' },
    ].map(s => `
      <div class="stat-card">
        <div class="stat-label">${s.label}</div>
        <div class="stat-value${s.hi ? ' text-acc' : ''}">${s.val}</div>
      </div>
    `).join('')
  } catch (err) {
    document.getElementById('statsGrid').innerHTML = `<div class="alert alert-danger">${err.message}</div>`
  }

  // Active sessions
  try {
    const r = await window.electronAPI.getActiveSessions()
    const sessions = r?.data || []
    const tbody = document.getElementById('sessionsBody')
    if (!sessions.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-title">No active exam sessions</div></div></td></tr>`
    } else {
      tbody.innerHTML = sessions.map(s => `
        <tr>
          <td class="fw">${s.studentName || `Student #${s.userId}`}</td>
          <td>${s.examTitle || `Exam #${s.examId}`}</td>
          <td>${fmtDate(s.startedAt)}</td>
          <td>${s.answeredCount !== undefined ? `${s.answeredCount} / ${s.totalQuestions}` : '—'}</td>
          <td><span class="badge ${statusBadge[s.status] || 'badge-default'}">${s.status || '—'}</span></td>
        </tr>
      `).join('')
    }
  } catch (err) {
    document.getElementById('sessionsBody').innerHTML = `<tr><td colspan="5" class="text-err text-sm">${err.message}</td></tr>`
  }

  // Incidents
  try {
    const r = await window.electronAPI.getRecentIncidents()
    const incidents = r?.data || []
    const tbody = document.getElementById('incidentsBody')
    if (!incidents.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-title">No recent incidents</div></div></td></tr>`
    } else {
      tbody.innerHTML = incidents.map(i => `
        <tr>
          <td>${fmtDate(i.createdAt)}</td>
          <td class="fw">${i.studentName || `#${i.userId}`}</td>
          <td>${i.type || '—'}</td>
          <td><span class="badge ${severityBadge[i.severity] || 'badge-default'}">${i.severity || '—'}</span></td>
          <td><span class="badge ${i.status === 'resolved' ? 'badge-success' : 'badge-warning'}">${i.status || 'open'}</span></td>
        </tr>
      `).join('')
    }
  } catch (err) {
    document.getElementById('incidentsBody').innerHTML = `<tr><td colspan="5" class="text-err text-sm">${err.message}</td></tr>`
  }

  document.getElementById('lastRefresh').textContent = `Last updated: ${new Date().toLocaleTimeString()}`
}

load()
