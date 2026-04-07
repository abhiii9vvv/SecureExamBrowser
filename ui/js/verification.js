let cameraStream = null
let verificationInterval = null
let verificationComplete = false
let verificationLocked = false
let cameraVideo = null
let enrollingIdentity = false
let verificationStartedAt = 0

const VERIFICATION_TIMEOUT_MS = 2 * 60 * 1000

function setStepState(index, state, label) {
  const cards = document.querySelectorAll('[data-step-card]')
  const card = cards[index]
  if (!card) return
  card.classList.remove('completed', 'active', 'pending')
  card.classList.add(state)
  const icon = card.querySelector('.material-symbols-outlined')
  const status = card.querySelector('[data-step-status]')
  if (icon) {
    icon.textContent = state === 'completed' ? 'check' : state === 'active' ? 'sync' : 'hourglass_empty'
  }
  if (status) {
    status.textContent = label
  }
}

function updateProgress(percent) {
  const bar = document.querySelector('[data-progress-bar]')
  if (bar) {
    bar.style.width = `${percent}%`
  }
  const stepText = document.querySelector('[data-step-text]')
  if (stepText) {
    const step = percent >= 100 ? 4 : percent >= 66 ? 3 : percent >= 33 ? 2 : 1
    stepText.textContent = `Step ${step} of 4`
  }
}

function setMetrics(result) {
  const confidenceValue = document.getElementById('confidenceValue')
  const faceStatusValue = document.getElementById('faceStatusValue')
  const faceScore = document.getElementById('faceScore')
  const livenessScore = document.getElementById('livenessScore')
  const identityScore = document.getElementById('identityScore')
  const lightLevelValue = document.getElementById('lightLevelValue')

  const confidence = result.faces && result.faces[0] ? Math.round(result.faces[0].confidence * 100) : 0
  if (confidenceValue) confidenceValue.textContent = `${confidence}%`
  if (faceStatusValue) faceStatusValue.textContent = result.face_count === 1 ? 'Detected' : result.face_count > 1 ? 'Multiple Faces' : 'Searching'
  if (faceScore) faceScore.textContent = `${confidence}%`
  if (livenessScore) {
    livenessScore.textContent = `Motion: ${Math.round((result.liveness?.motion_score || 0) * 100)}% | Eyes: ${result.liveness?.eyes_detected || 0}`
  }
  if (identityScore) {
    identityScore.textContent = `${Math.round((result.identity_match?.score || 0) * 100)}%`
  }
  if (lightLevelValue) {
    lightLevelValue.textContent = confidence >= 70 ? 'Optimal' : confidence >= 40 ? 'Normal' : 'Low'
  }
}

function drawOverlay(result) {
  const overlay = document.getElementById('faceOverlay')
  if (!overlay || !cameraVideo) return
  const context = overlay.getContext('2d')
  overlay.width = cameraVideo.videoWidth || overlay.clientWidth
  overlay.height = cameraVideo.videoHeight || overlay.clientHeight
  context.clearRect(0, 0, overlay.width, overlay.height)

  if (!result.faces || result.faces.length === 0) return
  const face = result.faces[0]
  const [x1, y1, x2, y2] = face.bbox
  const scaleX = overlay.width / (cameraVideo.videoWidth || overlay.width)
  const scaleY = overlay.height / (cameraVideo.videoHeight || overlay.height)

  context.strokeStyle = '#16a34a'
  context.lineWidth = 3
  context.strokeRect(x1 * scaleX, y1 * scaleY, (x2 - x1) * scaleX, (y2 - y1) * scaleY)
}

function setWarning(message, level = 'warning') {
  const container = document.getElementById('warningContainer')
  if (!container) return
  if (!message) {
    container.innerHTML = ''
    container.classList.add('is-hidden')
    return
  }
  container.classList.remove('is-hidden')
  container.innerHTML = `<div class="warning-item warning-${level}">${message}</div>`
}

function setRetryVisibility(visible) {
  const retryButton = document.querySelector('[data-retry-verification]')
  if (!retryButton) return
  retryButton.classList.toggle('d-none', !visible)
}

function cameraErrorReason(error) {
  if (!error || !error.name) {
    return 'Camera access failed. Check permissions and try again.'
  }
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return 'Camera permission denied. Allow access in system settings and retry.'
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return 'No camera device was detected. Connect a camera and retry.'
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
    return 'Camera is busy in another application. Close it and retry.'
  }
  return 'Unable to initialize camera. Retry setup or return to launch.'
}

function unlockReadyButton() {
  const button = document.querySelector('[data-ready-button]')
  if (button) {
    button.disabled = false
    button.classList.add('ready-glow')
  }
}

async function startCamera() {
  cameraVideo = document.getElementById('videoElement')
  const placeholder = document.getElementById('cameraPlaceholder')
  if (!cameraVideo) throw new Error('Video element not found')

  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  })

  cameraVideo.srcObject = cameraStream
  await cameraVideo.play()
  cameraVideo.classList.remove('is-hidden')
  if (placeholder) placeholder.style.display = 'none'
}

