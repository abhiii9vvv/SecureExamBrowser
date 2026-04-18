import { navigateTo, showToast, showConfirm } from './router.js'

/* ===================== STATE ===================== */
let questions         = []
let currentIndex      = 0
let sessionId         = Number(localStorage.getItem('currentSessionId') || '0')
let examId            = Number(localStorage.getItem('currentExamId') || '0')
let examDuration      = Number(localStorage.getItem('currentExamDuration') || '120') * 60
let timeRemaining     = examDuration
let answers           = {}
let flagged           = []
let editor            = null
let timerHandle       = null
let autosaveHandle    = null
let isDirty           = false
let isSubmitting      = false
let suppressChange    = false
let activeSectionType = 'mcq'
const sectionLastVisited = { mcq: 0, coding: 0 }
let plainEditorLines   = null
let proctorStream      = null
let proctorAudioStream = null
let audioContext       = null
let audioAnalyser      = null
let audioDataBuffer    = null
let audioMonitorHandle = null
let audioNoiseFloor    = null
let audioSpeechStreak  = 0
let lastAudioIncidentAt = 0
let audioPolicy = {
  mode: 'heuristic-fallback',
  audioModelAvailable: false,
  keywordModelAvailable: false,
  speechAlertWindowMs: 6000,
  speechCooldownMs: 45000,
  minConsecutiveSpeechFrames: 12,
  sampleIntervalMs: 500
}
const proctorState = {
  cameraAvailable: false,
  micAvailable: false,
  speaking: false
}
const riskSignalState = {
  visibilityBreaches: 0,
  speechBursts: 0,
  cameraDrops: 0,
  micDrops: 0,
  lastRiskScore: 0
}
const incidentThrottleMs = {
  'tab-switch': 30000,
  'voice-activity': 45000,
  'camera-unavailable': 90000,
  'microphone-unavailable': 90000
}
const lastIncidentByKey = new Map()
let visibilityHiddenAt = null
const INCIDENT_QUEUE_STORAGE_KEY = `sebIncidentQueue:v1:${localStorage.getItem('userId') || 'anon'}`
const ACCOMMODATION_STORAGE_KEY = 'examAccommodations'
const INCIDENT_QUEUE_MAX_ITEMS = 200
const INCIDENT_QUEUE_FLUSH_BATCH = 20
let incidentQueueFlushHandle = null
let incidentQueueFlushInFlight = false
let incidentEscalationResetHandle = null
let livenessRecheckTimeoutHandle = null
let livenessBusy = false
let lastLivenessStatus = 'Pending'
let lastSyncStateText = 'Loading...'
let lastSavedAt = 0
const selectedAccommodations = new Set()
const codingIntegrityState = {
  pasteEvents: [],
  typingEvents: [],
  recentSnapshots: [],
  lastLength: 0,
  lastTimestamp: 0
}
const incidentEscalationState = new Map()
const fairnessProfile = {
  cameraTier: 'unknown',
  lightingTier: 'unknown',
  speechEnv: 'unknown',
  accommodationFlags: []
}

/* ===================== DOM REFS ===================== */
const progressLabel    = document.getElementById('progressLabel')
const progressBar      = document.getElementById('progressBar')
const examBody         = document.querySelector('.exam-body')
const timerDisplay     = document.getElementById('timerDisplay')
const timerWrap        = document.getElementById('timerWrap')
const syncStatus       = document.getElementById('syncStatus')
const liveBanner       = document.getElementById('liveBanner')
const qBadge           = document.getElementById('qBadge')
const qTitle           = document.getElementById('questionTitle')
const qMeta            = document.getElementById('questionMeta')
const qBody            = document.getElementById('questionBody')
const mcqInfo          = document.getElementById('mcqInfo')
const codingPanel      = document.getElementById('codingPanel')
const outputEl         = document.getElementById('codeOutput')
const outputBadge      = document.getElementById('outputBadge')
const palette          = document.getElementById('questionPalette')
const flagBtn          = document.getElementById('btnFlagQuestion')
const prevBtn          = document.getElementById('btnPrev')
const nextBtn          = document.getElementById('btnNext')
const submitExamBtn    = document.getElementById('submitExamBtn')
const submitModal      = document.getElementById('submitModal')
const instructModal    = document.getElementById('instructionsModal')
const violationOverlay = document.getElementById('violationOverlay')
const violationMsg     = document.getElementById('violationMsg')
const sectionMcqCount  = document.getElementById('sectionMcqCount')
const sectionCodingCount = document.getElementById('sectionCodingCount')
const sectionTabMcq    = document.getElementById('sectionTabMcq')
const sectionTabCoding = document.getElementById('sectionTabCoding')
const proctorPip       = document.getElementById('proctorPip')
const proctorVideo     = document.getElementById('proctorVideo')
const proctorPipLabel  = document.getElementById('proctorPipLabel')
const healthToggleBtn  = document.getElementById('healthToggleBtn')
const examHealthPanel  = document.getElementById('examHealthPanel')
const healthCamera     = document.getElementById('healthCamera')
const healthMic        = document.getElementById('healthMic')
const healthNetwork    = document.getElementById('healthNetwork')
const healthQueue      = document.getElementById('healthQueue')
const healthLastSave   = document.getElementById('healthLastSave')
const healthLiveness   = document.getElementById('healthLiveness')
const submitLastSaved  = document.getElementById('submitLastSaved')
const submitQueueDepth = document.getElementById('submitQueueDepth')
const submitSyncState  = document.getElementById('submitSyncState')
const forceSyncNowBtn  = document.getElementById('forceSyncNow')

const SECTION_LABELS = { mcq: 'MCQ', coding: 'Coding' }
const LANGUAGE_LABELS = { javascript: 'JavaScript', python: 'Python', cpp: 'C++' }

/* ===================== UTILS ===================== */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function formatTime(s) {
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

function getCurrentQ() { return questions[currentIndex] }

function normalizeQuestionType(type) {
  return String(type || '').toLowerCase() === 'coding' ? 'coding' : 'mcq'
}

function getSectionLabel(type) {
  return SECTION_LABELS[type] || 'Section'
}

function getVisibleQuestionIndices(type = activeSectionType) {
  return questions.reduce((acc, q, index) => {
    if (normalizeQuestionType(q.type) === type) acc.push(index)
    return acc
  }, [])
}

function getOtherSectionType(type = activeSectionType) {
  return type === 'coding' ? 'mcq' : 'coding'
}

function formatRelativeFromNow(timestamp) {
  const ts = Number(timestamp || 0)
  if (!ts) return 'Not yet'
  const deltaSec = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (deltaSec < 2) return 'just now'
  if (deltaSec < 60) return `${deltaSec}s ago`
  const min = Math.round(deltaSec / 60)
  if (min < 60) return `${min}m ago`
  const hrs = Math.round(min / 60)
  return `${hrs}h ago`
}

function loadAccommodationSelection() {
  selectedAccommodations.clear()
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOMMODATION_STORAGE_KEY) || '[]')
    if (Array.isArray(parsed)) {
      parsed
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .forEach((item) => selectedAccommodations.add(item))
    }
  } catch {
    // Ignore malformed storage.
  }
}

function applyAccommodationModes() {
  const body = document.body
  if (!body) return
  body.classList.toggle('exam-accommodation-reduced-motion', selectedAccommodations.has('reduced-motion'))
  body.classList.toggle('exam-accommodation-high-contrast', selectedAccommodations.has('high-contrast'))
}

function updateExamHealthPanel() {
  if (!healthCamera || !healthMic || !healthNetwork || !healthQueue || !healthLastSave || !healthLiveness) {
    return
  }

  healthCamera.textContent = proctorState.cameraAvailable ? 'Connected' : 'Unavailable'
  healthMic.textContent = proctorState.micAvailable ? (proctorState.speaking ? 'Active speech' : 'Connected') : 'Unavailable'
  healthNetwork.textContent = navigator.onLine ? 'Online' : 'Offline'
  healthQueue.textContent = `${readQueuedIncidents().length} pending`
  healthLastSave.textContent = formatRelativeFromNow(lastSavedAt)
  healthLiveness.textContent = lastLivenessStatus

  if (submitLastSaved) submitLastSaved.textContent = formatRelativeFromNow(lastSavedAt)
  if (submitQueueDepth) submitQueueDepth.textContent = String(readQueuedIncidents().length)
  if (submitSyncState) submitSyncState.textContent = lastSyncStateText
}

function markSaveSuccess() {
  lastSavedAt = Date.now()
  updateExamHealthPanel()
}

