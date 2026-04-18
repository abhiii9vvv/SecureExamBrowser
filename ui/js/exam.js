import { navigateTo, showToast, showConfirm } from './router.js'

/* ===================== STATE ===================== */
let questions         = []
let currentIndex      = 0
let sessionId         = Number(localStorage.getItem('currentSessionId') || '0')
let examId            = Number(localStorage.getItem('currentExamId') || '0')
let examDuration      = Number(localStorage.getItem('currentExamDuration') || '120') * 60
let timeRemaining     = examDuration
let answers           = {}
let flagged           = []
let editor            = null
let timerHandle       = null
let autosaveHandle    = null
let isDirty           = false
let isSubmitting      = false
let suppressChange    = false
let activeSectionType = 'mcq'
const sectionLastVisited = { mcq: 0, coding: 0 }
let plainEditorLines   = null
let proctorStream      = null

/* ===================== DOM REFS ===================== */
const progressLabel    = document.getElementById('progressLabel')
const progressBar      = document.getElementById('progressBar')
const examBody         = document.querySelector('.exam-body')
const timerDisplay     = document.getElementById('timerDisplay')
const timerWrap        = document.getElementById('timerWrap')
const syncStatus       = document.getElementById('syncStatus')
const liveBanner       = document.getElementById('liveBanner')
const qBadge           = document.getElementById('qBadge')
const qTitle           = document.getElementById('questionTitle')
const qMeta            = document.getElementById('questionMeta')
const qBody            = document.getElementById('questionBody')
const mcqInfo          = document.getElementById('mcqInfo')
const codingPanel      = document.getElementById('codingPanel')
const outputEl         = document.getElementById('codeOutput')
const outputBadge      = document.getElementById('outputBadge')
const palette          = document.getElementById('questionPalette')
const flagBtn          = document.getElementById('btnFlagQuestion')
const prevBtn          = document.getElementById('btnPrev')
const nextBtn          = document.getElementById('btnNext')
const submitExamBtn    = document.getElementById('submitExamBtn')
const submitModal      = document.getElementById('submitModal')
const instructModal    = document.getElementById('instructionsModal')
const violationOverlay = document.getElementById('violationOverlay')
const violationMsg     = document.getElementById('violationMsg')
const sectionMcqCount  = document.getElementById('sectionMcqCount')
const sectionCodingCount = document.getElementById('sectionCodingCount')
const sectionTabMcq    = document.getElementById('sectionTabMcq')
const sectionTabCoding = document.getElementById('sectionTabCoding')
const proctorPip       = document.getElementById('proctorPip')
const proctorVideo     = document.getElementById('proctorVideo')
const proctorPipLabel  = document.getElementById('proctorPipLabel')

const SECTION_LABELS = { mcq: 'MCQ', coding: 'Coding' }
const LANGUAGE_LABELS = { javascript: 'JavaScript', python: 'Python', cpp: 'C++' }

