// Exam Screen JavaScript

const UI_ONLY = true;

// Code runner instance
const codeRunner = new CodeRunner();

// Exam state management
let examState = {
    currentQuestion: 1,
    totalQuestions: 50,
    timeRemaining: 7200, // 2 hours in seconds
    answers: {},
    flags: {},
    startTime: Date.now()
};

// Question data
let questionsData = [];
let currentSection = '';

function normalizeQuestionRow(row, index) {
    // Parse JSON fields
    let options = row.options;
    if (typeof options === 'string') {
        try { options = JSON.parse(options); } catch (e) { options = []; }
    }

    let testCases = row.test_cases;
    if (typeof testCases === 'string') {
        try { testCases = JSON.parse(testCases); } catch (e) { testCases = []; }
    }

    let examples = row.examples;
    if (typeof examples === 'string') {
        try { examples = JSON.parse(examples); } catch (e) { examples = []; }
    }

    let constraints = row.constraints;
    if (typeof constraints === 'string') {
        try { constraints = JSON.parse(constraints); } catch (e) { constraints = []; }
    }

    let starterCode = row.starter_code;
    if (typeof starterCode === 'string') {
        try { starterCode = JSON.parse(starterCode); } catch (e) { starterCode = null; }
    }

    const isCoding = row.question_type === 'coding';

    return {
        id: row.id || row.question_id,
        question: row.question_text,
        title: row.title || row.question_text,
        type: isCoding ? 'coding' : 'mcq',
        difficulty: row.difficulty,
        options: options || [],
        correct_index: row.correct_index,
        testCases: testCases || [],
        examples: examples || [],
        constraints: constraints || [],
        starterCode: starterCode || '',
        prompt: row.question_text,
        order_index: row.order_index || (index + 1),
        section: 'General',
        points: row.points || 1.0
    };
}

function setQuestionsFromRows(rows) {
    questionsData = rows.map((row, index) => normalizeQuestionRow(row, index));
    examState.totalQuestions = questionsData.length;
}

// Load questions from database or fallback JSON
async function loadQuestions() {
    const examId = Number(localStorage.getItem('currentExamId'));
    if (!UI_ONLY && window.electronAPI && window.electronAPI.getExamQuestions && examId) {
        try {
            const result = await window.electronAPI.getExamQuestions(examId);
            if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                setQuestionsFromRows(result.data);
                console.log(`Loaded ${questionsData.length} questions from database`);
                return true;
            }
        } catch (error) {
            console.warn('Database questions unavailable, falling back:', error);
        }
    }

    try {
        const response = await fetch('../ques.json');
        const data = await response.json();

        // Flatten all sections into single array
        questionsData = [];
        Object.keys(data).forEach(section => {
            data[section].forEach(q => {
                questionsData.push({
                    ...q,
                    section: section,
                    type: q.type || 'mcq'
                });
            });
        });

        examState.totalQuestions = questionsData.length;
        console.log(`Loaded ${questionsData.length} questions from ${Object.keys(data).length} sections`);
        return true;
    } catch (error) {
        console.error('Failed to load questions:', error);
        return false;
    }
}

