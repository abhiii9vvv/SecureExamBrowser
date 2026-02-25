const { app, BrowserWindow, globalShortcut, ipcMain, dialog, screen } = require('electron')
const path = require('node:path')

// Global variables
let mainWindow = null
let isExamMode = true
let adminExitAttempts = 0

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

  // Load the login screen
  mainWindow.loadFile('ui/login.html')
  
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
      arch: process.arch,
      version: app.getVersion(),
      isOnline: true, // Can be enhanced with actual check
      sessionId: generateSessionId(),
      timestamp: new Date().toISOString()
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

app.whenReady().then(async () => {
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