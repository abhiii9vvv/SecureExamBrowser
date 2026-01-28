// Verification Screen JavaScript

let verificationProgress = 0;
let verificationStep = 1;
let cameraStream = null;
let verificationComplete = false;
let verificationInterval = null;

async function initializeVerification() {
    // Try to access camera
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const videoElement = document.getElementById('videoElement');
        const placeholder = document.getElementById('cameraPlaceholder');
        
        if (videoElement && placeholder) {
            videoElement.srcObject = cameraStream;
            videoElement.style.display = 'block';
            placeholder.style.display = 'none';
        }
        
        // Start verification simulation
        startVerificationProcess();
    } catch (error) {
        console.error('Camera access denied:', error);
        const placeholder = document.getElementById('cameraPlaceholder');
        if (placeholder) {
            placeholder.innerHTML = `
                <div class="text-center p-6">
                    <span class="material-symbols-outlined text-yellow-500 text-8xl mb-4">videocam_off</span>
                    <p class="text-yellow-400 text-lg font-bold mb-2">Camera Access Required</p>
                    <p class="text-slate-300 text-sm mb-4">Click "I'm Ready" button below to grant camera access</p>
                    <p class="text-slate-500 text-xs">📹 Allow camera when browser prompts<br/>🔒 Your privacy is protected</p>
                </div>
            `;
        }
        // Don't auto-start, wait for user to click "I'm Ready"
    }
}

function startVerificationProcess() {
    verificationProgress = 0;
    verificationStep = 1;
    verificationComplete = false;
    
    const progressInterval = setInterval(() => {
        verificationProgress += 1.5;
        
        // Update progress bar
        const progressBar = document.querySelector('.h-2.w-full.bg-surface-dark.rounded-full .h-full');
        if (progressBar) {
            progressBar.style.width = `${Math.min(verificationProgress, 100)}%`;
        }
        
        // Update step indicators
        if (verificationProgress >= 20 && verificationStep === 1) {
            verificationStep = 2;
            updateVerificationCards(2);
        } else if (verificationProgress >= 45 && verificationStep === 2) {
            verificationStep = 3;
            updateVerificationCards(3);
        } else if (verificationProgress >= 70 && verificationStep === 3) {
            verificationStep = 4;
            updateVerificationCards(4);
        }
        
        if (verificationProgress >= 100) {
            clearInterval(progressInterval);
            verificationComplete = true;
            
            // Update step text
            const stepText = document.querySelector('.text-cyan-400.font-bold.tracking-wide');
            if (stepText) {
                stepText.textContent = 'Step 4 of 4';
            }
            
            // Enable I'm Ready button with visual feedback
            const buttons = document.querySelectorAll('button');
            buttons.forEach(btn => {
                if (btn.textContent.includes("I'm Ready")) {
                    btn.disabled = false;
                    btn.style.boxShadow = '0 0 30px rgba(0, 229, 255, 0.6)';
                    btn.classList.add('animate-pulse-slow');
                }
            });
        }
    }, 50);
}

function updateVerificationCards(completedStep) {
    const cards = document.querySelectorAll('.group.flex.items-center.gap-4');
    cards.forEach((card, index) => {
        const step = index + 1;
        const icon = card.querySelector('.material-symbols-outlined');
        const text = card.querySelector('.text-xs.font-mono');
        const iconBg = icon.parentElement;
        
        if (step < completedStep) {
            // Completed
            card.className = 'group flex items-center gap-4 p-4 rounded-xl bg-surface-dark/50 border border-emerald-500/30 shadow-lg relative overflow-hidden transition-all';
            iconBg.className = 'size-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 border border-emerald-500/50';
            icon.className = 'material-symbols-outlined text-emerald-400';
            icon.textContent = 'check';
            if (text) text.textContent = 'Completed successfully';
        } else if (step === completedStep) {
            // Active
            card.className = 'group flex items-center gap-4 p-4 rounded-xl bg-surface-dark border border-primary shadow-[0_0_15px_rgba(0,102,204,0.15)] relative overflow-hidden ring-1 ring-primary/30';
            iconBg.className = 'size-10 rounded-full bg-primary flex items-center justify-center shrink-0 animate-pulse-slow shadow-lg shadow-primary/40';
            icon.className = 'material-symbols-outlined text-white animate-spin';
            icon.textContent = 'sync';
            if (text) text.textContent = 'Processing...';
        }
    });
}

function navigateToExam() {
    // Stop camera
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }
    
    if (window.electronAPI && window.electronAPI.navigateTo) {
        window.electronAPI.navigateTo('exam');
    } else {
        window.location.href = 'exam.html';
    }
}

// Button handlers
document.addEventListener('DOMContentLoaded', () => {
    // Allow skipping verification with Shift+D for demo/testing
    document.addEventListener('keydown', (e) => {
        if (e.shiftKey && e.key === 'D') {
            console.log('🔓 Demo mode activated - Skipping verification');
            verificationComplete = true;
            verificationProgress = 100;
            
            // Update UI to show completed
            updateVerificationCards(4);
            const progressBar = document.querySelector('.h-2.w-full.bg-surface-dark.rounded-full .h-full');
            if (progressBar) {
                progressBar.style.width = '100%';
            }
            
            // Enable button
            const buttons = document.querySelectorAll('button');
            buttons.forEach(btn => {
                if (btn.textContent.includes("I'm Ready")) {
                    btn.disabled = false;
                    btn.style.boxShadow = '0 0 30px rgba(0, 229, 255, 0.6)';
                }
            });
        }
    });
    
    const buttons = document.querySelectorAll('button');
    buttons.forEach(btn => {
        if (btn.textContent.includes('Cancel')) {
            btn.addEventListener('click', () => {
                if (cameraStream) {
                    cameraStream.getTracks().forEach(track => track.stop());
                }
                if (window.electronAPI && window.electronAPI.navigateTo) {
                    window.electronAPI.navigateTo('launch');
                } else {
                    window.location.href = 'launch.html';
                }
            });
        }
        if (btn.textContent.includes("I'm Ready")) {
            btn.addEventListener('click', async () => {
                if (!verificationComplete) {
                    // Verification not started or not complete
                    if (!cameraStream) {
                        // Try to get camera access
                        await initializeVerification();
                    }
                    // Wait for verification to complete
                    let checkCount = 0;
                    const waitForVerification = setInterval(() => {
                        checkCount++;
                        if (verificationComplete || checkCount > 60) { // Wait max 3 seconds
                            clearInterval(waitForVerification);
                            if (verificationComplete) {
                                navigateToExam();
                            } else {
                                alert('⚠️ Verification in progress. Please wait...\n\nTip: Press Shift+D for demo mode without camera');
                            }
                        }
                    }, 50);
                } else {
                    // Verification already complete, navigate immediately
                    navigateToExam();
                }
            });
        }
    });
    
    // Auto-start verification
    setTimeout(() => {
        initializeVerification();
    }, 500);
});
