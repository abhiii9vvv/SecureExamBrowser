const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } = require('electron')
const path = require('node:path')

const { DatabaseService } = require('./backend/database')
const { getRuntimeCapabilities } = require('./backend/runtime-service')
const { CodeExecutionService } = require('./backend/code-execution')
const { ModelService } = require('./backend/model-service')
const { VisionService } = require('./backend/vision-service')

let mainWindow = null
let isExamMode = true

const allowedPages = new Set(['login', 'dashboard', 'student-dashboard', 'launch', 'verification', 'exam', 'submission'])
const secureFullscreenPages = new Set(['launch', 'verification', 'exam', 'submission'])
const rootDir = __dirname

const runtimeCapabilities = getRuntimeCapabilities(rootDir)
const database = new DatabaseService({ rootDir, pythonCommand: runtimeCapabilities.python.sqliteCommand || runtimeCapabilities.python.command || 'python' })
const modelService = new ModelService({ rootDir, database })
const visionService = new VisionService({ rootDir, pythonCommand: runtimeCapabilities.python.visionCommand || null })
const codeExecutionService = new CodeExecutionService({ database, runtimeCapabilities })

function generateSessionToken() {
  return `SES-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  mainWindow = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(920, height),
    minWidth: 1100,
    minHeight: 760,
    fullscreen: false,
    frame: true,
    kiosk: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'ui', 'login.html'))

  mainWindow.on('close', (event) => {
    if (!isExamMode) {
      return
    }
    console.log('Window close requested while exam mode is active')
  })

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('file://')) {
      event.preventDefault()
    }
  })
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
  await refreshVisionModels()
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
  ipcMain.handle('navigate-to', async (event, page) => {
    try {
      if (!allowedPages.has(page)) {
        throw new Error('Invalid navigation target')
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

  ipcMain.handle('get-open-source-models', async () => ({
    success: true,
    data: await modelService.getRegistryWithStatus()
  }))

  ipcMain.handle('sync-open-source-models', async (event, options = {}) => {
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
    return { success: true, data }
  })

  ipcMain.handle('get-active-exam', async () => {
    const data = await database.getActiveExam()
    return { success: true, data }
  })

  ipcMain.handle('get-user-profile', async (event, userId) => {
    const data = await database.getUserProfile(userId)
    return { success: true, data }
  })

  ipcMain.handle('get-exam-questions', async (event, examId) => {
    const data = await database.getExamQuestions(examId)
    return { success: true, data }
  })

  ipcMain.handle('start-exam-session', async (event, payload) => {
    validateSessionStartPayload(payload)
    const data = await database.startExamSession(payload)
    return { success: true, data }
  })

  ipcMain.handle('end-exam-session', async (event, sessionId, status) => {
    assertInteger(sessionId, 'sessionId')
    await database.endExamSession(sessionId, status)
    return { success: true }
  })

  ipcMain.handle('save-mcq-answer', async (event, payload) => {
    validateMcqPayload(payload)
    await database.saveMcqAnswer(payload)
    return { success: true }
  })

  ipcMain.handle('save-code-answer', async (event, payload) => {
    validateCodePayload(payload)
    await database.saveCodeAnswer(payload)
    return { success: true }
  })

  ipcMain.handle('save-session-progress', async (event, payload) => {
    validateSessionProgressPayload(payload)
    await database.saveSessionProgress(payload)
    return { success: true }
  })

  ipcMain.handle('get-session-state', async (event, sessionId) => {
    assertInteger(sessionId, 'sessionId')
    const data = await database.getSessionState(sessionId)
    return { success: true, data }
  })

  ipcMain.handle('run-code', async (event, payload) => {
    const result = await codeExecutionService.runCode(payload)
    return result
  })

  ipcMain.handle('save-exam-submission', async (event, payload) => {
    validateSubmissionPayload(payload)
    const data = await database.saveExamSubmission(payload)
    return { success: true, data }
  })

  ipcMain.handle('get-submission-summary', async (event, sessionId) => {
    assertInteger(sessionId, 'sessionId')
    const data = await database.getSubmissionSummary(sessionId)
    return { success: true, data }
  })

  ipcMain.handle('get-dashboard-stats', async () => ({
    success: true,
    data: await database.getDashboardStats()
  }))

  ipcMain.handle('get-active-sessions', async () => ({
    success: true,
    data: await database.getActiveSessions(100)
  }))

  ipcMain.handle('get-recent-submissions', async () => ({
    success: true,
    data: await database.getRecentSubmissions()
  }))

  ipcMain.handle('get-recent-incidents', async () => ({
    success: true,
    data: await database.getRecentIncidents()
  }))

  ipcMain.handle('record-incident', async (event, payload) => {
    assertObject(payload)
    assertString(payload.type, 'incident type')
    assertString(payload.message, 'incident message')
    await database.recordIncident(payload)
    return { success: true }
  })

  ipcMain.handle('get-lock-status', async () => {
    const state = getWindowState()
    return {
      enabled: isExamMode && state.fullscreen,
      examMode: isExamMode,
      fullscreen: state.fullscreen,
      focused: state.focused
    }
  })

  ipcMain.handle('set-fullscreen', async (event, enabled) => {
    try {
      ensureWindowReady()
    } catch (error) {
      return { success: false, error: 'Main window unavailable' }
    }
    mainWindow.setFullScreen(Boolean(enabled))
    return { success: true, fullscreen: mainWindow.isFullScreen() }
  })

  ipcMain.handle('save-biometric-data', async (event, userId, biometricType, payload) => {
    assertInteger(userId, 'userId')
    assertString(biometricType, 'biometricType')
    assertObject(payload)
    await database.saveBiometricData(userId, biometricType, payload)
    return { success: true }
  })

  ipcMain.handle('enroll-identity', async (event, payload) => {
    const data = await visionService.enrollIdentity(payload)
    return { success: true, ...data }
  })

  ipcMain.handle('verify-frame', async (event, payload) => visionService.verifyFrame(payload))

  ipcMain.handle('exit-app', async () => {
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