/* ===================== TIMER ===================== */
function startTimer() {
  updateTimerDisplay()
  timerHandle = setInterval(() => {
    timeRemaining--
    updateTimerDisplay()
    if (timeRemaining <= 0) { clearInterval(timerHandle); autoSubmit() }
  }, 1000)
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(Math.max(0, timeRemaining))
  timerWrap.className = timeRemaining <= 300 ? 'exam-timer danger'
    : timeRemaining <= 900 ? 'exam-timer warn'
    : 'exam-timer'
}

/* ===================== SYNC ===================== */
function setSyncStatus(msg, state = 'idle') {
  const icons = {
    idle:    `<svg viewBox="0 0 20 20" fill="currentColor" style="width:10px;height:10px;color:var(--success)"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>`,
    syncing: `<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>`,
    error:   `<svg viewBox="0 0 20 20" fill="currentColor" style="width:10px;height:10px;color:var(--danger)"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"/></svg>`,
  }
  syncStatus.innerHTML = `${icons[state] || icons.idle}<span style="font-size:var(--text-xs);color:var(--text-muted)">${msg}</span>`
  lastSyncStateText = msg
  updateExamHealthPanel()
}

/* ===================== BANNER ===================== */
function showBanner(msg, type = 'info') {
  liveBanner.textContent = msg
  liveBanner.className = `live-banner ${type}`
  liveBanner.classList.remove('hidden')
  const ttl = selectedAccommodations.has('extended-warnings') ? 8000 : 5000
  setTimeout(() => liveBanner.classList.add('hidden'), ttl)
}

function updateProctorStatusLabel() {
  if (!proctorPipLabel) {
    updateExamHealthPanel()
    return
  }

  let label = 'Proctor Unavailable'
  if (proctorState.speaking && proctorState.micAvailable) {
    label = 'Speech Detected'
  } else if (proctorState.cameraAvailable && proctorState.micAvailable) {
    label = 'Live Proctor · AV'
  } else if (proctorState.cameraAvailable && !proctorState.micAvailable) {
    label = 'Live Proctor · Cam Only'
  } else if (!proctorState.cameraAvailable && proctorState.micAvailable) {
    label = 'Live Proctor · Mic Only'
  }

  proctorPipLabel.textContent = label
  updateExamHealthPanel()
}

function detectAccommodationFlags() {
  const flags = [...selectedAccommodations]
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      flags.push('reduced-motion')
    }
    if (window.matchMedia?.('(forced-colors: active)')?.matches) {
      flags.push('forced-colors')
    }
    if (window.matchMedia?.('(prefers-contrast: more)')?.matches) {
      flags.push('high-contrast')
    }
  } catch {
    // Ignore feature detection failures.
  }
  return Array.from(new Set(flags))
}

function classifyCameraTier(width, height) {
  const w = Number(width || 0)
  const h = Number(height || 0)
  if (w >= 1280 && h >= 720) return 'high'
  if (w >= 640 && h >= 480) return 'medium'
  if (w > 0 && h > 0) return 'low'
  return 'unknown'
}

function classifyLightingTier(avgLuminance) {
  const value = Number(avgLuminance)
  if (!Number.isFinite(value)) return 'unknown'
  if (value >= 155) return 'bright'
  if (value >= 95) return 'normal'
  return 'low-light'
}

function estimateFrameLuminance(videoEl) {
  try {
    const width = Number(videoEl?.videoWidth || 0)
    const height = Number(videoEl?.videoHeight || 0)
    if (width < 16 || height < 16) {
      return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 18
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      return null
    }

    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    if (!data || !data.length) {
      return null
    }

    let sum = 0
    const pixels = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      sum += (0.299 * r) + (0.587 * g) + (0.114 * b)
    }
    return sum / Math.max(1, pixels)
  } catch {
    return null
  }
}

function refreshFairnessProfile() {
  fairnessProfile.accommodationFlags = detectAccommodationFlags()
  fairnessProfile.speechEnv = proctorState.speaking ? 'speech-detected' : 'quiet'

  if (proctorVideo?.srcObject) {
    const tracks = proctorVideo.srcObject.getVideoTracks?.() || []
    const settings = tracks[0]?.getSettings?.() || {}
    fairnessProfile.cameraTier = classifyCameraTier(settings.width || proctorVideo.videoWidth, settings.height || proctorVideo.videoHeight)

    const luminance = estimateFrameLuminance(proctorVideo)
    fairnessProfile.lightingTier = classifyLightingTier(luminance)
  }
}

function recordFairnessBenchmark({ incidentType, severity, confidence, detectorFamily }) {
  refreshFairnessProfile()
  window.electronAPI.recordFairnessBenchmark?.({
    sessionId: sessionId || null,
    incidentType,
    severity,
    confidence,
    detectorFamily,
    cameraTier: fairnessProfile.cameraTier,
    lightingTier: fairnessProfile.lightingTier,
    speechEnv: fairnessProfile.speechEnv,
    accommodationFlags: fairnessProfile.accommodationFlags
  }).catch(() => {})
}

async function loadAudioProctoringPolicy() {
  try {
    const result = await window.electronAPI.getAudioProctoringPolicy?.()
    const policy = result?.data ?? result
    if (policy && typeof policy === 'object') {
      audioPolicy = {
        ...audioPolicy,
        ...policy
      }
    }
  } catch {
    // Continue with renderer fallback defaults.
  }
}

function getAudioMetrics(buffer) {
  if (!buffer || !buffer.length) {
    return { rms: 0, zcr: 0 }
  }

  let sumSquares = 0
  let zeroCrossings = 0
  let prevSample = (buffer[0] - 128) / 128

  for (let i = 0; i < buffer.length; i += 1) {
    const sample = (buffer[i] - 128) / 128
    sumSquares += sample * sample
    if (i > 0 && ((sample >= 0 && prevSample < 0) || (sample < 0 && prevSample >= 0))) {
      zeroCrossings += 1
    }
    prevSample = sample
  }

  return {
    rms: Math.sqrt(sumSquares / buffer.length),
    zcr: zeroCrossings / Math.max(1, buffer.length - 1)
  }
}

function shouldEmitIncident(key, cooldownMs) {
  const now = Date.now()
  const last = Number(lastIncidentByKey.get(key) || 0)
  if ((now - last) < cooldownMs) {
    return false
  }
  lastIncidentByKey.set(key, now)
  return true
}

function nextIncidentEscalation(type) {
  const now = Date.now()
  const state = incidentEscalationState.get(type) || { count: 0, lastAt: 0 }
  const stale = (now - Number(state.lastAt || 0)) > 180000
  const count = stale ? 1 : (Number(state.count || 0) + 1)
  incidentEscalationState.set(type, { count, lastAt: now })

  if (count <= 1) {
    return {
      shouldRecord: false,
      severity: 'low',
      confidenceBoost: 0.85,
      warning: 'Warning issued. Continued violations will be recorded.'
    }
  }

  if (count === 2) {
    return {
      shouldRecord: true,
      severity: 'medium',
      confidenceBoost: 0.95,
      warning: 'Repeated behavior detected. Incident has been recorded.'
    }
  }

  return {
    shouldRecord: true,
    severity: 'high',
    confidenceBoost: 1,
    warning: 'Escalated violation pattern detected. High-risk incident recorded.'
  }
}

function computeProctorRiskScore({ eventType, confidence = 0, evidenceVector = {} }) {
  let score = 0

  if (!proctorState.cameraAvailable) score += 0.2
  if (!proctorState.micAvailable) score += 0.1
  if (proctorState.speaking) score += 0.12

  score += clamp(Number(evidenceVector.visibilityHiddenMs || 0) / 8000) * 0.35
  score += clamp(Number(evidenceVector.audioRms || 0) / 0.08) * 0.2

  if (eventType === 'tab-switch') score += 0.35
  if (eventType === 'voice-activity') score += 0.22
  if (eventType === 'camera-unavailable') score += 0.3
  if (eventType === 'microphone-unavailable') score += 0.2

  score += clamp(confidence) * 0.25
  return clamp(score)
}

function getSeverityFromScore(score) {
  if (score >= 0.78) return 'high'
  if (score >= 0.5) return 'medium'
  return 'low'
}

