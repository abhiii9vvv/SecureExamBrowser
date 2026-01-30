const { app, BrowserWindow, globalShortcut, ipcMain, dialog, screen } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')
const DatabaseService = require('./database/database')

// Global variables
let mainWindow = null
let isExamMode = true
let adminExitAttempts = 0
const db = new DatabaseService()
let dbReady = false
let dbLastError = null

// Verification process state
let verifyProc = null
let verifyBuffer = ''
let verifyRequestId = 0
const verifyPending = new Map()

function startVerifyProcess() {
  if (verifyProc) return

  const scriptPath = path.join(__dirname, 'secure_exam_proctoring', 'src', 'verify_server.py')
  console.log('Starting Python verification process:', scriptPath)
  verifyProc = spawn('python', ['-u', scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })
  
  console.log('Python process spawned, PID:', verifyProc.pid)

  verifyProc.stdout.on('data', (data) => {
    verifyBuffer += data.toString()
    let lineIndex
    while ((lineIndex = verifyBuffer.indexOf('\n')) >= 0) {
      const line = verifyBuffer.slice(0, lineIndex).trim()
      verifyBuffer = verifyBuffer.slice(lineIndex + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        const pending = verifyPending.get(msg.id)
        if (pending) {
          verifyPending.delete(msg.id)
          pending.resolve(msg)
        }
      } catch (error) {
        console.error('Verification parse error:', error)
      }
    }
  })

  verifyProc.stderr.on('data', (data) => {
    console.error('Verification stderr:', data.toString())
  })

  verifyProc.on('exit', (code) => {
    console.warn(`Verification process exited: ${code}`)
    for (const pending of verifyPending.values()) {
      pending.reject(new Error('Verification process exited'))
    }
    verifyPending.clear()
    verifyProc = null
  })
}

function sendVerifyRequest(payload) {
  startVerifyProcess()
  const id = ++verifyRequestId
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      verifyPending.delete(id)
      reject(new Error('Verification timeout after 5s'))
    }, 5000)
    
    verifyPending.set(id, { 
      resolve: (msg) => {
        clearTimeout(timeout)
        resolve(msg)
      }, 
      reject: (err) => {
        clearTimeout(timeout)
        reject(err)
      }
    })
    
    const message = JSON.stringify({ id, ...payload }) + '\n'
    try {
      verifyProc.stdin.write(message)
    } catch (error) {
      clearTimeout(timeout)
      verifyPending.delete(id)
      reject(error)
    }
  })
}

// Initialize database connection
async function initDatabase() {
  try {
    await db.connect()
    dbReady = true
    dbLastError = null
    console.log('✅ Database initialized')
  } catch (error) {
    dbReady = false
    dbLastError = error.message
    console.error('⚠️ Database connection failed - running in offline mode')
  }
}

function createWindow () {
  // Get primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: false, // Development mode - allow windowed
    frame: true, // Show window frame with controls
    kiosk: false, // Development mode - kiosk disabled
    alwaysOnTop: false, // Allow other windows on top
    closable: true, // Allow closing normally
    minimizable: true,
    maximizable: true,
    resizable: true,
    skipTaskbar: false, // Show in taskbar
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true // Enable dev tools for development
    }
  })

  // Load the launch screen
  mainWindow.loadFile('ui/launch.html')
  
  // Development mode - allow closing without restrictions
  mainWindow.on('close', (e) => {
    // isExamMode check disabled for development
    console.log('✅ Window closing allowed (development mode)')
    // if (isExamMode) {
    //   e.preventDefault()
    //   console.log('⚠️ Window close blocked - exam mode active')
    //   mainWindow.webContents.send('exit-blocked', {
    //     message: 'Exit blocked. Use admin shortcut to exit.',
    //     attempts: adminExitAttempts++
    //   })
    // }
  })

  // Development mode - keyboard shortcuts enabled
  // mainWindow.webContents.on('before-input-event', (event, input) => {
  //   // Block F11, Escape, Alt+F4, etc.
  //   if (
  //     input.key === 'F11' ||
  //     input.key === 'Escape' ||
  //     (input.alt && input.key === 'F4') ||
  //     (input.alt && input.key === 'Tab') ||
  //     (input.control && input.key === 'w') ||
  //     (input.control && input.shift && input.key === 'q')
  //   ) {
  //     event.preventDefault()
  //     console.log('🚫 Blocked shortcut:', input.key)
  //   }
  // })

  // Prevent navigation away from exam
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow navigation within our app only
    if (!url.includes('file://')) {
      event.preventDefault()
      console.log('🚫 External navigation blocked:', url)
    }
  })

  // Setup IPC handlers
  setupIpcHandlers()
  
  // Register admin exit shortcut
  registerAdminShortcut()
}

// Register admin exit shortcut: Ctrl+Alt+Shift+Q
function registerAdminShortcut() {
  const ret = globalShortcut.register('CommandOrControl+Alt+Shift+Q', () => {
    console.log('🔑 Admin exit shortcut triggered')
    showExitDialog()
  })

  if (!ret) {
    console.error('❌ Failed to register admin shortcut')
  } else {
    console.log('✅ Admin exit shortcut registered (Ctrl+Alt+Shift+Q)')
  }
}

