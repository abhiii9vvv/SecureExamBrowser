const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } = require('electron')
const crypto = require('node:crypto')
const path = require('node:path')

const { DatabaseService } = require('./backend/database')
const { getRuntimeCapabilities } = require('./backend/runtime-service')
const { CodeExecutionService } = require('./backend/code-execution')
const { ModelService } = require('./backend/model-service')
const { VisionService } = require('./backend/vision-service')

let mainWindow = null
let isExamMode = true
const AUTH_TOKEN_TTL_MS = 4 * 60 * 60 * 1000
const authSessions = new Map()
const VERIFICATION_TTL_MS = 20 * 60 * 1000
const verificationSessions = new Map()

const allowedPages = new Set([
  'login',
  'dashboard',
  'admin-exams',
  'admin-users',
  'admin-reports',
  'student-dashboard',
  'launch',
  'verification',
  'exam',
  'submission'
])
const secureFullscreenPages = new Set(['launch', 'verification', 'exam', 'submission'])
const pageAccessByRole = {
  guest: new Set(['login']),
  student: new Set(['login', 'student-dashboard', 'launch', 'verification', 'exam', 'submission']),
  admin: new Set(['login', 'dashboard', 'admin-exams', 'admin-users', 'admin-reports'])
}
const rootDir = __dirname

const runtimeCapabilities = getRuntimeCapabilities(rootDir)
const database = new DatabaseService({
  rootDir,
  pythonCommand: runtimeCapabilities.python.sqliteCommand || runtimeCapabilities.python.command || 'python',
  ensureLocalExamAvailability: !app.isPackaged
})
const modelService = new ModelService({ rootDir, database })
const visionService = new VisionService({ rootDir, pythonCommand: runtimeCapabilities.python.visionCommand || null })
const codeExecutionService = new CodeExecutionService({ database, runtimeCapabilities })
const PRIVACY_POLICY = {
  version: '2026.04',
  title: 'Secure Exam Monitoring & Data Policy',
  effectiveAt: '2026-04-18T00:00:00Z',
  retentionDaysBySeverity: {
    low: 14,
    medium: 45,
    high: 180
  },
  biometricRetentionDays: 30,
  summary: [
    'Monitoring data is collected for exam integrity and audit review.',
    'Evidence is retained using severity-based retention limits.',
    'Expired incident evidence is automatically redacted from stored details.'
  ]
}
const INCIDENT_SYNC_SIGNATURE_VERSION = 'v1'
const INCIDENT_SYNC_SIGNING_SECRET = crypto.randomBytes(32).toString('hex')
const INCIDENT_SYNC_MAX_BATCH = 100
const INCIDENT_SYNC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function generateSessionToken() {
  return `SES-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`
}

function normalizeRole(role) {
  const normalized = String(role || '').toLowerCase().trim()
  return normalized === 'admin' ? 'admin' : 'student'
}

function normalizePositiveInteger(value) {
  const num = Number(value)
  return Number.isInteger(num) && num > 0 ? num : null
}

function pruneExpiredAuthSessions() {
  const now = Date.now()
  for (const [token, session] of authSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      authSessions.delete(token)
    }
  }
}

function canBypassVerification() {
  const pythonCaps = runtimeCapabilities?.python || {}
  const visionReady = Boolean(pythonCaps.available && pythonCaps.visionReady)
  return !app.isPackaged && !visionReady
}

function pruneExpiredVerificationSessions() {
  const now = Date.now()
  for (const [senderId, state] of verificationSessions.entries()) {
    if (!Number.isInteger(senderId) || !state || !Number.isInteger(state.userId) || state.userId <= 0) {
      verificationSessions.delete(senderId)
      continue
    }

    const hasStartedExam = Number.isInteger(state.startedExamAt) && state.startedExamAt > 0
    const verifiedAt = Number(state.verifiedAt || 0)
    const isFreshVerification = Number.isFinite(verifiedAt) && (verifiedAt + VERIFICATION_TTL_MS) > now

    if (!hasStartedExam && !isFreshVerification) {
      verificationSessions.delete(senderId)
    }
  }
}

