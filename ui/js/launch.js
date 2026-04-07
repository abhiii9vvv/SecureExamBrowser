const systemStatus = {
  internet: null,
  camera: null,
  microphone: null,
  lock: null
}

let examScheduled = false
let biometricVerified = false
let systemChecksRunning = false

function setSystemAlert(message = '', level = 'warning') {
  const alert = document.getElementById('systemAlerts')
  if (!alert) return

  if (!message) {
    alert.className = 'system-alert d-none'
    alert.textContent = ''
    return
  }

  alert.className = `system-alert system-alert-${level}`
  alert.textContent = message
}

function mediaErrorReason(kind, error) {
  const label = kind === 'camera' ? 'Camera' : 'Microphone'
  if (!error || !error.name) {
    return `${label} unavailable`
  }

  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return `${label} permission denied`
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return `No ${kind} detected`
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    return `${label} is busy in another app`
  }
  if (error.name === 'OverconstrainedError') {
    return `${label} does not support required constraints`
  }

  return `${label} unavailable`
}

function updateDetailValue(elementId, value, fallback = 'Not specified') {
  const element = document.getElementById(elementId)
  if (!element) return
  element.textContent = value || fallback
}

function checkLabel(key) {
  if (key === 'internet') return 'Internet'
  if (key === 'camera') return 'Camera'
  if (key === 'microphone') return 'Microphone'
  return 'Secure Browser Mode'
}

function setStartExamHint(message) {
  const hint = document.getElementById('startExamHint')
  if (!hint) return
  hint.textContent = message
}

function setRecheckState(running) {
  const recheckButton = document.getElementById('recheckButton')
  if (!recheckButton) return

  recheckButton.disabled = running

  const icon = recheckButton.querySelector('.material-symbols-outlined')
  if (icon) {
    icon.textContent = running ? 'sync' : 'refresh'
  }

  const label = recheckButton.querySelector('[data-recheck-label]')
  if (label) {
    label.textContent = running ? 'Checking...' : 'Recheck'
  }
}

function formatExamWindow(startTime, endTime) {
  if (!startTime || !endTime) return 'Not specified'
  const start = new Date(startTime)
  const end = new Date(endTime)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Not specified'
  }
  const dateOpts = { month: 'short', day: '2-digit' }
  const timeOpts = { hour: '2-digit', minute: '2-digit' }
  return `${start.toLocaleDateString('en-US', dateOpts)} ${start.toLocaleTimeString('en-US', timeOpts)} -> ${end.toLocaleDateString('en-US', dateOpts)} ${end.toLocaleTimeString('en-US', timeOpts)}`
}

async function verifyMediaDevice(kind) {
  const constraints = kind === 'camera' ? { video: true, audio: false } : { video: false, audio: true }
  const deviceKind = kind === 'camera' ? 'videoinput' : 'audioinput'

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { passed: false, reason: `${kind} API unavailable` }
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    if (!devices.some((device) => device.kind === deviceKind)) {
      return { passed: false, reason: `No ${kind} detected` }
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    stream.getTracks().forEach((track) => track.stop())
    return { passed: true, reason: 'Ready' }
  } catch (error) {
    return { passed: false, reason: mediaErrorReason(kind, error) }
  }
}

function setCheckLoading(checkId, message) {
  const item = document.querySelector(`[data-status="${checkId}"]`)
  if (!item) return
  const icon = item.querySelector('.checklist-status span')
  const text = item.querySelector('[data-check-text]')
  if (icon) icon.textContent = 'schedule'
  if (text) text.textContent = message
}

function updateCheckItem(checkId, passed, reason) {
  const item = document.querySelector(`[data-status="${checkId}"]`)
  if (!item) return
  const icon = item.querySelector('.checklist-status span')
  const text = item.querySelector('[data-check-text]')
  item.setAttribute('data-check-pass', passed ? 'true' : 'false')
  if (icon) icon.textContent = passed ? 'check_circle' : 'cancel'
  if (text) text.textContent = reason || (passed ? 'Ready' : 'Failed')
}

function updateProgressSummary() {
  const passedCount = Object.values(systemStatus).filter(Boolean).length
  const totalCount = Object.keys(systemStatus).length
  const progress = Math.round((passedCount / totalCount) * 100)

  const count = document.getElementById('checksPassedCount')
  if (count) count.textContent = String(passedCount)

  const bar = document.querySelector('.checksProgressBar')
  if (bar) {
    bar.style.width = `${progress}%`
    bar.setAttribute('aria-valuenow', String(progress))
  }
}