function captureFrame() {
  const canvas = document.createElement('canvas')
  canvas.width = cameraVideo.videoWidth || 1280
  canvas.height = cameraVideo.videoHeight || 720
  const context = canvas.getContext('2d')
  context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

async function syncModels() {
  try {
    const result = await window.electronAPI.syncOpenSourceModels({ force: false })
    if (!result.success) {
      setWarning(`Model sync completed with ${result.failed} failed download(s).`, 'warning')
    }
  } catch (error) {
    setWarning(`Model sync failed: ${error.message}`, 'warning')
  }
}

async function runVerificationLoop() {
  if (verificationInterval) {
    clearInterval(verificationInterval)
  }

  verificationInterval = setInterval(async () => {
    if (verificationLocked || !cameraStream || verificationComplete) {
      return
    }

    if (Date.now() - verificationStartedAt > VERIFICATION_TIMEOUT_MS) {
      verificationLocked = true
      clearInterval(verificationInterval)
      setWarning('Verification timed out after 2 minutes. Retry camera setup and try again.', 'error')
      setRetryVisibility(true)
      return
    }

    try {
      const image = captureFrame()
      const result = await window.electronAPI.verifyFrame({ image })
      setMetrics(result)
      drawOverlay(result)

      if (result.face_count === 0) {
        setWarning('No face detected. Please center your face in the frame.', 'warning')
      } else if (result.face_count > 1) {
        setWarning('Multiple faces detected. Only one candidate is allowed.', 'error')
      } else if (!result.liveness?.is_live) {
        setWarning('Liveness check in progress. Move slightly and keep looking at the camera.', 'warning')
      } else if (result.has_reference && !result.identity_match?.match) {
        setWarning('Identity mismatch detected. Keep your face centered.', 'error')
      } else {
        setWarning('')
      }

      setStepState(0, result.face_count === 1 ? 'completed' : 'active', result.face_count === 1 ? 'Face detected' : 'Searching...')
      setStepState(1, result.has_reference ? 'completed' : result.face_count === 1 ? 'active' : 'pending', result.has_reference ? 'Identity enrolled' : 'Preparing reference...')
      setStepState(2, result.liveness?.is_live ? 'completed' : result.face_count === 1 ? 'active' : 'pending', result.liveness?.is_live ? 'Movement confirmed' : 'Waiting for movement...')
      setStepState(3, verificationComplete ? 'completed' : 'pending', verificationComplete ? 'Approved' : 'Pending')

      let progress = 0
      if (result.face_count === 1) progress += 35
      if (result.has_reference) progress += 25
      if (result.liveness?.is_live) progress += 25
      if (result.has_reference && result.identity_match?.match) progress += 15
      updateProgress(progress)

      if (result.face_count === 1 && !result.has_reference && !enrollingIdentity) {
        enrollingIdentity = true
        try {
          await window.electronAPI.enrollIdentity({ image })
        } finally {
          enrollingIdentity = false
        }
      }

      if (result.face_count === 1 && result.has_reference && result.identity_match?.match && result.liveness?.is_live) {
        verificationComplete = true
        updateProgress(100)
        setStepState(3, 'completed', 'Approved')
        localStorage.setItem('verificationComplete', 'true')
        const userId = Number(localStorage.getItem('currentUserId'))
        if (userId) {
          await window.electronAPI.saveBiometricData(userId, 'face', {
            capturedAt: new Date().toISOString(),
            verification: result
          })
        }
        unlockReadyButton()
        setRetryVisibility(false)
      }
    } catch (error) {
      console.warn('Verification loop failed:', error)
      setWarning(error.message || 'Verification failed.', 'error')
    }
  }, 900)
}

async function initializeVerification() {
  try {
    verificationLocked = false
    verificationComplete = false
    verificationStartedAt = Date.now()
    localStorage.removeItem('verificationComplete')
    setRetryVisibility(false)
    await syncModels()
    await startCamera()
    await runVerificationLoop()
  } catch (error) {
    verificationLocked = true
    setWarning(cameraErrorReason(error), 'error')
    setRetryVisibility(true)
  }
}

function cleanup() {
  if (verificationInterval) {
    clearInterval(verificationInterval)
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop())
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const cancelButton = document.querySelector('[data-cancel-button]')
  if (cancelButton) {
    cancelButton.addEventListener('click', async () => {
      cleanup()
      await window.electronAPI.navigateTo('launch')
    })
  }

  const readyButton = document.querySelector('[data-ready-button]')
  if (readyButton) {
    readyButton.disabled = true
    readyButton.addEventListener('click', async () => {
      if (!verificationComplete) return
      cleanup()
      await window.electronAPI.navigateTo('exam')
    })
  }

  const retryButton = document.querySelector('[data-retry-verification]')
  if (retryButton) {
    retryButton.addEventListener('click', async () => {
      cleanup()
      await initializeVerification()
    })
  }

  initializeVerification()
})

window.addEventListener('beforeunload', cleanup)
