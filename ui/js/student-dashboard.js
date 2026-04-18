import { navigateTo, navigateToLogin, showToast, setButtonLoading } from './router.js'

/* ──────── DOM refs ──────── */
const loadingEl  = document.getElementById('loadingState')
const mainEl     = document.getElementById('mainContent')
const errorEl    = document.getElementById('errorState')
const errorMsgEl = document.getElementById('errorMsg')
const profileAvat= document.getElementById('profileAvatar')
const profileName= document.getElementById('profileName')
const profileRole= document.getElementById('profileRole')
const headerName = document.getElementById('headerUserName')
const examCard   = document.getElementById('examCard')
const noExamEl   = document.getElementById('noExamState')
const examTitle  = document.getElementById('examTitle')
const examMeta   = document.getElementById('examMeta')
const examDesc   = document.getElementById('examDesc')
const examBadge  = document.getElementById('examStatusBadge')
const startBtn   = document.getElementById('startExamBtn')
const logoutBtn  = document.getElementById('logoutBtn')

let activeExam = null

function showError(msg) {
  loadingEl.classList.add('hidden')
  mainEl.classList.add('hidden')
  errorMsgEl.textContent = msg
  errorEl.classList.remove('hidden')
}

function renderProfile(profile) {
  // Use saved localStorage data as primary source (never stale)
  const name  = localStorage.getItem('userName')  || profile?.fullName || profile?.name || profile?.username || '?'
  const email = localStorage.getItem('userEmail') || profile?.email || ''
  const role  = localStorage.getItem('userRole')  || 'student'

  const initials = name
    .split(' ')
    .map(w => w[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

  profileAvat.textContent = initials
  profileName.textContent = name
  profileRole.textContent = email || (role === 'admin' ? 'Administrator' : 'Student')
  headerName.textContent  = name
}

function renderExam(exam) {
  if (!exam) {
    noExamEl.classList.remove('hidden')
    examCard.classList.add('hidden')
    return
  }

  examCard.classList.remove('hidden')
  noExamEl.classList.add('hidden')

  examTitle.textContent = exam.title || exam.name || 'Examination'
  examDesc.textContent  = exam.description || 'Please read all instructions before starting.'

  // Meta
  const metaParts = []
  if (exam.durationMinutes)
    metaParts.push(`<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;color:var(--text-muted)"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>&nbsp;${exam.durationMinutes} min</span>`)
  if (exam.totalQuestions)
    metaParts.push(`<span>${exam.totalQuestions} questions</span>`)
  if (exam.passingScore)
    metaParts.push(`<span>Pass: ${exam.passingScore}%</span>`)
  examMeta.innerHTML = metaParts.join('')

  const statusMap = {
    active:    ['badge-success', 'Active'],
    scheduled: ['badge-info',    'Scheduled'],
    ended:     ['badge-default', 'Ended'],
  }
  const [cls, lbl] = statusMap[exam.status] || ['badge-default', exam.status || 'Unknown']
  examBadge.innerHTML = `<span class="badge ${cls}"><span class="badge-dot"></span>${lbl}</span>`

  startBtn.disabled = exam.status !== 'active'
}

async function load() {
  try {
    // Try to enrich profile from DB (non-critical)
    const userId = Number(localStorage.getItem('userId') || '0')
    let profile = null

    if (userId > 0) {
      try {
        const pr = await window.electronAPI.getUserProfile(userId)
        if (pr?.success) profile = pr.data
      } catch { /* fallback to localStorage data */ }
    }

    renderProfile(profile)

    // Load active exam
    const examResult = await window.electronAPI.getActiveExam()
    activeExam = examResult?.success ? examResult.data : null
    renderExam(activeExam)

    loadingEl.classList.add('hidden')
    mainEl.classList.remove('hidden')
    mainEl.style.display = 'flex'

  } catch (err) {
    showError(err.message || 'Failed to load dashboard. Please restart the application.')
  }
}

startBtn.addEventListener('click', async () => {
  if (!activeExam) return
  // Persist exam info for launch and exam pages
  localStorage.setItem('currentExamId',       String(activeExam.id))
  localStorage.setItem('currentExamTitle',    activeExam.title || activeExam.name || '')
  localStorage.setItem('currentExamDuration', String(activeExam.durationMinutes || 120))
  await navigateTo('launch')
})

logoutBtn.addEventListener('click', async () => {
  setButtonLoading(logoutBtn, true)
  try {
    await window.electronAPI.logout()
  } catch { /* ignore */ }
  // Clear everything
  localStorage.clear()
  await navigateToLogin()
})

load()
