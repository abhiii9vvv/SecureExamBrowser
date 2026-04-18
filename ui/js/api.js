/**
 * api.js — Thin wrapper around window.electronAPI with
 * consistent error normalization.  All renderer code should
 * use these helpers instead of calling electronAPI directly.
 */

function getAPI() {
  if (!window.electronAPI) {
    throw new Error('electronAPI not available — are you running inside Electron?')
  }
  return window.electronAPI
}

function toError(err, fallback = 'An unexpected error occurred.') {
  if (!err) return fallback
  if (typeof err === 'string') return err
  return err.message || fallback
}

async function safe(fn, fallback = null) {
  try {
    return await fn()
  } catch (err) {
    console.error('[API]', err)
    return fallback
  }
}

/* ----- Auth ----- */
export async function login(username, password) {
  const result = await getAPI().login(username, password)
  if (!result?.success) throw new Error(result?.error || 'Login failed')
  return result.data
}

export async function logout() {
  await safe(() => getAPI().logout())
}

export async function getUserProfile(userId) {
  const result = await getAPI().getUserProfile(userId)
  if (!result?.success) throw new Error(result?.error || 'Failed to load profile')
  return result.data
}

/* ----- Navigation ----- */
export async function navigateTo(page) {
  const result = await getAPI().navigateTo(page)
  if (!result?.success) throw new Error(result?.error || `Navigation to ${page} failed`)
  return true
}

/* ----- System ----- */
export async function getSystemInfo() {
  return safe(() => getAPI().getSystemInfo(), {})
}

export async function getRuntimeCapabilities() {
  const result = await safe(() => getAPI().getRuntimeCapabilities(), { success: false })
  return result?.data || {}
}

export async function getDatabaseStatus() {
  return safe(() => getAPI().getDatabaseStatus(), { connected: false })
}

/* ----- Exam ----- */
export async function getActiveExam() {
  const result = await getAPI().getActiveExam()
  if (!result?.success) throw new Error(result?.error || 'Failed to load exam')
  return result.data
}

export async function getExamQuestions(examId) {
  const result = await getAPI().getExamQuestions(examId)
  if (!result?.success) throw new Error(result?.error || 'Failed to load questions')
  return result.data
}

export async function startExamSession(payload) {
  const result = await getAPI().startExamSession(payload)
  if (!result?.success) throw new Error(result?.error || 'Failed to start session')
  return result.data
}

export async function endExamSession(sessionId, status) {
  const result = await getAPI().endExamSession(sessionId, status)
  if (!result?.success) throw new Error(result?.error || 'Failed to end session')
  return result
}

export async function saveMCQAnswer(payload) {
  const result = await getAPI().saveMCQAnswer(payload)
  if (!result?.success) throw new Error(result?.error || 'Failed to save answer')
  return result
}

export async function saveCodeAnswer(payload) {
  const result = await getAPI().saveCodeAnswer(payload)
  if (!result?.success) throw new Error(result?.error || 'Failed to save code')
  return result
}

export async function saveSessionProgress(payload) {
  const result = await getAPI().saveSessionProgress(payload)
  if (!result?.success) throw new Error(result?.error || 'Failed to sync progress')
  return result
}

export async function getSessionState(sessionId) {
  const result = await getAPI().getSessionState(sessionId)
  if (!result?.success) throw new Error(result?.error || 'Failed to get session state')
  return result.data
}

export async function saveExamSubmission(payload) {
  const result = await getAPI().saveExamSubmission(payload)
  if (!result?.success) throw new Error(result?.error || 'Failed to submit exam')
  return result.data
}

export async function getSubmissionSummary(sessionId) {
  const result = await getAPI().getSubmissionSummary(sessionId)
  if (!result?.success) throw new Error(result?.error || 'Failed to load summary')
  return result.data
}

export async function runCode(payload) {
  return getAPI().runCode(payload)
}

/* ----- Admin ----- */
export async function getDashboardStats() {
  const result = await getAPI().getDashboardStats()
  if (!result?.success) throw new Error(result?.error || 'Failed to load stats')
  return result.data
}

export async function getAdminExams() {
  const result = await getAPI().getAdminExams()
  if (!result?.success) throw new Error(result?.error || 'Failed to load exams')
  return result.data
}

export async function getAdminUsers() {
  const result = await getAPI().getAdminUsers()
  if (!result?.success) throw new Error(result?.error || 'Failed to load users')
  return result.data
}

export async function getActiveSessions() {
  const result = await getAPI().getActiveSessions()
  if (!result?.success) throw new Error(result?.error || 'Failed to load sessions')
  return result.data
}

export async function getRecentSubmissions() {
  const result = await getAPI().getRecentSubmissions()
  if (!result?.success) throw new Error(result?.error || 'Failed to load submissions')
  return result.data
}

export async function getRecentIncidents() {
  const result = await getAPI().getRecentIncidents()
  if (!result?.success) throw new Error(result?.error || 'Failed to load incidents')
  return result.data
}

export async function recordIncident(payload) {
  const result = await safe(() => getAPI().recordIncident(payload), { success: false })
  return result?.success ?? false
}

export async function updateIncidentStatus(id, status, note = '') {
  const result = await getAPI().updateIncidentStatus(id, status, note)
  if (!result?.success) throw new Error(result?.error || 'Failed to update incident')
  return result.data
}

/* ----- Biometric / Vision ----- */
export async function verifyFrame(payload) {
  return safe(() => getAPI().verifyFrame(payload), null)
}

export async function enrollIdentity(payload) {
  const result = await getAPI().enrollIdentity(payload)
  if (!result?.success) throw new Error(result?.error || 'Enrollment failed')
  return result
}

/* ----- Window ----- */
export async function setFullscreen(enabled) {
  return safe(() => getAPI().setFullscreen(enabled))
}

export async function getLockStatus() {
  return safe(() => getAPI().getLockStatus(), { enabled: false })
}
