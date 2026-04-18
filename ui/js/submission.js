const loadingEl  = document.getElementById('loadingState')
const resultCard = document.getElementById('resultCard')
const errorEl    = document.getElementById('errorState')
const errorMsg   = document.getElementById('errorMsg')
const exitBtn    = document.getElementById('exitBtn')

function cleanupSessionStorage() {
  localStorage.removeItem('currentSessionId')
  localStorage.removeItem('examProgress')
  localStorage.removeItem('currentExamId')
  localStorage.removeItem('currentExamTitle')
  localStorage.removeItem('currentExamDuration')
}

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString() } catch { return s }
}

async function load() {
  const sessionId = Number(localStorage.getItem('currentSessionId') || '0')

  try {
    let summary = null

    if (sessionId > 0) {
      try {
        const res = await window.electronAPI.getSubmissionSummary(sessionId)
        if (res?.success && res.data) summary = res.data
      } catch (e) {
        console.warn('[submission] getSubmissionSummary failed:', e.message)
      }
    }

    loadingEl.classList.add('hidden')

    if (!summary) {
      // Show partial success — exam was submitted but summary unavailable
      errorEl.querySelector('span').textContent =
        'Your exam was submitted successfully. Results summary is unavailable right now.'
      errorEl.classList.remove('hidden')
      resultCard.classList.remove('hidden')
      // Still fill what we know
      document.getElementById('statAnswered').textContent = '—'
      document.getElementById('statFlagged').textContent  = '—'
      document.getElementById('statTotal').textContent    = '—'
      document.getElementById('subSubtitle').textContent  = 'Submitted successfully — results pending.'
      resultCard.classList.remove('hidden')
      cleanupSessionStorage()
      return
    }

    // ── Populate stats ──
    const answered = summary.answeredCount ?? summary.answered
    const flagged = summary.flaggedCount ?? summary.flagged
    const total = summary.totalQuestions ?? (
      Number.isFinite(summary.answered) && Number.isFinite(summary.unanswered)
        ? summary.answered + summary.unanswered
        : undefined
    )

    document.getElementById('statAnswered').textContent = answered ?? '—'
    document.getElementById('statFlagged').textContent  = flagged ?? '0'
    document.getElementById('statTotal').textContent    = total ?? '—'

    document.getElementById('subSubtitle').textContent =
      `Submitted on ${fmtDate(summary.submittedAt || new Date().toISOString())}`

    let detailHtml = ''
    if (summary.examTitle)  detailHtml += row('Exam', summary.examTitle)
    if (summary.duration)   detailHtml += row('Duration', summary.duration)
    if (summary.sessionId)  detailHtml += row('Session ID', `#${summary.sessionId}`)
    if (summary.score !== undefined) detailHtml += row('Score', `${summary.score}%`)
    document.getElementById('subDetails').innerHTML = detailHtml

    resultCard.classList.remove('hidden')

  } catch (err) {
    loadingEl.classList.add('hidden')
    errorMsg.textContent = err.message || 'Unable to load results.'
    errorEl.classList.remove('hidden')
  }

  cleanupSessionStorage()
}

function row(label, val) {
  return `<div class="sub-detail-row"><span class="sub-detail-key">${label}</span><span class="sub-detail-val">${val}</span></div>`
}

exitBtn.addEventListener('click', async () => {
  // Use electronAPI directly — logout and navigate to login
  try { await window.electronAPI.logout() } catch { /* ignore */ }
  localStorage.clear()
  // Navigate to login — preload handles this as an auth-free navigation
  try {
    await window.electronAPI.navigateTo('login')
  } catch (err) {
    // Last resort fallback
    console.error('[submission] exit nav failed:', err.message)
  }
})

load()
