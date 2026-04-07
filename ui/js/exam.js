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

function getCurrentUserRole() {
  return (localStorage.getItem('currentUserRole') || 'student').toLowerCase()
}

function getDashboardDestination() {
  return getCurrentUserRole() === 'admin' ? 'dashboard' : 'student-dashboard'
}

async function navigateToDashboard() {
  await saveCurrentCodingDraft()
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
  const hours = Math.floor(timeRemaining / 3600)
  const minutes = Math.floor((timeRemaining % 3600) / 60)
  const seconds = timeRemaining % 60
  const label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  document.querySelectorAll('[data-timer]').forEach((element) => {
    element.textContent = label
  })
}

function updateProgress() {
  const answered = Object.keys(answers).length
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
  const requested = new Set(question.languages || [])
  Array.from(select.options).forEach((option) => {
    option.disabled = !(supported.has(option.value) && requested.has(option.value))
  })
}

function getStarterCode(question, language) {
  const starter = question?.starterCode || {}
  return starter[language] || starter.javascript || starter.python || starter.cpp || ''
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
    if (text) text.textContent = question.options[index] || ''
    if (radio) {
      radio.checked = answers[String(question.id)]?.selectedOption === index
      radio.onchange = async () => {
        answers[String(question.id)] = {
          type: 'mcq',
          selectedOption: index,
          savedAt: new Date().toISOString()
        }
        await window.electronAPI.saveMCQAnswer({
          sessionId,
          questionId: question.id,
          selectedOption: index
        })
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
  const editor = document.getElementById('codeEditor')
  const output = document.getElementById('codeOutput')

  document.querySelector('[data-coding-question-badge]').textContent = `Question ${currentIndex + 1}`
  document.querySelector('[data-coding-question-text]').textContent = question.title
  document.querySelector('[data-coding-prompt]').textContent = question.prompt
  document.querySelector('[data-coding-constraints]').innerHTML = (question.constraints || []).map((item) => `<div>${item}</div>`).join('')
  document.querySelector('[data-coding-examples]').innerHTML = (question.examples || []).map((example, index) => `
    <div class="coding-example">
      <div class="coding-example-title">Example ${index + 1}</div>
      <div><strong>Input</strong></div>
      <code class="coding-example-code">${example.input}</code>
      <div class="mt-2"><strong>Output</strong></div>
      <code class="coding-example-code">${example.output}</code>
      ${example.explanation ? `<div class="text-muted small mt-2">${example.explanation}</div>` : ''}
    </div>
  `).join('')

  updateLanguageOptions(question)
  const preferredLanguage = saved?.language && !select.querySelector(`option[value="${saved.language}"]`)?.disabled
    ? saved.language
    : Array.from(select.options).find((option) => !option.disabled)?.value || 'javascript'

  select.value = preferredLanguage
  editor.value = saved?.code || getStarterCode(question, preferredLanguage)
  output.textContent = saved?.status ? `Last result: ${saved.status}` : 'Ready.'
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

async function saveCurrentCodingDraft() {
  const question = getCurrentQuestion()
  if (!question || question.type !== 'coding') return
  const editor = document.getElementById('codeEditor')
  const select = document.getElementById('codeLanguage')
  if (!editor || !select) return

  const payload = {
    type: 'coding',
    code: editor.value,
    language: select.value,
    status: answers[String(question.id)]?.status || 'Draft',
    testSummary: answers[String(question.id)]?.testSummary || {},
    savedAt: new Date().toISOString()
  }
  answers[String(question.id)] = payload
  await window.electronAPI.saveCodeAnswer({
    sessionId,
    questionId: question.id,
    code: payload.code,
    language: payload.language,
    status: payload.status,
    testSummary: payload.testSummary
  })
}

async function goToQuestion(index) {
  if (index < 0 || index >= questions.length) return
  await saveCurrentCodingDraft()
  currentIndex = index
  renderQuestion()
}

async function runCode(mode) {
  const question = getCurrentQuestion()
  if (!question || question.type !== 'coding') return

  const editor = document.getElementById('codeEditor')
  const select = document.getElementById('codeLanguage')
  const output = document.getElementById('codeOutput')
  if (!editor || !select || !output) return

  output.textContent = mode === 'sample' ? 'Running visible test cases...' : 'Submitting and running all tests...'

  const result = await window.electronAPI.runCode({
    sessionId,
    questionId: question.id,
    language: select.value,
    code: editor.value,
    mode
  })

  if (!result.success) {
    output.textContent = result.error || 'Execution failed.'
    return
  }

  const lines = []
  lines.push(`Status: ${result.status}`)
  lines.push(`Passed: ${result.passedCount}/${result.totalCount}`)
  lines.push(`Time: ${result.totalTimeMs}ms`)
  lines.push('')

  result.results.forEach((item, index) => {
    if (mode === 'sample' || !item.hidden) {
      lines.push(`Test ${index + 1}: ${item.passed ? 'Passed' : 'Failed'}`)
      lines.push(`Expected: ${JSON.stringify(item.expectedOutput)}`)
      lines.push(`Actual: ${JSON.stringify(item.actualOutput)}`)
      if (item.error) lines.push(`Error: ${item.error}`)
      lines.push('')
    }
  })

  output.textContent = lines.join('\n')

  if (mode === 'submit') {
    answers[String(question.id)] = {
      type: 'coding',
      code: editor.value,
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
    await window.electronAPI.saveCodeAnswer({
      sessionId,
      questionId: question.id,
      code: editor.value,
      language: select.value,
      status: result.status,
      testSummary: answers[String(question.id)].testSummary
    })
    updateProgress()
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
  timerHandle = setInterval(async () => {
    timeRemaining = Math.max(timeRemaining - 1, 0)
    updateTimer()
    persistUiState()
    if (sessionId && timeRemaining % 15 === 0) {
      await window.electronAPI.saveSessionProgress({
        sessionId,
        flaggedQuestionIds,
        remainingSeconds: timeRemaining
      })
    }
    if (timeRemaining === 0) {
      clearInterval(timerHandle)
      await goToSubmission()
    }
  }, 1000)
}

async function goToSubmission() {
  await saveCurrentCodingDraft()
  await window.electronAPI.saveSessionProgress({
    sessionId,
    flaggedQuestionIds,
    remainingSeconds: timeRemaining
  })
  persistUiState()
  await window.electronAPI.navigateTo('submission')
}

function toggleFlag() {
  const question = getCurrentQuestion()
  if (!question) return
  const id = question.id
  if (flaggedQuestionIds.includes(id)) {
    flaggedQuestionIds = flaggedQuestionIds.filter((item) => item !== id)
  } else {
    flaggedQuestionIds.push(id)
  }
  updateProgress()
  window.electronAPI.saveSessionProgress({
    sessionId,
    flaggedQuestionIds,
    remainingSeconds: timeRemaining
  })
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
  runtimeCapabilities = await window.electronAPI.getRuntimeCapabilities()
  const result = await window.electronAPI.getExamQuestions(examId)
  questions = (result.data || []).sort((a, b) => a.orderIndex - b.orderIndex)
  await startSessionIfNeeded()
  await restoreSessionState()

  currentIndex = Math.min(currentIndex, Math.max(questions.length - 1, 0))
  updateTimer()
  startTimer()
  renderQuestion()
}

document.addEventListener('DOMContentLoaded', async () => {
  configureDashboardNavigation()
  await initializeExam()

  document.querySelector('[data-nav-prev]')?.addEventListener('click', () => goToQuestion(currentIndex - 1))
  document.querySelector('[data-nav-next]')?.addEventListener('click', () => goToQuestion(currentIndex + 1))
  document.getElementById('runCode')?.addEventListener('click', () => runCode('sample'))
  document.getElementById('submitCode')?.addEventListener('click', () => runCode('submit'))
  document.getElementById('loadStarterCode')?.addEventListener('click', () => {
    const question = getCurrentQuestion()
    const editor = document.getElementById('codeEditor')
    const select = document.getElementById('codeLanguage')
    if (question && editor && select) {
      editor.value = getStarterCode(question, select.value)
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
    const editor = document.getElementById('codeEditor')
    const select = document.getElementById('codeLanguage')
    if (question && editor && select && !answers[String(question.id)]?.code) {
      editor.value = getStarterCode(question, select.value)
    }
  })
  document.querySelector('[data-submit-exam]')?.addEventListener('click', () => goToSubmission())
})

window.addEventListener('beforeunload', () => {
  persistUiState()
})

window.nextQuestion = () => goToQuestion(currentIndex + 1)
window.previousQuestion = () => goToQuestion(currentIndex - 1)
window.showInstructions = showInstructions
window.toggleFlag = toggleFlag