/* ===================== UTILS ===================== */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function escHtml(s) {
  if (!s) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function formatTime(s) {
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
}

function getCurrentQ() { return questions[currentIndex] }

function normalizeQuestionType(type) {
  return String(type || '').toLowerCase() === 'coding' ? 'coding' : 'mcq'
}

function getSectionLabel(type) {
  return SECTION_LABELS[type] || 'Section'
}

function getVisibleQuestionIndices(type = activeSectionType) {
  return questions.reduce((acc, q, index) => {
    if (normalizeQuestionType(q.type) === type) acc.push(index)
    return acc
  }, [])
}

function getOtherSectionType(type = activeSectionType) {
  return type === 'coding' ? 'mcq' : 'coding'
}

/* ===================== TIMER ===================== */
function startTimer() {
  updateTimerDisplay()
  timerHandle = setInterval(() => {
    timeRemaining--
    updateTimerDisplay()
    if (timeRemaining <= 0) { clearInterval(timerHandle); autoSubmit() }
  }, 1000)
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(Math.max(0, timeRemaining))
  timerWrap.className = timeRemaining <= 300 ? 'exam-timer danger'
    : timeRemaining <= 900 ? 'exam-timer warn'
    : 'exam-timer'
}

/* ===================== SYNC ===================== */
function setSyncStatus(msg, state = 'idle') {
  const icons = {
    idle:    `<svg viewBox="0 0 20 20" fill="currentColor" style="width:10px;height:10px;color:var(--success)"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>`,
    syncing: `<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>`,
    error:   `<svg viewBox="0 0 20 20" fill="currentColor" style="width:10px;height:10px;color:var(--danger)"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"/></svg>`,
  }
  syncStatus.innerHTML = `${icons[state] || icons.idle}<span style="font-size:var(--text-xs);color:var(--text-muted)">${msg}</span>`
}

/* ===================== BANNER ===================== */
function showBanner(msg, type = 'info') {
  liveBanner.textContent = msg
  liveBanner.className = `live-banner ${type}`
  liveBanner.classList.remove('hidden')
  setTimeout(() => liveBanner.classList.add('hidden'), 5000)
}

/* ===================== PROGRESS ===================== */
function updateProgress() {
  const visibleIndices = getVisibleQuestionIndices()
  const sectionTotal = visibleIndices.length
  const sectionAnswered = visibleIndices.filter(index => isAnswered(questions[index].id)).length
  const sectionPos = Math.max(visibleIndices.indexOf(currentIndex) + 1, 0)
  progressLabel.textContent = `${getSectionLabel(activeSectionType)} ${sectionPos} / ${sectionTotal}`
  progressBar.style.width = sectionTotal ? `${(sectionAnswered / sectionTotal) * 100}%` : '0%'
}

function updateSectionTabs() {
  const mcqIndices = getVisibleQuestionIndices('mcq')
  const codingIndices = getVisibleQuestionIndices('coding')
  const mcqAnswered = mcqIndices.filter(index => isAnswered(questions[index].id)).length
  const codingAnswered = codingIndices.filter(index => isAnswered(questions[index].id)).length

  sectionMcqCount.textContent = `${mcqAnswered}/${mcqIndices.length}`
  sectionCodingCount.textContent = `${codingAnswered}/${codingIndices.length}`

  sectionTabMcq.disabled = mcqIndices.length === 0
  sectionTabCoding.disabled = codingIndices.length === 0

  sectionTabMcq.classList.toggle('active', activeSectionType === 'mcq')
  sectionTabCoding.classList.toggle('active', activeSectionType === 'coding')
  sectionTabMcq.setAttribute('aria-selected', String(activeSectionType === 'mcq'))
  sectionTabCoding.setAttribute('aria-selected', String(activeSectionType === 'coding'))
}

function activateSection(type) {
  const nextType = type === 'coding' ? 'coding' : 'mcq'
  const nextIndices = getVisibleQuestionIndices(nextType)
  if (!nextIndices.length) return

  activeSectionType = nextType
  const rememberedIndex = sectionLastVisited[nextType]
  const targetIndex = nextIndices.includes(rememberedIndex) ? rememberedIndex : nextIndices[0]
  goToQuestion(targetIndex)
}

/* ===================== PALETTE ===================== */
function renderPalette() {
  palette.innerHTML = ''
  const visibleIndices = getVisibleQuestionIndices()

  if (!visibleIndices.length) {
    palette.innerHTML = '<span class="text-xs text-mute">No questions in this section</span>'
    return
  }

  visibleIndices.forEach((questionIndex, sectionIndex) => {
    const q = questions[questionIndex]
    const btn = document.createElement('button')
    btn.className = 'palette-btn'
    btn.textContent = sectionIndex + 1
    btn.title = q.title || `${getSectionLabel(activeSectionType)} question ${sectionIndex + 1}`
    btn.setAttribute('aria-label', `Go to ${getSectionLabel(activeSectionType)} question ${sectionIndex + 1}`)
    if (questionIndex === currentIndex)    btn.classList.add('current')
    else if (flagged.includes(q.id))  btn.classList.add('flagged')
    else if (isAnswered(q.id))        btn.classList.add('answered')
    btn.addEventListener('click', () => goToQuestion(questionIndex))
    palette.appendChild(btn)
  })
}

function isAnswered(qId) {
  const a = answers[String(qId)]
  if (!a) return false
  if (a.type === 'mcq') return a.selectedOption !== undefined
  return (a.code || '').trim().length > 0
}

/* ===================== NAVIGATION ===================== */
async function goToQuestion(index) {
  if (index < 0 || index >= questions.length || index === currentIndex) return
  const curr = getCurrentQ()
  if (normalizeQuestionType(curr?.type) === 'coding') await saveCodingDraft()
  sectionLastVisited[normalizeQuestionType(curr?.type)] = currentIndex
  currentIndex = index
  sectionLastVisited[normalizeQuestionType(questions[index]?.type)] = index
  activeSectionType = normalizeQuestionType(questions[index]?.type)
  renderQuestion()
  renderPalette()
  updateProgress()
  updateSectionTabs()
}

function goToAdjacentInSection(direction) {
  const visibleIndices = getVisibleQuestionIndices()
  const position = visibleIndices.indexOf(currentIndex)
  const nextPosition = position + direction
  if (nextPosition < 0 || nextPosition >= visibleIndices.length) return false
  goToQuestion(visibleIndices[nextPosition])
  return true
}

function goToNextQuestion() {
  const moved = goToAdjacentInSection(1)
  if (moved) return

  const otherSection = getOtherSectionType(activeSectionType)
  const otherSectionIndices = getVisibleQuestionIndices(otherSection)
  if (otherSectionIndices.length) {
    activateSection(otherSection)
    showToast(`Switched to ${getSectionLabel(otherSection)} section.`, 'info')
    return
  }

  openSubmitModal()
}

/* ===================== RENDER QUESTION ===================== */
function renderQuestion() {
  const q = getCurrentQ()
  if (!q) return

  const qType = normalizeQuestionType(q.type)
  activeSectionType = qType
  const visibleIndices = getVisibleQuestionIndices()
  const sectionPos = Math.max(visibleIndices.indexOf(currentIndex) + 1, 1)
  examBody.classList.toggle('mode-coding', qType === 'coding')
  examBody.classList.toggle('mode-mcq', qType !== 'coding')

  qBadge.innerHTML =
    `<svg viewBox="0 0 20 20" fill="currentColor" style="width:10px;height:10px"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/></svg>${getSectionLabel(qType)} ${sectionPos}`

  qTitle.textContent = q.title || 'Question'

  const metaParts = []
  if (q.section)             metaParts.push(`<span class="badge badge-default">${escHtml(q.section)}</span>`)
  if (q.difficulty)          metaParts.push(`<span class="badge ${diffClass(q.difficulty)}">${escHtml(q.difficulty)}</span>`)
  if (q.points)              metaParts.push(`<span class="badge badge-info">${q.points} pts</span>`)
  if (qType === 'coding')    metaParts.push(`<span class="badge badge-accent">Coding</span>`)
  if (qType === 'mcq')       metaParts.push(`<span class="badge badge-default">Single choice</span>`)
  qMeta.innerHTML = metaParts.join('')

  if (qType === 'coding') renderCoding(q)
  else                     renderMcq(q)

  const sectionPosition = visibleIndices.indexOf(currentIndex)
  const atFirst = sectionPosition <= 0
  const atLast = sectionPosition === visibleIndices.length - 1
  prevBtn.disabled = atFirst
  if (!atLast) {
    nextBtn.textContent = 'Next'
  } else {
    const hasOtherSection = getVisibleQuestionIndices(getOtherSectionType(activeSectionType)).length > 0
    nextBtn.textContent = hasOtherSection ? 'Next Section' : 'Submit Exam'
  }

  const isFlagged = flagged.includes(q.id)
  flagBtn.innerHTML   = isFlagged
    ? `<svg viewBox="0 0 20 20" fill="currentColor" style="width:13px;height:13px"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 7l2.55 2.4A1 1 0 0116 11H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"/></svg> Flagged`
    : `<svg viewBox="0 0 20 20" fill="currentColor" style="width:13px;height:13px"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 7l2.55 2.4A1 1 0 0116 11H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z"/></svg> Flag`
  flagBtn.className = isFlagged ? 'btn btn-secondary btn-sm' : 'btn btn-ghost btn-sm'
}

function diffClass(d) {
  const m = { easy: 'badge-success', medium: 'badge-warning', hard: 'badge-danger' }
  return m[(d || '').toLowerCase()] || 'badge-default'
}

/* ===================== MCQ ===================== */
function renderMcq(q) {
  mcqInfo.className              = 'exam-mcq-info hidden'
  codingPanel.style.display      = 'none'

  const saved = answers[String(q.id)]
  let html = `<p class="exam-q-prompt">${escHtml(q.prompt || q.description || '')}</p>`
  html    += `<div class="exam-section-heading">Choose one answer</div><div class="mcq-options" id="mcqOptions">`

  const opts = q.options || ['', '', '', '']
  const keys = ['A', 'B', 'C', 'D']
  opts.forEach((opt, i) => {
    if (!opt) return
    const selected = saved?.selectedOption === i
    html += `
      <label class="mcq-option${selected ? ' selected' : ''}" data-idx="${i}">
        <input type="radio" name="mcq-${q.id}" value="${i}" ${selected ? 'checked' : ''}/>
        <span class="mcq-opt-key">${keys[i]}</span>
        <span class="mcq-opt-text">${escHtml(opt)}</span>
      </label>`
  })
  html += '</div>'
  qBody.innerHTML = html

  qBody.querySelectorAll('.mcq-option').forEach(label => {
    label.addEventListener('click', () => {
      const idx = parseInt(label.dataset.idx)
      qBody.querySelectorAll('.mcq-option').forEach(l => l.classList.remove('selected'))
      label.classList.add('selected')
      label.querySelector('input').checked = true
      saveMcqAnswer(q.id, idx)
    })
  })
}

async function saveMcqAnswer(qId, idx) {
  answers[String(qId)] = { type: 'mcq', selectedOption: idx }
  renderPalette()
  updateProgress()
  updateSectionTabs()
  setSyncStatus('Saving...', 'syncing')
  try {
    await window.electronAPI.saveMCQAnswer({ sessionId, questionId: qId, selectedOption: idx })
    setSyncStatus('Saved', 'idle')
  } catch (err) {
    setSyncStatus('Save failed', 'error')
    console.warn('[exam] saveMCQ error:', err.message)
  }
}

/* ===================== CODING ===================== */
const LANG_MODE = { javascript: 'text/javascript', python: 'text/x-python', cpp: 'text/x-c++src' }
const DEFAULT_LANG_ORDER = ['javascript', 'python', 'cpp']

function getQuestionLanguages(q) {
  const fromQuestion = Array.isArray(q?.languages) ? q.languages : []
  const normalized = fromQuestion
    .map(lang => String(lang || '').toLowerCase())
    .filter(lang => Object.prototype.hasOwnProperty.call(LANG_MODE, lang))
  return normalized.length ? normalized : DEFAULT_LANG_ORDER
}

function getDefaultLanguage(q) {
  const languages = getQuestionLanguages(q)
  return languages[0] || 'javascript'
}

function configureLanguageSelect(q, selectedLang) {
  const langSelect = document.getElementById('codeLanguage')
  if (!langSelect) return getDefaultLanguage(q)

  const languages = getQuestionLanguages(q)
  langSelect.innerHTML = ''

  languages.forEach(lang => {
    const option = document.createElement('option')
    option.value = lang
    option.textContent = LANGUAGE_LABELS[lang] || lang
    langSelect.appendChild(option)
  })

  const finalLang = languages.includes(selectedLang) ? selectedLang : languages[0]
  langSelect.value = finalLang
  return finalLang
}

function renderCoding(q) {
  mcqInfo.className         = 'exam-mcq-info hidden'
  codingPanel.style.display = 'flex'
  codingPanel.style.flexDirection = 'column'
  codingPanel.style.height  = '100%'

  const saved = answers[String(q.id)]
  const initialLang = saved?.language || getDefaultLanguage(q)

  // Question body — prompt + constraints + examples
  let html = `<p class="exam-q-prompt">${escHtml(q.prompt || q.description || '')}</p>`

  if (q.functionName) {
    const lang = initialLang
    html += `<div class="exam-section-heading">Function Signature</div>
             <div class="fn-signature">${escHtml(buildSignature(q, lang))}</div>`
  }

  if (Array.isArray(q.constraints) && q.constraints.length) {
    html += `<div class="exam-section-heading">Constraints</div><ul class="constraint-list">`
    q.constraints.forEach(c => { html += `<li>${escHtml(c)}</li>` })
    html += '</ul>'
  }

  if (Array.isArray(q.examples) && q.examples.length) {
    html += `<div class="exam-section-heading">Examples</div>`
    q.examples.forEach((ex, i) => {
      html += `<div class="code-example">
        <div class="code-example-label">Example ${i + 1}</div>
        <div><strong style="font-size:var(--text-xs);color:var(--text-muted)">Input</strong><div class="code-example-block">${escHtml(ex.input ?? '')}</div></div>
        <div style="margin-top:var(--sp-2)"><strong style="font-size:var(--text-xs);color:var(--text-muted)">Output</strong><div class="code-example-block">${escHtml(ex.output ?? '')}</div></div>
        ${ex.explanation ? `<div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:var(--sp-2)">${escHtml(ex.explanation)}</div>` : ''}
      </div>`
    })
  }

  qBody.innerHTML = html

  // Editor
  const lang = configureLanguageSelect(q, initialLang)
  updateEditorLang(lang)

  suppressChange = true
  const code = saved?.code || getTemplate(q, lang)
  if (editor) {
    setEditorValue(code)
    editor.refresh()
  } else {
    initEditor(code)
  }
  suppressChange = false

  // Reset output
  const lastResult = saved?.lastResult || ''
  outputEl.textContent = lastResult || 'Ready. Click "Run" to execute your code.'
  outputEl.className   = lastResult ? 'output-pre output-idle' : 'output-pre output-idle'
  outputBadge.textContent = 'Ready'
  outputBadge.className   = 'badge badge-default'
}

function initEditor(initialValue = '') {
  const textarea = document.getElementById('codeEditor')
  if (!textarea) return

  if (!window.CodeMirror && textarea.dataset.editorReady === 'true') {
    textarea.value = initialValue
    syncPlainEditorLines()
    return
  }

  if (window.CodeMirror) {
    editor = window.CodeMirror.fromTextArea(textarea, {
      mode:             'text/javascript',
      theme:            'dracula',
      lineNumbers:      true,
      indentUnit:       2,
      tabSize:          2,
      indentWithTabs:   false,
      autoCloseBrackets: true,
      matchBrackets:    true,
      lineWrapping:     false,
      extraKeys:        { Tab: cm => cm.execCommand('indentMore') }
    })
    editor.setValue(initialValue)
    editor.on('change', () => {
      if (suppressChange) return
      isDirty = true
      scheduleAutosave()
    })
  } else {
    textarea.style.display = ''
    textarea.value = initialValue

    const editorWrap = document.getElementById('editorWrap')
    if (editorWrap && !editorWrap.querySelector('.plain-editor')) {
      const plain = document.createElement('div')
      plain.className = 'plain-editor'
      const lines = document.createElement('pre')
      lines.className = 'plain-editor-lines'
      plainEditorLines = lines

      textarea.parentNode.removeChild(textarea)
      plain.appendChild(lines)
      plain.appendChild(textarea)
      editorWrap.appendChild(plain)

      textarea.addEventListener('scroll', () => {
        if (plainEditorLines) plainEditorLines.scrollTop = textarea.scrollTop
      })
    }

    syncPlainEditorLines()
    textarea.addEventListener('input', () => {
      syncPlainEditorLines()
      isDirty = true
      scheduleAutosave()
    })
    textarea.dataset.editorReady = 'true'
  }
}

function syncPlainEditorLines() {
  if (!plainEditorLines) return
  const text = getEditorValue()
  const lineCount = Math.max(1, text.split('\n').length)
  plainEditorLines.textContent = Array.from({ length: lineCount }, (_, i) => String(i + 1)).join('\n')
}

function updateEditorLang(lang) {
  if (!editor) return
  editor.setOption('mode', LANG_MODE[lang] || 'text/javascript')
}

function getEditorValue() {
  if (editor) return editor.getValue()
  const ta = document.getElementById('codeEditor')
  return ta ? ta.value : ''
}

function setEditorValue(code) {
  if (editor) {
    editor.setValue(code)
    return
  }
  const ta = document.getElementById('codeEditor')
  if (!ta) return
  ta.value = code
  syncPlainEditorLines()
}

function getTemplate(q, lang) {
  const starterCode = q?.starterCode && typeof q.starterCode === 'object' ? q.starterCode[lang] : ''
  if (typeof starterCode === 'string' && starterCode.trim()) return starterCode

  const fn     = q.functionName || 'solve'
  const params = Array.isArray(q.params) ? q.params.map(p => p.name || p).join(', ') : 'input'
  if (lang === 'python') return `def ${fn}(${params}):\n    # Write your solution here\n    pass\n`
  if (lang === 'cpp')    return `#include <bits/stdc++.h>\nusing namespace std;\n\nauto ${fn}(${params}) {\n    // Write your solution here\n}\n`
  return `function ${fn}(${params}) {\n  // Write your solution here\n  return null;\n}\n`
}

function buildSignature(q, lang) {
  const fn     = q.functionName || 'solve'
  const params = Array.isArray(q.params) ? q.params.map(p => p.name || p).join(', ') : 'input'
  if (lang === 'python') return `def ${fn}(${params}):`
  if (lang === 'cpp')    return `auto ${fn}(${params})`
  return `function ${fn}(${params})`
}

/* ===================== AUTOSAVE ===================== */
function scheduleAutosave() {
  clearTimeout(autosaveHandle)
  autosaveHandle = setTimeout(saveCodingDraft, 1500)
}

async function saveCodingDraft(status = 'Draft') {
  const q = getCurrentQ()
  if (!q || normalizeQuestionType(q.type) !== 'coding') return
  const code = getEditorValue()
  const lang  = document.getElementById('codeLanguage')?.value || 'javascript'
  answers[String(q.id)] = { ...(answers[String(q.id)] || {}), type: 'coding', code, language: lang }

  if (!sessionId) return  // No session yet, skip save

  setSyncStatus('Saving...', 'syncing')
  try {
    await window.electronAPI.saveCodeAnswer({
      sessionId,
      questionId: q.id,
      language: lang,
      code,
      status,
      testSummary: answers[String(q.id)]?.testSummary || {}
    })
    setSyncStatus('Saved', 'idle')
    isDirty = false
  } catch (err) {
    setSyncStatus('Save failed', 'error')
    console.warn('[exam] saveCode error:', err.message)
  }
  renderPalette()
  updateProgress()
  updateSectionTabs()
}

/* ===================== RUN CODE ===================== */
function formatRunResults(result) {
  // result from codeExecutionService.runCode():
  // { success, allPassed, passedCount, totalCount, status, results: [...] }
  if (!result.success) {
    return `Error: ${result.error || 'Unknown error'}`
  }

  const lines = []
  lines.push(`Status: ${result.status || (result.allPassed ? 'Accepted' : 'Wrong Answer')}`)
  lines.push(`Passed: ${result.passedCount ?? '?'} / ${result.totalCount ?? '?'}`)

  if (Array.isArray(result.results)) {
    result.results.forEach((r, i) => {
      if (r.hidden) return  // Don't reveal hidden test case details
      const icon = r.passed ? '✓' : '✗'
      lines.push('')
      lines.push(`${icon} Test ${i + 1}${r.description ? ' — ' + r.description : ''}`)
      if (!r.passed) {
        if (r.error) {
          lines.push(`  Error:    ${r.error}`)
        } else {
          lines.push(`  Expected: ${JSON.stringify(r.expectedOutput)}`)
          lines.push(`  Got:      ${JSON.stringify(r.actualOutput)}`)
        }
      }
      lines.push(`  Time:     ${r.executionTimeMs}ms`)
    })
  }

  return lines.join('\n')
}

async function runCode(mode = 'sample') {
  const q = getCurrentQ()
  if (!q || normalizeQuestionType(q.type) !== 'coding') return

  const code = getEditorValue()
  const lang = document.getElementById('codeLanguage').value

  if (!code.trim()) {
    showToast('Write some code first.', 'warning')
    return
  }

  outputEl.textContent = 'Running code...'
  outputEl.className   = 'output-pre output-running'
  outputBadge.textContent = 'Running'
  outputBadge.className   = 'badge badge-info'

  // Save code before running
  await saveCodingDraft(mode === 'submit' ? 'Submitted' : 'Draft')

  try {
    const result = await window.electronAPI.runCode({
      sessionId: sessionId || null,
      questionId: q.id,
      code,
      language: lang,
      mode
    })

    // ──────────────────────────────────────────────
    // FIX: correct property check (not result.passed)
    // codeExecutionService returns: { success, allPassed, status:'Accepted'|'Wrong Answer', ... }
    // ──────────────────────────────────────────────
    const passed = result?.success && (result?.allPassed === true || result?.status === 'Accepted')
    const outputText = formatRunResults(result)

    outputEl.textContent = outputText
    outputEl.className   = passed ? 'output-pre output-success' : 'output-pre output-error'
    outputBadge.textContent = passed ? '✓ Passed' : '✗ Failed'
    outputBadge.className   = passed ? 'badge badge-success' : 'badge badge-danger'

    // Store last result + test summary in answer state
    const ans = answers[String(q.id)] || { type: 'coding', code, language: lang }
    ans.lastResult  = outputText.slice(0, 400)
    ans.testSummary = {
      status:      result?.status || '',
      passedCount: result?.passedCount ?? 0,
      totalCount:  result?.totalCount  ?? 0,
      allPassed:   result?.allPassed   ?? false
    }
    answers[String(q.id)] = ans

  } catch (err) {
    outputEl.textContent = `Execution error: ${err.message}`
    outputEl.className   = 'output-pre output-error'
    outputBadge.textContent = 'Error'
    outputBadge.className   = 'badge badge-danger'
  }
}

/* ===================== FLAG ===================== */
function toggleFlag() {
  const q = getCurrentQ()
  if (!q) return
  const idx = flagged.indexOf(q.id)
  if (idx > -1) {
    flagged.splice(idx, 1)
  } else {
    flagged.push(q.id)
  }
  renderQuestion()
  renderPalette()
}

/* ===================== SUBMIT ===================== */
function openSubmitModal() {
  const answered = Object.values(answers).filter(a =>
    a?.type === 'mcq'
      ? a.selectedOption !== undefined
      : (a?.code || '').trim().length > 0
  ).length
  document.getElementById('submitAnswered').textContent = `${answered} / ${questions.length}`
  document.getElementById('submitFlagged').textContent  = flagged.length
  submitModal.classList.remove('hidden')
}

async function submitExam() {
  if (isSubmitting) return
  isSubmitting = true
  clearInterval(timerHandle)

  try {
    submitModal.classList.add('hidden')
    setSyncStatus('Submitting...', 'syncing')

    // Save current coding question if open
    const curr = getCurrentQ()
    if (normalizeQuestionType(curr?.type) === 'coding') await saveCodingDraft('Submitted')

    const userId = Number(localStorage.getItem('userId') || '0')
    await window.electronAPI.saveExamSubmission({
      sessionId,
      examId,
      userId,
      timeRemaining,
      flaggedQuestionIds: flagged
    })
    await window.electronAPI.endExamSession(sessionId, 'submitted')

    await navigateTo('submission')
  } catch (err) {
    isSubmitting = false
    showToast('Submission failed: ' + (err.message || 'Unknown error'), 'error')
    setSyncStatus('Submit failed', 'error')
  }
}

async function autoSubmit() {
  showBanner('Time expired — auto-submitting in 3 seconds...', 'error')
  await sleep(3000)
  await submitExam()
}

/* ===================== MONITORING ===================== */
function setupMonitoring() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !isSubmitting) {
      reportViolation('tab-switch', 'Tab switch or window minimization detected during exam.')
    }
  })
}