function updateVerificationPanel() {
  biometricVerified = localStorage.getItem('verificationComplete') === 'true'
  const panel = document.getElementById('verificationStatus')
  if (!panel) return

  panel.innerHTML = biometricVerified
    ? `
      <div class="verification-icon">
        <span class="material-symbols-outlined">verified</span>
      </div>
      <div class="verification-text">
        <div class="verification-message">Verification complete</div>
        <div class="verification-note">Identity and liveness checks passed for this session</div>
      </div>
    `
    : `
      <div class="verification-icon">
        <span class="material-symbols-outlined">face</span>
      </div>
      <div class="verification-text">
        <div class="verification-message">Identity check required</div>
        <div class="verification-note">Complete biometric verification before starting the exam</div>
      </div>
    `
}

function updateGlobalExamStatus() {
  const badge = document.getElementById('globalExamStatus')
  const startButton = document.getElementById('startExamButton')
  if (!badge || !startButton) return

  const allChecksPassed = Object.values(systemStatus).every((value) => value === true)
  const pendingChecks = Object.values(systemStatus).some((value) => value === null)
  const failedChecks = Object.entries(systemStatus)
    .filter(([, value]) => value === false)
    .map(([key]) => checkLabel(key))

  let status = 'checking'
  let label = 'Checking readiness...'
  let icon = 'schedule'
  let hint = 'Blocked: checks are running.'

  if (!examScheduled) {
    status = 'not-scheduled'
    label = 'No exam scheduled'
    icon = 'event_busy'
    hint = 'Blocked: no scheduled exam is available for this account.'
  } else if (systemChecksRunning || pendingChecks) {
    status = 'checking'
    label = 'Checking readiness...'
    icon = 'schedule'
    hint = 'Blocked: system checks are still running.'
  } else if (!allChecksPassed || !biometricVerified) {
    status = 'issues'
    label = biometricVerified ? 'System issues detected' : 'Verification required'
    icon = 'warning'
    if (!biometricVerified) {
      hint = 'Blocked: complete biometric verification first.'
    } else if (failedChecks.length > 0) {
      hint = `Blocked: fix failed checks (${failedChecks.join(', ')}).`
    }
  } else {
    status = 'ready'
    label = 'Ready to start'
    icon = 'check_circle'
    hint = 'Ready: all checks passed. You can start the exam now.'
  }

  badge.setAttribute('data-status', status)
  const text = badge.querySelector('.exam-status-text')
  const iconNode = badge.querySelector('.exam-status-icon')
  if (text) text.textContent = label
  if (iconNode) iconNode.textContent = icon
  startButton.disabled = status !== 'ready'
  startButton.title = hint
  startButton.setAttribute('aria-label', `Start exam. ${hint}`)
  setStartExamHint(hint)
}

async function runSystemChecks() {
  if (systemChecksRunning) return

  systemChecksRunning = true
  systemStatus.internet = null
  systemStatus.camera = null
  systemStatus.microphone = null
  systemStatus.lock = null

  setRecheckState(true)
  setSystemAlert('')
  setCheckLoading('internet', 'Checking internet connection...')
  setCheckLoading('camera', 'Detecting camera...')
  setCheckLoading('microphone', 'Detecting microphone...')
  setCheckLoading('lock', 'Checking secure browser mode...')
  updateProgressSummary()
  updateGlobalExamStatus()

  try {
    systemStatus.internet = navigator.onLine
    updateCheckItem('internet', systemStatus.internet, systemStatus.internet ? 'Ready' : 'Offline')

    const camera = await verifyMediaDevice('camera')
    systemStatus.camera = camera.passed
    updateCheckItem('camera', camera.passed, camera.reason)

    const mic = await verifyMediaDevice('microphone')
    systemStatus.microphone = mic.passed
    updateCheckItem('microphone', mic.passed, mic.reason)

    try {
      let lockStatus = await window.electronAPI.getLockStatus()
      if (!lockStatus.fullscreen) {
        await window.electronAPI.setFullscreen(true)
        lockStatus = await window.electronAPI.getLockStatus()
      }
      systemStatus.lock = lockStatus.enabled === true && lockStatus.fullscreen === true
      updateCheckItem('lock', systemStatus.lock, systemStatus.lock ? 'Fullscreen secure mode active' : 'Fullscreen secure mode required')
    } catch (error) {
      systemStatus.lock = false
      updateCheckItem('lock', false, 'Unable to verify lock state')
    }

    updateProgressSummary()
    updateVerificationPanel()
    updateGlobalExamStatus()

    if (!systemStatus.internet) {
      setSystemAlert('Internet appears offline. Reconnect and run checks again.', 'error')
      return
    }

    if (!systemStatus.camera) {
      setSystemAlert('Camera check failed. Allow camera permission and close apps using the webcam, then recheck.', 'error')
      return
    }

    if (!systemStatus.microphone) {
      setSystemAlert('Microphone check failed. Allow microphone permission and close apps using the mic, then recheck.', 'warning')
      return
    }

    if (!systemStatus.lock) {
      setSystemAlert('Secure fullscreen lock could not be validated. Recheck to continue.', 'warning')
      return
    }

    if (!biometricVerified) {
      setSystemAlert('System checks passed. Complete biometric verification to unlock exam start.', 'info')
      return
    }

    setSystemAlert('All checks passed. You can now start the exam.', 'success')
  } finally {
    systemChecksRunning = false
    setRecheckState(false)
    updateGlobalExamStatus()
  }
}