function readQueuedIncidents() {
  try {
    const raw = localStorage.getItem(INCIDENT_QUEUE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueuedIncidents(items) {
  localStorage.setItem(INCIDENT_QUEUE_STORAGE_KEY, JSON.stringify(Array.isArray(items) ? items : []))
  updateExamHealthPanel()
}

async function enqueueIncidentForSync(payload, reason = '') {
  if (!window.electronAPI.signIncidentPayload) {
    return false
  }

  try {
    const signedResponse = await window.electronAPI.signIncidentPayload(payload)
    const signed = signedResponse?.data ?? signedResponse
    if (!signed?.payload || typeof signed.signature !== 'string' || !signed.signature.trim()) {
      return false
    }

    const queue = readQueuedIncidents()
    queue.push({
      payload: signed.payload,
      signature: signed.signature,
      queuedAt: Date.now(),
      reason: String(reason || '').slice(0, 160)
    })

    if (queue.length > INCIDENT_QUEUE_MAX_ITEMS) {
      queue.splice(0, queue.length - INCIDENT_QUEUE_MAX_ITEMS)
    }

    writeQueuedIncidents(queue)
    return true
  } catch {
    return false
  }
}

async function flushQueuedIncidents({ force = false } = {}) {
  if (!window.electronAPI.syncIncidentQueue || incidentQueueFlushInFlight) {
    return
  }

  incidentQueueFlushInFlight = true
  let passesLeft = force ? 6 : 1

  try {
    while (passesLeft > 0) {
      passesLeft -= 1
      const queue = readQueuedIncidents()
      if (!queue.length) {
        break
      }

      const batch = queue.slice(0, INCIDENT_QUEUE_FLUSH_BATCH)
      const response = await window.electronAPI.syncIncidentQueue({ items: batch })
      const result = response?.data ?? response ?? {}
      const acceptedIndices = Array.isArray(result.acceptedIndices) ? result.acceptedIndices : []
      const droppedIndices = Array.isArray(result.droppedIndices) ? result.droppedIndices : []
      const removeSet = new Set([...acceptedIndices, ...droppedIndices])

      if (!removeSet.size) {
        break
      }

      const remainingBatch = batch.filter((_item, index) => !removeSet.has(index))
      const nextQueue = [...remainingBatch, ...queue.slice(batch.length)]
      writeQueuedIncidents(nextQueue)

      if (!force) {
        break
      }
    }
  } catch {
    // Keep queued incidents for the next retry.
  } finally {
    incidentQueueFlushInFlight = false
    updateExamHealthPanel()
  }
}

function startIncidentQueueSyncLoop() {
  if (incidentQueueFlushHandle) {
    clearInterval(incidentQueueFlushHandle)
  }

  incidentQueueFlushHandle = setInterval(() => {
    flushQueuedIncidents().catch(() => {})
  }, 15000)
}

function emitProctorIncident({
  type,
  message,
  confidence = 0,
  evidenceVector = {},
  triggeredRules = [],
  severity,
  dedupeScope = 'session'
}) {
  const dedupeKey = `${dedupeScope}:${type}:${triggeredRules.slice().sort().join('|') || 'none'}`
  const cooldownMs = Number(incidentThrottleMs[type] || 25000)
  if (!shouldEmitIncident(dedupeKey, cooldownMs)) {
    return
  }

  const modelRisk = computeProctorRiskScore({ eventType: type, confidence, evidenceVector })
  const riskScore = clamp(Math.max(modelRisk, confidence))
  riskSignalState.lastRiskScore = riskScore

  const incidentPayload = {
    type,
    message,
    sessionId: sessionId || null,
    severity: severity || getSeverityFromScore(riskScore),
    confidence: riskScore,
    detectorFamily: audioPolicy.audioModelAvailable ? 'multimodal-audio-model' : 'multimodal-heuristic',
    triggeredRules,
    evidenceVector: {
      ...evidenceVector,
      riskScore: Number(riskScore.toFixed(4)),
      cameraAvailable: proctorState.cameraAvailable,
      micAvailable: proctorState.micAvailable,
      speaking: proctorState.speaking,
      visibilityBreaches: riskSignalState.visibilityBreaches,
      speechBursts: riskSignalState.speechBursts,
      cameraDrops: riskSignalState.cameraDrops,
      micDrops: riskSignalState.micDrops
    },
    dedupeKey,
    details: {
      source: 'exam-monitor',
      mode: audioPolicy.mode,
      event: type,
      message
    }
  }

    const usesTieredWarning = ['tab-switch', 'voice-activity', 'periodic-liveness-failed', 'genai-assist-signal'].includes(type)
    if (usesTieredWarning) {
      const decision = nextIncidentEscalation(type)
      showBanner(decision.warning, decision.shouldRecord ? (decision.severity === 'high' ? 'error' : 'warning') : 'info')
      if (!decision.shouldRecord) {
        recordFairnessBenchmark({
          incidentType: `${type}:warning-only`,
          severity: 'low',
          confidence: riskScore * 0.6,
          detectorFamily: incidentPayload.detectorFamily
        })
        return
      }
      incidentPayload.severity = decision.severity || incidentPayload.severity
      incidentPayload.confidence = clamp(incidentPayload.confidence * Number(decision.confidenceBoost || 1))
    }

  window.electronAPI.recordIncident?.(incidentPayload).catch((error) => {
    enqueueIncidentForSync(incidentPayload, error?.message || 'record-failed').catch(() => {})
  })

  recordFairnessBenchmark({
    incidentType: type,
    severity: incidentPayload.severity,
    confidence: riskScore,
    detectorFamily: incidentPayload.detectorFamily
  })
}

function recordAudioIncident(message, details = {}) {
  const threshold = Number(details.threshold || 0)
  const rms = Number(details.rms || 0)
  const confidence = threshold > 0 ? clamp(rms / threshold) : (proctorState.speaking ? 0.7 : 0.45)

  emitProctorIncident({
    type: 'voice-activity',
    message,
    confidence,
    triggeredRules: ['sustained_speech_detected'],
    evidenceVector: {
      audioRms: Number.isFinite(rms) ? Number(rms.toFixed(4)) : null,
      audioZcr: Number.isFinite(Number(details.zcr)) ? Number(Number(details.zcr).toFixed(4)) : null,
      audioThreshold: threshold > 0 ? Number(threshold.toFixed(4)) : null,
      sampleIntervalMs: Number(details.sampleIntervalMs || audioPolicy.sampleIntervalMs || 500)
    }
  })
}

/* ===================== PROGRESS ===================== */
function updateProgress() {
  const visibleIndices = getVisibleQuestionIndices()
  const sectionTotal = visibleIndices.length
  const sectionAnswered = visibleIndices.filter(index => isAnswered(questions[index].id)).length
  const sectionPos = Math.max(visibleIndices.indexOf(currentIndex) + 1, 0)
  progressLabel.textContent = `${getSectionLabel(activeSectionType)} ${sectionPos} / ${sectionTotal}`
  progressBar.style.width = sectionTotal ? `${(sectionAnswered / sectionTotal) * 100}%` : '0%'
}

function updateSectionTabs() {
  const mcqIndices = getVisibleQuestionIndices('mcq')
  const codingIndices = getVisibleQuestionIndices('coding')
  const mcqAnswered = mcqIndices.filter(index => isAnswered(questions[index].id)).length
  const codingAnswered = codingIndices.filter(index => isAnswered(questions[index].id)).length

  sectionMcqCount.textContent = `${mcqAnswered}/${mcqIndices.length}`
  sectionCodingCount.textContent = `${codingAnswered}/${codingIndices.length}`

  sectionTabMcq.disabled = mcqIndices.length === 0
  sectionTabCoding.disabled = codingIndices.length === 0

  sectionTabMcq.classList.toggle('active', activeSectionType === 'mcq')
  sectionTabCoding.classList.toggle('active', activeSectionType === 'coding')
  sectionTabMcq.setAttribute('aria-selected', String(activeSectionType === 'mcq'))
  sectionTabCoding.setAttribute('aria-selected', String(activeSectionType === 'coding'))
}

function activateSection(type) {
  const nextType = type === 'coding' ? 'coding' : 'mcq'
  const nextIndices = getVisibleQuestionIndices(nextType)
  if (!nextIndices.length) return

  activeSectionType = nextType
  const rememberedIndex = sectionLastVisited[nextType]
  const targetIndex = nextIndices.includes(rememberedIndex) ? rememberedIndex : nextIndices[0]
  goToQuestion(targetIndex)
}

/* ===================== PALETTE ===================== */
function renderPalette() {
  palette.innerHTML = ''
  const visibleIndices = getVisibleQuestionIndices()

  if (!visibleIndices.length) {
    palette.innerHTML = '<span class="text-xs text-mute">No questions in this section</span>'
    return
  }

  visibleIndices.forEach((questionIndex, sectionIndex) => {
    const q = questions[questionIndex]
    const btn = document.createElement('button')
    btn.className = 'palette-btn'
    btn.textContent = sectionIndex + 1
    btn.title = q.title || `${getSectionLabel(activeSectionType)} question ${sectionIndex + 1}`
    btn.setAttribute('aria-label', `Go to ${getSectionLabel(activeSectionType)} question ${sectionIndex + 1}`)
    if (questionIndex === currentIndex)    btn.classList.add('current')
    else if (flagged.includes(q.id))  btn.classList.add('flagged')
    else if (isAnswered(q.id))        btn.classList.add('answered')
    btn.addEventListener('click', () => goToQuestion(questionIndex))
    palette.appendChild(btn)
  })
}

function isAnswered(qId) {
  const a = answers[String(qId)]
  if (!a) return false
  if (a.type === 'mcq') return a.selectedOption !== undefined
  return (a.code || '').trim().length > 0
}

/* ===================== NAVIGATION ===================== */
async function goToQuestion(index) {
  if (index < 0 || index >= questions.length || index === currentIndex) return
  const curr = getCurrentQ()
  if (normalizeQuestionType(curr?.type) === 'coding') await saveCodingDraft()
  sectionLastVisited[normalizeQuestionType(curr?.type)] = currentIndex
  currentIndex = index
  sectionLastVisited[normalizeQuestionType(questions[index]?.type)] = index
  activeSectionType = normalizeQuestionType(questions[index]?.type)
  renderQuestion()
  renderPalette()
  updateProgress()
  updateSectionTabs()
}

function goToAdjacentInSection(direction) {
  const visibleIndices = getVisibleQuestionIndices()
  const position = visibleIndices.indexOf(currentIndex)
  const nextPosition = position + direction
  if (nextPosition < 0 || nextPosition >= visibleIndices.length) return false
  goToQuestion(visibleIndices[nextPosition])
  return true
}

function goToNextQuestion() {
  const moved = goToAdjacentInSection(1)
  if (moved) return

  const otherSection = getOtherSectionType(activeSectionType)
  const otherSectionIndices = getVisibleQuestionIndices(otherSection)
  if (otherSectionIndices.length) {
    activateSection(otherSection)
    showToast(`Switched to ${getSectionLabel(otherSection)} section.`, 'info')
    return
  }

  openSubmitModal()
}

/* ===================== RENDER QUESTION ===================== */
function renderQuestion() {
  const q = getCurrentQ()
  if (!q) return

  const qType = normalizeQuestionType(q.type)
  activeSectionType = qType
  const visibleIndices = getVisibleQuestionIndices()
  const sectionPos = Math.max(visibleIndices.indexOf(currentIndex) + 1, 1)
  examBody.classList.toggle('mode-coding', qType === 'coding')
  examBody.classList.toggle('mode-mcq', qType !== 'coding')

  qBadge.innerHTML =
    `<svg viewBox="0 0 20 20" fill="currentColor" style="width:10px;height:10px"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/></svg>${getSectionLabel(qType)} ${sectionPos}`

  qTitle.textContent = q.title || 'Question'

  const metaParts = []
  if (q.section)             metaParts.push(`<span class="badge badge-default">${escHtml(q.section)}</span>`)
  if (q.difficulty)          metaParts.push(`<span class="badge ${diffClass(q.difficulty)}">${escHtml(q.difficulty)}</span>`)
  if (q.points)              metaParts.push(`<span class="badge badge-info">${q.points} pts</span>`)
  if (qType === 'coding')    metaParts.push(`<span class="badge badge-accent">Coding</span>`)
  if (qType === 'mcq')       metaParts.push(`<span class="badge badge-default">Single choice</span>`)
  qMeta.innerHTML = metaParts.join('')

  if (qType === 'coding') renderCoding(q)
  else                     renderMcq(q)

  const sectionPosition = visibleIndices.indexOf(currentIndex)
  const atFirst = sectionPosition <= 0
  const atLast = sectionPosition === visibleIndices.length - 1
  prevBtn.disabled = atFirst
  if (!atLast) {
    nextBtn.textContent = 'Next'
  } else {
    const hasOtherSection = getVisibleQuestionIndices(getOtherSectionType(activeSectionType)).length > 0
    nextBtn.textContent = hasOtherSection ? 'Next Section' : 'Submit Exam'
  }

  const isFlagged = flagged.includes(q.id)
  flagBtn.innerHTML   = isFlagged
    ? `<svg viewBox="0 0 20 20" fill="currentColor" style="width:13px;height:13px"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 7l2.55 2.4A1 1 0 0116 11H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"/></svg> Flagged`
    : `<svg viewBox="0 0 20 20" fill="currentColor" style="width:13px;height:13px"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 7l2.55 2.4A1 1 0 0116 11H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"/></svg> Flag`
  flagBtn.className = isFlagged ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm'
}

function diffClass(d) {
  const m = { easy: 'badge-success', medium: 'badge-warning', hard: 'badge-danger' }
  return m[(d || '').toLowerCase()] || 'badge-default'
}

/* ===================== MCQ ===================== */
function renderMcq(q) {
  mcqInfo.className              = 'exam-mcq-info hidden'
  codingPanel.style.display      = 'none'

  const saved = answers[String(q.id)]
  let html = `<p class="exam-q-prompt">${escHtml(q.prompt || q.description || '')}</p>`
  html    += `<div class="exam-section-heading">Choose one answer</div><div class="mcq-options" id="mcqOptions">`

  const opts = q.options || ['', '', '', '']
  const keys = ['A', 'B', 'C', 'D']
  opts.forEach((opt, i) => {
    if (!opt) return
    const selected = saved?.selectedOption === i
    html += `
      <label class="mcq-option${selected ? ' selected' : ''}" data-idx="${i}">
        <input type="radio" name="mcq-${q.id}" value="${i}" ${selected ? 'checked' : ''}/>
        <span class="mcq-opt-key">${keys[i]}</span>
        <span class="mcq-opt-text">${escHtml(opt)}</span>
      </label>`
  })
  html += '</div>'
  qBody.innerHTML = html

  qBody.querySelectorAll('.mcq-option').forEach(label => {
    label.addEventListener('click', () => {
      const idx = parseInt(label.dataset.idx)
      qBody.querySelectorAll('.mcq-option').forEach(l => l.classList.remove('selected'))
      label.classList.add('selected')
      label.querySelector('input').checked = true
      saveMcqAnswer(q.id, idx)
    })
  })
}

async function saveMcqAnswer(qId, idx) {
  answers[String(qId)] = { type: 'mcq', selectedOption: idx }
  renderPalette()
  updateProgress()
  updateSectionTabs()
  setSyncStatus('Saving...', 'syncing')
  try {
    await window.electronAPI.saveMCQAnswer({ sessionId, questionId: qId, selectedOption: idx })
    setSyncStatus('Saved', 'idle')
    markSaveSuccess()
  } catch (err) {
    setSyncStatus('Save failed', 'error')
    console.warn('[exam] saveMCQ error:', err.message)
  }
}

/* ===================== CODING ===================== */
const LANG_MODE = { javascript: 'text/javascript', python: 'text/x-python', cpp: 'text/x-c++src' }
const DEFAULT_LANG_ORDER = ['javascript', 'python', 'cpp']

function getQuestionLanguages(q) {
  const fromQuestion = Array.isArray(q?.languages) ? q.languages : []
  const normalized = fromQuestion
    .map(lang => String(lang || '').toLowerCase())
    .filter(lang => Object.prototype.hasOwnProperty.call(LANG_MODE, lang))
  return normalized.length ? normalized : DEFAULT_LANG_ORDER
}

function getDefaultLanguage(q) {
  const languages = getQuestionLanguages(q)
  return languages[0] || 'javascript'
}

function configureLanguageSelect(q, selectedLang) {
  const langSelect = document.getElementById('codeLanguage')
  if (!langSelect) return getDefaultLanguage(q)

  const languages = getQuestionLanguages(q)
  langSelect.innerHTML = ''

  languages.forEach(lang => {
    const option = document.createElement('option')
    option.value = lang
    option.textContent = LANGUAGE_LABELS[lang] || lang
    langSelect.appendChild(option)
  })

  const finalLang = languages.includes(selectedLang) ? selectedLang : languages[0]
  langSelect.value = finalLang
  return finalLang
}

function renderCoding(q) {
  mcqInfo.className         = 'exam-mcq-info hidden'
  codingPanel.style.display = 'flex'
  codingPanel.style.flexDirection = 'column'
  codingPanel.style.height  = '100%'

  const saved = answers[String(q.id)]
  const initialLang = saved?.language || getDefaultLanguage(q)

  // Question body — prompt + constraints + examples
  let html = `<p class="exam-q-prompt">${escHtml(q.prompt || q.description || '')}</p>`

  if (q.functionName) {
    const lang = initialLang
    html += `<div class="exam-section-heading">Function Signature</div>
             <div class="fn-signature">${escHtml(buildSignature(q, lang))}</div>`
  }

  if (Array.isArray(q.constraints) && q.constraints.length) {
    html += `<div class="exam-section-heading">Constraints</div><ul class="constraint-list">`
    q.constraints.forEach(c => { html += `<li>${escHtml(c)}</li>` })
    html += '</ul>'
  }

  if (Array.isArray(q.examples) && q.examples.length) {
    html += `<div class="exam-section-heading">Examples</div>`
    q.examples.forEach((ex, i) => {
      html += `<div class="code-example">
        <div class="code-example-label">Example ${i + 1}</div>
        <div><strong style="font-size:var(--text-xs);color:var(--text-muted)">Input</strong><div class="code-example-block">${escHtml(ex.input ?? '')}</div></div>
        <div style="margin-top:var(--sp-2)"><strong style="font-size:var(--text-xs);color:var(--text-muted)">Output</strong><div class="code-example-block">${escHtml(ex.output ?? '')}</div></div>
        ${ex.explanation ? `<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--sp-2)">${escHtml(ex.explanation)}</div>` : ''}
      </div>`
    })
  }

  qBody.innerHTML = html

  // Editor
  const lang = configureLanguageSelect(q, initialLang)
  updateEditorLang(lang)

  suppressChange = true
  const code = saved?.code || getTemplate(q, lang)
  if (editor) {
    setEditorValue(code)
    editor.refresh()
  } else {
    initEditor(code)
  }
  suppressChange = false

  // Reset output
  const lastResult = saved?.lastResult || ''
  outputEl.textContent = lastResult || 'Ready. Click "Run" to execute your code.'
  outputEl.className   = lastResult ? 'output-pre output-idle' : 'output-pre output-idle'
  outputBadge.textContent = 'Ready'
  outputBadge.className   = 'badge badge-default'
}

function initEditor(initialValue = '') {
  const textarea = document.getElementById('codeEditor')
  if (!textarea) return

  if (!window.CodeMirror && textarea.dataset.editorReady === 'true') {
    textarea.value = initialValue
    syncPlainEditorLines()
    return
  }

  if (window.CodeMirror) {
    editor = window.CodeMirror.fromTextArea(textarea, {
      mode:             'text/javascript',
      theme:            'dracula',
      lineNumbers:      true,
      indentUnit:       2,
      tabSize:          2,
      indentWithTabs:   false,
      autoCloseBrackets: true,
      matchBrackets:    true,
      lineWrapping:     false,
      extraKeys:        { Tab: cm => cm.execCommand('indentMore') }
    })
    editor.setValue(initialValue)
    codingIntegrityState.lastLength = String(initialValue || '').length
    codingIntegrityState.lastTimestamp = Date.now()
    editor.on('change', (_cm, changeObj) => {
      if (suppressChange) return
      const inserted = Array.isArray(changeObj?.text) ? changeObj.text.join('\n').length : 0
      if (changeObj?.origin === 'paste') {
        recordPasteSignal(inserted)
      } else if (String(changeObj?.origin || '').startsWith('+')) {
        recordTypingSignal()
      }
      analyzeRapidRewrite(editor.getValue())
      isDirty = true
      scheduleAutosave()
    })
  } else {
    textarea.style.display = ''
    textarea.value = initialValue

    const editorWrap = document.getElementById('editorWrap')
    if (editorWrap && !editorWrap.querySelector('.plain-editor')) {
      const plain = document.createElement('div')
      plain.className = 'plain-editor'
      const lines = document.createElement('pre')
      lines.className = 'plain-editor-lines'
      plainEditorLines = lines

      textarea.parentNode.removeChild(textarea)
      plain.appendChild(lines)
      plain.appendChild(textarea)
      editorWrap.appendChild(plain)

      textarea.addEventListener('scroll', () => {
        if (plainEditorLines) plainEditorLines.scrollTop = textarea.scrollTop
      })
    }

    syncPlainEditorLines()
    codingIntegrityState.lastLength = String(initialValue || '').length
    codingIntegrityState.lastTimestamp = Date.now()
    textarea.addEventListener('input', () => {
      recordTypingSignal()
      analyzeRapidRewrite(textarea.value)
      syncPlainEditorLines()
      isDirty = true
      scheduleAutosave()
    })
    textarea.addEventListener('paste', (event) => {
      const pasted = event?.clipboardData?.getData('text') || ''
      recordPasteSignal(String(pasted).length)
    })
    textarea.dataset.editorReady = 'true'
  }
}

function syncPlainEditorLines() {
  if (!plainEditorLines) return
  const text = getEditorValue()
  const lineCount = Math.max(1, text.split('\n').length)
  plainEditorLines.textContent = Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n')
}

function updateEditorLang(lang) {
  if (!editor) return
  editor.setOption('mode', LANG_MODE[lang] || 'text/javascript')
}

function getEditorValue() {
  if (editor) return editor.getValue()
  const ta = document.getElementById('codeEditor')
  return ta ? ta.value : ''
}

function setEditorValue(code) {
  if (editor) {
    editor.setValue(code)
    return
  }
  const ta = document.getElementById('codeEditor')
  if (!ta) return
  ta.value = code
  syncPlainEditorLines()
}

function getTemplate(q, lang) {
  const starterCode = q?.starterCode && typeof q.starterCode === 'object' ? q.starterCode[lang] : ''
  if (typeof starterCode === 'string' && starterCode.trim()) return starterCode

  const fn     = q.functionName || 'solve'
  const params = Array.isArray(q.params) ? q.params.map(p => p.name || p).join(', ') : 'input'
  if (lang === 'python') return `def ${fn}(${params}):\n    # Write your solution here\n    pass\n`
  if (lang === 'cpp')    return `#include <bits/stdc++.h>\nusing namespace std;\n\nauto ${fn}(${params}) {\n    // Write your solution here\n}\n`
  return `function ${fn}(${params}) {\n  // Write your solution here\n  return null;\n}\n`
}

function buildSignature(q, lang) {
  const fn     = q.functionName || 'solve'
  const params = Array.isArray(q.params) ? q.params.map(p => p.name || p).join(', ') : 'input'
  if (lang === 'python') return `def ${fn}(${params}):`
  if (lang === 'cpp')    return `auto ${fn}(${params})`
  return `function ${fn}(${params})`
}

function trimOldEvents(events, maxAgeMs) {
  const now = Date.now()
  while (events.length && (now - events[0]) > maxAgeMs) {
    events.shift()
  }
}

function recordTypingSignal() {
  const now = Date.now()
  codingIntegrityState.typingEvents.push(now)
  trimOldEvents(codingIntegrityState.typingEvents, 15000)
}

function recordPasteSignal(charCount = 0) {
  const now = Date.now()
  codingIntegrityState.pasteEvents.push(now)
  trimOldEvents(codingIntegrityState.pasteEvents, 45000)

  const pasteBurstCount = codingIntegrityState.pasteEvents.length
  const largePaste = Number(charCount || 0) >= 280
  if (!largePaste && pasteBurstCount < 3) {
    return
  }

  emitProctorIncident({
    type: 'genai-assist-signal',
    message: largePaste
      ? 'Large paste activity detected in coding editor.'
      : 'Burst paste activity detected in coding editor.',
    confidence: largePaste ? 0.72 : 0.62,
    triggeredRules: [largePaste ? 'large_paste_insert' : 'paste_burst_pattern'],
    evidenceVector: {
      pastedChars: Number(charCount || 0),
      pasteBurstCount,
      typingWindowEvents: codingIntegrityState.typingEvents.length
    }
  })
}

function analyzeRapidRewrite(nextCode = '') {
  const now = Date.now()
  const nextLength = String(nextCode || '').length
  const prevLength = Number(codingIntegrityState.lastLength || 0)
  const elapsedMs = codingIntegrityState.lastTimestamp ? (now - codingIntegrityState.lastTimestamp) : 0
  const delta = nextLength - prevLength

  codingIntegrityState.lastLength = nextLength
  codingIntegrityState.lastTimestamp = now
  codingIntegrityState.recentSnapshots.push({ ts: now, length: nextLength })
  while (codingIntegrityState.recentSnapshots.length > 10) {
    codingIntegrityState.recentSnapshots.shift()
  }

  if (elapsedMs <= 0 || elapsedMs > 7000) {
    return
  }

  const typingRate = codingIntegrityState.typingEvents.length
  const likelyRapidRewrite = delta >= 260 && typingRate <= 6
  if (!likelyRapidRewrite) {
    return
  }

  emitProctorIncident({
    type: 'genai-assist-signal',
    message: 'Abrupt code rewrite pattern detected.',
    confidence: 0.66,
    triggeredRules: ['rapid_rewrite_pattern'],
    evidenceVector: {
      charDelta: delta,
      elapsedMs,
      typingWindowEvents: typingRate,
      pasteBurstCount: codingIntegrityState.pasteEvents.length
    }
  })
}

/* ===================== AUTOSAVE ===================== */
function scheduleAutosave() {
  clearTimeout(autosaveHandle)
  autosaveHandle = setTimeout(saveCodingDraft, 1500)
}

async function saveCodingDraft(status = 'Draft') {
  const q = getCurrentQ()
  if (!q || normalizeQuestionType(q.type) !== 'coding') return
  const code = getEditorValue()
  const lang  = document.getElementById('codeLanguage')?.value || 'javascript'
  answers[String(q.id)] = { ...(answers[String(q.id)] || {}), type: 'coding', code, language: lang }

  if (!sessionId) return  // No session yet, skip save

  setSyncStatus('Saving...', 'syncing')
  try {
    await window.electronAPI.saveCodeAnswer({
      sessionId,
      questionId: q.id,
      language: lang,
      code,
      status,
      testSummary: answers[String(q.id)]?.testSummary || {}
    })
    setSyncStatus('Saved', 'idle')
    isDirty = false
    markSaveSuccess()
  } catch (err) {
    setSyncStatus('Save failed', 'error')
    console.warn('[exam] saveCode error:', err.message)
  }
  renderPalette()
  updateProgress()
  updateSectionTabs()
}

/* ===================== RUN CODE ===================== */
function formatRunResults(result) {
  // result from codeExecutionService.runCode():
  // { success, allPassed, passedCount, totalCount, status, results: [...] }
  if (!result.success) {
    return `Error: ${result.error || 'Unknown error'}`
  }

  const lines = []
  lines.push(`Status: ${result.status || (result.allPassed ? 'Accepted' : 'Wrong Answer')}`)
  lines.push(`Passed: ${result.passedCount ?? '?'} / ${result.totalCount ?? '?'}`)

  if (Array.isArray(result.results)) {
    result.results.forEach((r, i) => {
      if (r.hidden) return  // Don't reveal hidden test case details
      const icon = r.passed ? '✓' : '✗'
      lines.push('')
      lines.push(`${icon} Test ${i + 1}${r.description ? ' — ' + r.description : ''}`)
      if (!r.passed) {
        if (r.error) {
          lines.push(`  Error:    ${r.error}`)
        } else {
          lines.push(`  Expected: ${JSON.stringify(r.expectedOutput)}`)
          lines.push(`  Got:      ${JSON.stringify(r.actualOutput)}`)
        }
      }
      lines.push(`  Time:     ${r.executionTimeMs}ms`)
    })
  }

  return lines.join('\n')
}

async function runCode(mode = 'sample') {
  const q = getCurrentQ()
  if (!q || normalizeQuestionType(q.type) !== 'coding') return

  const code = getEditorValue()
  const lang = document.getElementById('codeLanguage').value

  if (!code.trim()) {
    showToast('Write some code first.', 'warning')
    return
  }

  outputEl.textContent = 'Running code...'
  outputEl.className   = 'output-pre output-running'
  outputBadge.textContent = 'Running'
  outputBadge.className   = 'badge badge-info'

  // Save code before running
  await saveCodingDraft(mode === 'submit' ? 'Submitted' : 'Draft')

  try {
    const result = await window.electronAPI.runCode({
      sessionId: sessionId || null,
      questionId: q.id,
      code,
      language: lang,
      mode
    })

    // ──────────────────────────────────────────────
    // FIX: correct property check (not result.passed)
    // codeExecutionService returns: { success, allPassed, status:'Accepted'|'Wrong Answer', ... }
    // ──────────────────────────────────────────────
    const passed = result?.success && (result?.allPassed === true || result?.status === 'Accepted')
    const outputText = formatRunResults(result)

    outputEl.textContent = outputText
    outputEl.className   = passed ? 'output-pre output-success' : 'output-pre output-error'
    outputBadge.textContent = passed ? '✓ Passed' : '✗ Failed'
    outputBadge.className   = passed ? 'badge badge-success' : 'badge badge-danger'

    // Store last result + test summary in answer state
    const ans = answers[String(q.id)] || { type: 'coding', code, language: lang }
    ans.lastResult  = outputText.slice(0, 400)
    ans.testSummary = {
      status:      result?.status || '',
      passedCount: result?.passedCount ?? 0,
      totalCount:  result?.totalCount  ?? 0,
      allPassed:   result?.allPassed   ?? false
    }
    answers[String(q.id)] = ans

  } catch (err) {
    outputEl.textContent = `Execution error: ${err.message}`
    outputEl.className   = 'output-pre output-error'
    outputBadge.textContent = 'Error'
    outputBadge.className   = 'badge badge-danger'
  }
}

/* ===================== FLAG ===================== */
function toggleFlag() {
  const q = getCurrentQ()
  if (!q) return
  const idx = flagged.indexOf(q.id)
  if (idx > -1) {
    flagged.splice(idx, 1)
  } else {
    flagged.push(q.id)
  }
  renderQuestion()
  renderPalette()
}

/* ===================== SUBMIT ===================== */
function openSubmitModal() {
  const answered = Object.values(answers).filter(a =>
    a?.type === 'mcq'
      ? a.selectedOption !== undefined
      : (a?.code || '').trim().length > 0
  ).length
  document.getElementById('submitAnswered').textContent = `${answered} / ${questions.length}`
  document.getElementById('submitFlagged').textContent  = flagged.length
  updateExamHealthPanel()
  submitModal.classList.remove('hidden')
}

async function submitExam() {
  if (isSubmitting) return
  isSubmitting = true
  clearInterval(timerHandle)
  stopProctorPreview()
  stopAudioMonitoring()

  try {
    submitModal.classList.add('hidden')
    setSyncStatus('Submitting...', 'syncing')
    await flushQueuedIncidents({ force: true })

    // Save current coding question if open
    const curr = getCurrentQ()
    if (normalizeQuestionType(curr?.type) === 'coding') await saveCodingDraft('Submitted')

    const userId = Number(localStorage.getItem('userId') || '0')
    await window.electronAPI.saveExamSubmission({
      sessionId,
      examId,
      userId,
      timeRemaining,
      flaggedQuestionIds: flagged
    })
    markSaveSuccess()
    await window.electronAPI.endExamSession(sessionId, 'submitted')

    await navigateTo('submission')
  } catch (err) {
    isSubmitting = false
    showToast('Submission failed: ' + (err.message || 'Unknown error'), 'error')
    setSyncStatus('Submit failed', 'error')
  }
}

async function autoSubmit() {
  showBanner('Time expired — auto-submitting in 3 seconds...', 'error')
  await sleep(3000)
  await submitExam()
}

/* ===================== MONITORING ===================== */
function setupMonitoring() {
  document.addEventListener('visibilitychange', () => {
    if (isSubmitting) {
      return
    }

    if (document.hidden) {
      visibilityHiddenAt = Date.now()
      return
    }

    if (visibilityHiddenAt) {
      const hiddenMs = Date.now() - visibilityHiddenAt
      visibilityHiddenAt = null
      if (hiddenMs >= 1200) {
        reportViolation('tab-switch', 'Tab switch or window minimization detected during exam.', { visibilityHiddenMs: hiddenMs })
      }
    }
  })
}

async function startProctorPreview() {
  if (!proctorPip || !proctorVideo || proctorStream) return

  try {
    proctorStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 320 },
        height: { ideal: 180 },
        frameRate: { ideal: 12, max: 15 },
        facingMode: 'user'
      },
      audio: false
    })

    proctorVideo.srcObject = proctorStream
    proctorPip.classList.remove('hidden')
    proctorState.cameraAvailable = true
    lastLivenessStatus = 'Scheduled'
    refreshFairnessProfile()
    updateProctorStatusLabel()
    scheduleLivenessRecheck()
  } catch (err) {
    proctorState.cameraAvailable = false
    riskSignalState.cameraDrops += 1
    updateProctorStatusLabel()
    emitProctorIncident({
      type: 'camera-unavailable',
      message: 'Camera stream unavailable during exam monitoring.',
      confidence: 0.62,
      severity: 'medium',
      dedupeScope: 'device',
      triggeredRules: ['camera_stream_unavailable'],
      evidenceVector: {
        error: String(err?.message || err || 'unknown_error')
      }
    })
    console.warn('[exam] proctor preview unavailable:', err?.message || err)
  }
}

async function startAudioMonitoring() {
  if (audioMonitorHandle || proctorAudioStream) return

  try {
    proctorAudioStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    audioContext = new window.AudioContext()
    const source = audioContext.createMediaStreamSource(proctorAudioStream)
    audioAnalyser = audioContext.createAnalyser()
    audioAnalyser.fftSize = 1024
    audioAnalyser.smoothingTimeConstant = 0.72
    source.connect(audioAnalyser)

    audioDataBuffer = new Uint8Array(audioAnalyser.fftSize)
    audioNoiseFloor = null
    audioSpeechStreak = 0
    proctorState.micAvailable = true
    refreshFairnessProfile()
    updateProctorStatusLabel()

    const sampleIntervalMs = Number(audioPolicy.sampleIntervalMs || 500)
    audioMonitorHandle = setInterval(() => {
      if (!audioAnalyser || !audioDataBuffer) return

      audioAnalyser.getByteTimeDomainData(audioDataBuffer)
      const { rms, zcr } = getAudioMetrics(audioDataBuffer)

      if (!Number.isFinite(audioNoiseFloor) || audioNoiseFloor === null) {
        audioNoiseFloor = rms
      }

      if (rms < audioNoiseFloor * 1.4) {
        audioNoiseFloor = (audioNoiseFloor * 0.92) + (rms * 0.08)
      }

      const minNoiseFloor = audioPolicy.audioModelAvailable ? 0.01 : 0.012
      audioNoiseFloor = Math.max(minNoiseFloor, audioNoiseFloor)

      const thresholdMultiplier = audioPolicy.audioModelAvailable ? 1.8 : 2.05
      const absoluteThreshold = audioPolicy.audioModelAvailable ? 0.018 : 0.022
      const dynamicThreshold = Math.max(absoluteThreshold, audioNoiseFloor * thresholdMultiplier)
      const speechLike = rms >= dynamicThreshold && zcr >= 0.02 && zcr <= 0.25

      audioSpeechStreak = speechLike ? (audioSpeechStreak + 1) : Math.max(0, audioSpeechStreak - 1)
      proctorState.speaking = speechLike && audioSpeechStreak >= 2
      fairnessProfile.speechEnv = proctorState.speaking ? 'speech-detected' : 'quiet'
      updateProctorStatusLabel()

      const alertWindowFrames = Math.max(1, Math.ceil(Number(audioPolicy.speechAlertWindowMs || 6000) / Math.max(100, sampleIntervalMs)))
      const minFrames = Math.max(Number(audioPolicy.minConsecutiveSpeechFrames || 12), alertWindowFrames)
      if (audioSpeechStreak < minFrames) {
        return
      }

      const now = Date.now()
      const cooldownMs = Number(audioPolicy.speechCooldownMs || 45000)
      if ((now - lastAudioIncidentAt) < cooldownMs) {
        return
      }

      lastAudioIncidentAt = now
      riskSignalState.speechBursts += 1
      showBanner('Sustained voice activity detected. This incident has been recorded.', 'warning')
      recordAudioIncident('Sustained voice activity detected during exam session.', {
        mode: audioPolicy.mode,
        audioModelAvailable: !!audioPolicy.audioModelAvailable,
        rms: Number(rms.toFixed(4)),
        zcr: Number(zcr.toFixed(4)),
        threshold: Number(dynamicThreshold.toFixed(4)),
        sampleIntervalMs
      })
    }, sampleIntervalMs)
  } catch (err) {
    proctorState.micAvailable = false
    proctorState.speaking = false
    riskSignalState.micDrops += 1
    updateProctorStatusLabel()
    showBanner('Microphone unavailable. Audio proctoring incidents will be flagged.', 'warning')
    emitProctorIncident({
      type: 'microphone-unavailable',
      message: 'Microphone unavailable for audio proctoring during exam.',
      confidence: 0.58,
      severity: 'medium',
      dedupeScope: 'device',
      triggeredRules: ['microphone_stream_unavailable'],
      evidenceVector: {
        error: String(err?.message || err || 'permission denied')
      }
    })
  }
}

function stopProctorPreview() {
  stopLivenessRecheck()
  if (proctorStream) {
    proctorStream.getTracks().forEach(track => track.stop())
    proctorStream = null
  }
  if (proctorVideo) {
    proctorVideo.srcObject = null
  }
  proctorState.cameraAvailable = false
  lastLivenessStatus = 'Stopped'
  updateProctorStatusLabel()
}

function stopAudioMonitoring() {
  if (audioMonitorHandle) {
    clearInterval(audioMonitorHandle)
    audioMonitorHandle = null
  }

  if (proctorAudioStream) {
    proctorAudioStream.getTracks().forEach(track => track.stop())
    proctorAudioStream = null
  }

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {})
  }
  audioContext = null
  audioAnalyser = null
  audioDataBuffer = null
  audioNoiseFloor = null
  audioSpeechStreak = 0
  proctorState.micAvailable = false
  proctorState.speaking = false
  updateProctorStatusLabel()
}

