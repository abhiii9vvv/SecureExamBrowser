import { navigateTo, showToast, setButtonLoading } from './router.js'

const form   = document.getElementById('loginForm')
const userEl = document.getElementById('username')
const passEl = document.getElementById('password')
const btn    = document.getElementById('loginBtn')
const errBox = document.getElementById('login-error')
const errMsg = document.getElementById('login-error-msg')

function showError(msg) {
  errMsg.textContent = msg
  errBox.classList.add('show')
  userEl.classList.add('error')
  passEl.classList.add('error')
}

function clearError() {
  errBox.classList.remove('show')
  userEl.classList.remove('error')
  passEl.classList.remove('error')
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  clearError()

  const username = userEl.value.trim()
  const password = passEl.value.trim()

  if (!username || !password) {
    showError('Please enter both username and password.')
    return
  }

  setButtonLoading(btn, true)

  try {
    const result = await window.electronAPI.login(username, password)

    if (!result?.success) {
      showError(result?.error || 'Invalid username or password.')
      return
    }

    // ──────────────────────────────────────────────
    // CRITICAL: persist identity for all pages
    // ──────────────────────────────────────────────
    const data = result.data || {}
    localStorage.setItem('userId',   String(data.userId   || '0'))
    localStorage.setItem('userRole', String(data.role     || 'student'))
    localStorage.setItem('userName', String(data.fullName || data.name || data.username || ''))
    localStorage.setItem('userEmail',String(data.email    || ''))
    // Clear any stale exam session
    localStorage.removeItem('currentSessionId')
    localStorage.removeItem('currentExamId')
    localStorage.removeItem('currentExamTitle')
    localStorage.removeItem('currentExamDuration')
    localStorage.removeItem('examProgress')

    const role = (data.role || 'student').toLowerCase()
    if (role === 'admin') {
      await navigateTo('dashboard')
    } else {
      await navigateTo('student-dashboard')
    }
  } catch (err) {
    showError(err.message || 'Login failed. Please try again.')
  } finally {
    setButtonLoading(btn, false)
  }
})

userEl.addEventListener('input', clearError)
passEl.addEventListener('input', clearError)
