let questions = []
let runtimeCapabilities = null
let currentIndex = 0
let sessionId = Number(localStorage.getItem('currentSessionId') || '0')
let examId = Number(localStorage.getItem('currentExamId') || '0')
let examDurationMinutes = Number(localStorage.getItem('currentExamDuration') || '120')
let timeRemaining = examDurationMinutes * 60
let answers = {}
let flaggedQuestionIds = []
let timerHandle = null
let codeEditorInstance = null
let autosaveHandle = null
let syncInFlight = false
let dirtyState = false
let lastSyncedAt = 0
let suppressEditorChange = false
let isSubmitting = false

const AUTOSAVE_DEBOUNCE_MS = 900
const HEARTBEAT_INTERVAL_SECONDS = 15
const INCIDENT_COOLDOWN_MS = 45000
const incidentCooldown = {
  visibility: 0,
  blur: 0,
  offline: 0
}

const EDITOR_MODE_MAP = {
  javascript: 'text/javascript',
  python: 'text/x-python',
  cpp: 'text/x-c++src'
}

function ensureCodeEditor() {
  if (codeEditorInstance) {
    return codeEditorInstance
  }

  const textarea = document.getElementById('codeEditor')
  if (!textarea || !window.CodeMirror || typeof window.CodeMirror.fromTextArea !== 'function') {
    return null
  }

  codeEditorInstance = window.CodeMirror.fromTextArea(textarea, {
    mode: EDITOR_MODE_MAP.javascript,
    theme: 'material-darker',
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    autoCloseBrackets: true,
    lineWrapping: false,
    matchBrackets: true
  })

  codeEditorInstance.on('change', () => {
    if (suppressEditorChange) {
      return
    }
    markDirty('Code updated')
    scheduleDraftAutosave()
  })

  return codeEditorInstance
}

function setEditorLanguage(language) {
  const editor = ensureCodeEditor()
  const mode = EDITOR_MODE_MAP[language] || EDITOR_MODE_MAP.javascript
  if (editor) {
    editor.setOption('mode', mode)
    editor.refresh()
    return
  }
  const fallback = document.getElementById('codeEditor')
  if (fallback) {
    fallback.dataset.language = language
  }
}

function setEditorValue(value) {
  const normalized = value || ''
  const editor = ensureCodeEditor()
  if (editor) {
    suppressEditorChange = true
    editor.setValue(normalized)
    editor.refresh()
    suppressEditorChange = false
    return
  }
  const fallback = document.getElementById('codeEditor')
  if (fallback) {
    fallback.value = normalized
  }
}

function getEditorValue() {
  const editor = ensureCodeEditor()
  if (editor) {
    return editor.getValue()
  }
  const fallback = document.getElementById('codeEditor')
  return fallback ? fallback.value : ''
}

function getCurrentUserRole() {
  return (localStorage.getItem('currentUserRole') || 'student').toLowerCase()
}

function getDashboardDestination() {
  return getCurrentUserRole() === 'admin' ? 'dashboard' : 'student-dashboard'
}

async function navigateToDashboard() {
  try {
    await saveCurrentCodingDraft({ silent: true, saveStatus: false })
  } catch (_error) {
    setSyncStatus('Draft pending sync', 'error')
  }
  await syncSessionProgress('dashboard-nav', { quiet: true })
  await window.electronAPI.navigateTo(getDashboardDestination())
}

function configureDashboardNavigation() {
  const navButton = document.querySelector('[data-dashboard-nav]')
  const navLabel = document.querySelector('[data-dashboard-label]')
  if (navLabel) {
    navLabel.textContent = getCurrentUserRole() === 'admin' ? 'Admin Dashboard' : 'Student Dashboard'
  }
  if (navButton) {
    navButton.addEventListener('click', () => navigateToDashboard())
  }
}

function getCurrentQuestion() {
  return questions[currentIndex] || null
}

function getCurrentUserId() {
  return Number(localStorage.getItem('currentUserId') || '0')
}

function getAnsweredCount() {
  return questions.reduce((count, question) => {
    if (!question || !answers[String(question.id)]) {
      return count
    }

    const response = answers[String(question.id)]
    if (response.type === 'mcq') {
      return Number.isInteger(response.selectedOption) ? count + 1 : count
    }

    if (response.type === 'coding') {
      return (response.code || '').trim().length > 0 ? count + 1 : count
    }

    return count + 1
  }, 0)
}

