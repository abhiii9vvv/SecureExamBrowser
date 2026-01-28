// ============================================================================
// Secure Exam Browser - Client-Side Application Logic
// ============================================================================

class SecureExamApp {
    constructor() {
        this.currentScreen = 'launch';
        this.systemChecks = {
            internet: false,
            camera: false,
            microphone: false,
            lock: false
        };
        this.examData = {
            currentQuestion: 1,
            totalQuestions: 50,
            answers: {},
            flagged: [],
            timeRemaining: 7200 // 2 hours in seconds
        };
        this.init();
    }

    init() {
        console.log('🚀 Secure Exam Browser initialized');
        this.setupEventListeners();
        this.runSystemChecks();
        this.startClock();
    }

    setupEventListeners() {
        // Admin exit blocked handler
        if (window.electronAPI && window.electronAPI.onExitBlocked) {
            window.electronAPI.onExitBlocked(() => {
                this.showNotification('Exit Blocked', 'Use Ctrl+Alt+Shift+Q to exit securely', 'warning');
            });
        }

        // Navigation buttons
        document.addEventListener('click', (e) => {
            if (e.target.matches('[data-navigate]')) {
                const screen = e.target.dataset.navigate;
                this.navigateTo(screen);
            }

            // Flag question
            if (e.target.matches('[data-flag]')) {
                this.toggleFlag();
            }

            // Next/Previous question
            if (e.target.matches('[data-next-question]')) {
                this.nextQuestion();
            }
            if (e.target.matches('[data-prev-question]')) {
                this.prevQuestion();
            }

            // Submit exam
            if (e.target.matches('[data-submit-exam]')) {
                this.showSubmitConfirmation();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Arrow keys for navigation
            if (e.key === 'ArrowRight' && this.currentScreen === 'exam') {
                this.nextQuestion();
            }
            if (e.key === 'ArrowLeft' && this.currentScreen === 'exam') {
                this.prevQuestion();
            }
            // F for flag
            if (e.key.toLowerCase() === 'f' && this.currentScreen === 'exam') {
                this.toggleFlag();
            }
        });
    }

    async runSystemChecks() {
        // Check internet connection
        this.systemChecks.internet = navigator.onLine;
        
        // Check camera access
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            this.systemChecks.camera = true;
            stream.getTracks().forEach(track => track.stop()); // Stop camera after check
        } catch (error) {
            console.warn('Camera access denied:', error);
            this.systemChecks.camera = false;
        }

        // Check microphone access
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.systemChecks.microphone = true;
            stream.getTracks().forEach(track => track.stop());
        } catch (error) {
            console.warn('Microphone access denied:', error);
            this.systemChecks.microphone = false;
        }

        // Browser lock check (always true in Electron kiosk mode)
        this.systemChecks.lock = true;