function reportViolation(type, msg, details = {}) {
  violationMsg.textContent = msg
  violationOverlay.classList.remove('hidden')

  if (type === 'tab-switch') {
    riskSignalState.visibilityBreaches += 1
  }

  const hiddenMs = Number(details.visibilityHiddenMs || 0)
  emitProctorIncident({
    type,
    message: msg,
    confidence: hiddenMs > 0 ? clamp(hiddenMs / 5000) : 0.74,
    severity: hiddenMs >= 5000 ? 'high' : undefined,
    triggeredRules: ['visibility_loss'],
    evidenceVector: {
      visibilityHiddenMs: hiddenMs || null
    }
  })
}

function captureProctorFrameData() {
  if (!proctorVideo || !proctorVideo.videoWidth || !proctorVideo.videoHeight) {
    return null
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = proctorVideo.videoWidth
    canvas.height = proctorVideo.videoHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: false })
    if (!ctx) return null
    ctx.drawImage(proctorVideo, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return null
  }
}

async function runLivenessRecheck() {
  if (livenessBusy || isSubmitting) return
  if (!window.electronAPI.verifyFrame || !proctorState.cameraAvailable) {
    lastLivenessStatus = 'Skipped'
    updateExamHealthPanel()
    return
  }

  const frameData = captureProctorFrameData()
  if (!frameData) {
    lastLivenessStatus = 'Frame unavailable'
    updateExamHealthPanel()
    return
  }

  livenessBusy = true
  try {
    const result = await window.electronAPI.verifyFrame({
      imageData: frameData,
      requireMl: true,
      requireLiveness: true,
      examId: examId || null,
      sessionId: sessionId || null,
      stage: 'exam-random-recheck'
    })

    const data = result?.data || result || {}
    const faceCount = Number(data?.face_count || 0)
    const isLive = Boolean(data?.liveness?.is_live)
    if (faceCount === 1 && isLive) {
      lastLivenessStatus = 'Passed'
    } else {
      lastLivenessStatus = 'Recheck failed'
      emitProctorIncident({
        type: 'periodic-liveness-failed',
        message: 'Random liveness re-check could not validate active candidate presence.',
        confidence: 0.78,
        triggeredRules: ['periodic_liveness_recheck_failed'],
        evidenceVector: {
          faceCount,
          livenessScore: Number(data?.liveness?.score || 0),
          stage: 'exam-random-recheck'
        }
      })
    }
  } catch {
    lastLivenessStatus = 'Unavailable'
  } finally {
    livenessBusy = false
    updateExamHealthPanel()
  }
}

