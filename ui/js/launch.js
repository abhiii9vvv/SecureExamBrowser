import { navigateTo } from './router.js'

const proceedBtn   = document.getElementById('proceedBtn')
const backBtn      = document.getElementById('backBtn')
const launchErr    = document.getElementById('launchError')
const launchErrMsg = document.getElementById('launchErrorMsg')
const consentCheckbox = document.getElementById('consentCheckbox')
const consentStatus = document.getElementById('consentStatus')
const consentVersion = document.getElementById('consentVersion')
const consentSummary = document.getElementById('consentSummary')
const accommodationInputs = [
  document.getElementById('accReducedMotion'),
  document.getElementById('accHighContrast'),
  document.getElementById('accExtendedWarnings')
].filter(Boolean)
const ACCOMMODATION_STORAGE_KEY = 'examAccommodations'

/* ── Exam info ─────────────────────────────────── */
document.getElementById('examInfoTitle').textContent    = localStorage.getItem('currentExamTitle') || 'Examination'
document.getElementById('examInfoDuration').textContent = `${localStorage.getItem('currentExamDuration') || '120'} min`

async function loadExamDetails() {
  try {
    const result = await window.electronAPI.getActiveExam()
    const exam   = result?.success ? result.data : null
    if (exam) {
      document.getElementById('examInfoPass').textContent = exam.passingScore ? `${exam.passingScore}%` : '—'
      document.getElementById('examInfoQs').textContent   = exam.totalQuestions ?? '—'
    }
  } catch { /* non-critical */ }
}

/* ── System checks ─────────────────────────────── */
const checks = {
  display:  { el: document.getElementById('chk-display'),  pass: false },
  runtime:  { el: document.getElementById('chk-runtime'),  pass: false },
  database: { el: document.getElementById('chk-database'), pass: false },
  camera:   { el: document.getElementById('chk-camera'),   pass: false },
  microphone: { el: document.getElementById('chk-microphone'), pass: false },
  network:  { el: document.getElementById('chk-network'),  pass: false },
}

let failCount = 0
let allowVerificationBypass = false
const consentState = {
  policy: null,
  acceptedCurrentVersion: false,
  loaded: false,
  saving: false
}

async function initVerificationPolicy() {
  try {
    const [flagsResult, runtimeResult] = await Promise.all([
      window.electronAPI.getEnvironmentFlags(),
      window.electronAPI.getRuntimeCapabilities().catch(() => null)
    ])
    const flags = flagsResult?.data ?? flagsResult ?? {}
    const runtime = runtimeResult?.data ?? runtimeResult ?? {}
    const visionReady = Boolean(flags.visionReady ?? runtime?.python?.visionReady)
    const localDev = Boolean(flags.isLocalDevelopment || !flags.isPackaged)
    allowVerificationBypass = Boolean(flags.allowVerificationBypass ?? (localDev && !visionReady))
  } catch {
    allowVerificationBypass = false
  }
}

/* ── Helpers ── */
function markPass(key, detail) {
  const c = checks[key]; c.pass = true
  c.el.className = 'check-item pass'
  c.el.querySelector('.check-icon').className = 'check-icon pass'
  c.el.querySelector('.check-icon').innerHTML = svgCheck()
  c.el.querySelector('.check-detail').textContent = detail
}

function markFail(key, detail) {
  const c = checks[key]; c.pass = false
  c.el.className = 'check-item fail'
  c.el.querySelector('.check-icon').className = 'check-icon fail'
  c.el.querySelector('.check-icon').innerHTML = svgX()
  c.el.querySelector('.check-detail').textContent = detail
  failCount++
}

function startCheck(key) {
  const c = checks[key]
  c.el.className = 'check-item running'
  c.el.querySelector('.check-icon').className = 'check-icon running'
  c.el.querySelector('.check-icon').innerHTML = `<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>`
  c.el.querySelector('.check-detail').textContent = 'Checking...'
}

function svgCheck() {
  return `<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>`
}

