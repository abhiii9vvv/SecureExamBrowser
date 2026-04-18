import { navigateTo, showToast } from './router.js'

const video        = document.getElementById('cameraVideo')
const overlay      = document.getElementById('cameraOverlay')
const cameraStatus = document.getElementById('cameraStatus')
const proceedBtn   = document.getElementById('proceedBtn')
const skipBtn      = document.getElementById('skipBtn')
const verErr       = document.getElementById('verError')
const verErrMsg    = document.getElementById('verErrorMsg')

const steps = {
  camera: document.getElementById('step-camera'),
  detect: document.getElementById('step-detect'),
  enroll: document.getElementById('step-enroll'),
  ready:  document.getElementById('step-ready'),
}

let stream       = null
let enrollDone   = false
let allowVerificationBypass = false

async function initVerificationPolicy() {
  try {
    const result = await window.electronAPI.getEnvironmentFlags()
    const flags = result?.data ?? result ?? {}
    allowVerificationBypass = Boolean(flags.isLocalDevelopment || !flags.isPackaged)
  } catch {
    allowVerificationBypass = false
  }

  if (!allowVerificationBypass) {
    skipBtn.style.display = 'none'
    skipBtn.setAttribute('aria-hidden', 'true')
  }
}

/* ── Step state helper ── */
function setStepState(key, state, detail) {
  const el = steps[key]
  if (!el) return
  el.className = `ver-step ${state}`
  if (detail) el.querySelector('.ver-step-detail').textContent = detail

  const numEl = el.querySelector('.ver-step-num')
  if (!numEl) return

  if (state === 'active') {
    numEl.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>`
  } else if (state === 'done') {
    numEl.innerHTML = svgCheck()
  } else if (state === 'failed') {
    numEl.innerHTML = svgX()
  } else {
    // Restore step number
    const idx = Object.keys(steps).indexOf(key) + 1
    numEl.textContent = String(idx)
  }
}

function svgCheck() {
  return `<svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>`
}

function svgX() {
  return `<svg viewBox="0 0 20 20" fill="currentColor" style="width:12px;height:12px"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/></svg>`
}

function showError(msg) {
  verErrMsg.textContent = msg
  verErr.classList.remove('hidden')
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/* ── Camera startup ── */
async function startCamera() {
  setStepState('camera', 'active', 'Requesting camera access...')

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false
    })

    video.srcObject = stream
    await video.play()

    overlay.classList.add('hidden')
    setStepState('camera', 'done', 'Camera active')
    cameraStatus.className   = 'camera-status ok'
    cameraStatus.textContent = 'Camera active — please center your face and look straight ahead'

    // Brief pause so user can position face
    await sleep(1200)
    runEnroll()

  } catch (err) {
    overlay.querySelector('span').textContent = 'Camera unavailable'
    setStepState('camera', 'failed', err.message || 'Permission denied')
    cameraStatus.className   = 'camera-status fail'
    if (allowVerificationBypass) {
      cameraStatus.textContent = '✗ Camera access denied — click "Skip" to continue without verification'
      showError('Camera access required for proctoring. Allow camera permission and reload, or click Skip.')
      proceedBtn.disabled = false
      proceedBtn.textContent = 'Continue Without Camera'
    } else {
      cameraStatus.textContent = '✗ Camera access denied — verification is required to start the exam'
      showError('Camera access is required for this exam. Allow camera permission and reload.')
      proceedBtn.disabled = true
    }
  }
}

/* ── Capture frame + enroll ── */
async function runEnroll() {
  setStepState('detect', 'active', 'Detecting face...')

  await sleep(800)

  // Capture frame from video
  const canvas = document.getElementById('cameraCanvas')
  canvas.width  = video.videoWidth  || 640
  canvas.height = video.videoHeight || 480
  const ctx = canvas.getContext('2d')
  // Mirror to match display (flip horizontally)
  ctx.save()
  ctx.scale(-1, 1)
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height)
  ctx.restore()

  const frameDataUrl = canvas.toDataURL('image/jpeg', 0.85)

  try {
    const userId = Number(localStorage.getItem('userId') || '0')

    const result = await window.electronAPI.enrollIdentity({
      userId:  userId > 0 ? userId : undefined,
      image:   frameDataUrl,
      examId: Number(localStorage.getItem('currentExamId') || '0') || undefined,
      sessionId: Number(localStorage.getItem('currentSessionId') || '0') || undefined,
      requireMl: !allowVerificationBypass
    })

    if (result?.success) {
      setStepState('detect', 'done', 'Face detected and aligned')
      await sleep(400)
      setStepState('enroll', 'done', 'Biometric reference captured')
      await sleep(400)
      setStepState('ready',  'done', 'Identity verified — ready to start')
      cameraStatus.className   = 'camera-status ok'
      cameraStatus.textContent = '✓ Identity verified — click "Start Exam" when ready'
      enrollDone   = true
      proceedBtn.disabled = false
    } else {
      throw new Error(result?.error || 'Verification returned no match')
    }

  } catch (err) {
    console.warn('[verification] enrollIdentity failed:', err.message)
    if (allowVerificationBypass) {
      // Vision ML may be unavailable in local development — let the student through.
      setStepState('detect', 'done', 'Detection skipped (vision ML unavailable)')
      await sleep(300)
      setStepState('enroll', 'done', 'Enrollment skipped')
      await sleep(300)
      setStepState('ready',  'done', 'Ready (unverified session)')
      cameraStatus.className   = 'camera-status info'
      cameraStatus.textContent = '⚠ Vision ML unavailable — proceeding without face verification'
      enrollDone   = true
      proceedBtn.disabled = false
    } else {
      setStepState('enroll', 'failed', 'Identity verification service unavailable')
      setStepState('ready',  'failed', 'Cannot continue without verification')
      cameraStatus.className   = 'camera-status fail'
      cameraStatus.textContent = '✗ Identity verification failed — contact invigilator'
      showError('Identity verification is required for this exam. Please contact the invigilator.')
      enrollDone = false
      proceedBtn.disabled = true
    }
  }
}

/* ── Cleanup ── */
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop())
    stream = null
  }
}

/* ── Event handlers ── */
proceedBtn.addEventListener('click', async () => {
  if (!allowVerificationBypass && !enrollDone) {
    showError('Complete identity verification before starting the exam.')
    return
  }
  stopCamera()
  await navigateTo('exam')
})

skipBtn.addEventListener('click', async () => {
  if (!allowVerificationBypass) {
    showError('Verification bypass is disabled for this exam.')
    return
  }
  stopCamera()
  await navigateTo('exam')
})

window.addEventListener('beforeunload', stopCamera)

/* ── Boot ── */
;(async () => {
  await initVerificationPolicy()
  await startCamera()
})()