// Initialize exam when page loads
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== Exam Initialization Started ===');
    await loadQuestions();
    console.log('Questions loaded:', questionsData.length, 'Total:', examState.totalQuestions);
    console.log('First 3 questions:', questionsData.slice(0, 3).map(q => ({type: q.type, title: q.title || q.question})));
    initializeExam();
    if (!UI_ONLY) {
        initializeExamSession();
        initializeProctoringCamera();
    } else {
        updateProctoringStatus('OK', 'success');
    }
    startTimer();
    updateQuestionNavigation();
    loadQuestion(examState.currentQuestion);
    console.log('=== Exam Initialization Complete ===');
    
    // Setup navigation arrow buttons
    const prevBtn = document.querySelector('[data-nav-prev]');
    const nextBtn = document.querySelector('[data-nav-next]');
    console.log('Navigation buttons found:', {prev: !!prevBtn, next: !!nextBtn});
    if (prevBtn) prevBtn.addEventListener('click', () => {
        console.log('Previous clicked, current:', examState.currentQuestion);
        if (examState.currentQuestion > 1) {
            goToQuestion(examState.currentQuestion - 1);
        }
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
        console.log('Next clicked, current:', examState.currentQuestion, 'total:', examState.totalQuestions);
        if (examState.currentQuestion < examState.totalQuestions) {
            goToQuestion(examState.currentQuestion + 1);
        }
    });

    const runButton = document.getElementById('runCode');
    if (runButton) {
        runButton.addEventListener('click', () => {
            runCodeSimulated();
        });
    }

    const submitButton = document.getElementById('submitCode');
    if (submitButton) {
        submitButton.addEventListener('click', () => {
            submitCodeSimulated();
        });
    }

    // Submit exam button
    const submitExamBtn = document.querySelector('[data-submit-exam]');
    if (submitExamBtn) {
        submitExamBtn.addEventListener('click', () => {
            goToSubmission();
        });
    }

    // Language selector change handler
    const languageSelect = document.getElementById('codeLanguage');
    if (languageSelect) {
        languageSelect.addEventListener('change', (e) => {
            const questionIndex = examState.currentQuestion - 1;
            const questionData = questionsData[questionIndex];
            
            if (questionData && questionData.type === 'coding') {
                const codeEditor = document.getElementById('codeEditor');
                const selectedLanguage = e.target.value;
                
                // Check if there's saved code for this question
                const savedAnswer = examState.answers[examState.currentQuestion];
                const hasSavedCode = savedAnswer && savedAnswer.code;
                
                // Only update if no saved code or user confirms
                if (!hasSavedCode) {
                    // Load starter code for selected language
                    if (questionData.starterCode && questionData.starterCode[selectedLanguage]) {
                        codeEditor.value = questionData.starterCode[selectedLanguage];
                    }
                } else if (savedAnswer.language !== selectedLanguage) {
                    // User changed language after writing code - warn them
                    const confirmed = confirm(
                        'Changing language will load the starter code for the new language.\n' +
                        'Your current code will be lost.\n\n' +
                        'Do you want to continue?'
                    );
                    
                    if (confirmed) {
                        if (questionData.starterCode && questionData.starterCode[selectedLanguage]) {
                            codeEditor.value = questionData.starterCode[selectedLanguage];
                        }
                        // Clear the saved answer since we're switching languages
                        delete examState.answers[examState.currentQuestion];
                        updateQuestionNavigation();
                    } else {
                        // Revert selection
                        e.target.value = savedAnswer.language;
                    }
                }
            }
        });
    }
});

// Initialize exam with system info
async function initializeExam() {
    try {
        if (!UI_ONLY && window.electronAPI && window.electronAPI.getSystemInfo) {
            const systemInfo = await window.electronAPI.getSystemInfo();
            console.log('System info loaded:', systemInfo);
        }
    } catch (error) {
        console.warn('System info unavailable:', error);
    }

    const examTitle = document.getElementById('examTitleHeader');
    const examCode = document.getElementById('examCodeHeader');
    const storedName = localStorage.getItem('currentExamName') || '';
    const storedCode = localStorage.getItem('currentExamCode') || '';
    const safeName = /demo/i.test(storedName) ? '' : storedName;
    const safeCode = /demo/i.test(storedCode) ? '' : storedCode;
    if (examTitle) examTitle.textContent = safeName || 'Assessment';
    if (examCode) examCode.textContent = safeCode ? `Exam ID: ${safeCode}` : 'Exam ID: --';
}

async function initializeExamSession() {
    if (UI_ONLY) {
        return;
    }
    const userId = Number(localStorage.getItem('currentUserId'));
    const examId = Number(localStorage.getItem('currentExamId'));
    if (!userId || !examId) {
        console.warn('Exam session not started: missing user or exam context');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.startExamSession) {
        console.warn('Exam session API not available');
        return;
    }

    try {
        const systemInfo = window.electronAPI.getSystemInfo ? await window.electronAPI.getSystemInfo() : {};
        const payload = {
            user_id: userId,
            exam_id: examId,
            session_token: systemInfo.sessionId || `SES-${Date.now()}`,
            ip_address: null,
            machine_info: systemInfo || {}
        };

        const result = await window.electronAPI.startExamSession(payload);
        if (result.success && result.data) {
            localStorage.setItem('currentSessionId', result.data.sessionId);
        } else {
            console.warn('Failed to start session:', result.error);
        }
    } catch (error) {
        console.warn('Session init failed:', error);
    }
}

