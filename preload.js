const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  navigateTo: (page) => ipcRenderer.invoke('navigate-to', page),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getRuntimeCapabilities: () => ipcRenderer.invoke('get-runtime-capabilities'),

  login: (username, password) => ipcRenderer.invoke('login', username, password),
  getUserProfile: (userId) => ipcRenderer.invoke('get-user-profile', userId),

  getActiveExam: () => ipcRenderer.invoke('get-active-exam'),
  getExamQuestions: (examId) => ipcRenderer.invoke('get-exam-questions', examId),
  startExamSession: (payload) => ipcRenderer.invoke('start-exam-session', payload),
  endExamSession: (sessionId, status) => ipcRenderer.invoke('end-exam-session', sessionId, status),
  saveMCQAnswer: (payload) => ipcRenderer.invoke('save-mcq-answer', payload),
  saveCodeAnswer: (payload) => ipcRenderer.invoke('save-code-answer', payload),
  saveSessionProgress: (payload) => ipcRenderer.invoke('save-session-progress', payload),
  getSessionState: (sessionId) => ipcRenderer.invoke('get-session-state', sessionId),
  runCode: (payload) => ipcRenderer.invoke('run-code', payload),
  saveExamSubmission: (payload) => ipcRenderer.invoke('save-exam-submission', payload),
  getSubmissionSummary: (sessionId) => ipcRenderer.invoke('get-submission-summary', sessionId),

  getDashboardStats: () => ipcRenderer.invoke('get-dashboard-stats'),
  getActiveSessions: () => ipcRenderer.invoke('get-active-sessions'),
  getRecentSubmissions: () => ipcRenderer.invoke('get-recent-submissions'),
  getRecentIncidents: () => ipcRenderer.invoke('get-recent-incidents'),
  recordIncident: (payload) => ipcRenderer.invoke('record-incident', payload),
  getDatabaseStatus: () => ipcRenderer.invoke('get-database-status'),
  getLockStatus: () => ipcRenderer.invoke('get-lock-status'),
  setFullscreen: (enabled) => ipcRenderer.invoke('set-fullscreen', enabled),

  verifyFrame: (payload) => ipcRenderer.invoke('verify-frame', payload),
  enrollIdentity: (payload) => ipcRenderer.invoke('enroll-identity', payload),
  saveBiometricData: (userId, biometricType, payload) => ipcRenderer.invoke('save-biometric-data', userId, biometricType, payload),
  getOpenSourceModels: () => ipcRenderer.invoke('get-open-source-models'),
  syncOpenSourceModels: (options) => ipcRenderer.invoke('sync-open-source-models', options),

  exitApp: () => ipcRenderer.invoke('exit-app'),

  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron
  }
})
