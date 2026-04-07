const { spawn } = require('node:child_process')
const path = require('node:path')

class DatabaseService {
  constructor(options = {}) {
    this.pythonCommand = options.pythonCommand || 'python'
    this.rootDir = options.rootDir || path.resolve(__dirname, '..')
    this.dbPath = options.dbPath || path.join(this.rootDir, '.dist', 'secure-exam-browser.sqlite')
    this.seedPath = options.seedPath || path.join(this.rootDir, 'data', 'seed-data.json')
    this.bridgePath = options.bridgePath || path.join(this.rootDir, 'backend', 'python', 'sqlite_bridge.py')
  }

  invoke(action, payload = {}) {
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

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })

      child.on('error', (error) => {
        reject(error)
      })

      child.on('close', () => {
        const output = String(stdout || '').trim()
        if (!output) {
          reject(new Error(stderr ? String(stderr).trim() : `No output from database bridge for ${action}`))
          return
        }

        let parsed
        try {
          parsed = JSON.parse(output)
        } catch (error) {
          reject(new Error(`Invalid database bridge response for ${action}: ${output}`))
          return
        }

        if (!parsed.success) {
          reject(new Error(parsed.error || `Database action failed: ${action}`))
          return
        }

        resolve(parsed.data)
      })

      child.stdin.write(JSON.stringify(payload))
      child.stdin.end()
    })
  }

  initialize() {
    return this.invoke('init_db', {})
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

  getActiveSessions() {
    return this.invoke('get_active_sessions', {})
  }

  getRecentSubmissions(limit = 10) {
    return this.invoke('get_recent_submissions', { limit })
  }

  saveBiometricData(userId, biometricType, payload) {
    return this.invoke('save_biometric_data', { userId, biometricType, payload })
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
}

module.exports = {
  DatabaseService
}