// Timer countdown
function startTimer() {
    const timerInterval = setInterval(() => {
        if (examState.timeRemaining > 0) {
            examState.timeRemaining--;
            updateTimerDisplay();
        } else {
            clearInterval(timerInterval);
            autoSubmitExam();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const hours = Math.floor(examState.timeRemaining / 3600);
    const minutes = Math.floor((examState.timeRemaining % 3600) / 60);
    const seconds = examState.timeRemaining % 60;
    
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    const timerElements = document.querySelectorAll('[data-timer]');
    timerElements.forEach(el => {
        el.textContent = timeString;
    });

    const timerContainer = document.querySelector('[data-timer-container]');
    if (timerContainer) {
        if (examState.timeRemaining <= 60) {
            timerContainer.classList.add('text-danger');
        } else if (examState.timeRemaining <= 300) {
            timerContainer.classList.add('text-warning');
        }
    }
    
    // Update progress
    const answered = Object.keys(examState.answers).length;
    const percentage = Math.round((answered / examState.totalQuestions) * 100);
    
    const progressText = document.querySelector('[data-progress-text]');
    if (progressText) {
        progressText.textContent = `${answered}/${examState.totalQuestions} (${percentage}%)`;
    }
    
    const progressBar = document.querySelector('[data-progress-bar]');
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
    }
}

// Generate question navigator grid
function generateQuestionGrid() {
    updateQuestionNavigation();
}

function updateQuestionNavigation() {
    const currentEl = document.querySelector('[data-nav-current]');
    const totalEl = document.querySelector('[data-nav-total]');
    const prevBtn = document.querySelector('[data-nav-prev]');
    const nextBtn = document.querySelector('[data-nav-next]');
    const answeredEl = document.querySelector('[data-answered-count]');
    const flaggedEl = document.querySelector('[data-flagged-count]');
    const remainingEl = document.querySelector('[data-remaining-count]');
    
    if (currentEl) currentEl.textContent = examState.currentQuestion;
    if (totalEl) totalEl.textContent = examState.totalQuestions;
    
    // Update button states
    if (prevBtn) {
        prevBtn.disabled = examState.currentQuestion <= 1;
        console.log('Prev button disabled:', prevBtn.disabled, 'Current:', examState.currentQuestion);
    }
    if (nextBtn) {
        nextBtn.disabled = examState.currentQuestion >= examState.totalQuestions;
        console.log('Next button disabled:', nextBtn.disabled, 'Current:', examState.currentQuestion, 'Total:', examState.totalQuestions);
    }
    
    // Update counts
    const answeredCount = Object.keys(examState.answers).length;
    const flaggedCount = Object.keys(examState.flags).length;
    const remainingCount = examState.totalQuestions - answeredCount;
    
    if (answeredEl) answeredEl.textContent = answeredCount;
    if (flaggedEl) flaggedEl.textContent = flaggedCount;
    if (remainingEl) remainingEl.textContent = remainingCount;
}

// Load question data
function loadQuestion(questionNumber) {
    console.log('loadQuestion called:', questionNumber, 'Total questions:', examState.totalQuestions);
    examState.currentQuestion = questionNumber;
    
    // Get question data
    const questionIndex = questionNumber - 1;
    const questionData = questionsData[questionIndex];
    
    if (!questionData) {
        console.error('Question data not found for:', questionNumber, 'Index:', questionIndex, 'Available:', questionsData.length);
        return;
    }
    
    console.log('Loading question:', {number: questionNumber, type: questionData.type, title: questionData.title || questionData.question});
    
    // Update question number display
    const questionBadge = document.querySelector('[data-question-badge]');
    if (questionBadge) {
        questionBadge.textContent = `Question ${questionNumber}`;
    }
    
    // Update section badge if exists
    const sectionBadge = document.querySelector('[data-section-badge]');
    if (sectionBadge) {
        sectionBadge.textContent = questionData.section || 'General';
    }
    
    // Update question text
    const questionText = document.querySelector('[data-question-text]');
    if (questionText) {
        questionText.textContent = questionData.question || questionData.title || 'Question';
    }

    const subtext = document.querySelector('[data-question-subtext]');
    if (subtext) {
        subtext.textContent = questionData.section ? `Section: ${questionData.section}` : '';
    }

    const mcqContainer = document.querySelector('[data-mcq-container]');
    const codingContainer = document.querySelector('[data-coding-container]');
    const isCoding = questionData.type === 'coding';
    
    // Toggle containers
    if (mcqContainer) {
        if (isCoding) {
            mcqContainer.classList.add('d-none');
        } else {
            mcqContainer.classList.remove('d-none');
        }
    }
    if (codingContainer) {
        if (isCoding) {
            codingContainer.classList.remove('d-none');
        } else {
            codingContainer.classList.add('d-none');
        }
    }
    
    // Update badges for coding
    if (isCoding) {
        const codingBadge = document.querySelector('[data-coding-question-badge]');
        if (codingBadge) {
            const difficultyBadge = questionData.difficulty ? 
                `<span class="badge bg-${questionData.difficulty === 'easy' ? 'success' : questionData.difficulty === 'medium' ? 'warning' : 'danger'}">${questionData.difficulty}</span>` : '';
            codingBadge.innerHTML = `Question ${questionNumber} ${difficultyBadge}`;
        }
        const codingQuestionText = document.querySelector('[data-coding-question-text]');
        if (codingQuestionText) {
            codingQuestionText.textContent = questionData.title || 'Coding Problem';
        }

        // Update prompt
        const prompt = document.querySelector('[data-coding-prompt]');
        if (prompt) {
            prompt.textContent = questionData.prompt || '';
        }

        // Update constraints
        const constraints = document.querySelector('[data-coding-constraints]');
        if (constraints && questionData.constraints) {
            constraints.innerHTML = questionData.constraints.map(c => `<div>• ${c}</div>`).join('');
        }

        // Update examples
        const examples = document.querySelector('[data-coding-examples]');
        if (examples && questionData.examples) {
            examples.innerHTML = questionData.examples.map((ex, idx) => `
                <div class="mb-2 p-2" style="background: #f8f9fa; border-radius: 4px;">
                    <div class="fw-semibold">Example ${idx + 1}:</div>
                    <div class="mt-1"><strong>Input:</strong> ${ex.input}</div>
                    <div><strong>Output:</strong> ${ex.output}</div>
                    ${ex.explanation ? `<div class="text-muted small">${ex.explanation}</div>` : ''}
                </div>
            `).join('');
        }

        // Set starter code
        const codeEditor = document.getElementById('codeEditor');
        const languageSelect = document.getElementById('codeLanguage');
        const currentLanguage = languageSelect ? languageSelect.value : 'javascript';
        
        if (codeEditor) {
            if (savedAnswer && savedAnswer.code) {
                codeEditor.value = savedAnswer.code;
                if (languageSelect && savedAnswer.language) {
                    languageSelect.value = savedAnswer.language;
                }
            } else {
                // Load starter code for selected language
                let starterCode = '';
                if (questionData.starterCode) {
                    if (typeof questionData.starterCode === 'object') {
                        starterCode = questionData.starterCode[currentLanguage] || '';
                    } else {
                        starterCode = questionData.starterCode;
                    }
                }
                codeEditor.value = starterCode;
            }
        }

        // Clear output
        const output = document.getElementById('codeOutput');
        if (output) {
            output.textContent = 'Ready to run tests...';
            output.style.color = '';
        }
    } else {
        const optionLabels = document.querySelectorAll('[data-option-label]');
        questionData.options.forEach((option, index) => {
            if (optionLabels[index]) {
                const optionText = optionLabels[index].querySelector('[data-option-text]');
                if (optionText) {
                    optionText.textContent = option;
                }
            }
        });
    }
    
    // Load saved answer if exists
    const savedAnswer = examState.answers[questionNumber];
    if (isCoding) {
        const codeEditor = document.getElementById('codeEditor');
        if (codeEditor) {
            if (savedAnswer && typeof savedAnswer === 'object') {
                codeEditor.value = savedAnswer.value || questionData.starterCode || '';
            } else {
                codeEditor.value = questionData.starterCode || '';
            }
        }

        const prompt = document.querySelector('[data-coding-prompt]');
        if (prompt) {
            prompt.textContent = questionData.prompt || '';
        }

        const constraints = document.querySelector('[data-coding-constraints]');
        if (constraints) {
            const items = (questionData.constraints || []).map(c => `- ${c}`).join('\n');
            constraints.textContent = items ? `Constraints:\n${items}` : '';
        }

        const examples = document.querySelector('[data-coding-examples]');
        if (examples) {
            const lines = (questionData.examples || []).map(ex => `Input: ${ex.input}\nOutput: ${ex.output}`).join('\n\n');
            examples.textContent = lines;
        }

        const languageSelect = document.getElementById('codeLanguage');
        if (languageSelect && questionData.language) {
            languageSelect.value = questionData.language;
        }
    } else {
        if (savedAnswer !== undefined) {
            const radioButtons = document.querySelectorAll('input[name="answer"]');
            radioButtons.forEach((radio, index) => {
                radio.checked = (index === savedAnswer);
            });
        } else {
            // Clear all selections
            const radioButtons = document.querySelectorAll('input[name="answer"]');
            radioButtons.forEach(radio => {
                radio.checked = false;
            });
        }
    }
    
    // Update navigation
    updateQuestionNavigation();
    
    // Scroll to top
    const mainElement = document.querySelector('[data-exam-scroll]');
    if (mainElement) {
        mainElement.scrollTop = 0;
    }
}

// Navigation functions
function nextQuestion() {
    saveCurrentAnswer();
    if (examState.currentQuestion < examState.totalQuestions) {
        loadQuestion(examState.currentQuestion + 1);
    } else {
        // Last question, show submit option
        if (confirm('This is the last question. Do you want to review your answers before submitting?')) {
            goToSubmission();
        }
    }
}

function previousQuestion() {
    saveCurrentAnswer();
    if (examState.currentQuestion > 1) {
        loadQuestion(examState.currentQuestion - 1);
    }
}

function goToQuestion(questionNumber) {
    console.log('goToQuestion called:', questionNumber);
    saveCurrentAnswer();
    loadQuestion(questionNumber);
}

// Save current answer
function saveCurrentAnswer() {
    const questionData = questionsData[examState.currentQuestion - 1];
    if (!questionData) return;

    if (questionData.type === 'coding') {
        const codeEditor = document.getElementById('codeEditor');
        const languageSelect = document.getElementById('codeLanguage');
        
        if (codeEditor) {
            const code = codeEditor.value.trim();
            const language = languageSelect ? languageSelect.value : 'javascript';
            
            examState.answers[examState.currentQuestion] = {
                type: 'coding',
                code: code,
                language: language,
                value: code, // Keep for backward compatibility
                timestamp: Date.now()
            };
            
            showAutoSaveIndicator();
        }
        return;
    }

    const selectedRadio = document.querySelector('input[name="answer"]:checked');
    if (selectedRadio) {
        const radioButtons = Array.from(document.querySelectorAll('input[name="answer"]'));
        const answerIndex = radioButtons.indexOf(selectedRadio);
        examState.answers[examState.currentQuestion] = answerIndex;
        
        // Save to database
        const sessionId = localStorage.getItem('currentSessionId');
        if (!UI_ONLY && sessionId && questionData && window.electronAPI) {
            window.electronAPI.saveMCQAnswer({
                sessionId: sessionId,
                questionId: questionData.id,
                selectedOption: answerIndex
            }).then(response => {
                if (response.success) {
                    console.log(`MCQ answer saved to database for question ${examState.currentQuestion}`);
                } else {
                    console.error('Failed to save MCQ answer to database:', response.error);
                }
            }).catch(error => {
                console.error('Error saving MCQ answer:', error);
            });
        }
        
        // Show auto-save indication
        showAutoSaveIndicator();
    }
}

// Show auto-save indicator
function showAutoSaveIndicator() {
    const indicator = document.querySelector('[data-auto-save]');
    if (indicator) {
        indicator.style.opacity = '1';
        const textEl = indicator.querySelector('span:last-child');
        if (textEl) {
            textEl.textContent = 'Auto-saved';
        }
        const dot = indicator.querySelector('[data-auto-save-dot]');
        if (dot) {
            dot.classList.add('is-active');
        }
        
        // Hide after 2 seconds
        setTimeout(() => {
            indicator.style.opacity = '0.7';
            const dot = indicator.querySelector('[data-auto-save-dot]');
            if (dot) {
                dot.classList.remove('is-active');
            }
        }, 2000);
    }
}

async function runCodeSimulated() {
    const output = document.getElementById('codeOutput');
    const codeEditor = document.getElementById('codeEditor');
    const languageSelect = document.getElementById('codeLanguage');
    
    if (!output || !codeEditor) return;

    const code = codeEditor.value.trim();
    const language = languageSelect ? languageSelect.value : 'javascript';
    
    if (!code) {
        output.textContent = 'Error: No code to run.';
        output.style.color = '#dc3545';
        return;
    }

    // Get current question data
    const questionIndex = examState.currentQuestion - 1;
    const questionData = questionsData[questionIndex];

    if (!questionData || questionData.type !== 'coding') {
        output.textContent = 'Error: Not a coding question.';
        output.style.color = '#dc3545';
        return;
    }

    if (!questionData.testCases || questionData.testCases.length === 0) {
        output.textContent = 'Error: No test cases available for this question.';
        output.style.color = '#dc3545';
        return;
    }

    // Show running message
    output.textContent = 'Running sample tests...\n';
    output.style.color = '#0d6efd';

    try {
        // Run sample test cases (non-hidden only)
        const result = await codeRunner.runSampleTests(code, questionData.testCases, language);

        if (!result.success) {
            output.textContent = `Error: ${result.error}`;
            output.style.color = '#dc3545';
            return;
        }

        // Format and display results
        const formattedOutput = codeRunner.formatResults(result);
        output.textContent = formattedOutput;
        
        if (result.allPassed) {
            output.style.color = '#198754';
        } else {
            output.style.color = '#dc3545';
        }

    } catch (error) {
        output.textContent = `Runtime Error: ${error.message}`;
        output.style.color = '#dc3545';
    }
}

async function submitCodeSimulated() {
    const output = document.getElementById('codeOutput');
    const codeEditor = document.getElementById('codeEditor');
    const languageSelect = document.getElementById('codeLanguage');
    
    if (!output || !codeEditor) return;

    const code = codeEditor.value.trim();
    const language = languageSelect ? languageSelect.value : 'javascript';
    
    if (!code) {
        output.textContent = 'Error: Cannot submit empty code.';
        output.style.color = '#dc3545';
        return;
    }

    // Get current question data
    const questionIndex = examState.currentQuestion - 1;
    const questionData = questionsData[questionIndex];

    if (!questionData || questionData.type !== 'coding') {
        output.textContent = 'Error: Not a coding question.';
        output.style.color = '#dc3545';
        return;
    }

    if (!questionData.testCases || questionData.testCases.length === 0) {
        output.textContent = 'Error: No test cases available for this question.';
        output.style.color = '#dc3545';
        return;
    }

    // Show submitting message
    output.textContent = 'Submitting and running all test cases (including hidden)...\n';
    output.style.color = '#0d6efd';

    try {
        // Run all test cases (including hidden ones)
        const result = await codeRunner.submitCode(code, questionData.testCases, language);

        if (!result.success) {
            output.textContent = `Error: ${result.error}`;
            output.style.color = '#dc3545';
            return;
        }

        // Format results
        let submissionOutput = `\n=== SUBMISSION RESULT ===\n`;
        submissionOutput += `Status: ${result.status}\n`;
        submissionOutput += `Test Cases: ${result.passed}/${result.total} passed\n`;
        submissionOutput += `Total Time: ${result.totalTime}ms\n\n`;

        // Show visible test results
        result.results.forEach((testResult, index) => {
            if (!questionData.testCases[index].hidden) {
                submissionOutput += `Test ${index + 1}: ${testResult.passed ? '✓ Passed' : '✗ Failed'}\n`;
                if (!testResult.passed && testResult.error) {
                    submissionOutput += `  Error: ${testResult.error}\n`;
                }
            }
        });

        const hiddenTests = questionData.testCases.filter(tc => tc.hidden).length;
        if (hiddenTests > 0) {
            const hiddenPassed = result.results
                .filter((r, i) => questionData.testCases[i].hidden)
                .filter(r => r.passed).length;
            submissionOutput += `\nHidden Tests: ${hiddenPassed}/${hiddenTests} passed\n`;
        }

        output.textContent = submissionOutput;
        
        if (result.allPassed) {
            output.style.color = '#198754';
            output.textContent += '\n✓ Accepted! Your solution is correct.\n';
        } else {
            output.style.color = '#dc3545';
            output.textContent += '\n✗ Wrong Answer. Please review your solution.\n';
        }

        // Save the answer
        saveCodeAnswer(code, language, result);

    } catch (error) {
        output.textContent = `Runtime Error: ${error.message}`;
        output.style.color = '#dc3545';
    }
}

function saveCodeAnswer(code, language, result) {
    const questionNumber = examState.currentQuestion;
    const questionData = questionsData[questionNumber - 1];
    
    examState.answers[questionNumber] = {
        type: 'coding',
        code: code,
        language: language,
        status: result.status,
        passed: result.passed,
        total: result.total,
        allPassed: result.allPassed,
        timestamp: Date.now()
    };

    updateQuestionNavigation();
    
    // Save to database
    const sessionId = localStorage.getItem('currentSessionId');
    if (!UI_ONLY && sessionId && questionData && window.electronAPI) {
        window.electronAPI.saveCodeAnswer({
            sessionId: sessionId,
            questionId: questionData.id,
            code: code,
            language: language,
            testResults: result.results,
            passedTests: result.passed,
            totalTests: result.total,
            executionTime: result.totalTime || 0
        }).then(response => {
            if (response.success) {
                console.log(`Code answer saved to database for question ${questionNumber}`);
            } else {
                console.error('Failed to save code answer to database:', response.error);
            }
        }).catch(error => {
            console.error('Error saving code answer:', error);
        });
    }
    
    console.log(`Code answer saved for question ${questionNumber}:`, result.status);
}

// Simulate auto-save every 30 seconds
setInterval(() => {
    if (Object.keys(examState.answers).length > 0) {
        localStorage.setItem('examState', JSON.stringify(examState));
        showAutoSaveIndicator();
    }
}, 30000);

// Flag management
function toggleFlag() {
    const questionNumber = examState.currentQuestion;
    if (examState.flags[questionNumber]) {
        delete examState.flags[questionNumber];
    } else {
        examState.flags[questionNumber] = true;
    }
    generateQuestionGrid();
}

// Note functionality
function addNote() {
    const note = prompt('Add a note for this question:');
    if (note) {
        console.log(`Note added for question ${examState.currentQuestion}:`, note);
        // In real implementation, save to database
    }
}

// Settings toggle
function toggleSettings() {
    alert('Settings panel would open here (font size, theme, etc.)');
}

// Auto-submit when time runs out
function autoSubmitExam() {
    alert('Time is up! Your exam will be submitted automatically.');
    goToSubmission();
}

// Navigate to submission page
function goToSubmission() {
    saveCurrentAnswer();
    
    // Save exam state to localStorage for submission page
    localStorage.setItem('examState', JSON.stringify(examState));
    
    if (!UI_ONLY && window.electronAPI && window.electronAPI.navigateTo) {
        window.electronAPI.navigateTo('submission');
    } else {
        window.location.href = 'submission.html';
    }
}


// Show exam instructions modal
function showInstructions() {
    alert(`EXAM INSTRUCTIONS:

1. This is a proctored examination. Your webcam and microphone are being monitored throughout the exam.

2. You have 2 hours to complete 50 questions.

3. You can navigate between questions using the question grid on the right.

4. You can flag questions for review by clicking the flag icon.

5. Do not switch tabs, open other windows, or leave the exam screen. Such actions will be flagged as violations.

6. Your answers are auto-saved every 30 seconds.

7. Click "Submit Exam" when you have completed all questions or when time runs out.

8. Once submitted, you cannot return to the exam.

Good luck!`);
}

// Show incident log (for dashboard tooltips)
function showIncidentLog() {
    window.location.href = 'dashboard.html#incidents';
}

// Toggle settings menu
function toggleSettings() {
    alert('Settings panel would open here (font size, contrast adjustments, etc.)');
}

// ============================================
// PROCTORING CAMERA INTEGRATION
// ============================================

let proctoringStream = null;
let proctoringContext = null;
let proctoringMonitorInterval = null;

async function initializeProctoringCamera() {
    if (UI_ONLY) {
        updateProctoringStatus('OK', 'success');
        return;
    }
    try {
        const video = document.getElementById('proctoring-video');
        const canvas = document.getElementById('proctoring-canvas');
        const statusDiv = document.getElementById('proctoring-status');

        if (!video || !canvas) {
            console.warn('Proctoring video elements not found');
            return;
        }

        // Get camera stream
        proctoringStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false
        });

        video.srcObject = proctoringStream;
        proctoringContext = canvas.getContext('2d');

        // Update status
        updateProctoringStatus('Valid Face Detected', 'success');

        // Start simulated face detection overlay
        startProctoringOverlay(video, canvas);

        // Start monitoring camera health
        startProctoringCameraMonitoring(video);

        console.log('✓ Proctoring camera initialized');
    } catch (error) {
        console.error('Failed to initialize proctoring camera:', error);
        updateProctoringStatus('Camera Access Denied', 'error');
    }
}