function formatTime(seconds) {
  const safeSeconds = Math.max(seconds, 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const secs = safeSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function setLiveBanner(message, tone = 'info') {
  const banner = document.querySelector('[data-live-banner]')
  if (!banner) {
    return
  }

  if (!message) {
    banner.classList.add('d-none')
    banner.textContent = ''
    banner.dataset.tone = ''
    return
  }

  banner.classList.remove('d-none')
  banner.dataset.tone = tone
  banner.textContent = message
}

function setSyncStatus(message, tone = 'idle') {
  const chip = document.querySelector('[data-sync-status]')
  if (!chip) {
    return
  }

  chip.dataset.syncTone = tone
  chip.textContent = message
}

function markDirty(message = 'Unsaved changes') {
  dirtyState = true
  setSyncStatus(message, 'syncing')
}

function markSynced(message = 'Changes saved') {
  dirtyState = false
  lastSyncedAt = Date.now()
  setSyncStatus(`${message} at ${new Date(lastSyncedAt).toLocaleTimeString()}`, 'ok')
}

function updateConnectionStatus() {
  const online = navigator.onLine !== false
  const chip = document.querySelector('[data-connection-status]')
  if (chip) {
    chip.dataset.netTone = online ? 'online' : 'offline'
    chip.textContent = online ? 'Online' : 'Offline'
  }

  if (!online) {
    setLiveBanner('Network disconnected. Continue solving; local saving remains active.', 'warning')
  }
}

function updateFlagButton() {
  const question = getCurrentQuestion()
  const isFlagged = !!question && flaggedQuestionIds.includes(question.id)
  document.querySelectorAll('[data-flag-toggle]').forEach((button) => {
    button.textContent = isFlagged ? 'Unmark Review' : 'Mark for Review'
    button.classList.toggle('btn-dark', isFlagged)
    button.classList.toggle('btn-outline-dark', !isFlagged)
  })
}

function renderQuestionPalette() {
  const container = document.querySelector('[data-question-palette]')
  if (!container) {
    return
  }

  container.innerHTML = ''
  questions.forEach((question, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'exam-palette-btn'
    button.textContent = String(index + 1)

    const answer = answers[String(question.id)]
    const answered = answer
      ? (answer.type === 'mcq'
          ? Number.isInteger(answer.selectedOption)
          : (answer.code || '').trim().length > 0)
      : false

    if (answered) {
      button.classList.add('is-answered')
    }
    if (flaggedQuestionIds.includes(question.id)) {
      button.classList.add('is-flagged')
    }
    if (index === currentIndex) {
      button.classList.add('is-current')
    }

    button.setAttribute('aria-label', `Question ${index + 1}`)
    button.addEventListener('click', () => {
      goToQuestion(index)
    })
    container.appendChild(button)
  })

  const answered = getAnsweredCount()
  const summary = document.querySelector('[data-palette-summary]')
  if (summary) {
    const total = questions.length
    const flagged = flaggedQuestionIds.length
    const unanswered = Math.max(total - answered, 0)
    summary.textContent = `Answered ${answered}/${total} | Flagged ${flagged} | Pending ${unanswered}`
  }
}

function persistUiState() {
  localStorage.setItem('examUiState', JSON.stringify({
    currentIndex,
    timeRemaining
  }))
}

function loadUiState() {
  try {
    const state = JSON.parse(localStorage.getItem('examUiState') || '{}')
    if (Number.isInteger(state.currentIndex)) currentIndex = state.currentIndex
    if (Number.isInteger(state.timeRemaining) && state.timeRemaining > 0) timeRemaining = state.timeRemaining
  } catch (error) {
    console.warn('Unable to load UI state:', error)
  }
}

function updateTimer() {
  const label = formatTime(timeRemaining)
  document.querySelectorAll('[data-timer]').forEach((element) => {
    element.textContent = label
  })
}

function updateProgress() {
  const answered = getAnsweredCount()
  const flagged = flaggedQuestionIds.length
  const remaining = Math.max(questions.length - answered, 0)

  const progressText = document.querySelector('[data-progress-text]')
  if (progressText) progressText.textContent = `${answered}/${questions.length}`
  const answeredCount = document.querySelector('[data-answered-count]')
  const flaggedCount = document.querySelector('[data-flagged-count]')
  const remainingCount = document.querySelector('[data-remaining-count]')
  if (answeredCount) answeredCount.textContent = String(answered)
  if (flaggedCount) flaggedCount.textContent = String(flagged)
  if (remainingCount) remainingCount.textContent = String(remaining)

  const navCurrent = document.querySelector('[data-nav-current]')
  const navTotal = document.querySelector('[data-nav-total]')
  if (navCurrent) navCurrent.textContent = String(currentIndex + 1)
  if (navTotal) navTotal.textContent = String(questions.length)

  const prev = document.querySelector('[data-nav-prev]')
  const next = document.querySelector('[data-nav-next]')
  if (prev) prev.disabled = currentIndex === 0
  if (next) next.disabled = currentIndex >= questions.length - 1

  updateFlagButton()
  renderQuestionPalette()
}

function availableLanguages() {
  if (!runtimeCapabilities) return ['javascript']
  const languages = []
  if (runtimeCapabilities.data?.node?.available) languages.push('javascript')
  if (runtimeCapabilities.data?.python?.available) languages.push('python')
  if (runtimeCapabilities.data?.cpp?.available) languages.push('cpp')
  return languages
}

function updateLanguageOptions(question) {
  const select = document.getElementById('codeLanguage')
  if (!select || !question) return
  const supported = new Set(availableLanguages())
  const requested = new Set((question.languages && question.languages.length > 0)
    ? question.languages
    : Array.from(select.options).map((option) => option.value))
  Array.from(select.options).forEach((option) => {
    option.disabled = !(supported.has(option.value) && requested.has(option.value))
  })
}

function inferCppTypeFromValue(value) {
  if (Array.isArray(value)) {
    const innerType = value.length > 0 ? inferCppTypeFromValue(value[0]) : 'int'
    return `vector<${innerType}>`
  }
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'bool'
  return 'int'
}

function getTemplateParameterNames(question) {
  const tests = Array.isArray(question?.testCases) ? question.testCases : []
  if (!tests.length) {
    return ['input']
  }

  const firstInput = tests[0]?.input || {}
  const names = Object.keys(firstInput)
  return names.length > 0 ? names : ['input']
}

function getDefaultTemplate(question, language) {
  const functionName = question?.functionName || 'solve'
  const params = getTemplateParameterNames(question)

  if (language === 'python') {
    return `def ${functionName}(${params.join(', ')}):\n    # Write your code here\n    return None\n`
  }

  if (language === 'cpp') {
    const typedParams = params.map((name) => {
      const value = (question?.testCases?.[0]?.input || {})[name]
      return `${inferCppTypeFromValue(value)} ${name}`
    }).join(', ')

    return [
      '#include <bits/stdc++.h>',
      'using namespace std;',
      '',
      `auto ${functionName}(${typedParams}) {`,
      '    // Write your code here',
      '}',
      ''
    ].join('\n')
  }

  return `function ${functionName}(${params.join(', ')}) {\n  // Write your code here\n  return null;\n}\n`
}

function formatCodingSignature(question, language) {
  const functionName = question?.functionName || 'solve'
  const params = getTemplateParameterNames(question)

  if (language === 'python') {
    return `def ${functionName}(${params.join(', ')})`
  }

  if (language === 'cpp') {
    const typed = params.map((name) => {
      const value = (question?.testCases?.[0]?.input || {})[name]
      return `${inferCppTypeFromValue(value)} ${name}`
    }).join(', ')
    return `auto ${functionName}(${typed})`
  }

  return `function ${functionName}(${params.join(', ')})`
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getStarterCode(question, language) {
  return getDefaultTemplate(question, language)
}

function renderMcq(question) {
  document.querySelector('[data-mcq-container]')?.classList.remove('d-none')
  document.querySelector('[data-coding-container]')?.classList.add('d-none')

  const questionBadge = document.querySelector('[data-question-badge]')
  const sectionBadge = document.querySelector('[data-section-badge]')
  const questionText = document.querySelector('[data-question-text]')
  const subtext = document.querySelector('[data-question-subtext]')
  if (questionBadge) questionBadge.textContent = `Question ${currentIndex + 1}`
  if (sectionBadge) sectionBadge.textContent = question.section || 'General'
  if (questionText) questionText.textContent = question.prompt
  if (subtext) subtext.textContent = question.difficulty ? `Difficulty: ${question.difficulty}` : ''

  const labels = document.querySelectorAll('[data-option-label]')
  labels.forEach((label, index) => {
    const text = label.querySelector('[data-option-text]')
    const radio = label.querySelector('input[name="answer"]')
    const hasOption = Boolean(question.options[index])
    if (text) text.textContent = question.options[index] || ''
    label.classList.toggle('d-none', !hasOption)
    if (radio) {
      radio.checked = answers[String(question.id)]?.selectedOption === index
      radio.disabled = !hasOption
      radio.onchange = async () => {
        markDirty('Saving answer...')
        answers[String(question.id)] = {
          type: 'mcq',
          selectedOption: index,
          savedAt: new Date().toISOString()
        }
        try {
          const result = await window.electronAPI.saveMCQAnswer({
            sessionId,
            questionId: question.id,
            selectedOption: index
          })
          if (!result?.success) {
            throw new Error(result?.error || 'Could not save answer')
          }
          markSynced('Answer saved')
        } catch (error) {
          setSyncStatus('Failed to save answer', 'error')
          setLiveBanner(error.message || 'Answer could not be saved. Try syncing manually.', 'error')
        }
        updateProgress()
      }
    }
  })
}

function renderCoding(question) {
  document.querySelector('[data-mcq-container]')?.classList.add('d-none')
  document.querySelector('[data-coding-container]')?.classList.remove('d-none')

  const saved = answers[String(question.id)]
  const select = document.getElementById('codeLanguage')
  const output = document.getElementById('codeOutput')
  const constraints = Array.isArray(question.constraints) ? question.constraints : []
  const examples = Array.isArray(question.examples) ? question.examples : []
  const visibleTests = Array.isArray(question.testCases)
    ? question.testCases.filter((item) => !item.hidden)
    : []

  document.querySelector('[data-coding-question-badge]').textContent = `Question ${currentIndex + 1}`
  document.querySelector('[data-coding-question-text]').textContent = question.title
  document.querySelector('[data-coding-prompt]').textContent = question.prompt || 'Detailed question statement will be available here.'
  document.querySelector('[data-coding-constraints]').innerHTML = constraints.length > 0
    ? constraints.map((item) => `<div>${escapeHtml(item)}</div>`).join('')
    : '<div>No explicit constraints provided for this problem.</div>'
  document.querySelector('[data-coding-examples]').innerHTML = examples.map((example, index) => `
    <div class="coding-example">
      <div class="coding-example-title">Example ${index + 1}</div>
      <div><strong>Input</strong></div>
      <code class="coding-example-code">${escapeHtml(example.input)}</code>
      <div class="mt-2"><strong>Output</strong></div>
      <code class="coding-example-code">${escapeHtml(example.output)}</code>
      ${example.explanation ? `<div class="text-muted small mt-2">${escapeHtml(example.explanation)}</div>` : ''}
    </div>
  `).join('') || '<div class="text-muted">No examples are provided for this question.</div>'

  updateLanguageOptions(question)
  const preferredLanguage = saved?.language && !select.querySelector(`option[value="${saved.language}"]`)?.disabled
    ? saved.language
    : Array.from(select.options).find((option) => !option.disabled)?.value || 'javascript'

  const signature = document.querySelector('[data-coding-signature]')
  if (signature) {
    signature.textContent = formatCodingSignature(question, preferredLanguage)
  }

  const testsContainer = document.querySelector('[data-coding-testcases]')
  if (testsContainer) {
    testsContainer.innerHTML = visibleTests.length > 0
      ? visibleTests.map((test, index) => `
        <div class="coding-testcase-card">
          <div class="coding-testcase-title">Sample Test ${index + 1}${test.description ? ` - ${escapeHtml(test.description)}` : ''}</div>
          <div><strong>Input:</strong> <code class="coding-example-code">${escapeHtml(JSON.stringify(test.input))}</code></div>
          <div class="mt-1"><strong>Expected:</strong> <code class="coding-example-code">${escapeHtml(JSON.stringify(test.output))}</code></div>
        </div>
      `).join('')
      : '<div class="text-muted">No visible tests configured. Use examples and constraints for guidance.</div>'
  }

  const evalElement = document.querySelector('[data-coding-eval]')
  if (evalElement) {
    const hiddenCount = Math.max((question.testCasesTotalCount || visibleTests.length) - visibleTests.length, 0)
    const metaParts = []
    if (question.difficulty) metaParts.push(`Difficulty: ${question.difficulty}`)
    if (question.points) metaParts.push(`Marks: ${question.points}`)
    metaParts.push(hiddenCount > 0
      ? `Visible tests: ${visibleTests.length}, hidden tests: ${hiddenCount}`
      : `Visible tests: ${visibleTests.length}`)
    evalElement.textContent = `${metaParts.join(' | ')}. Focus on correctness, edge cases, and time complexity.`
  }

  select.value = preferredLanguage
  setEditorLanguage(preferredLanguage)
  setEditorValue(saved?.code || getStarterCode(question, preferredLanguage))
  output.textContent = saved?.status ? `Last result: ${saved.status}` : 'Ready.'
}

function refreshCodingSignature() {
  const question = getCurrentQuestion()
  const select = document.getElementById('codeLanguage')
  const signature = document.querySelector('[data-coding-signature]')
  if (!question || !select || !signature || question.type !== 'coding') {
    return
  }
  signature.textContent = formatCodingSignature(question, select.value)
}

function renderQuestion() {
  const question = getCurrentQuestion()
  if (!question) return
  if (question.type === 'coding') {
    renderCoding(question)
  } else {
    renderMcq(question)
  }
  updateProgress()
  persistUiState()
}

async function saveCurrentCodingDraft({ silent = false, saveStatus = true } = {}) {
  const question = getCurrentQuestion()
  if (!question || question.type !== 'coding') return
  const select = document.getElementById('codeLanguage')
  if (!select) return

  const code = getEditorValue()

  const payload = {
    type: 'coding',
    code,
    language: select.value,
    status: answers[String(question.id)]?.status || 'Draft',
    testSummary: answers[String(question.id)]?.testSummary || {},
    savedAt: new Date().toISOString()
  }
  answers[String(question.id)] = payload

  if (!silent) {
    setSyncStatus('Saving draft...', 'syncing')
  }

  const result = await window.electronAPI.saveCodeAnswer({
    sessionId,
    questionId: question.id,
    code: payload.code,
    language: payload.language,
    status: payload.status,
    testSummary: payload.testSummary
  })
  if (!result?.success) {
    throw new Error(result?.error || 'Draft save failed')
  }

  if (saveStatus) {
    markSynced('Draft saved')
  }
}

function scheduleDraftAutosave() {
  if (autosaveHandle) {
    clearTimeout(autosaveHandle)
  }

  autosaveHandle = setTimeout(async () => {
    try {
      await saveCurrentCodingDraft({ silent: true, saveStatus: true })
      updateProgress()
    } catch (error) {
      setSyncStatus('Autosave failed', 'error')
    }
  }, AUTOSAVE_DEBOUNCE_MS)
}

async function syncSessionProgress(reason = 'manual', { quiet = false } = {}) {
  if (!sessionId || syncInFlight) {
    return false
  }

  syncInFlight = true
  if (!quiet) {
    setSyncStatus('Syncing...', 'syncing')
  }

  try {
    const result = await window.electronAPI.saveSessionProgress({
      sessionId,
      flaggedQuestionIds,
      remainingSeconds: timeRemaining
    })

    if (!result?.success) {
      throw new Error(result?.error || 'Progress sync failed')
    }

    if (!quiet || reason === 'manual') {
      markSynced('Progress synced')
    }

    return true
  } catch (error) {
    setSyncStatus('Sync failed. Retry', 'error')
    if (!quiet) {
      setLiveBanner(error.message || 'Progress sync failed. Continue and retry sync.', 'warning')
    }
    return false
  } finally {
    syncInFlight = false
  }
}

function canReportIncident(key) {
  const now = Date.now()
  if (now - incidentCooldown[key] < INCIDENT_COOLDOWN_MS) {
    return false
  }
  incidentCooldown[key] = now
  return true
}

async function reportIncident(type, message, severity = 'medium', details = {}) {
  try {
    const payload = {
      userId: getCurrentUserId(),
      sessionId,
      type,
      severity,
      message,
      details: {
        ...details,
        questionIndex: currentIndex + 1,
        remainingSeconds: timeRemaining
      }
    }
    await window.electronAPI.recordIncident(payload)
  } catch (_error) {
    // Do not block exam flow if incident logging fails.
  }
}

function isTypingTarget(event) {
  const target = event.target
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.closest('.CodeMirror')) {
    return true
  }
  if (target.isContentEditable) {
    return true
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function formatExecutionFailure(result) {
  const lines = []
  lines.push('Execution failed.')
  if (result?.error) {
    lines.push(`Error: ${result.error}`)
  }
  if (result?.details?.stderr) {
    lines.push('')
    lines.push('stderr:')
    lines.push(result.details.stderr)
  }
  if (result?.details?.stdout) {
    lines.push('')
    lines.push('stdout:')
    lines.push(result.details.stdout)
  }
  lines.push('')
  lines.push('Tip: Confirm function name/signature and return format match the statement.')
  return lines.join('\n')
}

async function goToQuestion(index) {
  if (index < 0 || index >= questions.length) return
  try {
    await saveCurrentCodingDraft({ silent: true, saveStatus: false })
  } catch (_error) {
    setSyncStatus('Draft pending sync', 'error')
  }
  currentIndex = index
  renderQuestion()
}

async function runCode(mode) {
  const question = getCurrentQuestion()
  if (!question || question.type !== 'coding') return

  const select = document.getElementById('codeLanguage')
  const output = document.getElementById('codeOutput')
  if (!select || !output) return

  const code = getEditorValue()
  const runButton = document.getElementById('runCode')
  const submitButton = document.getElementById('submitCode')

  if (runButton) runButton.disabled = true
  if (submitButton) submitButton.disabled = true

  output.textContent = mode === 'sample' ? 'Running visible test cases...' : 'Submitting and running all tests...'

  try {
    const result = await window.electronAPI.runCode({
      sessionId,
      questionId: question.id,
      language: select.value,
      code,
      mode
    })

    if (!result.success) {
      output.textContent = formatExecutionFailure(result)
      return
    }

    const lines = []
    lines.push(`Status: ${result.status}`)
    lines.push(`Passed: ${result.passedCount}/${result.totalCount}`)
    lines.push(`Time: ${result.totalTimeMs}ms`)
    lines.push('')

    result.results.forEach((item, index) => {
      if (mode === 'sample' || !item.hidden) {
        lines.push(`Test ${index + 1}: ${item.passed ? 'Passed' : 'Failed'}${item.description ? ` (${item.description})` : ''}`)
        lines.push(`Expected: ${JSON.stringify(item.expectedOutput)}`)
        lines.push(`Actual: ${JSON.stringify(item.actualOutput)}`)
        if (item.error) lines.push(`Error: ${item.error}`)
        if (item.executionTimeMs !== undefined) {
          lines.push(`Elapsed: ${item.executionTimeMs}ms`)
        }
        lines.push('')
      }
    })

    output.textContent = lines.join('\n')

    if (mode === 'submit') {
      markDirty('Saving code submission...')
      answers[String(question.id)] = {
        type: 'coding',
        code,
        language: select.value,
        status: result.status,
        testSummary: {
          allPassed: result.allPassed,
          passedCount: result.passedCount,
          totalCount: result.totalCount,
          totalTimeMs: result.totalTimeMs
        },
        savedAt: new Date().toISOString()
      }

      const saveResult = await window.electronAPI.saveCodeAnswer({
        sessionId,
        questionId: question.id,
        code,
        language: select.value,
        status: result.status,
        testSummary: answers[String(question.id)].testSummary
      })

      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Could not persist submission result')
      }

      markSynced('Code submission saved')
      updateProgress()
    }
  } catch (error) {
    output.textContent = error.message || 'Execution failed unexpectedly.'
  } finally {
    if (runButton) runButton.disabled = false
    if (submitButton) submitButton.disabled = false
  }
}

async function startSessionIfNeeded() {
  if (sessionId) {
    return
  }

  const userId = Number(localStorage.getItem('currentUserId') || '0')
  const systemInfo = await window.electronAPI.getSystemInfo()
  const session = await window.electronAPI.startExamSession({
    userId,
    examId,
    sessionToken: systemInfo.sessionToken,
    machineInfo: systemInfo,
    remainingSeconds: timeRemaining
  })

  sessionId = session.data.sessionId
  localStorage.setItem('currentSessionId', String(sessionId))
}

async function restoreSessionState() {
  if (!sessionId) return
  try {
    const state = await window.electronAPI.getSessionState(sessionId)
    if (state.success && state.data) {
      answers = state.data.answers || {}
      flaggedQuestionIds = state.data.flaggedQuestionIds || []
      if (Number.isInteger(state.data.remainingSeconds) && state.data.remainingSeconds > 0) {
        timeRemaining = state.data.remainingSeconds
      }
    }
  } catch (error) {
    console.warn('Unable to restore session state:', error)
  }
}

function startTimer() {
  if (timerHandle) clearInterval(timerHandle)
  timerHandle = setInterval(() => {
    timeRemaining = Math.max(timeRemaining - 1, 0)
    updateTimer()
    persistUiState()
    if (sessionId && timeRemaining % HEARTBEAT_INTERVAL_SECONDS === 0) {
      void syncSessionProgress('heartbeat', { quiet: true })
    }
    if (timeRemaining === 0) {
      clearInterval(timerHandle)
      setLiveBanner('Time is up. Redirecting to submission...', 'warning')
      void goToSubmission({ force: true })
    }
  }, 1000)
}

async function goToSubmission({ force = false } = {}) {
  if (isSubmitting) {
    return
  }

  isSubmitting = true
  const submitButton = document.querySelector('[data-submit-exam]')
  if (submitButton) {
    submitButton.disabled = true
    submitButton.textContent = 'Preparing...'
  }

  try {
    if (autosaveHandle) {
      clearTimeout(autosaveHandle)
      autosaveHandle = null
    }

    try {
      await saveCurrentCodingDraft({ silent: true, saveStatus: false })
    } catch (_error) {
      setSyncStatus('Draft pending sync', 'error')
    }

    await syncSessionProgress('submission', { quiet: true })

    const unanswered = Math.max(questions.length - getAnsweredCount(), 0)
    if (!force && unanswered > 0) {
      const proceed = window.confirm(`You still have ${unanswered} unanswered question(s). Submit anyway?`)
      if (!proceed) {
        return
      }
    }

    persistUiState()
    await window.electronAPI.navigateTo('submission')
  } finally {
    isSubmitting = false
    if (submitButton) {
      submitButton.disabled = false
      submitButton.textContent = 'Submit'
    }
  }
}

async function toggleFlag() {
  const question = getCurrentQuestion()
  if (!question) return
  const id = question.id
  markDirty('Saving review flag...')
  if (flaggedQuestionIds.includes(id)) {
    flaggedQuestionIds = flaggedQuestionIds.filter((item) => item !== id)
  } else {
    flaggedQuestionIds.push(id)
  }
  updateProgress()
  const synced = await syncSessionProgress('flag-update', { quiet: true })
  if (synced) {
    markSynced('Review flag saved')
  }
}

function showInstructions() {
  alert('Complete all questions within the allotted time. Coding questions support JavaScript, Python, and C++. Visible tests can be run before final submission. Hidden tests are used only during Submit.')
}

async function initializeExam() {
  const title = document.getElementById('examTitleHeader')
  const code = document.getElementById('examCodeHeader')
  if (title) title.textContent = localStorage.getItem('currentExamName') || 'Assessment'
  if (code) code.textContent = `Exam ID: ${localStorage.getItem('currentExamCode') || '--'}`

  loadUiState()
  updateConnectionStatus()
  setSyncStatus('Connecting to exam session...', 'syncing')

  runtimeCapabilities = await window.electronAPI.getRuntimeCapabilities()
  const result = await window.electronAPI.getExamQuestions(examId)
  questions = (result.data || []).sort((a, b) => a.orderIndex - b.orderIndex)
  await startSessionIfNeeded()
  await restoreSessionState()

  currentIndex = Math.min(currentIndex, Math.max(questions.length - 1, 0))
  updateTimer()
  startTimer()
  renderQuestion()
  markSynced('Session restored')
}

function setupConnectivityEvents() {
  window.addEventListener('online', () => {
    updateConnectionStatus()
    setLiveBanner('Connection restored.', 'ok')
  })

  window.addEventListener('offline', () => {
    updateConnectionStatus()
    if (canReportIncident('offline')) {
      void reportIncident('network_offline', 'Network disconnected during exam', 'medium')
    }
  })
}

function setupMonitoringEvents() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      return
    }
    if (canReportIncident('visibility')) {
      void reportIncident('window_hidden', 'Exam window lost visibility', 'high', { hidden: true })
      setLiveBanner('Please keep the exam window visible at all times.', 'warning')
    }
  })

  window.addEventListener('blur', () => {
    if (canReportIncident('blur')) {
      void reportIncident('window_focus_lost', 'Exam window lost focus', 'medium')
    }
  })
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase()

    if (event.ctrlKey && key === 's') {
      event.preventDefault()
      void syncSessionProgress('manual', { quiet: false })
      setLiveBanner('Manual sync requested.', 'info')
      return
    }

    if (isTypingTarget(event)) {
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      void goToQuestion(currentIndex - 1)
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      void goToQuestion(currentIndex + 1)
      return
    }

    if (key === 'f') {
      event.preventDefault()
      void toggleFlag()
    }
  })
}