function clearVerificationSessionForSender(senderId) {
  if (Number.isInteger(senderId)) {
    verificationSessions.delete(senderId)
  }
}

function getVerificationSessionForSender(senderId) {
  pruneExpiredVerificationSessions()
  if (!Number.isInteger(senderId)) {
    return null
  }
  return verificationSessions.get(senderId) || null
}

function setVerificationSessionForSender(senderId, nextState = {}) {
  if (!Number.isInteger(senderId)) {
    return
  }

  const current = verificationSessions.get(senderId) || {}
  const merged = {
    ...current,
    ...nextState
  }

  if (!Number.isInteger(merged.userId) || merged.userId <= 0) {
    verificationSessions.delete(senderId)
    return
  }

  verificationSessions.set(senderId, merged)
}

function hasExamAccess(event, authSession, options = {}) {
  if (authSession.role !== 'student') {
    return true
  }

  if (canBypassVerification()) {
    return true
  }

  const senderId = event?.sender?.id
  const state = getVerificationSessionForSender(senderId)
  if (!state || state.userId !== authSession.userId) {
    return false
  }

  const requestedExamId = normalizePositiveInteger(options.examId)
  const verifiedExamId = normalizePositiveInteger(state.examId)

  if (Number.isInteger(state.startedExamAt) && state.startedExamAt > 0) {
    if (!requestedExamId || !verifiedExamId) {
      return true
    }
    return verifiedExamId === requestedExamId
  }

  const verifiedAt = Number(state.verifiedAt || 0)
  const isFreshVerification = Number.isFinite(verifiedAt) && (verifiedAt + VERIFICATION_TTL_MS) > Date.now()
  if (!isFreshVerification) {
    return false
  }

  if (!requestedExamId) {
    return true
  }

  if (!verifiedExamId) {
    return true
  }

  return verifiedExamId === requestedExamId
}

function assertExamAccess(event, authSession, options = {}) {
  if (!hasExamAccess(event, authSession, options)) {
    throw new Error('Complete identity verification before entering the exam.')
  }
}

function createAuthSession({ userId, role, senderId }) {
  pruneExpiredAuthSessions()
  clearVerificationSessionForSender(senderId)
  const token = crypto.randomBytes(32).toString('hex')
  const issuedAt = Date.now()
  const expiresAt = issuedAt + AUTH_TOKEN_TTL_MS
  const session = {
    token,
    userId,
    role: normalizeRole(role),
    senderId,
    issuedAt,
    expiresAt
  }
  authSessions.set(token, session)
  return {
    token,
    expiresAt,
    role: session.role,
    userId: session.userId
  }
}

function readAuthToken(authPayload) {
  if (!authPayload || typeof authPayload !== 'object' || Array.isArray(authPayload)) {
    return null
  }
  const token = authPayload.token
  if (typeof token !== 'string' || !token.trim()) {
    return null
  }
  return token.trim()
}

function resolveAuthSession(event, authPayload, allowedRoles = ['student', 'admin']) {
  pruneExpiredAuthSessions()
  const token = readAuthToken(authPayload)
  if (!token) {
    throw new Error('Unauthorized request')
  }

  const session = authSessions.get(token)
  if (!session) {
    throw new Error('Invalid session token')
  }

  if (session.expiresAt <= Date.now()) {
    authSessions.delete(token)
    throw new Error('Session expired. Please sign in again.')
  }

  if (!event?.sender || session.senderId !== event.sender.id) {
    throw new Error('Session token mismatch')
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
    throw new Error('Forbidden request')
  }

  return session
}

function roleCanNavigate(role, page) {
  const normalizedRole = normalizeRole(role)
  const access = pageAccessByRole[normalizedRole] || pageAccessByRole.guest
  return access.has(page)
}