function svgX() {
  return `<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/></svg>`
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function setConsentStatus(message, tone = '') {
  consentStatus.textContent = message
  consentStatus.className = `consent-status${tone ? ` ${tone}` : ''}`
}

function renderConsentSummary(policy) {
  consentSummary.innerHTML = ''
  const items = Array.isArray(policy?.summary) ? policy.summary : []
  if (!items.length) {
    const li = document.createElement('li')
    li.textContent = 'Consent is required before exam verification can begin.'
    consentSummary.appendChild(li)
    return
  }

  items.forEach((line) => {
    const li = document.createElement('li')
    li.textContent = line
    consentSummary.appendChild(li)
  })
}

function allChecksPassed() {
  return Object.values(checks).every(c => c.pass)
}

function updateProceedEligibility() {
  const ready = allChecksPassed() && consentState.acceptedCurrentVersion
  proceedBtn.disabled = !ready
}

function loadAccommodationSelection() {
  let selected = []
  try {
    const raw = localStorage.getItem(ACCOMMODATION_STORAGE_KEY)
    const parsed = JSON.parse(raw || '[]')
    if (Array.isArray(parsed)) {
      selected = parsed.map((item) => String(item || '').trim()).filter(Boolean)
    }
  } catch {
    selected = []
  }

  const selectedSet = new Set(selected)
  accommodationInputs.forEach((input) => {
    input.checked = selectedSet.has(String(input.value || '').trim())
  })
}

function persistAccommodationSelection() {
  const selected = accommodationInputs
    .filter((input) => input.checked)
    .map((input) => String(input.value || '').trim())
    .filter(Boolean)
  localStorage.setItem(ACCOMMODATION_STORAGE_KEY, JSON.stringify(selected))
}

async function initializePrivacyConsent() {
  consentCheckbox.disabled = true
  setConsentStatus('Loading consent policy...')

  try {
    const [policyResp, statusResp] = await Promise.all([
      window.electronAPI.getPrivacyPolicy(),
      window.electronAPI.getPrivacyConsentStatus()
    ])

    const policy = policyResp?.data || null
    const status = statusResp?.data || null
    consentState.policy = policy
    consentState.loaded = Boolean(policy)
    consentState.acceptedCurrentVersion = Boolean(status?.acceptedCurrentVersion)

    consentVersion.textContent = `Policy v${policy?.version || 'unknown'}`
    renderConsentSummary(policy)
    consentCheckbox.checked = consentState.acceptedCurrentVersion
    consentCheckbox.disabled = false

    if (consentState.acceptedCurrentVersion) {
      setConsentStatus('Consent already recorded for this policy version.', 'ok')
    } else {
      setConsentStatus('Accept the policy to unlock verification.', '')
    }
  } catch (error) {
    consentState.policy = null
    consentState.loaded = false
    consentState.acceptedCurrentVersion = false
    consentVersion.textContent = 'Policy unavailable'
    renderConsentSummary(null)
    setConsentStatus(`Could not load privacy policy: ${error?.message || error}`, 'error')
  }

  updateProceedEligibility()
}

async function savePrivacyConsent() {
  if (!consentState.loaded || consentState.saving) {
    return false
  }

  if (!consentCheckbox.checked) {
    consentState.acceptedCurrentVersion = false
    setConsentStatus('Please check the consent box to continue.', 'error')
    updateProceedEligibility()
    return false
  }

  if (consentState.acceptedCurrentVersion) {
    updateProceedEligibility()
    return true
  }

  consentState.saving = true
  consentCheckbox.disabled = true
  setConsentStatus('Saving consent...')

  try {
    await window.electronAPI.savePrivacyConsent({
      accepted: true,
      machineInfo: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language
      }
    })
    consentState.acceptedCurrentVersion = true
    setConsentStatus('Consent recorded. You can now proceed.', 'ok')
    return true
  } catch (error) {
    consentState.acceptedCurrentVersion = false
    setConsentStatus(`Failed to save consent: ${error?.message || error}`, 'error')
    return false
  } finally {
    consentState.saving = false
    consentCheckbox.disabled = false
    updateProceedEligibility()
  }
}