async function startProctorPreview() {
  if (!proctorPip || !proctorVideo || proctorStream) return

  try {
    proctorStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 320 },
        height: { ideal: 180 },
        frameRate: { ideal: 12, max: 15 },
        facingMode: 'user'
      },
      audio: false
    })

    proctorVideo.srcObject = proctorStream
    proctorPip.classList.remove('hidden')
    if (proctorPipLabel) proctorPipLabel.textContent = 'Live Proctor'
  } catch (err) {
    if (proctorPipLabel) {
      proctorPipLabel.textContent = 'Camera Blocked'
    }
    console.warn('[exam] proctor preview unavailable:', err?.message || err)
  }
}

function stopProctorPreview() {
  if (proctorStream) {
    proctorStream.getTracks().forEach(track => track.stop())
    proctorStream = null
  }
  if (proctorVideo) {
    proctorVideo.srcObject = null
  }
}

function reportViolation(type, msg) {
  violationMsg.textContent = msg
  violationOverlay.classList.remove('hidden')
  window.electronAPI.recordIncident?.({
    type, message: msg, sessionId: sessionId || null, severity: 'high'
  }).catch(() => {})
}

/* ===================== PROGRESS SYNC ===================== */
async function syncProgress() {
  if (!sessionId) return
  try {
    await window.electronAPI.saveSessionProgress({
      sessionId,
      remainingSeconds:   timeRemaining,
      flaggedQuestionIds: flagged
    })
  } catch { /* silent */ }
}

