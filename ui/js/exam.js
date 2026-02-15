// Exam Screen JavaScript

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

// Load questions from JSON
async function loadQuestionsFromJSON() {
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
    await loadQuestionsFromJSON();
    initializeExam();
    initializeExamSession();
    initializeProctoringCamera();
    startTimer();
    generateQuestionGrid();
    loadQuestion(examState.currentQuestion);

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
});

// Initialize exam with system info
async function initializeExam() {
    try {
        if (window.electronAPI && window.electronAPI.getSystemInfo) {
            const systemInfo = await window.electronAPI.getSystemInfo();
            console.log('System info loaded:', systemInfo);
        }
    } catch (error) {
        console.warn('System info unavailable:', error);
    }
}

async function initializeExamSession() {
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
    const gridContainer = document.querySelector('[data-question-grid]');
    if (!gridContainer) return;
    
    gridContainer.innerHTML = '';
    
    for (let i = 1; i <= examState.totalQuestions; i++) {
        const button = document.createElement('button');
        button.textContent = i;
        button.onclick = () => goToQuestion(i);
        
        // Determine button state
        button.className = 'question-button position-relative';
        if (i === examState.currentQuestion) {
            button.classList.add('is-current');
        } else if (examState.answers[i] !== undefined) {
            button.classList.add('is-answered');
        }
        
        // Add flag indicator if flagged
        if (examState.flags[i]) {
            button.classList.add('is-flagged');
        }
        
        gridContainer.appendChild(button);
    }
}

// Load question data
function loadQuestion(questionNumber) {
    examState.currentQuestion = questionNumber;
    
    // Get question data
    const questionIndex = questionNumber - 1;
    const questionData = questionsData[questionIndex];
    
    if (!questionData) {
        console.warn('Question data not found for:', questionNumber);
        return;
    }
    
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

    const mcqPanel = document.querySelector('[data-mcq-panel]');
    const codingPanel = document.querySelector('[data-coding-panel]');
    const isCoding = questionData.type === 'coding';
    if (mcqPanel) {
        mcqPanel.classList.toggle('d-none', isCoding);
    }
    if (codingPanel) {
        codingPanel.classList.toggle('d-none', !isCoding);
    }
    
    // Update options
    const optionLabels = document.querySelectorAll('[data-option-label]');
    if (!isCoding && questionData.options) {
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
    
    // Update grid
    generateQuestionGrid();
    
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
    saveCurrentAnswer();
    loadQuestion(questionNumber);
}

// Save current answer
function saveCurrentAnswer() {
    const questionData = questionsData[examState.currentQuestion - 1];
    if (!questionData) return;

    if (questionData.type === 'coding') {
        const codeEditor = document.getElementById('codeEditor');
        if (codeEditor) {
            examState.answers[examState.currentQuestion] = {
                type: 'coding',
                value: codeEditor.value
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

function runCodeSimulated() {
    const output = document.getElementById('codeOutput');
    const codeEditor = document.getElementById('codeEditor');
    if (!output || !codeEditor) return;

    const code = codeEditor.value.trim();
    if (!code) {
        output.textContent = 'No code to run.';
        return;
    }

    output.textContent = 'Running sample tests...\n\nTest 1: Passed\nTest 2: Passed\n\nOutput: [0, 1]';
}

function submitCodeSimulated() {
    const output = document.getElementById('codeOutput');
    const codeEditor = document.getElementById('codeEditor');
    if (!output || !codeEditor) return;

    const code = codeEditor.value.trim();
    if (!code) {
        output.textContent = 'Submission failed: code is empty.';
        return;
    }

    output.textContent = 'Submitting...\n\nResult: Accepted (simulated)';
    saveCurrentAnswer();
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
    
    if (window.electronAPI && window.electronAPI.navigateTo) {
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
    // Simulate face detection with bounding box
    setInterval(() => {
        if (!proctoringContext) return;

        proctoringContext.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw face bounding box (simulated)
        const boxX = canvas.width / 4;
        const boxY = canvas.height / 6;
        const boxW = canvas.width / 2;
        const boxH = canvas.height / 1.5;

        proctoringContext.strokeStyle = '#00ff00';
        proctoringContext.lineWidth = 2;
        proctoringContext.strokeRect(boxX, boxY, boxW, boxH);

        // Draw confidence text
        proctoringContext.fillStyle = '#00ff00';
        proctoringContext.font = '12px monospace';
        proctoringContext.fillText('Face: 98%', boxX, boxY - 5);
    }, 100);
}

function updateProctoringStatus(message, type = 'success') {
    const statusDiv = document.getElementById('proctoring-status');
    if (!statusDiv) return;

    const colors = {
        success: { icon: 'check_circle', color: 'green' },
        warning: { icon: 'warning', color: 'yellow' },
        error: { icon: 'error', color: 'red' }
    };

    const config = colors[type] || colors.success;

    statusDiv.innerHTML = `
        <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-${config.color}-500 text-sm">${config.icon}</span>
            <span class="text-xs text-${config.color}-400 font-medium">${message}</span>
        </div>
    `;
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