/* ── Check runner ── */
async function runChecks() {
  failCount = 0
  updateProceedEligibility()

  const selectedExamId = Number(localStorage.getItem('currentExamId') || '0')
  if (!selectedExamId) {
    launchErr.classList.remove('hidden')
    launchErrMsg.textContent = 'No active exam selected. Return to dashboard and start from an available exam.'
    return
  }

  /* 1 ── Display resolution */
  await sleep(200)
  const { width, height } = window.screen
  if (width >= 1024 && height >= 600) {
    markPass('display', `${width}×${height} — OK`)
  } else {
    markFail('display', `${width}×${height} — minimum 1024×600 required`)
  }

  /* 2 ── Runtime capabilities */
  startCheck('runtime')
  await sleep(300)
  try {
    // preload: getRuntimeCapabilities() → ipcRenderer.invoke('get-runtime-capabilities')
    // script.js returns: { success: true, data: runtimeCapabilities }
    // runtimeCapabilities = { node, python, cpp, ... }
    const r = await window.electronAPI.getRuntimeCapabilities()
    const caps = r?.data ?? r ?? {}

    const nodeOk   = caps?.node?.available   !== false
    const pythonOk = caps?.python?.available === true

    if (nodeOk) {
      const extra = pythonOk ? ` · Python ${caps.python.version || ''}` : ' · No Python'
      markPass('runtime', `Node.js OK${extra}`)
    } else {
      markFail('runtime', 'Node.js runtime unavailable')
    }
  } catch (err) {
    // Non-fatal — show as warning, don't block
    markPass('runtime', `Runtime check skipped (${err.message})`)
  }

  /* 3 ── Database */
  startCheck('database')
  await sleep(400)
  try {
    // getDatabaseStatus → preload calls ipcRenderer.invoke('get-database-status') (no auth required)
    // Returns raw DB data: could be { connected: true } or truthy object
    const db = await window.electronAPI.getDatabaseStatus()
    const dbData = (db && typeof db === 'object' && db.data && typeof db.data === 'object') ? db.data : db
    if (dbData && dbData.error) {
      markFail('database', String(dbData.error).slice(0, 60))
    } else if (dbData && dbData.connected === true) {
      markPass('database', 'Database connected')
    } else {
      markFail('database', 'Database unreachable or not ready')
    }
  } catch (err) {
    markFail('database', `DB error: ${String(err.message || err).slice(0, 50)}`)
  }

  /* 4 ── Camera */
  startCheck('camera')
  await sleep(200)
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    s.getTracks().forEach(t => t.stop())
    markPass('camera', 'Camera accessible')
  } catch (err) {
    const reason = err?.message || 'permission denied'
    if (allowVerificationBypass) {
      markPass('camera', `Camera unavailable — verification can be bypassed (${reason})`)
      checks.camera.pass = true
    } else {
      markFail('camera', `Camera required for verification (${reason})`)
    }
  }

  /* 5 ── Microphone */
  startCheck('microphone')
  await sleep(200)
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      }
    })
    s.getTracks().forEach(t => t.stop())
    markPass('microphone', 'Microphone accessible')
  } catch (err) {
    const reason = err?.message || 'permission denied'
    if (allowVerificationBypass) {
      markPass('microphone', `Microphone unavailable — local bypass enabled (${reason})`)
      checks.microphone.pass = true
    } else {
      markFail('microphone', `Microphone required for audio proctoring (${reason})`)
    }
  }

  /* 6 ── Network */
  startCheck('network')
  await sleep(200)
  markPass('network', navigator.onLine ? 'Online' : 'Offline (local exam mode)')

  /* ── Evaluate ── */
  const allPassed = allChecksPassed()
  if (allPassed) {
    updateProceedEligibility()
    launchErr.classList.add('hidden')
  } else {
    proceedBtn.disabled = true
    launchErr.classList.remove('hidden')
    launchErrMsg.textContent = `${failCount} check(s) failed. Resolve issues before continuing.`
  }
}

/* ── Event handlers ── */
proceedBtn.addEventListener('click', async () => {
  const consentSaved = await savePrivacyConsent()
  if (!consentSaved) {
    return
  }
  persistAccommodationSelection()
  await navigateTo('verification')
})

consentCheckbox.addEventListener('change', async () => {
  if (!consentCheckbox.checked) {
    consentState.acceptedCurrentVersion = false
    setConsentStatus('Please check the consent box to continue.', 'error')
    updateProceedEligibility()
    return
  }
  await savePrivacyConsent()
})

backBtn.addEventListener('click', async () => {
  await navigateTo('student-dashboard')
})

accommodationInputs.forEach((input) => {
  input.addEventListener('change', () => {
    persistAccommodationSelection()
  })
})

/* ── Boot ── */
;(async () => {
  loadAccommodationSelection()
  await initVerificationPolicy()
  await initializePrivacyConsent()
  await loadExamDetails()
  await runChecks()
})()
