// Launch Screen JavaScript - Refactored

const UI_ONLY = true;

// Initialize launch screen
const systemStatus = {
    internet: null,
    camera: null,
    microphone: null,
    lock: null
};

let biometricVerified = UI_ONLY ? true : false;
let examScheduled = UI_ONLY ? true : false;

async function initializeLaunchScreen() {
    const startExamButton = document.getElementById('startExamButton');
    const verificationButton = document.querySelector('.btn-verification-start');
    let hasActiveExam = false;
    let hasUserProfile = false;

    if (!UI_ONLY && window.electronAPI && window.electronAPI.getSystemInfo) {
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
    if (!UI_ONLY && window.electronAPI && window.electronAPI.getActiveExam) {
        try {
            const examResult = await window.electronAPI.getActiveExam();
            if (examResult.success && examResult.data) {
                const exam = examResult.data;
                
                // Update exam details
                updateDetailValue('examTitle', exam.exam_name);
                updateDetailValue('examCodeInline', exam.exam_code);
                updateDetailValue('examDuration', exam.duration_minutes ? `${exam.duration_minutes} minutes` : null);
                updateDetailValue('examWindow', formatExamWindow(exam.start_time, exam.end_time));
                
                const examUrl = exam.exam_url || '';
                const examUrlEl = document.getElementById('examUrl');
                if (examUrlEl) {
                    if (examUrl) {
                        examUrlEl.innerHTML = `<a href="${examUrl}" target="_blank">${examUrl}</a>`;
                    } else {
                        examUrlEl.innerHTML = '<span class="empty-state">Not available</span>';
                    }
                }
                
                localStorage.setItem('currentExamName', exam.exam_name || '');
                localStorage.setItem('currentExamCode', exam.exam_code || '');
                localStorage.setItem('currentExamDuration', exam.duration_minutes || '');
                localStorage.setItem('currentExamId', exam.exam_id);
                
                hasActiveExam = true;
                examScheduled = true;
            }
        } catch (error) {
            console.error('Failed to load active exam:', error);
        }
    }

    // Load current user profile (production data)
    const userId = Number(localStorage.getItem('currentUserId'));
    if (!UI_ONLY && window.electronAPI && window.electronAPI.getUserProfile && userId) {
        try {
            const userResult = await window.electronAPI.getUserProfile(userId);
            if (userResult.success && userResult.data) {
                document.getElementById('studentName').textContent = userResult.data.full_name || 'Student';
                updateDetailValue('studentId', userResult.data.student_id);
                hasUserProfile = true;
            }
        } catch (error) {
            console.error('Failed to load user profile:', error);
        }
    }

    // Load profile details from localStorage
    const storedCourse = localStorage.getItem('currentUserCourse');
    const storedBranch = localStorage.getItem('currentUserBranch');
    const storedUniversity = localStorage.getItem('currentUserUniversity');
    const storedLocation = localStorage.getItem('currentUserLocation');

    updateDetailValue('studentCourse', storedCourse);
    updateDetailValue('studentBranch', storedBranch);
    updateDetailValue('studentUniversity', storedUniversity);
    updateDetailValue('studentLocation', storedLocation);

    if (!hasUserProfile) {
        document.getElementById('studentName').textContent = 'Not signed in';
    }

    // Run system checks
    if (UI_ONLY) {
        examScheduled = true;
        biometricVerified = true;
        const storedName = localStorage.getItem('currentExamName') || '';
        const storedCode = localStorage.getItem('currentExamCode') || '';
        if (!storedName || /demo/i.test(storedName)) {
            localStorage.setItem('currentExamName', 'Assessment');
        }
        if (!storedCode || /demo/i.test(storedCode)) {
            localStorage.setItem('currentExamCode', 'EXAM-001');
        }
    }
    await runSystemChecks();

    // Update database connectivity status
    if (!UI_ONLY && window.electronAPI && window.electronAPI.getDatabaseStatus) {
        try {
            const dbStatus = await window.electronAPI.getDatabaseStatus();
            const statusEl = document.getElementById('connectionStatus');
            if (statusEl) {
                statusEl.textContent = dbStatus.connected ? 'Connected' : 'Offline';
                statusEl.style.color = dbStatus.connected ? '#059669' : '#d97706';
            }
        } catch (error) {
            console.warn('Database status unavailable:', error);
        }
    }

    // Update global exam status
    updateGlobalExamStatus();

    // Setup verification button
    if (verificationButton) {
        verificationButton.addEventListener('click', async (e) => {
            e.preventDefault();
            console.log('Verification button clicked - navigating to verification...');
            
            if (!UI_ONLY && window.electronAPI && window.electronAPI.navigateTo) {
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
    }

    // Setup start exam button
    if (startExamButton) {
        startExamButton.addEventListener('click', async (e) => {
            e.preventDefault();
            console.log('Start exam button clicked');
            
            // Navigate to exam page
            if (!UI_ONLY && window.electronAPI && window.electronAPI.navigateTo) {
                try {
                    await window.electronAPI.navigateTo('exam');
                } catch (error) {
                    console.error('Navigation failed:', error);
                    window.location.href = 'exam.html';
                }
            } else {
                window.location.href = 'exam.html';
            }
        });
    }

    // Update clock
    updateClock();
    setInterval(updateClock, 1000);
}

function updateDetailValue(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    if (value && value !== '--' && value !== '') {
        element.textContent = value;
        // Remove empty state if exists
        const emptyState = element.querySelector('.empty-state');
        if (emptyState) {
            element.textContent = value;
        }
    }
}

function formatExamWindow(startTime, endTime) {
    if (!startTime || !endTime) return null;
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
    }

    const options = { hour: '2-digit', minute: '2-digit' };
    const dateOptions = { month: 'short', day: '2-digit' };
    const startLabel = `${start.toLocaleDateString('en-US', dateOptions)} ${start.toLocaleTimeString('en-US', options)}`;
    const endLabel = `${end.toLocaleDateString('en-US', dateOptions)} ${end.toLocaleTimeString('en-US', options)}`;
    return `${startLabel} → ${endLabel}`;
}

async function runSystemChecks() {
    if (UI_ONLY) {
        systemStatus.internet = true;
        systemStatus.camera = true;
        systemStatus.microphone = true;
        systemStatus.lock = true;
        updateCheckItem('internet', true);
        updateCheckItem('camera', true);
        updateCheckItem('microphone', true);
        updateCheckItem('lock', true);
        updateProgressSummary();
        updateSystemAlerts();
        updateGlobalExamStatus();
        return;
    }

    console.log('Starting system checks...');
    
    // Internet check
    setCheckLoading('internet', 'Checking internet connection...');
    await new Promise(resolve => setTimeout(resolve, 300));
    systemStatus.internet = navigator.onLine;
    updateCheckItem('internet', systemStatus.internet);

    // Camera check  
    setCheckLoading('camera', 'Detecting camera...');
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        systemStatus.camera = videoDevices.length > 0;
        if (systemStatus.camera) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop());
        }
    } catch (error) {
        console.warn('Camera check failed:', error);
        systemStatus.camera = false;
    }
    updateCheckItem('camera', systemStatus.camera);

    // Microphone check
    setCheckLoading('microphone', 'Detecting microphone...');
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(d => d.kind === 'audioinput');
        systemStatus.microphone = audioDevices.length > 0;
        if (systemStatus.microphone) {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
        }
    } catch (error) {
        console.warn('Microphone check failed:', error);
        systemStatus.microphone = false;
    }
    updateCheckItem('microphone', systemStatus.microphone);

    // Lock mode check
    setCheckLoading('lock', 'Verifying lockdown mode...');
    await new Promise(resolve => setTimeout(resolve, 800));
    if (!UI_ONLY && window.electronAPI && window.electronAPI.getLockStatus) {
        try {
            const lockStatus = await window.electronAPI.getLockStatus();
            systemStatus.lock = lockStatus.enabled === true;
        } catch (error) {
            console.warn('Lock status check failed:', error);
            systemStatus.lock = false;
        }
    } else {
        systemStatus.lock = false;
    }
    updateCheckItem('lock', systemStatus.lock);

    console.log('System checks completed:', systemStatus);
    updateProgressSummary();
    updateSystemAlerts();
    updateGlobalExamStatus();
}