/* ===================== INIT ===================== */
async function init() {
  setSyncStatus('Loading...', 'syncing')

  try {
    await window.electronAPI.ensureExamAccess({
      sessionId: sessionId > 0 ? sessionId : null,
      examId: examId > 0 ? examId : null
    })

    // Try to restore progress from localStorage cache
    const cachedProgress = localStorage.getItem('examProgress')
    if (cachedProgress) {
      try {
        const p = JSON.parse(cachedProgress)
        answers       = p.answers       || {}
        flagged       = p.flagged       || []
        if (Object.prototype.hasOwnProperty.call(p, 'timeRemaining')) {
          const cachedRemaining = Number(p.timeRemaining)
          if (Number.isFinite(cachedRemaining) && cachedRemaining >= 0) {
            timeRemaining = cachedRemaining
          }
        }
      } catch { /* ignore malformed cache */ }
    }

    // Load questions
    if (!examId) throw new Error('No exam selected. Please return to the dashboard.')

    const result = await window.electronAPI.getExamQuestions(examId)
    if (!result?.success || !Array.isArray(result.data)) {
      throw new Error(result?.error || 'Failed to load questions')
    }
    questions = [...result.data].sort((a, b) => {
      const orderA = Number.isFinite(a?.orderIndex) ? a.orderIndex : Number.MAX_SAFE_INTEGER
      const orderB = Number.isFinite(b?.orderIndex) ? b.orderIndex : Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      return (a?.id || 0) - (b?.id || 0)
    })
    if (!questions.length) throw new Error('This exam has no questions.')

    activeSectionType = normalizeQuestionType(questions[currentIndex]?.type)
    sectionLastVisited[activeSectionType] = currentIndex

    // Start session if not already started
    if (!sessionId) {
      const userId = Number(localStorage.getItem('userId') || '0')
      const sRes   = await window.electronAPI.startExamSession({
        userId,
        examId,
        sessionToken: `SES-${Date.now().toString(36).toUpperCase()}`
      })
      if (sRes?.success && sRes.data?.sessionId) {
        sessionId = Number(sRes.data.sessionId)
        localStorage.setItem('currentSessionId', String(sessionId))
      } else {
        throw new Error(sRes?.error || 'Could not start exam session')
      }
    } else {
      // Restore server-side progress
      try {
        const state = await window.electronAPI.getSessionState(sessionId)
        if (state?.success && state.data) {
          const d = state.data
          if (Number.isInteger(d.remainingSeconds) && d.remainingSeconds >= 0) timeRemaining = d.remainingSeconds
          if (Array.isArray(d.flaggedQuestionIds)) flagged = d.flaggedQuestionIds
          if (d.answers && typeof d.answers === 'object' && Object.keys(d.answers).length > 0) {
            answers = d.answers
          }
        }
      } catch { /* ignore, use cache */ }
    }

    setSyncStatus('Ready', 'idle')
    renderQuestion()
    renderPalette()
    updateProgress()
    updateSectionTabs()
    startTimer()
    setupMonitoring()
    startProctorPreview()

    // Periodic server sync every 20 seconds
    setInterval(syncProgress, 20000)
    // Periodic localStorage cache every 10 seconds
    setInterval(() => {
      localStorage.setItem('examProgress', JSON.stringify({
        answers, flagged, timeRemaining
      }))
    }, 10000)

  } catch (err) {
    const message = String(err?.message || err || '')
    if (/identity verification|verification/i.test(message)) {
      setSyncStatus('Verification required', 'error')
      showBanner('Identity verification required before entering exam.', 'warning')
      setTimeout(() => {
        navigateTo('verification')
      }, 300)
      return
    }

    setSyncStatus('Load failed', 'error')
    showBanner('Failed to load exam: ' + message, 'error')
    console.error('[exam] init error:', err)
  }
}