async function ensureSessionOwnership(sessionId, authSession) {
  const state = await database.getSessionState(sessionId)
  const ownerUserId = Number(state?.userId || 0)
  if (authSession.role !== 'admin' && ownerUserId !== authSession.userId) {
    throw new Error('Forbidden session access')
  }
  return state
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize
  const isDevelopment = String(process.env.NODE_ENV || '').toLowerCase() === 'development'

  mainWindow = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(920, height),
    minWidth: 1100,
    minHeight: 760,
    fullscreen: true,
    frame: false,
    titleBarStyle: 'hidden',
    kiosk: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDevelopment
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'ui', 'login.html'))

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    if (!mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(true)
    }
  })

  mainWindow.on('close', (event) => {
    if (!isExamMode) {
      return
    }
    event.preventDefault()
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['OK'],
      defaultId: 0,
      title: 'Exam Mode Active',
      message: 'Closing the window is disabled during exam mode.',
      detail: 'Use the authorized admin exit shortcut if an emergency exit is required.'
    })
  })

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('file://')) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

function registerAdminShortcut() {
  globalShortcut.register('CommandOrControl+Alt+Shift+Q', async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Exit Exam'],
      defaultId: 0,
      title: 'Exit Exam Mode',
      message: 'Are you sure you want to exit exam mode?',
      detail: 'This action will close the Secure Exam Browser session.'
    })

    if (result.response === 1) {
      isExamMode = false
      app.quit()
    }
  })
}

async function refreshVisionModels() {
  const paths = await modelService.getVisionModelPaths()
  if (paths.detectorPath || paths.fallbackCascadePath) {
    try {
      await visionService.initModels(paths)
    } catch (error) {
      console.warn('Failed to initialize vision models:', error.message)
    }
  }
}

async function initializeServices() {
  await database.initialize()
  await database.pruneExpiredIncidentEvidence().catch((error) => {
    console.warn('Failed to prune expired incident evidence:', toMessage(error))
  })
  await refreshVisionModels()
}

function getDefaultIncidentRetentionDays(severity) {
  const normalized = String(severity || '').toLowerCase().trim()
  const map = PRIVACY_POLICY.retentionDaysBySeverity || {}
  return map[normalized] || map.medium || 45
}

function getPrivacyPolicySnapshot() {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({
      version: PRIVACY_POLICY.version,
      effectiveAt: PRIVACY_POLICY.effectiveAt,
      retentionDaysBySeverity: PRIVACY_POLICY.retentionDaysBySeverity,
      biometricRetentionDays: PRIVACY_POLICY.biometricRetentionDays,
      summary: PRIVACY_POLICY.summary
    }))
    .digest('hex')

  return {
    ...PRIVACY_POLICY,
    hash
  }
}

async function getAudioProctoringPolicy() {
  const audioPaths = await modelService.getAudioModelPaths()
  const audioModelAvailable = Boolean(audioPaths.sileroVadOnnxPath || audioPaths.sileroVadJitPath)
  const keywordModelAvailable = Boolean(audioPaths.porcupineParamsPath)

  return {
    mode: audioModelAvailable ? 'model-preferred' : 'heuristic-fallback',
    audioModelAvailable,
    keywordModelAvailable,
    speechAlertWindowMs: audioModelAvailable ? 4500 : 6000,
    speechCooldownMs: audioModelAvailable ? 30000 : 45000,
    minConsecutiveSpeechFrames: audioModelAvailable ? 9 : 12,
    sampleIntervalMs: 500
  }
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function signIncidentPayloadEnvelope(payload) {
  return crypto
    .createHmac('sha256', INCIDENT_SYNC_SIGNING_SECRET)
    .update(stableSerialize(payload))
    .digest('hex')
}

function canonicalizeIncidentPayload(payload, authSession) {
  assertObject(payload)
  assertString(payload.type, 'incident type')
  assertString(payload.message, 'incident message')

  const severity = String(payload.severity || 'medium').toLowerCase().trim()
  const normalizedSeverity = ['low', 'medium', 'high'].includes(severity) ? severity : 'medium'
  const policy = getPrivacyPolicySnapshot()
  const retentionDays = Number(payload.retentionDays || getDefaultIncidentRetentionDays(normalizedSeverity))

  return {
    userId: authSession.role === 'admin' ? (Number(payload.userId) || authSession.userId) : authSession.userId,
    sessionId: payload.sessionId === null || payload.sessionId === undefined ? null : Number(payload.sessionId),
    type: String(payload.type).trim(),
    severity: normalizedSeverity,
    message: String(payload.message).trim(),
    details: payload.details && typeof payload.details === 'object' && !Array.isArray(payload.details) ? payload.details : {},
    confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null,
    detectorFamily: payload.detectorFamily ? String(payload.detectorFamily).slice(0, 64) : '',
    triggeredRules: Array.isArray(payload.triggeredRules)
      ? payload.triggeredRules.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 32)
      : [],
    evidenceVector: payload.evidenceVector && typeof payload.evidenceVector === 'object' && !Array.isArray(payload.evidenceVector)
      ? payload.evidenceVector
      : {},
    dedupeKey: payload.dedupeKey ? String(payload.dedupeKey).slice(0, 256) : '',
    retentionDays: Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : getDefaultIncidentRetentionDays(normalizedSeverity),
    policyVersion: payload.policyVersion ? String(payload.policyVersion) : policy.version
  }
}

