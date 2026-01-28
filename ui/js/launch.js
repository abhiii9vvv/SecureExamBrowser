// Launch Screen JavaScript

// Initialize launch screen
async function initializeLaunchScreen() {
    if (window.electronAPI && window.electronAPI.getSystemInfo) {
        try {
            const info = await window.electronAPI.getSystemInfo();
            document.getElementById('systemInfo').textContent = `${info.platform} ${info.arch}`;
            document.getElementById('studentName').textContent = 'Abhinav Tiwary';
            document.getElementById('studentId').textContent = '#SU2024BTech';
        } catch (error) {
            console.error('Failed to get system info:', error);
            document.getElementById('studentName').textContent = 'Abhinav Tiwary';
            document.getElementById('studentId').textContent = '#SU2024BTech';
        }
    } else {
        document.getElementById('studentName').textContent = 'Abhinav Tiwary';
        document.getElementById('studentId').textContent = '#SU2024BTech';
    }

    // Run system checks
    await runSystemChecks();
    
    // Update clock
    updateClock();
    setInterval(updateClock, 1000);
}

async function runSystemChecks() {
    // Check internet
    const internetCheck = document.querySelector('[data-status="internet"]');
    if (internetCheck) {
        const isOnline = navigator.onLine;
        updateStatusCard(internetCheck, isOnline);
    }

    // Check camera
    const cameraCheck = document.querySelector('[data-status="camera"]');
    if (cameraCheck) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop());
            updateStatusCard(cameraCheck, true);
        } catch (error) {
            updateStatusCard(cameraCheck, false);
        }
    }

    // Check microphone
    const micCheck = document.querySelector('[data-status="microphone"]');
    if (micCheck) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            updateStatusCard(micCheck, true);
        } catch (error) {
            updateStatusCard(micCheck, false);
        }
    }

    // Browser lock (always true in Electron)
    const lockCheck = document.querySelector('[data-status="lock"]');
    if (lockCheck) {
        updateStatusCard(lockCheck, true);
    }
}

function updateStatusCard(card, isActive) {
    const statusText = card.querySelector('.font-semibold');
    const statusDot = card.querySelector('.pulse-dot');
    const icon = card.querySelector('.material-symbols-outlined');

    if (statusText) {
        statusText.textContent = isActive ? 'Active' : 'Inactive';
    }
    if (statusDot) {
        statusDot.className = isActive ? 'w-2 h-2 rounded-full bg-green-500 pulse-dot' : 'w-2 h-2 rounded-full bg-red-500';
    }
    if (icon) {
        const parent = icon.parentElement;
        parent.className = isActive 
            ? 'p-2.5 rounded-lg bg-green-500/10 text-green-400 flex items-center justify-center'
            : 'p-2.5 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center';
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
document.querySelector('button').addEventListener('click', async () => {
    if (window.electronAPI && window.electronAPI.navigateTo) {
        await window.electronAPI.navigateTo('verification');
    } else {
        window.location.href = 'verification.html';
    }
});

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLaunchScreen);
} else {
    initializeLaunchScreen();
}
