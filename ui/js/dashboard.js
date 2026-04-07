function renderActiveSessions(sessions) {
  const grid = document.getElementById('activeSessionsGrid')
  if (!grid) return
  grid.innerHTML = ''

  if (!sessions.length) {
    grid.innerHTML = '<div class="col-12 text-center text-muted py-4">No active sessions</div>'
    return
  }

  sessions.forEach((session) => {
    const card = document.createElement('div')
    card.className = 'col-md-6 col-lg-4 col-xl-3'
    card.innerHTML = `
      <div class="app-card p-3 h-100">
        <div class="d-flex align-items-center justify-content-between">
          <div class="status-icon is-ok">
            <span class="material-symbols-outlined">person</span>
          </div>
          <span class="badge text-bg-dark">LIVE</span>
        </div>
        <div class="mt-3">
          <div class="fw-semibold">${session.fullName}</div>
          <div class="text-muted small">ID: ${session.studentId}</div>
          <div class="text-muted small">${session.examName}</div>
          <div class="text-muted small">Verification: ${session.verificationStatus}</div>
        </div>
      </div>
    `
    grid.appendChild(card)
  })
}

function renderActivity(recentSubmissions, incidents) {
  const container = document.querySelector('aside .app-card:last-child .border-top')
  if (!container) return
  container.innerHTML = ''

  const combined = [
    ...incidents.map((item) => ({
      kind: 'incident',
      title: item.message,
      subtitle: item.fullName ? `${item.fullName} (${item.studentId || 'N/A'})` : item.type,
      badge: item.severity,
      emphasis: 'text-bg-light border'
    })),
    ...recentSubmissions.map((item) => ({
      kind: 'submission',
      title: `Submission recorded: ${item.score}%`,
      subtitle: `${item.fullName} - ${item.examName}`,
      badge: item.status,
      emphasis: 'text-bg-dark'
    }))
  ].slice(0, 6)

  if (!combined.length) {
    container.innerHTML = '<div class="text-muted small">No recent activity yet.</div>'
    return
  }

  combined.forEach((item) => {
    const row = document.createElement('div')
    row.className = 'd-flex justify-content-between align-items-start mb-3'
    row.innerHTML = `
      <div>
        <div class="fw-semibold">${item.title}</div>
        <div class="text-muted small">${item.subtitle}</div>
      </div>
      <span class="badge ${item.emphasis}">${item.badge}</span>
    `
    container.appendChild(row)
  })
}

async function refreshDashboard() {
  const stats = await window.electronAPI.getDashboardStats()
  const sessions = await window.electronAPI.getActiveSessions()
  const submissions = await window.electronAPI.getRecentSubmissions()
  const incidents = await window.electronAPI.getRecentIncidents()
  const dbStatus = await window.electronAPI.getDatabaseStatus()

  document.getElementById('activeCount').textContent = String(stats.data.activeSessions || 0)
  document.getElementById('criticalCount').textContent = String(stats.data.todayViolations || 0)
  document.getElementById('dashboardDbStatus').textContent = dbStatus.connected ? 'Connected' : 'Offline'
  document.getElementById('dashboardActive').textContent = String(stats.data.activeSessions || 0)
  document.getElementById('dashboardViolations').textContent = String(stats.data.todayViolations || 0)

  renderActiveSessions(sessions.data || [])
  renderActivity(submissions.data || [], incidents.data || [])
}

function showIncidentLog() {
  const activityCard = document.querySelector('aside .app-card:last-child')
  if (activityCard) {
    activityCard.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const role = (localStorage.getItem('currentUserRole') || 'student').toLowerCase()
  if (role !== 'admin') {
    window.electronAPI.navigateTo('student-dashboard')
    return
  }

  refreshDashboard()
  setInterval(refreshDashboard, 15000)
})

window.showIncidentLog = showIncidentLog
