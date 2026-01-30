// Launch Screen JavaScript

// Initialize launch screen
async function initializeLaunchScreen() {
    const proceedButton = document.querySelector('button[aria-label="Proceed to biometric verification"]');
    let hasActiveExam = false;
    let hasUserProfile = false;

    if (window.electronAPI && window.electronAPI.getSystemInfo) {
        try {
            const info = await window.electronAPI.getSystemInfo();
            document.getElementById('systemInfo').textContent = `${info.platform} ${info.arch}`;
            if (document.getElementById('sessionId')) {
                document.getElementById('sessionId').textContent = info.sessionId || '--';
            }
        } catch (error) {
            console.error('Failed to get system info:', error);
        }
    }

    // Load active exam (production data)
    if (window.electronAPI && window.electronAPI.getActiveExam) {
        try {
            const examResult = await window.electronAPI.getActiveExam();
            if (examResult.success && examResult.data) {
                const exam = examResult.data;
                const examName = document.getElementById('examName');
                const examCode = document.getElementById('examCode');
                if (examName) examName.textContent = exam.exam_name;
                if (examCode) examCode.textContent = exam.exam_code;
                localStorage.setItem('currentExamId', exam.exam_id);
                hasActiveExam = true;
            }
        } catch (error) {
            console.error('Failed to load active exam:', error);
        }
    }

    // Load current user profile (production data)
    const userId = Number(localStorage.getItem('currentUserId'));
    if (window.electronAPI && window.electronAPI.getUserProfile && userId) {
        try {
            const userResult = await window.electronAPI.getUserProfile(userId);
            if (userResult.success && userResult.data) {
                document.getElementById('studentName').textContent = userResult.data.full_name || 'Student';
                document.getElementById('studentId').textContent = userResult.data.student_id || '--';
                hasUserProfile = true;
            }
        } catch (error) {
            console.error('Failed to load user profile:', error);
        }
    }

    if (!hasUserProfile) {
        document.getElementById('studentName').textContent = 'Not signed in';
        document.getElementById('studentId').textContent = '--';
    }

    // Run system checks
    await runSystemChecks();

    // Update database connectivity status
    if (window.electronAPI && window.electronAPI.getDatabaseStatus) {
        try {
            const dbStatus = await window.electronAPI.getDatabaseStatus();
            const statusEl = document.getElementById('connectionStatus');
            if (statusEl) {
                statusEl.textContent = dbStatus.connected ? 'DB Connected' : 'DB Offline';
                statusEl.className = dbStatus.connected
                    ? 'text-green-400 font-mono'
                    : 'text-red-400 font-mono';
            }
        } catch (error) {
            console.warn('Database status unavailable:', error);
        }
    }

    // Enable proceed button for demo mode (no database requirement)
    if (proceedButton) {
        // Always enable for demo/testing
        proceedButton.disabled = false;
        proceedButton.classList.remove('opacity-60', 'cursor-not-allowed');
        proceedButton.title = '';
        
        // Show warning if no data loaded (but still allow proceeding)
        if (!hasActiveExam || !hasUserProfile) {
            console.warn('Demo mode: Proceeding without full database setup');
        }
    }
    
    // Update clock
    updateClock();
    setInterval(updateClock, 1000);
}

async function runSystemChecks() {
    console.log('Starting system checks...');
    
    // Check internet
    const internetCheck = document.querySelector('[data-status="internet"]');
    if (internetCheck) {
        setLoadingState(internetCheck, true);
        await new Promise(resolve => setTimeout(resolve, 800));
        const isOnline = navigator.onLine;
        console.log('Internet check:', isOnline);
        updateStatusCard(internetCheck, isOnline);
        setLoadingState(internetCheck, false);
    }

    // Check camera
    const cameraCheck = document.querySelector('[data-status="camera"]');
    if (cameraCheck) {
        setLoadingState(cameraCheck, true);
        try {
            console.log('Requesting camera permission...');
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            });
            console.log('Camera granted:', stream);
            stream.getTracks().forEach(track => {
                console.log('Stopping track:', track);
                track.stop();
            });
            updateStatusCard(cameraCheck, true);
        } catch (error) {
            console.error('Camera error:', error);
            updateStatusCard(cameraCheck, false);
        }
        setLoadingState(cameraCheck, false);
    }

    // Check microphone
    const micCheck = document.querySelector('[data-status="microphone"]');
    if (micCheck) {
        setLoadingState(micCheck, true);
        await new Promise(resolve => setTimeout(resolve, 300));
        try {
            console.log('Requesting microphone permission...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Microphone granted:', stream);
            stream.getTracks().forEach(track => {
                console.log('Stopping track:', track);
                track.stop();
            });
            updateStatusCard(micCheck, true);
        } catch (error) {
            console.error('Microphone error:', error);
            updateStatusCard(micCheck, false);
        }
        setLoadingState(micCheck, false);
    }

    // Browser lock check
    const lockCheck = document.querySelector('[data-status="lock"]');
    if (lockCheck) {
        setLoadingState(lockCheck, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        // Check if running in fullscreen or Electron kiosk mode
        const isLocked = document.fullscreenElement !== null || 
                        (window.electronAPI !== undefined) ||
                        window.innerHeight === screen.height;
        console.log('Browser lock status:', isLocked);
        updateStatusCard(lockCheck, isLocked);
        setLoadingState(lockCheck, false);
    }
    
    console.log('System checks completed');
}