function setCheckLoading(checkId, message) {
    const checkItem = document.querySelector(`[data-status="${checkId}"]`);
    if (!checkItem) return;

    const statusIcon = checkItem.querySelector('.checklist-status span');
    const statusText = checkItem.querySelector('[data-check-text]');

    checkItem.removeAttribute('data-check-pass');
    if (statusIcon) statusIcon.textContent = 'schedule';
    if (statusText) statusText.textContent = message || 'Checking...';
}

function updateCheckItem(checkId, passed) {
    const checkItem = document.querySelector(`[data-status="${checkId}"]`);
    if (!checkItem) return;

    const statusIcon = checkItem.querySelector('.checklist-status span');
    const statusText = checkItem.querySelector('[data-check-text]');

    checkItem.setAttribute('data-check-pass', passed ? 'true' : 'false');
    
    if (passed) {
        if (statusIcon) statusIcon.textContent = 'check_circle';
        if (statusText) statusText.textContent = 'Ready';
    } else {
        if (statusIcon) statusIcon.textContent = 'cancel';
        if (statusText) statusText.textContent = 'Failed';
    }
}

function updateProgressSummary() {
    const checksPassedCount = Object.values(systemStatus).filter(v => v === true).length;
    const totalChecks = Object.keys(systemStatus).length;
    
    const percentComplete = (checksPassedCount / totalChecks) * 100;
    
    // Update progress text
    const progressCount = document.getElementById('checksPassedCount');
    if (progressCount) {
        progressCount.textContent = checksPassedCount;
    }
    
    // Update progress bar
    const progressBar = document.querySelector('.checksProgressBar');
    if (progressBar) {
        progressBar.style.width = `${percentComplete}%`;
        progressBar.setAttribute('aria-valuenow', percentComplete);
    }
}