function scheduleLivenessRecheck() {
  if (livenessRecheckTimeoutHandle) {
    clearTimeout(livenessRecheckTimeoutHandle)
  }

  const minMs = 120000
  const maxMs = 200000
  const nextMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  livenessRecheckTimeoutHandle = setTimeout(async () => {
    await runLivenessRecheck()
    scheduleLivenessRecheck()
  }, nextMs)
}

function stopLivenessRecheck() {
  if (livenessRecheckTimeoutHandle) {
    clearTimeout(livenessRecheckTimeoutHandle)
    livenessRecheckTimeoutHandle = null
  }
}

/* ===================== PROGRESS SYNC ===================== */
async function syncProgress() {
  if (!sessionId) return
  try {
    await window.electronAPI.saveSessionProgress({
      sessionId,
      remainingSeconds:   timeRemaining,
      flaggedQuestionIds: flagged
    })
    markSaveSuccess()
  } catch { /* silent */ }
}

/* ===================== INIT ===================== */
async function init() {
  loadAccommodationSelection()
  applyAccommodationModes()
  setSyncStatus('Loading...', 'syncing')

  try {
    await window.electronAPI.ensureExamAccess({
      sessionId: sessionId > 0 ? sessionId : null,
      examId: examId > 0 ? examId : null
    })

    // Try to restore progress from localStorage cache
    const cachedProgress = localStorage.getItem('examProgress')
    if (cachedProgress) {
      try {
        const p = JSON.parse(cachedProgress)
        answers       = p.answers       || {}
        flagged       = p.flagged       || []
        if (Object.prototype.hasOwnProperty.call(p, 'timeRemaining')) {
          const cachedRemaining = Number(p.timeRemaining)
          if (Number.isFinite(cachedRemaining) && cachedRemaining >= 0) {
            timeRemaining = cachedRemaining
          }
        }
      } catch { /* ignore malformed cache */ }
    }

    // Load questions
    if (!examId) throw new Error('No exam selected. Please return to the dashboard.')

    const result = await window.electronAPI.getExamQuestions(examId)
    if (!result?.success || !Array.isArray(result.data)) {
      throw new Error(result?.error || 'Failed to load questions')
    }
    questions = [...result.data].sort((a, b) => {
      const orderA = Number.isFinite(a?.orderIndex) ? a.orderIndex : Number.MAX_SAFE_INTEGER
      const orderB = Number.isFinite(b?.orderIndex) ? b.orderIndex : Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      return (a?.id || 0) - (b?.id || 0)
    })
    if (!questions.length) throw new Error('This exam has no questions.')

    activeSectionType = normalizeQuestionType(questions[currentIndex]?.type)
    sectionLastVisited[activeSectionType] = currentIndex

    // Start session if not already started
    if (!sessionId) {
      const userId = Number(localStorage.getItem('userId') || '0')
      const sRes   = await window.electronAPI.startExamSession({
        userId,
        examId,
        sessionToken: `SES-${Date.now().toString(36).toUpperCase()}`
      })
      if (sRes?.success && sRes.data?.sessionId) {
        sessionId = Number(sRes.data.sessionId)
        localStorage.setItem('currentSessionId', String(sessionId))
      } else {
        throw new Error(sRes?.error || 'Could not start exam session')
      }
    } else {
      // Restore server-side progress
      try {
        const state = await window.electronAPI.getSessionState(sessionId)
        if (state?.success && state.data) {
          const d = state.data
          if (Number.isInteger(d.remainingSeconds) && d.remainingSeconds >= 0) timeRemaining = d.remainingSeconds
          if (Array.isArray(d.flaggedQuestionIds)) flagged = d.flaggedQuestionIds
          if (d.answers && typeof d.answers === 'object' && Object.keys(d.answers).length > 0) {
            answers = d.answers
          }
        }
      } catch { /* ignore, use cache */ }
    }

    setSyncStatus('Ready', 'idle')
    updateExamHealthPanel()
    renderQuestion()
    renderPalette()
    updateProgress()
    updateSectionTabs()
    startTimer()
    setupMonitoring()
    await loadAudioProctoringPolicy()
    startProctorPreview()
    startAudioMonitoring()
    recordFairnessBenchmark({
      incidentType: 'baseline-snapshot',
      severity: 'low',
      confidence: 0,
      detectorFamily: audioPolicy.audioModelAvailable ? 'multimodal-audio-model' : 'multimodal-heuristic'
    })
    await flushQueuedIncidents({ force: true })
    startIncidentQueueSyncLoop()

    if (incidentEscalationResetHandle) {
      clearInterval(incidentEscalationResetHandle)
    }
    incidentEscalationResetHandle = setInterval(() => {
      const staleBefore = Date.now() - 180000
      for (const [key, value] of incidentEscalationState.entries()) {
        if (Number(value?.lastAt || 0) < staleBefore) {
          incidentEscalationState.delete(key)
        }
      }
    }, 30000)

    // Periodic server sync every 20 seconds
    setInterval(syncProgress, 20000)
    // Periodic localStorage cache every 10 seconds
    setInterval(() => {
      localStorage.setItem('examProgress', JSON.stringify({
        answers, flagged, timeRemaining
      }))
    }, 10000)

  } catch (err) {
    const message = String(err?.message || err || '')
    if (/identity verification|verification/i.test(message)) {
      setSyncStatus('Verification required', 'error')
      showBanner('Identity verification required before entering exam.', 'warning')
      setTimeout(() => {
        navigateTo('verification')
      }, 300)
      return
    }

    setSyncStatus('Load failed', 'error')
    showBanner('Failed to load exam: ' + message, 'error')
    console.error('[exam] init error:', err)
  }
}

