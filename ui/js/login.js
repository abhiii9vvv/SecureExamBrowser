const DEFAULT_STUDENT_USERNAME = 'student'
const DEFAULT_STUDENT_PASSWORD = 'student123'

function setCredentials(usernameValue, passwordValue) {
  const username = document.getElementById('username')
  const password = document.getElementById('password')
  if (!username || !password) return
  username.value = usernameValue
  password.value = passwordValue
}

function showError(message) {
  const errorElement = document.getElementById('loginError')
  if (!errorElement) return
  errorElement.textContent = message
  errorElement.style.display = 'block'
}

function clearError() {
  const errorElement = document.getElementById('loginError')
  if (!errorElement) return
  errorElement.textContent = ''
  errorElement.style.display = 'none'
}

function resetSessionArtifacts() {
  localStorage.removeItem('currentSessionId')
  localStorage.removeItem('examUiState')
  localStorage.removeItem('verificationComplete')
  localStorage.removeItem('lastSubmissionScore')
  localStorage.removeItem('lastSubmissionAt')
  localStorage.removeItem('lastSubmissionExamName')
}

async function updateDbStatus() {
  const badge = document.getElementById('dbStatus')
  if (!badge) return

  try {
    const status = await window.electronAPI.getDatabaseStatus()
    badge.textContent = status.connected ? 'SQLite Ready' : 'SQLite Offline'
    badge.className = status.connected ? 'status-pill-ok' : 'status-pill-warn'
  } catch (error) {
    badge.textContent = 'DB Error'
    badge.className = 'status-pill-warn'
  }
}

async function handleLogin(event) {
  event.preventDefault()
  clearError()

  const username = document.getElementById('username')
  const password = document.getElementById('password')
  const button = document.getElementById('loginButton')
  if (!username || !password || !button) return

  button.disabled = true
  button.textContent = 'Signing In...'

  try {
    resetSessionArtifacts()
    const result = await window.electronAPI.login(username.value.trim(), password.value)
    if (!result.success) {
      throw new Error(result.error || 'Invalid username or password')
    }

    const user = result.data
    localStorage.setItem('currentUserId', String(user.userId))
    localStorage.setItem('currentUserName', user.fullName || '')
    localStorage.setItem('currentUserRole', user.role || 'student')
    localStorage.setItem('currentUserCourse', user.course || '')
    localStorage.setItem('currentUserBranch', user.branch || '')
    localStorage.setItem('currentUserUniversity', user.university || '')
    localStorage.setItem('currentUserLocation', user.location || '')

    const destination = (user.role || '').toLowerCase() === 'admin' ? 'dashboard' : 'student-dashboard'
    await window.electronAPI.navigateTo(destination)
  } catch (error) {
    showError(error.message || 'Login failed')
  } finally {
    button.disabled = false
    button.textContent = 'Sign In'
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setCredentials(DEFAULT_STUDENT_USERNAME, DEFAULT_STUDENT_PASSWORD)
  updateDbStatus()

  const form = document.getElementById('loginForm')
  if (form) {
    form.addEventListener('submit', handleLogin)
  }

  const quickFill = document.getElementById('useStudentCredentials')
  if (quickFill) {
    quickFill.addEventListener('click', () => {
      setCredentials(DEFAULT_STUDENT_USERNAME, DEFAULT_STUDENT_PASSWORD)
    })
  }
})