// Show exit confirmation dialog
async function showExitDialog() {
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Exit Exam'],
    defaultId: 0,
    title: 'Exit Exam Mode',
    message: 'Are you sure you want to exit?',
    detail: 'This will terminate the exam session. This action will be logged.'
  })

  if (response.response === 1) {
    console.log('🚪 Admin authorized exit')
    isExamMode = false
    
    // Log the exit
    try {
      await logActivity('ADMIN_EXIT', 'Admin force exit using shortcut')
    } catch (error) {
      console.error('Failed to log exit:', error)
    }
    
    app.quit()
  }
}

// Setup IPC communication handlers
function setupIpcHandlers() {
  // Handle page navigation
  ipcMain.handle('navigate-to', async (event, page) => {
    try {
      const filePath = path.join(__dirname, 'ui', `${page}.html`)
      await mainWindow.loadFile(filePath)
      return { success: true }
    } catch (error) {
      console.error('Navigation error:', error)
      return { success: false, error: error.message }
    }
  })

  // Get system info
  ipcMain.handle('get-system-info', async () => {
    return {
      platform: process.platform,
      version: app.getVersion(),
      isOnline: true, // Can be enhanced with actual check
      sessionId: generateSessionId(),
      timestamp: new Date().toISOString()
    }
  })

  // Database query handler
  ipcMain.handle('db-query', async (event, sql, params) => {
    try {
      const result = await db.query(sql, params)
      return { success: true, data: result }
    } catch (error) {
      console.error('Database query error:', error)
      return { success: false, error: error.message }
    }
  })

  // Database status
  ipcMain.handle('get-db-status', async () => {
    return {
      connected: dbReady,
      error: dbLastError
    }
  })

  // Dashboard stats
  ipcMain.handle('get-dashboard-stats', async () => {
    try {
      const stats = await db.getDashboardStats()
      return { success: true, data: stats }
    } catch (error) {
      console.error('Dashboard stats error:', error)
      return { success: false, error: error.message }
    }
  })

  // Active sessions
  ipcMain.handle('get-active-sessions', async () => {
    try {
      const sessions = await db.getActiveSessions()
      return { success: true, data: sessions }
    } catch (error) {
      console.error('Active sessions error:', error)
      return { success: false, error: error.message }
    }
  })

  // User profile
  ipcMain.handle('get-user-profile', async (event, userId) => {
    try {
      const user = await db.getUserById(userId)
      return { success: true, data: user }
    } catch (error) {
      console.error('User profile error:', error)
      return { success: false, error: error.message }
    }
  })

  // Active exam (first available)
  ipcMain.handle('get-active-exam', async () => {
    try {
      const exams = await db.getActiveExams()
      return { success: true, data: exams && exams.length > 0 ? exams[0] : null }
    } catch (error) {
      console.error('Active exam error:', error)
      return { success: false, error: error.message }
    }
  })

  // Start exam session
  ipcMain.handle('start-exam-session', async (event, payload) => {
    try {
      const sessionId = await db.startSession(payload)
      return { success: true, data: { sessionId } }
    } catch (error) {
      console.error('Start session error:', error)
      return { success: false, error: error.message }
    }
  })

  // End exam session
  ipcMain.handle('end-exam-session', async (event, sessionId, status) => {
    try {
      await db.endSession(sessionId, status)
      return { success: true }
    } catch (error) {
      console.error('End session error:', error)
      return { success: false, error: error.message }
    }
  })

  // Save exam submission
  ipcMain.handle('save-exam-submission', async (event, submissionData) => {
    try {
      const submissionId = await db.saveExamSubmission(submissionData)
      return { success: true, data: { submissionId } }
    } catch (error) {
      console.error('Save submission error:', error)
      return { success: false, error: error.message }
    }
  })

  // Save biometric data
  ipcMain.handle('save-biometric-data', async (event, userId, biometricType, data) => {
    try {
      await db.saveBiometricData(userId, biometricType, data)
      return { success: true }
    } catch (error) {
      console.error('Save biometric error:', error)
      return { success: false, error: error.message }
    }
  })

  // Log activity
  ipcMain.handle('log-activity', async (event, type, details) => {
    return await logActivity(type, details)
  })

  // AI verification
  ipcMain.handle('verify-frame', async (event, payload) => {
    try {
      return await sendVerifyRequest({ image: payload.image })
    } catch (error) {
      return { error: error.message }
    }
  })

  ipcMain.handle('enroll-identity', async (event, payload) => {
    try {
      return await sendVerifyRequest({ image: payload.image, enroll: true })
    } catch (error) {
      return { error: error.message }
    }
  })

  // Exit app (for admin)
  ipcMain.handle('exit-app', async () => {
    showExitDialog()
  })
}

// Generate session ID
function generateSessionId() {
  return 'SES-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase()
}

// Log activity to database
async function logActivity(type, details) {
  try {
    if (db.pool) {
      if (!details || !details.session_id) {
        return { success: false, error: 'session_id required for activity log' }
      }

      await db.logActivity({
        session_id: details.session_id,
        activity_type: type,
        activity_data: details
      })
      return { success: true }
    }
    return { success: false, error: 'Database not connected' }
  } catch (error) {
    console.error('Failed to log activity:', error)
    return { success: false, error: error.message }
  }
}

app.whenReady().then(async () => {
  await initDatabase()
  createWindow()

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

// Cleanup on exit
app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll()
  console.log('🔓 Admin shortcuts unregistered')
})