function setLoadingState(card, isLoading) {
    const statusText = card.querySelector('.status-text');
    const statusDot = card.querySelector('.pulse-dot, .w-2.h-2.rounded-full');
    const icon = card.querySelector('.material-symbols-outlined');
    
    if (isLoading) {
        if (statusText) {
            statusText.textContent = 'Checking...';
            statusText.style.opacity = '0.6';
        }
        if (statusDot) {
            statusDot.className = 'w-2 h-2 rounded-full bg-blue-500 animate-pulse';
        }
        if (icon) {
            const parent = icon.parentElement;
            parent.className = 'p-2.5 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center animate-pulse';
        }
    }
}

function updateStatusCard(card, isActive) {
    const statusText = card.querySelector('.status-text');
    const statusDot = card.querySelector('.pulse-dot, .w-2.h-2.rounded-full');
    const icon = card.querySelector('.material-symbols-outlined');
    const errorMessage = card.querySelector('.error-message');
    
    console.log('Updating card:', card.getAttribute('data-status'), 'Active:', isActive);
    
    // Reset loading state
    if (statusText) {
        statusText.style.opacity = '1';
    }

    // Update text
    if (statusText) {
        const statusName = card.getAttribute('data-status');
        if (statusName === 'internet') {
            statusText.textContent = isActive ? 'Connected' : 'Disconnected';
        } else if (statusName === 'lock') {
            statusText.textContent = isActive ? 'Locked' : 'Unlocked';
        } else {
            statusText.textContent = isActive ? 'Active' : 'Inactive';
        }
    }

    // Update status dot
    if (statusDot) {
        if (isActive) {
            statusDot.className = 'w-2 h-2 rounded-full bg-green-500 pulse-dot';
        } else {
            statusDot.className = 'w-2 h-2 rounded-full bg-red-500';
        }
    }

    // Update icon container
    if (icon) {
        const parent = icon.parentElement;
        if (isActive) {
            parent.className = 'p-2.5 rounded-lg bg-green-500/10 text-green-400 flex items-center justify-center';
        } else {
            parent.className = 'p-2.5 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center';
        }
    }

    // Show/hide error message
    if (errorMessage) {
        if (isActive) {
            errorMessage.classList.add('hidden');
        } else {
            errorMessage.classList.remove('hidden');
        }
    }
}

function updateClock() {
    const clockElement = document.getElementById('clock');
    if (!clockElement) return;
    const now = new Date();
    clockElement.textContent = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', 
        hour12: true 
    });
}

// Navigate to verification
const proceedButton = document.querySelector('button[aria-label="Proceed to biometric verification"]');
if (proceedButton) {
    proceedButton.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('Proceed button clicked - navigating to verification...');
        
        if (window.electronAPI && window.electronAPI.navigateTo) {
            try {
                await window.electronAPI.navigateTo('verification');
            } catch (error) {
                console.error('Navigation failed:', error);
                window.location.href = 'verification.html';
            }
        } else {
            window.location.href = 'verification.html';
        }
    });
} else {
    console.error('Proceed button not found!');
}

// Real-time internet monitoring
window.addEventListener('online', () => {
    console.log('Internet connection restored');
    const internetCheck = document.querySelector('[data-status="internet"]');
    if (internetCheck) {
        updateStatusCard(internetCheck, true);
    }
});

window.addEventListener('offline', () => {
    console.log('Internet connection lost');
    const internetCheck = document.querySelector('[data-status="internet"]');
    if (internetCheck) {
        updateStatusCard(internetCheck, false);
    }
});

// Monitor device changes
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
        console.log('Media devices changed - rechecking...');
        await runSystemChecks();
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLaunchScreen);
} else {
    initializeLaunchScreen();
}
