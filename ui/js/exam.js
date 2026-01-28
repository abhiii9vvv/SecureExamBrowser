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

// Initialize exam when page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeExam();
    startTimer();
    generateQuestionGrid();
    loadQuestion(examState.currentQuestion);
});

// Initialize exam with system info
async function initializeExam() {
    try {
        if (window.electronAPI && window.electronAPI.getSystemInfo) {
            const systemInfo = await window.electronAPI.getSystemInfo();
            console.log('System info loaded:', systemInfo);
        }
    } catch (error) {
        console.log('Running in demo mode:', error);
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
    
    // Update progress
    const answered = Object.keys(examState.answers).length;
    const percentage = Math.round((answered / examState.totalQuestions) * 100);
    
    const progressText = document.querySelector('.flex.justify-between.text-xs.text-gray-400 span:last-child');
    if (progressText) {
        progressText.textContent = `${percentage}%`;
    }
    
    const progressBar = document.querySelector('.h-2.w-full .h-full');
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
    }
}

// Generate question navigator grid
function generateQuestionGrid() {
    const gridContainer = document.querySelector('.grid.grid-cols-5');
    if (!gridContainer) return;
    
    gridContainer.innerHTML = '';
    
    for (let i = 1; i <= examState.totalQuestions; i++) {
        const button = document.createElement('button');
        button.textContent = i;
        button.onclick = () => goToQuestion(i);
        
        // Determine button state
        if (i === examState.currentQuestion) {
            button.className = 'aspect-square flex items-center justify-center rounded bg-primary text-white text-sm font-bold shadow-glow-active ring-2 ring-primary ring-offset-2 ring-offset-[#101418] relative z-10';
        } else if (examState.answers[i]) {
            button.className = 'aspect-square flex items-center justify-center rounded bg-[#394756] text-gray-300 text-xs font-medium hover:bg-[#4a5a6b] transition-colors';
        } else {
            button.className = 'aspect-square flex items-center justify-center rounded bg-[#1b2128] border border-[#394756] text-gray-500 text-xs font-medium hover:bg-[#27303a] transition-colors relative';
        }
        
        // Add flag indicator if flagged
        if (examState.flags[i]) {
            const flagIndicator = document.createElement('div');
            flagIndicator.className = 'absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-yellow-500';
            button.appendChild(flagIndicator);
        }
        
        gridContainer.appendChild(button);
    }
}

// Load question data
function loadQuestion(questionNumber) {
    examState.currentQuestion = questionNumber;
    
    // Update question number display
    const questionBadge = document.querySelector('.bg-primary\\/20.text-primary');
    if (questionBadge) {
        questionBadge.textContent = `Question ${questionNumber}`;
    }
    
    // Load saved answer if exists
    const savedAnswer = examState.answers[questionNumber];
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
    
    // Update grid
    generateQuestionGrid();
    
    // Scroll to top
    const mainElement = document.querySelector('main');
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
    const selectedRadio = document.querySelector('input[name="answer"]:checked');
    if (selectedRadio) {
        const radioButtons = Array.from(document.querySelectorAll('input[name="answer"]'));
        const answerIndex = radioButtons.indexOf(selectedRadio);
        examState.answers[examState.currentQuestion] = answerIndex;
    }
}

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

// Auto-save every 30 seconds
setInterval(() => {
    saveCurrentAnswer();
    console.log('Auto-saved at', new Date().toLocaleTimeString());
}, 30000);
// ============================================
// DEMO AI/ML FEATURES (Simulated)
// ============================================

// Demo: AI Answer Validation
function validateAnswerWithAI(questionNumber, selectedAnswer) {
    // Simulate AI analysis
    const confidence = Math.random() * 0.3 + 0.7; // 70-100% confidence
    
    // For demo purposes, flag some answers as "needs review"
    if (Math.random() > 0.8) {
        console.log(`🤖 AI FLAG: Question ${questionNumber} - Unusual pattern detected (Confidence: ${(confidence * 100).toFixed(1)}%)`);
        return { flagged: true, reason: 'Unusual answer pattern', confidence };
    }
    return { flagged: false, confidence };
}

// Demo: Face Detection & Liveness Check
function simulateFaceDetection() {
    const detectionResult = {
        faceDetected: Math.random() > 0.05, // 95% chance of detection
        livenessPassed: Math.random() > 0.1, // 90% chance of liveness
        eyeContact: Math.random() > 0.2, // 80% chance of good eye contact
        confidence: Math.random() * 0.2 + 0.85, // 85-95% confidence
        timestamp: new Date().toISOString()
    };
    return detectionResult;
}

// Demo: Anomaly Detection (unusual exam behavior)
function checkForAnomalies() {
    const anomalies = [];
    
    // Check if answers are changing frequently
    if (examState.currentQuestion > 10) {
        const recentAnswerChanges = Object.keys(examState.answers).length > 40;
        if (recentAnswerChanges && Math.random() > 0.9) {
            anomalies.push('Rapid answer changes detected');
        }
    }
    
    // Check for suspicious timing
    if (examState.timeRemaining > 7000) { // More than 50 min left
        const answeredTooFast = Object.keys(examState.answers).length > examState.currentQuestion;
        if (answeredTooFast && Math.random() > 0.95) {
            anomalies.push('Unusual pace detected - answers submitted very quickly');
        }
    }
    
    return anomalies;
}

// Demo: Proctoring Alert System
function triggerProctorAlert(severity = 'low') {
    const severities = {
        low: { icon: 'info', color: 'text-blue-400', message: '📷 System monitoring active' },
        medium: { icon: 'warning', color: 'text-yellow-400', message: '⚠️ Unusual activity detected' },
        high: { icon: 'error', color: 'text-red-400', message: '🚨 Multiple violations detected' }
    };
    
    // In a real system, this would alert a human proctor
    console.log(`🔒 [${severity.toUpperCase()}] ${severities[severity].message}`);
    return severities[severity];
}

// Initialize proctoring on exam start (demo)
document.addEventListener('DOMContentLoaded', () => {
    // Simulate periodic proctoring checks every 2 minutes
    setInterval(() => {
        const anomalies = checkForAnomalies();
        if (anomalies.length > 0 && Math.random() > 0.7) {
            console.log('🔔 Proctoring Alert:', anomalies);
            triggerProctorAlert('low');
        }
    }, 120000);
});