function updateSystemAlerts() {
    const alertContainer = document.getElementById('systemAlerts');
    if (!alertContainer) return;

    const failedChecks = [];
    if (!systemStatus.internet) failedChecks.push('Internet connection');
    if (!systemStatus.camera) failedChecks.push('Camera access');
    if (!systemStatus.microphone) failedChecks.push('Microphone access');
    if (!systemStatus.lock) failedChecks.push('Lockdown mode');

    if (failedChecks.length === 0) {
        alertContainer.classList.add('d-none');
        alertContainer.innerHTML = '';
    } else {
        alertContainer.classList.remove('d-none');
        const alertText = `Please resolve: ${failedChecks.join(', ')}`;
        alertContainer.innerHTML = `
            <div class="alert alert-warning mb-0" role="alert">
                <span class="material-symbols-outlined" style="vertical-align: middle;">warning</span>
                ${alertText}
            </div>
        `;
    }
}

function updateGlobalExamStatus() {
    const statusBadge = document.querySelector('.exam-status-badge');
    const startExamButton = document.getElementById('startExamButton');
    
    if (!statusBadge) return;

    if (UI_ONLY) {
        statusBadge.setAttribute('data-status', 'ready');
        const statusText = statusBadge.querySelector('.exam-status-text');
        const statusIcon = statusBadge.querySelector('.exam-status-icon');
        if (statusText) statusText.textContent = 'Ready to Start';
        if (statusIcon) statusIcon.textContent = 'check_circle';
        if (startExamButton) startExamButton.disabled = false;
        return;
    }
    
    // Determine overall status
    const allChecksPassed = Object.values(systemStatus).every(v => v === true);
    const anyCheckRunning = Object.values(systemStatus).some(v => v === null);
    
    let status = 'checking';
    
    if (!examScheduled) {
        status = 'not-scheduled';
    } else if (anyCheckRunning) {
        status = 'checking';
    } else if (!allChecksPassed || !biometricVerified) {
        status = 'issues';
    } else {
        status = 'ready';
    }
    
    // Update badge
    statusBadge.setAttribute('data-status', status);
    
    const statusText = statusBadge.querySelector('.exam-status-text');
    const statusIcon = statusBadge.querySelector('.exam-status-icon');
    
    if (statusText) {
        switch(status) {
            case 'not-scheduled':
                statusText.textContent = 'No Exam Scheduled';
                if (statusIcon) statusIcon.textContent = 'event_busy';
                break;
            case 'checking':
                statusText.textContent = 'Checking readiness...';
                if (statusIcon) statusIcon.textContent = 'schedule';
                break;
            case 'issues':
                statusText.textContent = 'System Issues Detected';
                if (statusIcon) statusIcon.textContent = 'warning';
                break;
            case 'ready':
                statusText.textContent = 'Ready to Start';
                if (statusIcon) statusIcon.textContent = 'check_circle';
                break;
        }
    }
    
    // Update start exam button
    if (startExamButton) {
        const canStart = status === 'ready';
        startExamButton.disabled = !canStart;
    }
}

function updateClock() {
    const clockElement = document.getElementById('currentTime');
    if (!clockElement) return;
    const now = new Date();
    clockElement.textContent = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', 
        hour12: true 
    });
}

// Real-time internet monitoring
window.addEventListener('online', () => {
    if (UI_ONLY) {
        return;
    }
    console.log('Internet connection restored');
    systemStatus.internet = true;
    updateCheckItem('internet', true);
    updateProgressSummary();
    updateSystemAlerts();
    updateGlobalExamStatus();
});

window.addEventListener('offline', () => {
    if (UI_ONLY) {
        return;
    }
    console.log('Internet connection lost');
    systemStatus.internet = false;
    updateCheckItem('internet', false);
    updateProgressSummary();
    updateSystemAlerts();
    updateGlobalExamStatus();
});

// Monitor device changes
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
        if (UI_ONLY) {
            return;
        }
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