/* ===================== EVENT WIRING ===================== */
prevBtn.addEventListener('click',       () => goToAdjacentInSection(-1))
nextBtn.addEventListener('click',       () => goToNextQuestion())
flagBtn.addEventListener('click',       () => toggleFlag())
submitExamBtn.addEventListener('click', () => openSubmitModal())
sectionTabMcq?.addEventListener('click', () => activateSection('mcq'))
sectionTabCoding?.addEventListener('click', () => activateSection('coding'))
healthToggleBtn?.addEventListener('click', () => {
  examHealthPanel?.classList.toggle('hidden')
  updateExamHealthPanel()
})

document.getElementById('cancelSubmit').addEventListener('click',  () => submitModal.classList.add('hidden'))
document.getElementById('confirmSubmit').addEventListener('click', () => submitExam())
forceSyncNowBtn?.addEventListener('click', async () => {
  setSyncStatus('Force syncing...', 'syncing')
  await flushQueuedIncidents({ force: true })
  setSyncStatus('Sync refreshed', 'idle')
  updateExamHealthPanel()
})

document.getElementById('instructionsTopBtn').addEventListener('click', () => instructModal.classList.remove('hidden'))
document.getElementById('closeInstructions').addEventListener('click',  () => instructModal.classList.add('hidden'))
document.getElementById('violationDismiss').addEventListener('click',   () => violationOverlay.classList.add('hidden'))