        this.updateSystemStatus();
    }

    updateSystemStatus() {
        // Update status indicators if they exist
        const indicators = {
            internet: document.querySelector('[data-status="internet"]'),
            camera: document.querySelector('[data-status="camera"]'),
            microphone: document.querySelector('[data-status="microphone"]'),
            lock: document.querySelector('[data-status="lock"]')
        };

        Object.keys(indicators).forEach(key => {
            const element = indicators[key];
            if (element) {
                const status = this.systemChecks[key];
                const statusText = element.querySelector('.status-text');
                const statusDot = element.querySelector('.status-dot');
                const icon = element.querySelector('.status-icon');

                if (statusText) statusText.textContent = status ? 'Active' : 'Inactive';
                if (statusDot) {
                    statusDot.className = `status-dot ${status ? 'bg-green-500' : 'bg-red-500'}`;
                }
                if (icon) {
                    icon.className = `status-icon ${status ? 'text-green-400' : 'text-red-400'}`;
                }
            }
        });
    }

    async navigateTo(screen) {
        console.log(`Navigating to: ${screen}`);
        
        // Log activity if electronAPI is available
        if (window.electronAPI && window.electronAPI.logActivity) {
            await window.electronAPI.logActivity(`Navigated to ${screen}`);
        }

        // Use electronAPI navigation if available
        if (window.electronAPI && window.electronAPI.navigateTo) {
            try {
                await window.electronAPI.navigateTo(screen);
                this.currentScreen = screen;
            } catch (error) {
                console.error('Navigation failed:', error);
                window.location.href = `${screen}.html`;
            }
        } else {
            // Fallback to regular navigation
            window.location.href = `${screen}.html`;
        }
    }

    startClock() {
        const clockElement = document.getElementById('clock');
        if (!clockElement) return;

        const updateClock = () => {
            const now = new Date();
            const timeString = now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
            clockElement.textContent = timeString;
        };

        updateClock();
        setInterval(updateClock, 1000);
    }

    startExamTimer() {
        const timerElement = document.querySelector('[data-exam-timer]');
        if (!timerElement) return;

        const updateTimer = () => {
            if (this.examData.timeRemaining <= 0) {
                this.autoSubmitExam();
                return;
            }

            const hours = Math.floor(this.examData.timeRemaining / 3600);
            const minutes = Math.floor((this.examData.timeRemaining % 3600) / 60);
            const seconds = this.examData.timeRemaining % 60;

            const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            timerElement.textContent = formattedTime;

            // Change color based on time remaining
            if (this.examData.timeRemaining < 300) { // Last 5 minutes
                timerElement.className = 'text-red-500 font-bold';
            } else if (this.examData.timeRemaining < 1800) { // Last 30 minutes
                timerElement.className = 'text-amber-500 font-bold';
            } else {
                timerElement.className = 'text-green-500 font-bold';
            }

            this.examData.timeRemaining--;
        };

        updateTimer();
        this.timerInterval = setInterval(updateTimer, 1000);
    }

    toggleFlag() {
        const questionId = this.examData.currentQuestion;
        const index = this.examData.flagged.indexOf(questionId);
        
        if (index > -1) {
            this.examData.flagged.splice(index, 1);
            this.showNotification('Unflagged', `Question ${questionId} removed from review list`, 'info');
        } else {
            this.examData.flagged.push(questionId);
            this.showNotification('Flagged', `Question ${questionId} marked for review`, 'warning');
        }

        this.updateQuestionNavigator();
    }

    nextQuestion() {
        if (this.examData.currentQuestion < this.examData.totalQuestions) {
            this.examData.currentQuestion++;
            this.loadQuestion(this.examData.currentQuestion);
            this.saveProgress();
        }
    }

    prevQuestion() {
        if (this.examData.currentQuestion > 1) {
            this.examData.currentQuestion--;
            this.loadQuestion(this.examData.currentQuestion);
        }
    }

    loadQuestion(questionNumber) {
        console.log(`Loading question ${questionNumber}`);
        // In a real implementation, fetch question data from database
        this.updateQuestionNavigator();
    }

    updateQuestionNavigator() {
        const navigator = document.querySelector('[data-question-navigator]');
        if (!navigator) return;

        // Update active question highlight
        const buttons = navigator.querySelectorAll('[data-question-number]');
        buttons.forEach(btn => {
            const num = parseInt(btn.dataset.questionNumber);
            btn.className = this.getQuestionButtonClass(num);
        });
    }

    getQuestionButtonClass(questionNumber) {
        let baseClass = 'aspect-square flex items-center justify-center rounded text-xs font-medium transition-colors';
        
        if (questionNumber === this.examData.currentQuestion) {
            return `${baseClass} bg-primary text-white ring-2 ring-primary`;
        } else if (this.examData.answers[questionNumber]) {
            return `${baseClass} bg-[#394756] text-gray-300 hover:bg-[#4a5a6b]`;
        } else if (this.examData.flagged.includes(questionNumber)) {
            return `${baseClass} bg-[#1b2128] border border-yellow-500 text-gray-400 hover:bg-[#27303a]`;
        } else {
            return `${baseClass} bg-[#1b2128] border border-[#394756] text-gray-500 hover:bg-[#27303a]`;
        }
    }

    saveProgress() {
        // Auto-save functionality
        const data = {
            currentQuestion: this.examData.currentQuestion,
            answers: this.examData.answers,
            flagged: this.examData.flagged,
            timestamp: new Date().toISOString()
        };

        localStorage.setItem('examProgress', JSON.stringify(data));
        this.showNotification('Progress Saved', 'Your answers have been saved', 'success', 2000);
    }

    showSubmitConfirmation() {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="glass-panel rounded-2xl p-8 max-w-md mx-4 border-2 border-red-500/50">
                <div class="flex items-center gap-4 mb-4">
                    <span class="material-symbols-outlined text-red-500 text-4xl">warning</span>
                    <h2 class="text-2xl font-bold text-white">Final Submission</h2>
                </div>
                <p class="text-gray-300 mb-6">
                    Are you sure you want to submit your exam? This action cannot be undone.
                </p>
                <div class="bg-black/40 rounded-lg p-4 mb-6">
                    <div class="flex justify-between text-sm mb-2">
                        <span class="text-gray-400">Answered:</span>
                        <span class="text-white font-bold">${Object.keys(this.examData.answers).length}/${this.examData.totalQuestions}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span class="text-gray-400">Flagged for Review:</span>
                        <span class="text-amber-500 font-bold">${this.examData.flagged.length}</span>
                    </div>
                </div>
                <div class="flex gap-3">
                    <button data-cancel class="flex-1 py-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium transition-colors">
                        Cancel
                    </button>
                    <button data-confirm class="flex-1 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition-colors">
                        Submit Exam
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('[data-cancel]').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('[data-confirm]').addEventListener('click', () => {
            modal.remove();
            this.submitExam();
        });
    }

    async submitExam() {
        this.showNotification('Submitting...', 'Processing your exam submission', 'info');
        
        // In real implementation, send data to backend
        setTimeout(() => {
            this.navigateTo('success');
        }, 2000);
    }

    autoSubmitExam() {
        clearInterval(this.timerInterval);
        this.showNotification('Time Up!', 'Exam time has expired. Auto-submitting...', 'error');
        setTimeout(() => {
            this.submitExam();
        }, 3000);
    }

    showNotification(title, message, type = 'info', duration = 4000) {
        const colors = {
            success: 'bg-green-500',
            warning: 'bg-amber-500',
            error: 'bg-red-500',
            info: 'bg-blue-500'
        };

        const notification = document.createElement('div');
        notification.className = `fixed top-20 right-6 ${colors[type]} text-white px-6 py-4 rounded-lg shadow-2xl z-50 animate-in slide-in-from-right duration-300`;
        notification.innerHTML = `
            <div class="flex items-start gap-3">
                <span class="material-symbols-outlined">notifications</span>
                <div>
                    <h4 class="font-bold">${title}</h4>
                    <p class="text-sm opacity-90">${message}</p>
                </div>
            </div>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slide-out-to-right 300ms ease-out';
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.secureExamApp = new SecureExamApp();
    });
} else {
    window.secureExamApp = new SecureExamApp();
}