document.addEventListener('DOMContentLoaded', async () => {
  ensureCodeEditor()
  configureDashboardNavigation()
  setupConnectivityEvents()
  setupMonitoringEvents()
  setupKeyboardShortcuts()
  await initializeExam()

  document.querySelector('[data-nav-prev]')?.addEventListener('click', () => goToQuestion(currentIndex - 1))
  document.querySelector('[data-nav-next]')?.addEventListener('click', () => goToQuestion(currentIndex + 1))
  document.querySelector('[data-sync-now]')?.addEventListener('click', () => {
    void syncSessionProgress('manual', { quiet: false })
  })
  document.querySelector('[data-flag-toggle]')?.addEventListener('click', () => {
    void toggleFlag()
  })
  document.getElementById('runCode')?.addEventListener('click', () => runCode('sample'))
  document.getElementById('submitCode')?.addEventListener('click', () => runCode('submit'))
  document.getElementById('loadStarterCode')?.addEventListener('click', () => {
    const question = getCurrentQuestion()
    const select = document.getElementById('codeLanguage')
    if (question && select) {
      setEditorLanguage(select.value)
      setEditorValue(getStarterCode(question, select.value))
      refreshCodingSignature()
      markDirty('Template loaded')
      scheduleDraftAutosave()
    }
  })
  document.getElementById('copyPrompt')?.addEventListener('click', async () => {
    const question = getCurrentQuestion()
    if (question) {
      await navigator.clipboard.writeText(question.prompt)
    }
  })
  document.getElementById('codeLanguage')?.addEventListener('change', () => {
    const question = getCurrentQuestion()
    const select = document.getElementById('codeLanguage')
    if (question && select) {
      setEditorLanguage(select.value)
    }
    if (question && select && !answers[String(question.id)]?.code) {
      setEditorValue(getStarterCode(question, select.value))
    }
    refreshCodingSignature()
    markDirty('Language changed')
    scheduleDraftAutosave()
  })

  document.getElementById('codeEditor')?.addEventListener('input', () => {
    markDirty('Code updated')
    scheduleDraftAutosave()
  })

  document.querySelector('[data-submit-exam]')?.addEventListener('click', () => goToSubmission({ force: false }))
})

window.addEventListener('beforeunload', (event) => {
  persistUiState()
  if (dirtyState) {
    event.preventDefault()
    event.returnValue = ''
  }
})

window.nextQuestion = () => goToQuestion(currentIndex + 1)
window.previousQuestion = () => goToQuestion(currentIndex - 1)
window.showInstructions = showInstructions
window.toggleFlag = toggleFlag