/* ===================== EVENT WIRING ===================== */
prevBtn.addEventListener('click',       () => goToAdjacentInSection(-1))
nextBtn.addEventListener('click',       () => goToNextQuestion())
flagBtn.addEventListener('click',       () => toggleFlag())
submitExamBtn.addEventListener('click', () => openSubmitModal())
sectionTabMcq?.addEventListener('click', () => activateSection('mcq'))
sectionTabCoding?.addEventListener('click', () => activateSection('coding'))

document.getElementById('cancelSubmit').addEventListener('click',  () => submitModal.classList.add('hidden'))
document.getElementById('confirmSubmit').addEventListener('click', () => submitExam())

document.getElementById('instructionsTopBtn').addEventListener('click', () => instructModal.classList.remove('hidden'))
document.getElementById('closeInstructions').addEventListener('click',  () => instructModal.classList.add('hidden'))
document.getElementById('violationDismiss').addEventListener('click',   () => violationOverlay.classList.add('hidden'))

document.getElementById('btnRunCode')?.addEventListener('click',     () => runCode('sample'))
document.getElementById('btnSubmitCode')?.addEventListener('click',  () => runCode('submit'))
document.getElementById('btnLoadStarter')?.addEventListener('click', () => {
  const q = getCurrentQ()
  if (!q) return
  const lang = document.getElementById('codeLanguage')?.value || getDefaultLanguage(q)
  suppressChange = true
  setEditorValue(getTemplate(q, lang))
  suppressChange = false
  isDirty = true
  scheduleAutosave()
})

document.getElementById('codeLanguage')?.addEventListener('change', e => {
  const q = getCurrentQ()
  if (!q) return
  const lang = e.target.value
  updateEditorLang(lang)
  // Only load template if editor is empty / unchanged
  const code = getEditorValue()
  const templates = getQuestionLanguages(q).map(item => getTemplate(q, item))
  if (!code.trim() || templates.includes(code)) {
    suppressChange = true
    setEditorValue(getTemplate(q, lang))
    suppressChange = false
  }
  scheduleAutosave()
})

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  // Skip if focus is in editor or text input
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return
  if (e.target.closest?.('.CodeMirror')) return
  if (e.key === 'ArrowLeft')         { e.preventDefault(); goToAdjacentInSection(-1) }
  else if (e.key === 'ArrowRight')   { e.preventDefault(); goToNextQuestion() }
  else if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFlag() }
})

// Save before page unloads
window.addEventListener('beforeunload', () => {
  if (isDirty) saveCodingDraft()
  syncProgress()
  stopProctorPreview()
  localStorage.setItem('examProgress', JSON.stringify({ answers, flagged, timeRemaining }))
})

/* ===================== BOOT ===================== */
init()
