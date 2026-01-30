// Submission Screen JavaScript

// Load exam state from localStorage
let examState = null;
let submissionStats = {
    answered: 0,
    unanswered: 0,
    flagged: 0,
    timeRemaining: 0
};

// Confirmation dialog for submission
function confirmSubmission() {
    const unanswered = submissionStats.unanswered;
    const flagged = submissionStats.flagged;
    
    let warningMessage = 'Are you sure you want to submit your exam?\n\n';
    
    if (unanswered > 0) {
        warningMessage += `⚠️ You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}.\n`;
    }
    
    if (flagged > 0) {
        warningMessage += `🚩 You have ${flagged} flagged question${flagged > 1 ? 's' : ''} for review.\n`;
    }
    
    warningMessage += '\n✓ Once submitted, you cannot return to the exam.\n';
    warningMessage += '✓ Your answers will be final and submitted for grading.';
    
    if (confirm(warningMessage)) {
        submitExam();
    }
}

function submitExam() {
    // Show submission animation
    const submitButton = document.querySelector('button[onclick="confirmSubmission()"]');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="material-symbols-outlined animate-spin">sync</span> Submitting...';
    }
    
    setTimeout(() => {
        alert('✅ Exam submitted successfully!\n\nYour submission has been recorded.');
        console.log('Exam submitted:', examState);
    }, 1500);
}

function returnToExam() {
    if (confirm('Return to exam? You can review and change your answers.')) {
        window.location.href = 'exam.html';
    }
}

// Initialize submission page
document.addEventListener('DOMContentLoaded', () => {
    loadExamState();
    if (examState) {
        updateStatistics();
        generateQuestionGrid();
        updateTimerDisplay();
    }
});

// Load exam state from previous page
function loadExamState() {
    const savedState = localStorage.getItem('examState');
    if (savedState) {
        examState = JSON.parse(savedState);
        
        // Calculate statistics
        submissionStats.answered = Object.keys(examState.answers || {}).length;
        submissionStats.unanswered = examState.totalQuestions - submissionStats.answered;
        submissionStats.flagged = Object.keys(examState.flags || {}).length;
        submissionStats.timeRemaining = examState.timeRemaining || 0;
    } else {
        examState = null;
        setEmptyState('No active exam session found. Please return to the exam to continue.');
    }
}

function setEmptyState(message) {
    const submitButton = document.querySelector('button[onclick="confirmSubmission()"]');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.classList.add('opacity-60', 'cursor-not-allowed');
    }

    const gridContainers = document.querySelectorAll('.grid.grid-cols-10');
    gridContainers.forEach(container => {
        container.innerHTML = `
            <div class="col-span-10 text-center text-slate-400 text-sm py-6">${message}</div>
        `;
    });
}

// Update statistics displays
function updateStatistics() {
    // Update timer widget
    const timerDisplay = document.querySelector('.glass-panel .flex.items-baseline span.font-mono');
    if (timerDisplay) {
        const hours = Math.floor(submissionStats.timeRemaining / 3600);
        const minutes = Math.floor((submissionStats.timeRemaining % 3600) / 60);
        const seconds = submissionStats.timeRemaining % 60;
        timerDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    // Update answered widget
    const answeredDisplay = document.querySelectorAll('.glass-panel .font-mono')[1];
    if (answeredDisplay) {
        answeredDisplay.textContent = submissionStats.answered;
        const totalDisplay = answeredDisplay.parentElement.querySelector('.text-gray-500');
        if (totalDisplay) {
            totalDisplay.textContent = `/ ${examState.totalQuestions}`;
        }
    }
    
    // Update radial progress
    const percentage = Math.round((submissionStats.answered / examState.totalQuestions) * 100);
    const radialProgress = document.querySelector('.radial-progress + .absolute span.font-bold');
    if (radialProgress) {
        radialProgress.textContent = `${percentage}%`;
    }
    
    // Update metrics cards
    updateMetricsCard('answered', submissionStats.answered, examState.totalQuestions);
    updateMetricsCard('unanswered', submissionStats.unanswered, examState.totalQuestions);
    updateMetricsCard('flagged', submissionStats.flagged, examState.totalQuestions);
}

function updateMetricsCard(type, value, total) {
    const cards = document.querySelectorAll('.glass-panel');
    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        if (text.includes(type)) {
            const valueDisplay = card.querySelector('.font-bold.font-mono');
            if (valueDisplay) {
                valueDisplay.textContent = value;
            }
            const totalDisplay = card.querySelector('.text-gray-500');
            if (totalDisplay) {
                totalDisplay.textContent = `/ ${total}`;
            }
        }
    });
}