function startProctoringCameraMonitoring(video) {
    if (proctoringMonitorInterval) {
        clearInterval(proctoringMonitorInterval);
    }

    proctoringMonitorInterval = setInterval(async () => {
        try {
            if (!proctoringStream) {
                return;
            }

            const tracks = proctoringStream.getVideoTracks();
            const track = tracks && tracks[0];

            if (!track || track.readyState === 'ended') {
                console.warn('Proctoring camera track ended. Restarting...');
                await restartProctoringCamera(video);
                return;
            }

            if (video && video.readyState < 2) {
                console.warn('Proctoring video stalled. Restarting...');
                await restartProctoringCamera(video);
                return;
            }
        } catch (error) {
            console.warn('Proctoring camera monitor error:', error);
        }
    }, 2000);
}

async function restartProctoringCamera(video) {
    try {
        if (proctoringStream) {
            proctoringStream.getTracks().forEach(track => track.stop());
        }

        proctoringStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false
        });

        video.srcObject = proctoringStream;
        await video.play();
    } catch (error) {
        console.error('Failed to restart proctoring camera:', error);
    }
}

function startProctoringOverlay(video, canvas) {
    // Resize canvas to match video
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    // Simulate face detection with bounding box
    setInterval(() => {
        if (!proctoringContext) return;

        // Sync canvas size with video
        if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }

        proctoringContext.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw face bounding box (simulated) - smaller for compact view
        const boxX = canvas.width / 4;
        const boxY = canvas.height / 6;
        const boxW = canvas.width / 2;
        const boxH = canvas.height / 1.5;

        proctoringContext.strokeStyle = '#16a34a';
        proctoringContext.lineWidth = 3;
        proctoringContext.strokeRect(boxX, boxY, boxW, boxH);
    }, 100);
}

function updateProctoringStatus(message, type = 'success') {
    const statusDiv = document.getElementById('proctoring-status');
    if (!statusDiv) return;

    // Simple status indicator for small overlay
    if (type === 'success') {
        statusDiv.textContent = '\u2713';
        statusDiv.style.background = 'rgba(22, 163, 74, 0.9)';
    } else if (type === 'warning') {
        statusDiv.textContent = '!';
        statusDiv.style.background = 'rgba(234, 179, 8, 0.9)';
    } else {
        statusDiv.textContent = '\u2717';
        statusDiv.style.background = 'rgba(220, 38, 38, 0.9)';
    }
}

// Clean up camera on page unload
window.addEventListener('beforeunload', () => {
    if (proctoringStream) {
        proctoringStream.getTracks().forEach(track => track.stop());
    }
    if (proctoringMonitorInterval) {
        clearInterval(proctoringMonitorInterval);
    }
});
