function role() {
  return (localStorage.getItem('currentUserRole') || 'student').toLowerCase()
}

const flowState = {
  examScheduled: false,
  verified: false,
  online: navigator.onLine,
  databaseConnected: false
}

function setText(selector, value, fallback = '--') {
  const element = document.querySelector(selector)
  if (!element) return
  element.textContent = value || fallback
}

function formatWindow(startTime, endTime) {
  if (!startTime || !endTime) return 'Not set'
  const start = new Date(startTime)
  const end = new Date(endTime)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Not set'
  const dateOptions = { month: 'short', day: '2-digit' }
  const timeOptions = { hour: '2-digit', minute: '2-digit' }
  return `${start.toLocaleDateString('en-US', dateOptions)} ${start.toLocaleTimeString('en-US', timeOptions)} to ${end.toLocaleDateString('en-US', dateOptions)} ${end.toLocaleTimeString('en-US', timeOptions)}`
}

function updateVerificationState() {
  flowState.verified = localStorage.getItem('verificationComplete') === 'true'
  const value = flowState.verified ? 'Verified' : 'Pending'
  setText('[data-verification-state]', value)
  setText('[data-quick-verify]', value)
  updateFlowSummary()
}

function updateSubmissionSnapshot() {
  const score = localStorage.getItem('lastSubmissionScore')
  const examName = localStorage.getItem('lastSubmissionExamName')
  const submittedAt = localStorage.getItem('lastSubmissionAt')

  setText('[data-last-score]', score ? `${score}%` : '--%')
  setText('[data-last-exam]', `Exam: ${examName || '--'}`)

  if (submittedAt) {
    const time = new Date(submittedAt)
    setText('[data-last-time]', `Submitted: ${time.toLocaleString('en-US')}`)
  } else {
    setText('[data-last-time]', 'Submitted: --')
  }
}

async function loadExamCard() {
  try {
    const result = await window.electronAPI.getActiveExam()
    if (!result.success || !result.data) {
      flowState.examScheduled = false
      setText('[data-exam-status]', 'Not Scheduled')
      updateFlowSummary()
      return
    }

    const exam = result.data
    localStorage.setItem('currentExamId', String(exam.id || ''))
    localStorage.setItem('currentExamName', exam.name || '')
    localStorage.setItem('currentExamCode', exam.code || '')
    localStorage.setItem('currentExamDuration', String(exam.durationMinutes || ''))

    setText('[data-exam-name]', exam.name, 'Not scheduled')
    setText('[data-exam-code]', exam.code)
    setText('[data-exam-duration]', exam.durationMinutes ? `${exam.durationMinutes} minutes` : '--')
    setText('[data-exam-window]', formatWindow(exam.startTime, exam.endTime))
    setText('[data-exam-status]', 'Scheduled')
    flowState.examScheduled = true
    updateFlowSummary()
  } catch (error) {
    flowState.examScheduled = false
    setText('[data-exam-status]', 'Unavailable')
    updateFlowSummary()
  }
}

async function updateDatabaseState() {
  try {
    const status = await window.electronAPI.getDatabaseStatus()
    flowState.databaseConnected = !!status.connected
    setText('[data-db-state]', status.connected ? 'Connected' : 'Offline')
  } catch (error) {
    flowState.databaseConnected = false
    setText('[data-db-state]', 'Offline')
  }
  updateFlowSummary()
}

function updateConnectivityState() {
  flowState.online = navigator.onLine
  setText('[data-online-state]', flowState.online ? 'Online' : 'Offline')
  updateFlowSummary()
}

function setFlowNote(message, tone = 'warning') {
  const note = document.querySelector('[data-flow-note]')
  if (!note) return
  note.textContent = message
  note.setAttribute('data-flow-tone', tone)
}

function setActionHint(message, tone = 'neutral') {
  const hint = document.querySelector('[data-action-hint]')
  if (!hint) return
  hint.textContent = message
  hint.setAttribute('data-flow-tone', tone)
}

function setActionAvailability(selector, enabled, reason = '') {
  document.querySelectorAll(selector).forEach((button) => {
    button.disabled = !enabled
    if (reason) {
      button.title = reason
      button.setAttribute('aria-label', `${button.textContent.trim()}. ${reason}`)
    } else {
      button.removeAttribute('title')
      button.setAttribute('aria-label', button.textContent.trim())
    }
  })
}