function updateClock() {
  const clock = document.getElementById('clock')
  if (!clock) return
  clock.textContent = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  })
}

async function initializeLaunchScreen() {
  const role = (localStorage.getItem('currentUserRole') || 'student').toLowerCase()
  if (role === 'admin') {
    await window.electronAPI.navigateTo('dashboard')
    return
  }

  try {
    const systemInfo = await window.electronAPI.getSystemInfo()
    updateDetailValue('systemInfo', `${systemInfo.platform} ${systemInfo.arch}`)
    updateDetailValue('sessionId', systemInfo.sessionToken || '--', '--')
  } catch (error) {
    console.warn('System info unavailable:', error)
  }

  try {
    const examResult = await window.electronAPI.getActiveExam()
    if (examResult.success && examResult.data) {
      const exam = examResult.data
      examScheduled = true
      localStorage.setItem('currentExamId', String(exam.id))
      localStorage.setItem('currentExamName', exam.name || '')
      localStorage.setItem('currentExamCode', exam.code || '')
      localStorage.setItem('currentExamDuration', String(exam.durationMinutes || ''))
      updateDetailValue('examTitle', exam.name)
      updateDetailValue('examCodeInline', exam.code, '--')
      updateDetailValue('examDuration', exam.durationMinutes ? `${exam.durationMinutes} minutes` : null)
      updateDetailValue('examWindow', formatExamWindow(exam.startTime, exam.endTime))
    }
  } catch (error) {
    console.warn('Active exam unavailable:', error)
  }

  const userId = Number(localStorage.getItem('currentUserId'))
  if (userId) {
    try {
      const profileResult = await window.electronAPI.getUserProfile(userId)
      if (profileResult.success && profileResult.data) {
        const profile = profileResult.data
        updateDetailValue('studentName', profile.fullName)
        updateDetailValue('studentId', profile.studentId, '--')
        updateDetailValue('studentCourse', profile.course)
        updateDetailValue('studentBranch', profile.branch)
        updateDetailValue('studentUniversity', profile.university)
        updateDetailValue('studentLocation', profile.location)
      }
    } catch (error) {
      console.warn('User profile unavailable:', error)
    }
  }

  try {
    const dbStatus = await window.electronAPI.getDatabaseStatus()
    updateDetailValue('connectionStatus', dbStatus.connected ? 'Connected' : 'Offline', 'Offline')
  } catch (error) {
    updateDetailValue('connectionStatus', 'Offline', 'Offline')
  }

  updateVerificationPanel()
  updateGlobalExamStatus()
  if (!biometricVerified) {
    setSystemAlert('Step 1 pending: complete biometric verification, then rerun readiness checks.', 'info')
  }
  await runSystemChecks()
  updateClock()
  setInterval(updateClock, 1000)

  const verifyButton = document.querySelector('.btn-verification-start')
  if (verifyButton) {
    verifyButton.addEventListener('click', async (event) => {
      event.preventDefault()
      await window.electronAPI.navigateTo('verification')
    })
  }

  const recheckButton = document.getElementById('recheckButton')
  if (recheckButton) {
    recheckButton.addEventListener('click', async (event) => {
      event.preventDefault()
      await runSystemChecks()
    })
  }

  const startButton = document.getElementById('startExamButton')
  if (startButton) {
    startButton.addEventListener('click', async (event) => {
      event.preventDefault()
      if (!biometricVerified) {
        setSystemAlert('Verification is required before starting the exam. Redirecting now.', 'warning')
        await window.electronAPI.navigateTo('verification')
        return
      }
      await window.electronAPI.navigateTo('exam')
    })
  }
}

document.addEventListener('DOMContentLoaded', initializeLaunchScreen)
window.addEventListener('online', runSystemChecks)
window.addEventListener('offline', runSystemChecks)
window.runSystemChecks = runSystemChecks
