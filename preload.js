const { contextBridge, ipcRenderer } = require('electron')

let authToken = null

async function ensureAuthToken() {
  if (authToken) {
    return authToken
  }

  const session = await ipcRenderer.invoke('get-auth-session')
  if (session?.success && session?.data?.token) {
    authToken = session.data.token
    return authToken
  }

  throw new Error('Authentication required')
}

function authPayload() {
  return { token: authToken }
}

async function invokeProtected(channel, ...args) {
  await ensureAuthToken()
  return ipcRenderer.invoke(channel, ...args, authPayload())
}

async function clearAuthSession() {
  if (!authToken) {
    return
  }

  try {
    await ipcRenderer.invoke('logout', authPayload())
  } catch (_error) {
    // Keep logout resilient even if the main process has already revoked this token.
  } finally {
    authToken = null
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  windowControl: (action) => ipcRenderer.invoke('window-control', action),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),

  navigateTo: async (page) => {
    if (page === 'login') {
      await clearAuthSession()
      return ipcRenderer.invoke('navigate-to', page)
    }
    return invokeProtected('navigate-to', page)
  },
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getRuntimeCapabilities: () => ipcRenderer.invoke('get-runtime-capabilities'),
  getEnvironmentFlags: () => ipcRenderer.invoke('get-environment-flags'),
  getAudioProctoringPolicy: () => invokeProtected('get-audio-proctoring-policy'),
  getPrivacyPolicy: () => invokeProtected('get-privacy-policy'),
  getPrivacyConsentStatus: () => invokeProtected('get-privacy-consent-status'),
  savePrivacyConsent: (payload) => invokeProtected('save-privacy-consent', payload),

  login: async (username, password) => {
    const result = await ipcRenderer.invoke('login', username, password)
    if (result?.success && result?.authSession?.token) {
      authToken = result.authSession.token
      delete result.authSession
    }
    return result
  },
  logout: () => clearAuthSession(),
  getUserProfile: (userId) => invokeProtected('get-user-profile', userId),

  getActiveExam: () => invokeProtected('get-active-exam'),
  getExamQuestions: (examId) => invokeProtected('get-exam-questions', examId),
  ensureExamAccess: (payload) => invokeProtected('ensure-exam-access', payload),
  startExamSession: (payload) => invokeProtected('start-exam-session', payload),
  endExamSession: (sessionId, status) => invokeProtected('end-exam-session', sessionId, status),
  saveMCQAnswer: (payload) => invokeProtected('save-mcq-answer', payload),
  saveCodeAnswer: (payload) => invokeProtected('save-code-answer', payload),
  saveSessionProgress: (payload) => invokeProtected('save-session-progress', payload),
  getSessionState: (sessionId) => invokeProtected('get-session-state', sessionId),
  runCode: (payload) => invokeProtected('run-code', payload),
  saveExamSubmission: (payload) => invokeProtected('save-exam-submission', payload),
  getSubmissionSummary: (sessionId) => invokeProtected('get-submission-summary', sessionId),

  getDashboardStats: () => invokeProtected('get-dashboard-stats'),
  getAdminExams: () => invokeProtected('get-admin-exams'),
  getAdminUsers: () => invokeProtected('get-admin-users'),
  getActiveSessions: () => invokeProtected('get-active-sessions'),
  getRecentSubmissions: () => invokeProtected('get-recent-submissions'),
  getRecentIncidents: () => invokeProtected('get-recent-incidents'),
  getFairnessBenchmarkSummary: (payload) => invokeProtected('get-fairness-benchmark-summary', payload || {}),
  recordFairnessBenchmark: (payload) => invokeProtected('record-fairness-benchmark', payload),
  signIncidentPayload: (payload) => invokeProtected('sign-incident-payload', payload),
  syncIncidentQueue: (payload) => invokeProtected('sync-incident-queue', payload),
  recordIncident: (payload) => invokeProtected('record-incident', payload),
  updateIncidentStatus: (incidentId, status, note) => invokeProtected('update-incident-status', incidentId, status, note),
  getDatabaseStatus: () => ipcRenderer.invoke('get-database-status'),
  getLockStatus: () => invokeProtected('get-lock-status'),
  setFullscreen: (enabled) => invokeProtected('set-fullscreen', enabled),

  verifyFrame: (payload) => invokeProtected('verify-frame', payload),
  enrollIdentity: (payload) => invokeProtected('enroll-identity', payload),
  saveBiometricData: (userId, biometricType, payload) => invokeProtected('save-biometric-data', userId, biometricType, payload),
  getOpenSourceModels: () => invokeProtected('get-open-source-models'),
  syncOpenSourceModels: (options) => invokeProtected('sync-open-source-models', options),

  exitApp: () => invokeProtected('exit-app'),

  versions: {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron
  }
})