function updateFlowSummary() {
  const sessionStatus = document.querySelector('[data-session-status]')

  if (!flowState.examScheduled) {
    if (sessionStatus) sessionStatus.textContent = 'No Exam Scheduled'
    setFlowNote('No active exam is assigned to your account yet.', 'neutral')
    setActionHint('Exam gate is locked until an exam is scheduled.', 'neutral')
    setActionAvailability('[data-open-launch]', false, 'No active exam is scheduled yet.')
    setActionAvailability('[data-start-exam]', false, 'No active exam is scheduled yet.')
    setActionAvailability('[data-open-verification]', true)
    return
  }

  if (!flowState.verified) {
    if (sessionStatus) sessionStatus.textContent = 'Step 1: Verify Identity'
    setFlowNote('Step 1: Verify identity before running system checks.', 'warning')
    setActionHint('Step 2 and Step 3 unlock automatically after verification succeeds.', 'warning')
    setActionAvailability('[data-open-verification]', true)
    setActionAvailability('[data-open-launch]', false, 'Complete Step 1 verification first.')
    setActionAvailability('[data-start-exam]', false, 'Complete Step 1 verification first.')
    return
  }

  if (!flowState.databaseConnected || !flowState.online) {
    if (sessionStatus) sessionStatus.textContent = 'Step 2: Resolve Connectivity'
    setFlowNote('Database or network is offline. Fix connectivity before launch checks.', 'error')
    setActionHint('You can still open Launch Pad, but exam start will stay blocked until connectivity recovers.', 'error')
    setActionAvailability('[data-open-verification]', true)
    setActionAvailability('[data-open-launch]', true)
    setActionAvailability('[data-start-exam]', true)
    return
  }

  if (sessionStatus) sessionStatus.textContent = 'Step 2: System Checks'
  setFlowNote('Identity verified. Continue to Launch Pad and complete all readiness checks.', 'ok')
  setActionHint('Step 2 is unlocked. Run system checks, then continue through the exam gate.', 'ok')
  setActionAvailability('[data-open-verification]', true)
  setActionAvailability('[data-open-launch]', true)
  setActionAvailability('[data-start-exam]', true)
}

function loadUserCard() {
  const name = localStorage.getItem('currentUserName') || 'Student'
  const course = localStorage.getItem('currentUserCourse') || '--'
  const branch = localStorage.getItem('currentUserBranch') || '--'
  setText('[data-student-name]', name)
  setText('[data-course]', course)
  setText('[data-branch]', branch)
}

function attachActions() {
  document.querySelectorAll('[data-open-launch]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!flowState.examScheduled) {
        updateFlowSummary()
        return
      }
      if (!flowState.verified) {
        setFlowNote('Redirecting to verification. Complete identity verification first.', 'warning')
        await window.electronAPI.navigateTo('verification')
        return
      }
      await window.electronAPI.navigateTo('launch')
    })
  })

  document.querySelectorAll('[data-open-verification]').forEach((button) => {
    button.addEventListener('click', async () => {
      setFlowNote('Opening verification. Keep your face centered and camera unobstructed.', 'neutral')
      await window.electronAPI.navigateTo('verification')
    })
  })

  const startExamButton = document.querySelector('[data-start-exam]')
  if (startExamButton) {
    startExamButton.addEventListener('click', async () => {
      if (!flowState.examScheduled) {
        updateFlowSummary()
        return
      }
      if (!flowState.verified) {
        setFlowNote('Verification is required before the exam gate can be opened.', 'warning')
        await window.electronAPI.navigateTo('verification')
        return
      }
      await window.electronAPI.navigateTo('launch')
    })
  }

  const logoutButton = document.querySelector('[data-logout]')
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      localStorage.removeItem('currentSessionId')
      localStorage.removeItem('examUiState')
      localStorage.removeItem('verificationComplete')
      await window.electronAPI.navigateTo('login')
    })
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (role() === 'admin') {
    await window.electronAPI.navigateTo('dashboard')
    return
  }

  loadUserCard()
  updateConnectivityState()
  updateVerificationState()
  updateSubmissionSnapshot()
  await updateDatabaseState()
  await loadExamCard()
  attachActions()

  window.addEventListener('online', updateConnectivityState)
  window.addEventListener('offline', updateConnectivityState)
})
