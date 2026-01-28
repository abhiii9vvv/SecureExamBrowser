const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Navigation
  navigateTo: (page) => ipcRenderer.invoke('navigate-to', page),
  
  // System info
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  
  // Database operations
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),
  
  // Activity logging
  logActivity: (type, details) => ipcRenderer.invoke('log-activity', type, details),
  
  // Exit app
  exitApp: () => ipcRenderer.invoke('exit-app'),
  
  // Listen to events from main process
  onExitBlocked: (callback) => ipcRenderer.on('exit-blocked', callback),
  
  // Get versions
  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron
  }
})

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }
  
  console.log('🔒 Secure Exam Browser - Preload script loaded')
  console.log('🔑 Admin Exit: Press Ctrl+Alt+Shift+Q')
})