// Generate question grid
function generateQuestionGrid() {
    const gridContainers = document.querySelectorAll('.grid.grid-cols-10');
    
    gridContainers.forEach(container => {
        container.innerHTML = '';
        
        for (let i = 1; i <= examState.totalQuestions; i++) {
            const button = document.createElement('button');
            button.textContent = i;
            button.onclick = () => goToQuestion(i);
            
            // Determine button state
            const isAnswered = examState.answers[i] !== undefined;
            const isFlagged = examState.flags[i];
            
            if (isAnswered && isFlagged) {
                // Answered and flagged
                button.className = 'aspect-square flex items-center justify-center rounded-lg bg-green-900/30 border-2 border-yellow-500 text-white text-xs font-bold hover:bg-green-900/50 transition-all relative';
                const flagDot = document.createElement('div');
                flagDot.className = 'absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-yellow-500';
                button.appendChild(flagDot);
            } else if (isAnswered) {
                // Answered only
                button.className = 'aspect-square flex items-center justify-center rounded-lg bg-green-900/30 border-2 border-green-600 text-white text-xs font-bold hover:bg-green-900/50 transition-all';
            } else if (isFlagged) {
                // Flagged but not answered
                button.className = 'aspect-square flex items-center justify-center rounded-lg bg-yellow-900/20 border-2 border-yellow-500 text-yellow-300 text-xs font-bold hover:bg-yellow-900/30 transition-all relative';
                const flagDot = document.createElement('div');
                flagDot.className = 'absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-yellow-500';
                button.appendChild(flagDot);
            } else {
                // Unanswered
                button.className = 'aspect-square flex items-center justify-center rounded-lg bg-red-900/20 border-2 border-red-600 text-red-300 text-xs font-bold hover:bg-red-900/30 transition-all';
            }
            
            container.appendChild(button);
        }
    });
}

// Timer countdown
function updateTimerDisplay() {
    setInterval(() => {
        if (submissionStats.timeRemaining > 0) {
            submissionStats.timeRemaining--;
            updateStatistics();
        } else {
            autoSubmitExam();
        }
    }, 1000);
}

// Navigation functions
function returnToExam() {
    if (window.electronAPI && window.electronAPI.navigateTo) {
        window.electronAPI.navigateTo('exam');
    } else {
        window.location.href = 'exam.html';
    }
}

function goToQuestion(questionNumber) {
    // Update exam state with target question
    examState.currentQuestion = questionNumber;
    localStorage.setItem('examState', JSON.stringify(examState));
    returnToExam();
}

// Submission confirmation
function confirmSubmission() {
    const unansweredCount = submissionStats.unanswered;
    const flaggedCount = submissionStats.flagged;
    
    let message = 'Are you sure you want to submit your exam?\n\n';
    message += `Answered: ${submissionStats.answered} / ${examState.totalQuestions}\n`;
    
    if (unansweredCount > 0) {
        message += `\n⚠️ WARNING: ${unansweredCount} question(s) unanswered!\n`;
    }
    
    if (flaggedCount > 0) {
        message += `\n🚩 ${flaggedCount} question(s) are still flagged for review.\n`;
    }
    
    message += '\nThis action cannot be undone.';
    
    if (confirm(message)) {
        submitExam();
    }
}

// Submit exam
async function submitExam() {
    try {
        // Show loading state
        const submitButton = document.querySelector('button[onclick="confirmSubmission()"]');
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> Submitting...';
        }
        
        // Prepare submission data
        const sessionId = Number(localStorage.getItem('currentSessionId'));
        if (!sessionId) {
            throw new Error('No active session found');
        }

        const submissionData = {
            session_id: sessionId,
            examState: examState,
            submittedAt: new Date().toISOString(),
            time_remaining: examState.timeRemaining,
            answers: examState.answers,
            flags: examState.flags
        };
        
        // Save to database if electronAPI available
        if (window.electronAPI && window.electronAPI.saveExamSubmission) {
            const result = await window.electronAPI.saveExamSubmission(submissionData);
            if (!result.success) {
                throw new Error(result.error || 'Submission failed');
            }

            if (window.electronAPI.endExamSession) {
                await window.electronAPI.endExamSession(sessionId, 'completed');
            }
        }
        
        // Clear localStorage
        localStorage.removeItem('examState');
        
        // Navigate to dashboard or success page
        setTimeout(() => {
            alert('✅ Exam submitted successfully!\n\nYour answers have been recorded.');
            
            if (window.electronAPI && window.electronAPI.navigateTo) {
                window.electronAPI.navigateTo('dashboard');
            } else {
                window.location.href = 'dashboard.html';
            }
        }, 1000);
        
    } catch (error) {
        console.error('Submission error:', error);
        alert('❌ Error submitting exam. Please try again or contact support.');
        
        // Re-enable button
        const submitButton = document.querySelector('button[onclick="confirmSubmission()"]');
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = 'Confirm Submission <span class="material-symbols-outlined">send</span>';
        }
    }
}

// Auto-submit when time runs out
function autoSubmitExam() {
    alert('⏰ Time is up! Your exam will be submitted automatically.');
    submitExam();
}

// Update student name