function toMessage(error, fallback = 'Unknown error') {
  if (!error) {
    return fallback
  }
  if (typeof error === 'string') {
    return error
  }
  return error.message || fallback
}

function assertObject(payload, fieldName = 'payload') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Invalid ${fieldName}`)
  }
}

function assertInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${fieldName}`)
  }
}

function assertString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${fieldName}`)
  }
}

function getWindowState() {
  const windowReady = !!mainWindow && !mainWindow.isDestroyed()
  return {
    ready: windowReady,
    fullscreen: windowReady ? mainWindow.isFullScreen() : false,
    focused: windowReady ? mainWindow.isFocused() : false
  }
}

function ensureWindowReady() {
  const state = getWindowState()
  if (!state.ready) {
    throw new Error('Main window unavailable')
  }
  return state
}

function validateSessionStartPayload(payload) {
  assertObject(payload)
  assertInteger(payload.userId, 'userId')
  assertInteger(payload.examId, 'examId')
  assertString(payload.sessionToken, 'sessionToken')
}

function validateMcqPayload(payload) {
  assertObject(payload)
  assertInteger(payload.sessionId, 'sessionId')
  assertInteger(payload.questionId, 'questionId')
  assertInteger(payload.selectedOption, 'selectedOption')
}

function validateCodePayload(payload) {
  assertObject(payload)
  assertInteger(payload.sessionId, 'sessionId')
  assertInteger(payload.questionId, 'questionId')
  assertString(payload.language, 'language')
}

function validateSessionProgressPayload(payload) {
  assertObject(payload)
  assertInteger(payload.sessionId, 'sessionId')
  if (payload.remainingSeconds !== undefined && payload.remainingSeconds !== null) {
    assertInteger(payload.remainingSeconds, 'remainingSeconds')
  }
  if (payload.flaggedQuestionIds !== undefined && !Array.isArray(payload.flaggedQuestionIds)) {
    throw new Error('Invalid flaggedQuestionIds')
  }
}

function validateSubmissionPayload(payload) {
  assertObject(payload)
  assertInteger(payload.sessionId, 'sessionId')
  assertInteger(payload.examId, 'examId')
  assertInteger(payload.userId, 'userId')
  if (payload.timeRemaining !== undefined && payload.timeRemaining !== null) {
    assertInteger(payload.timeRemaining, 'timeRemaining')
  }
  if (payload.flaggedQuestionIds !== undefined && !Array.isArray(payload.flaggedQuestionIds)) {
    throw new Error('Invalid flaggedQuestionIds')
  }
}

function setupIpcHandlers() {
  ipcMain.handle('window-control', async (_event, action) => {
    try {
      ensureWindowReady()
      if (action === 'minimize') {
        mainWindow.minimize()
        return { success: true }
      }
      if (action === 'toggle-maximize') {
        if (mainWindow.isMaximized()) {
          mainWindow.unmaximize()
        } else {
          mainWindow.maximize()
        }
        return { success: true, maximized: mainWindow.isMaximized() }
      }
      if (action === 'close') {
        mainWindow.close()
        return { success: true }
      }
      return { success: false, error: 'Unsupported window control action' }
    } catch (error) {
      return { success: false, error: toMessage(error, 'Window control failed') }
    }
  })

  ipcMain.handle('get-window-state', async () => {
    const state = getWindowState()
    return {
      success: true,
      data: {
        ...state,
        maximized: state.ready ? mainWindow.isMaximized() : false
      }
    }
  })

  ipcMain.handle('navigate-to', async (event, page, auth) => {
    try {
      if (!allowedPages.has(page)) {
        throw new Error('Invalid navigation target')
      }

      if (page === 'login') {
        const token = readAuthToken(auth)
        if (token) {
          const session = authSessions.get(token)
          if (session && session.senderId === event.sender.id) {
            authSessions.delete(token)
          }
        }
      } else {
        const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
        if (!roleCanNavigate(authSession.role, page)) {
          throw new Error('Forbidden navigation target')
        }
        if (page === 'exam') {
          assertExamAccess(event, authSession)
        }
      }

      ensureWindowReady()
      await mainWindow.loadFile(path.join(__dirname, 'ui', `${page}.html`))
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setFullScreen(secureFullscreenPages.has(page))
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: toMessage(error, 'Navigation failed') }
    }
  })

  ipcMain.handle('logout', async (event, auth) => {
    const token = readAuthToken(auth)
    if (token) {
      const session = authSessions.get(token)
      if (session && session.senderId === event.sender.id) {
        authSessions.delete(token)
      }
    }
    clearVerificationSessionForSender(event?.sender?.id)
    return { success: true }
  })

  ipcMain.handle('get-auth-session', async (event) => {
    pruneExpiredAuthSessions()
    let match = null
    for (const session of authSessions.values()) {
      if (session.senderId === event.sender.id) {
        if (!match || session.issuedAt > match.issuedAt) {
          match = session
        }
      }
    }

    if (!match) {
      return { success: false, data: null }
    }

    return {
      success: true,
      data: {
        token: match.token,
        userId: match.userId,
        role: match.role,
        expiresAt: match.expiresAt
      }
    }
  })

  ipcMain.handle('get-system-info', async () => {
    let modelRegistry = []
    try {
      modelRegistry = await modelService.getRegistryWithStatus()
    } catch (error) {
      console.warn('Failed to read model registry:', toMessage(error))
    }
    return {
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      isOnline: true,
      sessionToken: generateSessionToken(),
      runtimeCapabilities,
      modelRegistry,
      timestamp: new Date().toISOString()
    }
  })

  ipcMain.handle('get-runtime-capabilities', async () => ({
    success: true,
    data: runtimeCapabilities
  }))

  ipcMain.handle('get-environment-flags', async () => ({
    success: true,
    data: {
      isPackaged: app.isPackaged,
      isLocalDevelopment: !app.isPackaged,
      allowVerificationBypass: canBypassVerification(),
      visionReady: Boolean(runtimeCapabilities?.python?.visionReady),
      nodeEnv: String(process.env.NODE_ENV || '')
    }
  }))

  ipcMain.handle('get-audio-proctoring-policy', async (event, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    return {
      success: true,
      data: await getAudioProctoringPolicy()
    }
  })

  ipcMain.handle('get-privacy-policy', async (event, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    return {
      success: true,
      data: getPrivacyPolicySnapshot()
    }
  })

  ipcMain.handle('get-privacy-consent-status', async (event, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    const policy = getPrivacyPolicySnapshot()
    const data = await database.getPrivacyConsentStatus({
      userId: authSession.userId,
      policyVersion: policy.version
    })

    return {
      success: true,
      data: {
        ...data,
        currentPolicyVersion: policy.version,
        currentPolicyHash: policy.hash,
        acceptedCurrentVersion: Boolean(data?.exists && data?.accepted && data?.policyVersion === policy.version)
      }
    }
  })

  ipcMain.handle('save-privacy-consent', async (event, payload = {}, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    assertObject(payload)
    const policy = getPrivacyPolicySnapshot()
    const data = await database.savePrivacyConsent({
      userId: authSession.userId,
      policyVersion: policy.version,
      policyHash: policy.hash,
      accepted: payload.accepted !== false,
      policySnapshot: {
        version: policy.version,
        effectiveAt: policy.effectiveAt,
        summary: policy.summary,
        retentionDaysBySeverity: policy.retentionDaysBySeverity,
        biometricRetentionDays: policy.biometricRetentionDays
      },
      machineInfo: payload.machineInfo || {}
    })
    return { success: true, data }
  })

  ipcMain.handle('get-open-source-models', async (event, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    return {
      success: true,
      data: await modelService.getRegistryWithStatus()
    }
  })

  ipcMain.handle('sync-open-source-models', async (event, options = {}, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    const data = await modelService.sync(!!options.force)
    await refreshVisionModels()
    return {
      success: data.every((item) => item.status !== 'failed'),
      data,
      failed: data.filter((item) => item.status === 'failed').length
    }
  })

  ipcMain.handle('get-database-status', async () => database.getDatabaseStatus())

  ipcMain.handle('login', async (event, username, password) => {
    const data = await database.login(username, password)
    for (const [token, session] of authSessions.entries()) {
      if (session.senderId === event.sender.id) {
        authSessions.delete(token)
      }
    }
    clearVerificationSessionForSender(event?.sender?.id)
    const authSession = createAuthSession({ userId: data.userId, role: data.role, senderId: event.sender.id })
    return { success: true, data, authSession }
  })

  ipcMain.handle('get-active-exam', async (event, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    const data = await database.getActiveExam()
    return { success: true, data }
  })

  ipcMain.handle('get-user-profile', async (event, userId, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    if (authSession.role !== 'admin' && authSession.userId !== userId) {
      throw new Error('Forbidden profile access')
    }
    const data = await database.getUserProfile(userId)
    return { success: true, data }
  })

  ipcMain.handle('get-exam-questions', async (event, examId, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    const data = await database.getExamQuestions(examId)
    return { success: true, data }
  })

  ipcMain.handle('start-exam-session', async (event, payload, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    validateSessionStartPayload(payload)
    if (authSession.role !== 'admin' && authSession.userId !== payload.userId) {
      throw new Error('Forbidden session start')
    }
    assertExamAccess(event, authSession, { examId: payload.examId })
    const data = await database.startExamSession(payload)
    setVerificationSessionForSender(event.sender.id, {
      userId: authSession.userId,
      examId: payload.examId,
      startedExamAt: Date.now()
    })
    return { success: true, data }
  })

  ipcMain.handle('end-exam-session', async (event, sessionId, status, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    assertInteger(sessionId, 'sessionId')
    await ensureSessionOwnership(sessionId, authSession)
    await database.endExamSession(sessionId, status)
    clearVerificationSessionForSender(event.sender.id)
    return { success: true }
  })

  ipcMain.handle('ensure-exam-access', async (event, payload = {}, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    assertObject(payload)

    const sessionId = normalizePositiveInteger(payload.sessionId)
    const examId = normalizePositiveInteger(payload.examId)

    if (authSession.role !== 'student' || canBypassVerification()) {
      return { success: true, data: { allowed: true, bypass: true } }
    }

    if (sessionId) {
      const state = await ensureSessionOwnership(sessionId, authSession)
      const stateExamId = normalizePositiveInteger(state?.examId) || examId || undefined
      setVerificationSessionForSender(event.sender.id, {
        userId: authSession.userId,
        examId: stateExamId,
        startedExamAt: Date.now()
      })
      return { success: true, data: { allowed: true, reason: 'existing-session' } }
    }

    assertExamAccess(event, authSession, { examId })
    return { success: true, data: { allowed: true, reason: 'verified' } }
  })

  ipcMain.handle('save-mcq-answer', async (event, payload, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    validateMcqPayload(payload)
    await ensureSessionOwnership(payload.sessionId, authSession)
    await database.saveMcqAnswer(payload)
    return { success: true }
  })

  ipcMain.handle('save-code-answer', async (event, payload, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    validateCodePayload(payload)
    await ensureSessionOwnership(payload.sessionId, authSession)
    await database.saveCodeAnswer(payload)
    return { success: true }
  })

  ipcMain.handle('save-session-progress', async (event, payload, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    validateSessionProgressPayload(payload)
    await ensureSessionOwnership(payload.sessionId, authSession)
    await database.saveSessionProgress(payload)
    return { success: true }
  })

  ipcMain.handle('get-session-state', async (event, sessionId, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    assertInteger(sessionId, 'sessionId')
    const data = await ensureSessionOwnership(sessionId, authSession)
    return { success: true, data }
  })

  ipcMain.handle('run-code', async (event, payload, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    assertObject(payload)
    if (payload.sessionId !== undefined && payload.sessionId !== null) {
      assertInteger(payload.sessionId, 'sessionId')
      await ensureSessionOwnership(payload.sessionId, authSession)
    }
    const result = await codeExecutionService.runCode(payload)
    return result
  })

  ipcMain.handle('save-exam-submission', async (event, payload, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    validateSubmissionPayload(payload)
    if (authSession.role !== 'admin' && authSession.userId !== payload.userId) {
      throw new Error('Forbidden submission request')
    }
    await ensureSessionOwnership(payload.sessionId, authSession)
    const data = await database.saveExamSubmission(payload)
    return { success: true, data }
  })

  ipcMain.handle('get-submission-summary', async (event, sessionId, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    assertInteger(sessionId, 'sessionId')
    await ensureSessionOwnership(sessionId, authSession)
    const data = await database.getSubmissionSummary(sessionId)
    return { success: true, data }
  })

  ipcMain.handle('get-dashboard-stats', async (event, auth) => {
    resolveAuthSession(event, auth, ['admin'])
    return {
      success: true,
      data: await database.getDashboardStats()
    }
  })

  ipcMain.handle('get-admin-exams', async (event, auth) => {
    resolveAuthSession(event, auth, ['admin'])
    return {
      success: true,
      data: await database.getAdminExams()
    }
  })

  ipcMain.handle('get-admin-users', async (event, auth) => {
    resolveAuthSession(event, auth, ['admin'])
    return {
      success: true,
      data: await database.getAdminUsers()
    }
  })

  ipcMain.handle('get-active-sessions', async (event, auth) => {
    resolveAuthSession(event, auth, ['admin'])
    return {
      success: true,
      data: await database.getActiveSessions(100)
    }
  })

  ipcMain.handle('get-recent-submissions', async (event, auth) => {
    resolveAuthSession(event, auth, ['admin'])
    return {
      success: true,
      data: await database.getRecentSubmissions()
    }
  })

  ipcMain.handle('get-recent-incidents', async (event, auth) => {
    resolveAuthSession(event, auth, ['admin'])
    return {
      success: true,
      data: await database.getRecentIncidents()
    }
  })

  ipcMain.handle('get-fairness-benchmark-summary', async (event, payload = {}, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    const limitDays = Number(payload?.limitDays || 30)
    return {
      success: true,
      data: await database.getFairnessBenchmarkSummary(Number.isFinite(limitDays) ? limitDays : 30)
    }
  })

  ipcMain.handle('record-fairness-benchmark', async (event, payload = {}, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    assertObject(payload)
    if (authSession.role !== 'admin') {
      payload.userId = authSession.userId
    }
    const data = await database.recordFairnessBenchmark(payload)
    return { success: true, data }
  })

  ipcMain.handle('sign-incident-payload', async (event, payload = {}, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    const normalizedPayload = canonicalizeIncidentPayload(payload, authSession)
    const signature = signIncidentPayloadEnvelope(normalizedPayload)
    return {
      success: true,
      data: {
        payload: normalizedPayload,
        signature,
        signatureVersion: INCIDENT_SYNC_SIGNATURE_VERSION,
        signedAt: Date.now()
      }
    }
  })

  ipcMain.handle('sync-incident-queue', async (event, payload = {}, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    assertObject(payload)
    const items = Array.isArray(payload.items) ? payload.items : []
    if (items.length > INCIDENT_SYNC_MAX_BATCH) {
      throw new Error(`Queue batch exceeds limit (${INCIDENT_SYNC_MAX_BATCH})`)
    }

    const acceptedIndices = []
    const droppedIndices = []

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      try {
        assertObject(item, 'queue item')
        const queuedAt = Number(item.queuedAt || Date.now())
        if (!Number.isFinite(queuedAt) || (Date.now() - queuedAt) > INCIDENT_SYNC_MAX_AGE_MS) {
          droppedIndices.push(index)
          continue
        }

        assertObject(item.payload, 'incident payload')
        assertString(item.signature, 'incident signature')
        const expected = signIncidentPayloadEnvelope(item.payload)
        if (expected !== item.signature) {
          droppedIndices.push(index)
          continue
        }

        const normalizedPayload = canonicalizeIncidentPayload(item.payload, authSession)
        if (normalizedPayload.sessionId !== null && normalizedPayload.sessionId !== undefined) {
          await ensureSessionOwnership(normalizedPayload.sessionId, authSession)
        }

        await database.recordIncident(normalizedPayload)
        acceptedIndices.push(index)
      } catch {
        droppedIndices.push(index)
      }
    }

    return {
      success: true,
      data: {
        acceptedIndices,
        droppedIndices,
        processedAt: Date.now(),
        signatureVersion: INCIDENT_SYNC_SIGNATURE_VERSION
      }
    }
  })

  ipcMain.handle('record-incident', async (event, payload, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    const normalizedPayload = canonicalizeIncidentPayload(payload, authSession)

    if (normalizedPayload.sessionId !== null && normalizedPayload.sessionId !== undefined) {
      assertInteger(normalizedPayload.sessionId, 'sessionId')
      await ensureSessionOwnership(normalizedPayload.sessionId, authSession)
    }

    await database.recordIncident(normalizedPayload)
    return { success: true }
  })

  ipcMain.handle('update-incident-status', async (event, incidentId, status, note = '', auth) => {
    resolveAuthSession(event, auth, ['admin'])
    assertInteger(incidentId, 'incidentId')
    assertString(status, 'status')
    const data = await database.updateIncidentStatus(incidentId, status, note)
    return { success: true, data }
  })

  ipcMain.handle('get-lock-status', async (event, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    const state = getWindowState()
    return {
      enabled: isExamMode && state.fullscreen,
      examMode: isExamMode,
      fullscreen: state.fullscreen,
      focused: state.focused
    }
  })

  ipcMain.handle('set-fullscreen', async (event, enabled, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    try {
      ensureWindowReady()
    } catch (error) {
      return { success: false, error: 'Main window unavailable' }
    }
    mainWindow.setFullScreen(Boolean(enabled))
    return { success: true, fullscreen: mainWindow.isFullScreen() }
  })

  ipcMain.handle('save-biometric-data', async (event, userId, biometricType, payload, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    assertInteger(userId, 'userId')
    assertString(biometricType, 'biometricType')
    assertObject(payload)
    if (authSession.role !== 'admin' && authSession.userId !== userId) {
      throw new Error('Forbidden biometric write')
    }
    await database.saveBiometricData(userId, biometricType, payload)
    return { success: true }
  })

  ipcMain.handle('enroll-identity', async (event, payload, auth) => {
    const authSession = resolveAuthSession(event, auth, ['student', 'admin'])
    const data = await visionService.enrollIdentity(payload)
    const enrollmentSucceeded = data?.success !== false

    if (enrollmentSucceeded) {
      const examId = normalizePositiveInteger(payload?.examId) || undefined
      setVerificationSessionForSender(event.sender.id, {
        userId: authSession.userId,
        examId,
        verifiedAt: Date.now()
      })
    }

    return { success: enrollmentSucceeded, ...data }
  })

  ipcMain.handle('verify-frame', async (event, payload, auth) => {
    resolveAuthSession(event, auth, ['student', 'admin'])
    return visionService.verifyFrame(payload)
  })

  ipcMain.handle('exit-app', async (event, auth) => {
    resolveAuthSession(event, auth, ['admin'])
    isExamMode = false
    app.quit()
  })
}

app.whenReady().then(async () => {
  try {
    await initializeServices()
  } catch (error) {
    console.error('Failed to initialize services:', error)
  }

  createWindow()
  setupIpcHandlers()
  registerAdminShortcut()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  visionService.dispose()
})


