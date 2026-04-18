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
  challenge: document.getElementById('step-challenge'),
  ready:  document.getElementById('step-ready'),
}

let stream       = null
let enrollDone   = false
let challengeDone = false
let allowVerificationBypass = false
let lastFrameWidth = 640
let lastFrameHeight = 480

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

function clearError() {
  verErr.classList.add('hidden')
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function captureFrameDataUrl(quality = 0.85) {
  const canvas = document.getElementById('cameraCanvas')
  canvas.width  = video.videoWidth  || 640
  canvas.height = video.videoHeight || 480
  lastFrameWidth = canvas.width
  lastFrameHeight = canvas.height
  const ctx = canvas.getContext('2d')
  // Mirror to match display (flip horizontally)
  ctx.save()
  ctx.scale(-1, 1)
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height)
  ctx.restore()
  return canvas.toDataURL('image/jpeg', quality)
}

function getPrimaryFace(result) {
  if (!result || Number(result.face_count) !== 1 || !Array.isArray(result.faces) || !result.faces.length) {
    return null
  }
  return result.faces[0]
}

function getFaceCenterXNorm(face) {
  if (!face || !Array.isArray(face.bbox) || face.bbox.length < 4 || !lastFrameWidth) {
    return null
  }
  const [x1, , x2] = face.bbox
  return ((x1 + x2) / 2) / lastFrameWidth
}

async function sampleVerificationFrame() {
  const image = captureFrameDataUrl(0.82)
  return window.electronAPI.verifyFrame({
    image,
    examId: Number(localStorage.getItem('currentExamId') || '0') || undefined,
    sessionId: Number(localStorage.getItem('currentSessionId') || '0') || undefined,
    requireMl: !allowVerificationBypass
  })
}

function recordVerificationIncident(type, message, details = {}, severity = 'medium') {
  window.electronAPI.recordIncident?.({
    type,
    message,
    sessionId: Number(localStorage.getItem('currentSessionId') || '0') || null,
    severity,
    details
  }).catch(() => {})
}

async function waitForStableFace(timeoutMs = 9000) {
  const startedAt = Date.now()
  let best = null

  while ((Date.now() - startedAt) < timeoutMs) {
    const verify = await sampleVerificationFrame().catch(() => null)
    const face = getPrimaryFace(verify)
    if (face && Number(face.confidence || verify?.confidence || 0) >= 0.45) {
      const centerXNorm = getFaceCenterXNorm(face)
      if (centerXNorm !== null) {
        best = { verify, face, centerXNorm }
        break
      }
    }
    await sleep(320)
  }

  if (!best) {
    throw new Error('No stable face detected. Please center your face and improve lighting.')
  }

  return best
}

async function runHeadMovementChallenge(baseCenterXNorm) {
  const startedAt = Date.now()
  let maxShift = 0

  setStepState('challenge', 'active', 'Anti-spoof check: gently move your head left or right')

  while ((Date.now() - startedAt) < 9000) {
    const verify = await sampleVerificationFrame().catch(() => null)
    const face = getPrimaryFace(verify)
    if (!face) {
      await sleep(280)
      continue
    }

    const centerXNorm = getFaceCenterXNorm(face)
    if (centerXNorm === null) {
      await sleep(280)
      continue
    }

    const shift = Math.abs(centerXNorm - baseCenterXNorm)
    if (shift > maxShift) {
      maxShift = shift
    }

    if (maxShift >= 0.1) {
      return {
        passed: true,
        maxShift: Number(maxShift.toFixed(4))
      }
    }

    await sleep(280)
  }

  return {
    passed: false,
    maxShift: Number(maxShift.toFixed(4))
  }
}

