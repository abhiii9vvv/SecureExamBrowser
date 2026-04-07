let submissionSummary = null
let questions = []

function getDashboardDestination() {
  const role = (localStorage.getItem('currentUserRole') || 'student').toLowerCase()
  return role === 'admin' ? 'dashboard' : 'student-dashboard'
}

function updateMetrics() {
  if (!submissionSummary) return
  const total = questions.length
  const answered = submissionSummary.answered || 0
  const unanswered = submissionSummary.unanswered ?? Math.max(total - answered, 0)
  const flagged = submissionSummary.flagged || 0
  const percentage = total > 0 ? Math.round((answered / total) * 100) : 0

  const timer = document.querySelector('[data-timer-display]')
  if (timer) {
    const remaining = submissionSummary.remainingSeconds || 0
    const hours = Math.floor(remaining / 3600)
    const minutes = Math.floor((remaining % 3600) / 60)
    const seconds = remaining % 60
    timer.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  document.querySelector('[data-radial-value]').textContent = `${percentage}%`
  document.querySelector('[data-radial-meter]').style.background = `conic-gradient(#111111 0deg ${percentage * 3.6}deg, #e5e7eb ${percentage * 3.6}deg 360deg)`
  document.querySelector('[data-metric="answered"] [data-metric-value]').textContent = String(answered)
  document.querySelector('[data-metric="answered"] [data-metric-total]').textContent = `/ ${total}`
  document.querySelector('[data-metric="unanswered"] [data-metric-value]').textContent = String(unanswered)
  document.querySelector('[data-metric="unanswered"] [data-metric-total]').textContent = `/ ${total}`
  document.querySelector('[data-metric="flagged"] [data-metric-value]').textContent = String(flagged)
  document.querySelector('[data-metric="flagged"] [data-metric-total]').textContent = `/ ${total}`
}

function renderGrid() {
  const container = document.querySelector('[data-submission-grid]')
  if (!container || !submissionSummary) return
  container.innerHTML = ''

  const flaggedIds = submissionSummary.flaggedQuestionIds || []
  const answerMap = submissionSummary.answers || {}

  questions.forEach((question, index) => {
    const wrapper = document.createElement('div')
    wrapper.className = 'col-2 col-sm-2 col-md-1'
    const button = document.createElement('button')
    button.className = 'question-button position-relative w-100'
    button.textContent = String(index + 1)
    if (answerMap[String(question.id)]) button.classList.add('is-answered')
    if (flaggedIds.includes(question.id)) button.classList.add('is-flagged')
    button.addEventListener('click', () => goToQuestion(index))
    wrapper.appendChild(button)
    container.appendChild(wrapper)
  })
}

async function loadSummary() {
  const sessionId = Number(localStorage.getItem('currentSessionId') || '0')
  const examId = Number(localStorage.getItem('currentExamId') || '0')
  const userName = localStorage.getItem('currentUserName') || 'Student'
  const studentName = document.getElementById('studentName')
  if (studentName) studentName.textContent = userName

  const questionResult = await window.electronAPI.getExamQuestions(examId)
  questions = (questionResult.data || []).sort((a, b) => a.orderIndex - b.orderIndex)

  const sessionState = await window.electronAPI.getSessionState(sessionId)
  const summaryResult = await window.electronAPI.getSubmissionSummary(sessionId)
  submissionSummary = {
    ...(summaryResult.data || {}),
    remainingSeconds: sessionState.data?.remainingSeconds || 0,
    flaggedQuestionIds: sessionState.data?.flaggedQuestionIds || summaryResult.data?.flaggedQuestionIds || [],
    answers: sessionState.data?.answers || summaryResult.data?.answers || {}
  }

  updateMetrics()
  renderGrid()
}

async function submitExam() {
  const sessionId = Number(localStorage.getItem('currentSessionId') || '0')
  const examId = Number(localStorage.getItem('currentExamId') || '0')
  const userId = Number(localStorage.getItem('currentUserId') || '0')
  const submitButton = document.querySelector('[data-submit-button]')
  if (submitButton) {
    submitButton.disabled = true
    submitButton.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> Submitting...'
  }

  try {
    const result = await window.electronAPI.saveExamSubmission({
      sessionId,
      examId,
      userId,
      flaggedQuestionIds: submissionSummary.flaggedQuestionIds || [],
      timeRemaining: submissionSummary.remainingSeconds || 0
    })
    if (!result.success) {
      throw new Error(result.error || 'Submission failed')
    }
    localStorage.setItem('lastSubmissionScore', String(result.data.score ?? 0))
    localStorage.setItem('lastSubmissionAt', new Date().toISOString())
    localStorage.setItem('lastSubmissionExamName', localStorage.getItem('currentExamName') || '')
    localStorage.removeItem('examUiState')
    alert(`Exam submitted successfully. Score: ${result.data.score}%`)
    await window.electronAPI.navigateTo(getDashboardDestination())
  } catch (error) {
    alert(error.message || 'Submission failed')
    if (submitButton) {
      submitButton.disabled = false
      submitButton.innerHTML = 'Confirm Submission'
    }
  }
}

function confirmSubmission() {
  if (!submissionSummary) return
  const message = `Submit exam now?\n\nAnswered: ${submissionSummary.answered}/${questions.length}\nFlagged: ${submissionSummary.flagged}`
  if (confirm(message)) {
    submitExam()
  }
}

async function returnToExam() {
  await window.electronAPI.navigateTo('exam')
}

function goToQuestion(index) {
  localStorage.setItem('examUiState', JSON.stringify({
    currentIndex: index,
    timeRemaining: submissionSummary.remainingSeconds || 0
  }))
  returnToExam()
}

document.addEventListener('DOMContentLoaded', loadSummary)
window.confirmSubmission = confirmSubmission
window.returnToExam = returnToExam