document.getElementById('btnRunCode')?.addEventListener('click',     () => runCode('sample'))
document.getElementById('btnSubmitCode')?.addEventListener('click',  () => runCode('submit'))
document.getElementById('btnLoadStarter')?.addEventListener('click', () => {
  const q = getCurrentQ()
  if (!q) return
  const lang = document.getElementById('codeLanguage')?.value || getDefaultLanguage(q)
  suppressChange = true
  setEditorValue(getTemplate(q, lang))
  suppressChange = false
  isDirty = true
  scheduleAutosave()
})

document.getElementById('codeLanguage')?.addEventListener('change', e => {
  const q = getCurrentQ()
  if (!q) return
  const lang = e.target.value
  updateEditorLang(lang)
  // Only load template if editor is empty / unchanged
  const code = getEditorValue()
  const templates = getQuestionLanguages(q).map(item => getTemplate(q, item))
  if (!code.trim() || templates.includes(code)) {
    suppressChange = true
    setEditorValue(getTemplate(q, lang))
    suppressChange = false
  }
  scheduleAutosave()
})

window.addEventListener('online', () => {
  showBanner('Network restored. Sync resumed.', 'success')
  updateExamHealthPanel()
})

window.addEventListener('offline', () => {
  showBanner('Network offline. Progress will sync when connection returns.', 'warning')
  updateExamHealthPanel()
})

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  // Skip if focus is in editor or text input
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return
  if (e.target.closest?.('.CodeMirror')) return
  if (e.key === 'ArrowLeft')         { e.preventDefault(); goToAdjacentInSection(-1) }
  else if (e.key === 'ArrowRight')   { e.preventDefault(); goToNextQuestion() }
  else if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFlag() }
})

// Save before page unloads
window.addEventListener('beforeunload', () => {
  if (isDirty) saveCodingDraft()
  syncProgress()
  stopProctorPreview()
  stopAudioMonitoring()
  if (incidentQueueFlushHandle) {
    clearInterval(incidentQueueFlushHandle)
    incidentQueueFlushHandle = null
  }
  if (incidentEscalationResetHandle) {
    clearInterval(incidentEscalationResetHandle)
    incidentEscalationResetHandle = null
  }
  localStorage.setItem('examProgress', JSON.stringify({ answers, flagged, timeRemaining }))
})

/* ===================== BOOT ===================== */
init()
