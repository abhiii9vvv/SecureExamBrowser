// Submission Screen JavaScript

// Load exam state from localStorage
let examState = null;
let submissionStats = {
    answered: 0,
    unanswered: 0,
    flagged: 0,
    timeRemaining: 0
};

// Initialize submission page
document.addEventListener('DOMContentLoaded', () => {
    loadExamState();
    updateStatistics();
    generateQuestionGrid();
    updateTimerDisplay();
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
        // Demo mode - generate sample data
        examState = {
            currentQuestion: 1,
            totalQuestions: 50,
            timeRemaining: 765, // 12:45
            answers: {},
            flags: {},
            startTime: Date.now()
        };
        
        // Generate some demo answers
        for (let i = 1; i <= 45; i++) {
            examState.answers[i] = Math.floor(Math.random() * 4);
        }
        examState.flags[4] = true;
        examState.flags[23] = true;
        examState.flags[38] = true;
        
        submissionStats.answered = 45;
        submissionStats.unanswered = 5;
        submissionStats.flagged = 3;
        submissionStats.timeRemaining = 765;
    }
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
        const submissionData = {
            examState: examState,
            submittedAt: new Date().toISOString(),
            timeSpent: examState.timeRemaining,
            answers: examState.answers,
            flags: examState.flags
        };
        
        // Save to database if electronAPI available
        if (window.electronAPI && window.electronAPI.dbQuery) {
            await window.electronAPI.dbQuery('saveExamSubmission', submissionData);
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
if (document.getElementById('studentName')) {
    document.getElementById('studentName').textContent = 'Abhinav Tiwary';
}
// ============================================
// DEMO AI/ML FEATURES (Simulated)
// ============================================

// Demo: Answer Quality Analysis
function analyzeAnswerQuality(questionNumber, answerIndex) {
    // Simulate ML-based answer analysis
    const qualityScores = {
        0: { correct: 0.65, quality: 'fair', feedback: 'Partially correct approach' },
        1: { correct: 0.92, quality: 'excellent', feedback: 'Excellent understanding demonstrated' },
        2: { correct: 0.45, quality: 'poor', feedback: 'Consider reviewing this concept' },
        3: { correct: 0.78, quality: 'good', feedback: 'Good grasp, minor gaps possible' }
    };
    
    return qualityScores[answerIndex] || { correct: 0.5, quality: 'average', feedback: 'Answer recorded' };
}

// Demo: Performance Prediction
function predictPerformance(answeredCount, totalCount) {
    // Simulate ML model predicting final score
    const answerRate = answeredCount / totalCount;
    const baseScore = answerRate * 100;
    const variance = Math.random() * 15 - 7.5; // ±7.5 variance
    const predictedScore = Math.max(0, Math.min(100, baseScore + variance));
    
    return {
        predicted: predictedScore.toFixed(1),
        confidence: (0.8 + Math.random() * 0.15).toFixed(2), // 80-95%
        category: predictedScore >= 70 ? 'Pass' : predictedScore >= 40 ? 'Borderline' : 'Fail'
    };
}

// Demo: Answer Similarity Detection (Plagiarism)
function checkAnswerSimilarity() {
    // Simulate checking answers against known responses
    const similarityScore = Math.random() * 0.2; // Low similarity (0-20%)
    
    return {
        plagiarismDetected: similarityScore > 0.15,
        similarities: [
            { sourceId: 'Q2', similarity: 0.08 },
            { sourceId: 'Q5', similarity: 0.12 }
        ],
        status: similarityScore > 0.15 ? 'FLAG' : 'PASS'
    };
}

// Demo: Concept Mastery Assessment
function assessConceptMastery() {
    const concepts = [
        { name: 'Time Complexity', mastery: Math.random() * 100 },
        { name: 'Big O Notation', mastery: Math.random() * 100 },
        { name: 'Data Structures', mastery: Math.random() * 100 },
        { name: 'Algorithm Design', mastery: Math.random() * 100 }
    ];
    
    return concepts.map(c => ({
        ...c,
        level: c.mastery >= 80 ? 'Advanced' : c.mastery >= 60 ? 'Intermediate' : 'Beginner'
    }));
}

// Demo: Weak Areas Identification
function identifyWeakAreas() {
    const topics = ['Recursion', 'Dynamic Programming', 'Graph Algorithms', 'Sorting'];
    const weakAreas = topics
        .map(topic => ({ topic, confidence: Math.random() * 100 }))
        .filter(item => item.confidence < 50)
        .sort((a, b) => a.confidence - b.confidence);
    
    return weakAreas.slice(0, 3); // Return top 3 weak areas
}

// Initialize analytics on submission page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (examState) {
            const performance = predictPerformance(
                Object.keys(examState.answers || {}).length,
                examState.totalQuestions
            );
            console.log('📊 Performance Prediction:', performance);
            
            const plagiarism = checkAnswerSimilarity();
            console.log('🔍 Plagiarism Check:', plagiarism);
            
            const mastery = assessConceptMastery();
            console.log('🎯 Concept Mastery:', mastery);
            
            const weakAreas = identifyWeakAreas();
            console.log('⚠️ Weak Areas:', weakAreas);
        }
    });
}