const { spawn } = require('node:child_process')
const path = require('node:path')

const MAX_BRIDGE_PAYLOAD_BYTES = 256 * 1024

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function truncateString(value, maxLength) {
  const text = String(value)
  if (!Number.isInteger(maxLength) || maxLength <= 0 || text.length <= maxLength) {
    return text
  }
  return text.slice(0, maxLength)
}

function coerceInteger(value, fieldName, { min = null, max = null, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) {
    return null
  }

  if (!Number.isInteger(value)) {
    throw new Error(`Invalid ${fieldName}`)
  }

  if (min !== null && value < min) {
    throw new Error(`Invalid ${fieldName}`)
  }

  if (max !== null && value > max) {
    throw new Error(`Invalid ${fieldName}`)
  }

  return value
}

function coerceString(value, fieldName, { minLength = 0, maxLength = 2048, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error(`Invalid ${fieldName}`)
  }

  const trimmed = value.trim()
  if (trimmed.length < minLength) {
    throw new Error(`Invalid ${fieldName}`)
  }

  return truncateString(trimmed, maxLength)
}

function coerceIntegerArray(value, fieldName, { maxItems = 1000 } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${fieldName}`)
  }

  if (value.length > maxItems) {
    throw new Error(`Invalid ${fieldName}`)
  }

  return value.map((item) => coerceInteger(item, fieldName, { min: 0 }))
}

function coercePlainObject(value, fieldName, { nullable = false, maxBytes = 64 * 1024 } = {}) {
  if (nullable && (value === null || value === undefined)) {
    return null
  }

  if (!isPlainObject(value)) {
    throw new Error(`Invalid ${fieldName}`)
  }

  const serialized = JSON.stringify(value)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new Error(`Invalid ${fieldName}`)
  }

  return JSON.parse(serialized)
}

const ACTION_SANITIZERS = {
  init_db: () => ({}),
  ensure_active_exam: () => ({}),
  get_database_status: () => ({}),
  get_active_exam: () => ({}),
  get_dashboard_stats: () => ({}),
  get_admin_exams: () => ({}),
  get_admin_users: () => ({}),
  get_model_assets: () => ({}),

  login: (payload) => ({
    username: coerceString(payload.username, 'username', { minLength: 1, maxLength: 128 }),
    password: coerceString(payload.password, 'password', { minLength: 1, maxLength: 128 })
  }),

  get_user_profile: (payload) => ({
    userId: coerceInteger(payload.userId, 'userId', { min: 1 })
  }),

  get_exam_questions: (payload) => ({
    examId: coerceInteger(payload.examId, 'examId', { min: 1 })
  }),

  get_question_for_execution: (payload) => ({
    questionId: coerceInteger(payload.questionId, 'questionId', { min: 1 })
  }),

  start_exam_session: (payload) => ({
    userId: coerceInteger(payload.userId, 'userId', { min: 1 }),
    examId: coerceInteger(payload.examId, 'examId', { min: 1 }),
    sessionToken: coerceString(payload.sessionToken, 'sessionToken', { minLength: 1, maxLength: 128 }),
    machineInfo: coercePlainObject(payload.machineInfo || {}, 'machineInfo', { maxBytes: 96 * 1024 }),
    remainingSeconds: coerceInteger(payload.remainingSeconds, 'remainingSeconds', { min: 0, nullable: true })
  }),

  end_exam_session: (payload) => ({
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1 }),
    status: coerceString(payload.status || 'completed', 'status', { minLength: 1, maxLength: 32 })
  }),

  save_mcq_answer: (payload) => ({
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1 }),
    questionId: coerceInteger(payload.questionId, 'questionId', { min: 1 }),
    selectedOption: coerceInteger(payload.selectedOption, 'selectedOption', { min: 0 })
  }),

  save_code_answer: (payload) => ({
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1 }),
    questionId: coerceInteger(payload.questionId, 'questionId', { min: 1 }),
    code: truncateString(String(payload.code || ''), 250000),
    language: coerceString(payload.language, 'language', { minLength: 1, maxLength: 16 }),
    status: coerceString(payload.status || 'Draft', 'status', { minLength: 1, maxLength: 32 }),
    testSummary: coercePlainObject(payload.testSummary || {}, 'testSummary')
  }),

  save_code_run: (payload) => ({
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1, nullable: true }),
    questionId: coerceInteger(payload.questionId, 'questionId', { min: 1 }),
    language: coerceString(payload.language, 'language', { minLength: 1, maxLength: 16 }),
    mode: coerceString(payload.mode, 'mode', { minLength: 1, maxLength: 16 }),
    code: truncateString(String(payload.code || ''), 250000),
    status: coerceString(payload.status, 'status', { minLength: 1, maxLength: 32 }),
    passedCount: coerceInteger(payload.passedCount, 'passedCount', { min: 0 }),
    totalCount: coerceInteger(payload.totalCount, 'totalCount', { min: 0 }),
    totalTimeMs: coerceInteger(payload.totalTimeMs, 'totalTimeMs', { min: 0 }),
    runtimeDetails: coercePlainObject(payload.runtimeDetails || {}, 'runtimeDetails', { maxBytes: 96 * 1024 })
  }),

  save_session_progress: (payload) => ({
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1 }),
    flaggedQuestionIds: coerceIntegerArray(payload.flaggedQuestionIds || [], 'flaggedQuestionIds', { maxItems: 1000 }),
    remainingSeconds: coerceInteger(payload.remainingSeconds, 'remainingSeconds', { min: 0, nullable: true })
  }),

  get_session_state: (payload) => ({
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1 })
  }),

  save_exam_submission: (payload) => ({
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1 }),
    examId: coerceInteger(payload.examId, 'examId', { min: 1 }),
    userId: coerceInteger(payload.userId, 'userId', { min: 1 }),
    flaggedQuestionIds: coerceIntegerArray(payload.flaggedQuestionIds || [], 'flaggedQuestionIds', { maxItems: 1000 }),
    timeRemaining: coerceInteger(payload.timeRemaining, 'timeRemaining', { min: 0, nullable: true })
  }),

  get_submission_summary: (payload) => ({
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1 })
  }),

  get_active_sessions: (payload) => ({
    limit: coerceInteger(payload.limit ?? 100, 'limit', { min: 1, max: 500 })
  }),

  get_recent_submissions: (payload) => ({
    limit: coerceInteger(payload.limit ?? 10, 'limit', { min: 1, max: 200 })
  }),

  save_biometric_data: (payload) => ({
    userId: coerceInteger(payload.userId, 'userId', { min: 1 }),
    biometricType: coerceString(payload.biometricType, 'biometricType', { minLength: 1, maxLength: 64 }),
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1, nullable: true }),
    payload: coercePlainObject(payload.payload || {}, 'payload', { maxBytes: 96 * 1024 })
  }),

  upsert_model_asset: (payload) => ({
    modelId: coerceString(payload.modelId, 'modelId', { minLength: 1, maxLength: 128 }),
    family: coerceString(payload.family || '', 'family', { maxLength: 128 }),
    version: coerceString(payload.version || '', 'version', { maxLength: 64 }),
    githubUrl: coerceString(payload.githubUrl || '', 'githubUrl', { maxLength: 512 }),
    sourceUrl: coerceString(payload.sourceUrl || '', 'sourceUrl', { maxLength: 512 }),
    localPath: coerceString(payload.localPath || '', 'localPath', { maxLength: 512 }),
    status: coerceString(payload.status || 'unknown', 'status', { minLength: 1, maxLength: 32 }),
    sizeBytes: coerceInteger(payload.sizeBytes ?? 0, 'sizeBytes', { min: 0 }),
    checksum: coerceString(payload.checksum || '', 'checksum', { maxLength: 256 }),
    syncedAt: coerceString(payload.syncedAt || '', 'syncedAt', { maxLength: 64 }),
    errorMessage: coerceString(payload.errorMessage || '', 'errorMessage', { maxLength: 2048 })
  }),

  record_incident: (payload) => ({
    userId: coerceInteger(payload.userId, 'userId', { min: 1, nullable: true }),
    sessionId: coerceInteger(payload.sessionId, 'sessionId', { min: 1, nullable: true }),
    type: coerceString(payload.type, 'type', { minLength: 1, maxLength: 128 }),
    severity: coerceString(payload.severity || 'medium', 'severity', { minLength: 1, maxLength: 16 }),
    message: coerceString(payload.message, 'message', { minLength: 1, maxLength: 2048 }),
    details: coercePlainObject(payload.details || {}, 'details')
  }),

  get_recent_incidents: (payload) => ({
    limit: coerceInteger(payload.limit ?? 10, 'limit', { min: 1, max: 200 })
  }),

  update_incident_status: (payload) => ({
    incidentId: coerceInteger(payload.incidentId, 'incidentId', { min: 1 }),
    status: coerceString(payload.status, 'status', { minLength: 1, maxLength: 32 }),
    note: coerceString(payload.note || '', 'note', { maxLength: 2048 })
  })
}

function sanitizeBridgePayload(action, payload) {
  const sanitizer = ACTION_SANITIZERS[action]
  if (!sanitizer) {
    throw new Error(`Unsupported database action: ${action}`)
  }

  const safePayload = sanitizer(isPlainObject(payload) ? payload : {})
  const serialized = JSON.stringify(safePayload)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BRIDGE_PAYLOAD_BYTES) {
    throw new Error(`Payload too large for action: ${action}`)
  }

  return safePayload
}

class DatabaseService {
  constructor(options = {}) {
    this.pythonCommand = options.pythonCommand || 'python'
    this.rootDir = options.rootDir || path.resolve(__dirname, '..')
    this.dbPath = options.dbPath || path.join(this.rootDir, '.dist', 'secure-exam-browser.sqlite')
    this.seedPath = options.seedPath || path.join(this.rootDir, 'data', 'seed-data.json')
    this.bridgePath = options.bridgePath || path.join(this.rootDir, 'backend', 'python', 'sqlite_bridge.py')
    this.defaultTimeoutMs = options.defaultTimeoutMs || 30000
    this.ensureLocalExamAvailability = options.ensureLocalExamAvailability !== false
  }

  getActionTimeoutMs(action) {
    const writeActions = new Set([
      'start_exam_session',
      'end_exam_session',
      'save_mcq_answer',
      'save_code_answer',
      'save_code_run',
      'save_session_progress',
      'save_exam_submission',
      'save_biometric_data',
      'upsert_model_asset',
      'record_incident',
      'update_incident_status'
    ])

    if (action === 'sync_open_source_models') {
      return 90000
    }

    if (writeActions.has(action)) {
      return 45000
    }

    return this.defaultTimeoutMs
  }

  formatBridgeError(action, stderr, fallback) {
    const text = String(stderr || '').trim()
    if (!text) {
      return fallback
    }
    const lastLine = text.split(/\r?\n/).filter(Boolean).pop()
    return `${fallback}: ${lastLine}`
  }

  invoke(action, payload = {}) {
    const safePayload = sanitizeBridgePayload(action, payload)
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.pythonCommand,
        [this.bridgePath, '--db', this.dbPath, '--action', action, '--seed', this.seedPath],
        {
          cwd: this.rootDir,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )

      const timeoutMs = this.getActionTimeoutMs(action)
      let stdout = ''
      let stderr = ''
      let settled = false

      const settle = (type, value) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        if (type === 'resolve') {
          resolve(value)
        } else {
          reject(value)
        }
      }

      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch (error) {
          // Process may already be closed.
        }
        settle('reject', new Error(`Database action timed out after ${timeoutMs}ms: ${action}`))
      }, timeoutMs)

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', (error) => {
        settle('reject', new Error(`Database bridge process error for '${action}': ${error.message}`))
      })

      child.on('close', () => {
        if (settled) {
          return
        }

        const output = String(stdout || '').trim()
        if (!output) {
          settle('reject', new Error(this.formatBridgeError(action, stderr, `No output from database bridge for ${action}`)))
          return
        }

        let parsed
        try {
          parsed = JSON.parse(output)
        } catch (error) {
          settle('reject', new Error(`Invalid database bridge response for ${action}`))
          return
        }

        if (!parsed.success) {
          settle('reject', new Error(parsed.error || this.formatBridgeError(action, stderr, `Database action failed: ${action}`)))
          return
        }

        settle('resolve', parsed.data)
      })

      child.stdin.write(JSON.stringify(safePayload))
      child.stdin.end()
    })
  }

  initialize() {
    return this.invoke('init_db', {})
      .then((result) => {
        if (!this.ensureLocalExamAvailability) {
          return result
        }

        return this.invoke('ensure_active_exam', {})
          .catch(() => null)
          .then(() => result)
      })
  }

  ensureActiveExam() {
    return this.invoke('ensure_active_exam', {})
  }

  getDatabaseStatus() {
    return this.invoke('get_database_status', {})
  }

  login(username, password) {
    return this.invoke('login', { username, password })
  }

  getActiveExam() {
    return this.invoke('get_active_exam', {})
  }

  getUserProfile(userId) {
    return this.invoke('get_user_profile', { userId })
  }

  getExamQuestions(examId) {
    return this.invoke('get_exam_questions', { examId })
  }

  getQuestionForExecution(questionId) {
    return this.invoke('get_question_for_execution', { questionId })
  }

  startExamSession(payload) {
    return this.invoke('start_exam_session', payload)
  }

  endExamSession(sessionId, status) {
    return this.invoke('end_exam_session', { sessionId, status })
  }

  saveMcqAnswer(payload) {
    return this.invoke('save_mcq_answer', payload)
  }

  saveCodeAnswer(payload) {
    return this.invoke('save_code_answer', payload)
  }

  saveCodeRun(payload) {
    return this.invoke('save_code_run', payload)
  }

  saveSessionProgress(payload) {
    return this.invoke('save_session_progress', payload)
  }

  getSessionState(sessionId) {
    return this.invoke('get_session_state', { sessionId })
  }

  saveExamSubmission(payload) {
    return this.invoke('save_exam_submission', payload)
  }

  getSubmissionSummary(sessionId) {
    return this.invoke('get_submission_summary', { sessionId })
  }

  getDashboardStats() {
    return this.invoke('get_dashboard_stats', {})
  }

  getAdminExams() {
    return this.invoke('get_admin_exams', {})
  }

  getAdminUsers() {
    return this.invoke('get_admin_users', {})
  }

  getActiveSessions(limit = 100) {
    return this.invoke('get_active_sessions', { limit })
  }

  getRecentSubmissions(limit = 10) {
    return this.invoke('get_recent_submissions', { limit })
  }

  saveBiometricData(userId, biometricType, payload) {
    return this.invoke('save_biometric_data', {
      userId,
      biometricType,
      sessionId: payload?.sessionId || null,
      payload
    })
  }

  upsertModelAsset(asset) {
    return this.invoke('upsert_model_asset', asset)
  }

  getModelAssets() {
    return this.invoke('get_model_assets', {})
  }

  recordIncident(payload) {
    return this.invoke('record_incident', payload)
  }

  getRecentIncidents(limit = 10) {
    return this.invoke('get_recent_incidents', { limit })
  }

  updateIncidentStatus(incidentId, status, note = '') {
    return this.invoke('update_incident_status', { incidentId, status, note })
  }
}

module.exports = {
  DatabaseService
}