async function runLivenessChallenge() {
  const startedAt = Date.now()
  let consecutiveLive = 0
  let peakMotion = 0
  let peakLandmarkShift = 0

  setStepState('challenge', 'active', 'Anti-spoof check: blink naturally and hold still')

  while ((Date.now() - startedAt) < 8500) {
    const verify = await sampleVerificationFrame().catch(() => null)
    const liveness = verify?.liveness || {}
    const motion = Number(liveness.motion_score || 0)
    const landmarkShift = Number(liveness.landmark_shift || 0)

    if (motion > peakMotion) peakMotion = motion
    if (landmarkShift > peakLandmarkShift) peakLandmarkShift = landmarkShift

    if (verify?.face_count === 1 && liveness?.is_live === true) {
      consecutiveLive += 1
    } else {
      consecutiveLive = 0
    }

    if (consecutiveLive >= 2) {
      return {
        passed: true,
        peakMotion: Number(peakMotion.toFixed(4)),
        peakLandmarkShift: Number(peakLandmarkShift.toFixed(4))
      }
    }

    await sleep(280)
  }

  return {
    passed: false,
    peakMotion: Number(peakMotion.toFixed(4)),
    peakLandmarkShift: Number(peakLandmarkShift.toFixed(4))
  }
}

async function runActiveChallenge(baseCenterXNorm) {
  const head = await runHeadMovementChallenge(baseCenterXNorm)
  if (!head.passed) {
    throw new Error('Head movement challenge failed. Please move your head left or right when prompted.')
  }

  const live = await runLivenessChallenge()
  if (!live.passed) {
    throw new Error('Liveness challenge failed. Please blink naturally and retry verification.')
  }

  return {
    head,
    live
  }
}

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
  clearError()
  setStepState('detect', 'active', 'Detecting face...')

  try {
    const userId = Number(localStorage.getItem('userId') || '0')
    const stable = await waitForStableFace()
    const frameDataUrl = captureFrameDataUrl(0.85)
    setStepState('detect', 'done', 'Face detected and aligned')

    setStepState('enroll', 'active', 'Capturing biometric reference...')

    const result = await window.electronAPI.enrollIdentity({
      userId:  userId > 0 ? userId : undefined,
      image:   frameDataUrl,
      examId: Number(localStorage.getItem('currentExamId') || '0') || undefined,
      sessionId: Number(localStorage.getItem('currentSessionId') || '0') || undefined,
      requireMl: !allowVerificationBypass
    })

    if (result?.success) {
      setStepState('enroll', 'done', 'Biometric reference captured')

      if (allowVerificationBypass) {
        setStepState('challenge', 'done', 'Challenge skipped in local development mode')
      } else {
        const challengeResult = await runActiveChallenge(stable.centerXNorm)
        challengeDone = true
        setStepState('challenge', 'done', `Liveness confirmed (movement ${challengeResult.head.maxShift}, motion ${challengeResult.live.peakMotion})`)
      }

      setStepState('ready',  'done', 'Identity verified — ready to start')
      cameraStatus.className   = 'camera-status ok'
      cameraStatus.textContent = '✓ Identity and liveness verified — click "Start Exam" when ready'
      enrollDone   = true
      proceedBtn.disabled = false
    } else {
      throw new Error(result?.error || 'Verification returned no match')
    }

  } catch (err) {
    console.warn('[verification] enrollIdentity failed:', err.message)
    if (allowVerificationBypass) {
      // Local bypass is enabled only when verification enforcement is intentionally relaxed.
      setStepState('detect', 'done', 'Detection bypassed in local development')
      await sleep(300)
      setStepState('enroll', 'done', 'Enrollment bypassed')
      await sleep(300)
      setStepState('challenge', 'done', 'Challenge skipped in local development mode')
      challengeDone = true
      setStepState('ready',  'done', 'Ready (unverified session)')
      cameraStatus.className   = 'camera-status info'
      cameraStatus.textContent = '⚠ Verification bypass enabled in local development — proceeding without face verification'
      enrollDone   = true
      proceedBtn.disabled = false
    } else {
      setStepState('challenge', 'failed', 'Anti-spoof challenge not completed')
      setStepState('enroll', 'failed', 'Identity verification service unavailable')
      setStepState('ready',  'failed', 'Cannot continue without verification')
      cameraStatus.className   = 'camera-status fail'
      cameraStatus.textContent = '✗ Identity verification failed — contact invigilator'
      showError('Identity verification is required for this exam. Please contact the invigilator.')
      recordVerificationIncident(
        'verification-challenge-failed',
        'Identity verification challenge failed before exam start.',
        {
          error: String(err?.message || err || 'unknown_error'),
          allowBypass: false,
          examId: Number(localStorage.getItem('currentExamId') || '0') || null
        },
        'high'
      )
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
  if (!allowVerificationBypass && (!enrollDone || !challengeDone)) {
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
