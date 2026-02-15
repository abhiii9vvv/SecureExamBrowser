// Verification Screen JavaScript

let verificationProgress = 0;
let verificationStep = 1;
let cameraStream = null;
let verificationComplete = false;
let verificationInterval = null;
let faceDetector = null;
let faceDetected = false;
let livenessPassed = false;
let lastFaceBox = null;
let motionScore = 0;
let faceStableStart = null;
let detectionLoopActive = false;
let faceDetectionFrame = null;
let biometricSaved = false;
let verificationLocked = false;
let lockReason = '';
let faceDetectionStableFrames = 0;
let requiredStableFrames = 30; // Need 30 frames of stable face detection
let cameraMonitorInterval = null;
let lastCameraError = null;
let verificationVideoElement = null;
let identityMatched = false;
let backendVerifyInterval = null;
let enrollingIdentity = false;
const DEMO_MODE = true;

// Warning and score tracking
let currentWarnings = [];
let detectionScores = {
    faceConfidence: 0,
    livenessScore: 0,
    motionScore: 0,
    identityScore: 0,
    eyesDetected: 0
};

async function initializeVerification() {
    console.log('Initializing verification...');
    
    // Check if verification is locked
    if (verificationLocked) {
        showVerificationLocked();
        return;
    }

    const videoElement = document.getElementById('videoElement');
    const placeholder = document.getElementById('cameraPlaceholder');
    
    if (!videoElement) {
        console.error('Video element not found!');
        return;
    }
    verificationVideoElement = videoElement;

    // Try to access camera
    try {
        console.log('Requesting camera access...');
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }, 
            audio: false 
        });
        
        console.log('Camera access granted!');

        videoElement.srcObject = cameraStream;

        // Wait for video to be ready
        await new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                console.log('Video metadata loaded');
                resolve();
            };
        });

        await videoElement.play();
        console.log('Video playing');
        
        // Show video, hide placeholder
        videoElement.style.display = 'block';
        if (placeholder) {
            placeholder.style.display = 'none';
        }

        // Start verification process
        startVerificationProcess();

        // Start monitoring camera health
        startCameraMonitoring(videoElement);

        // Start detection (backend if available)
        if (window.electronAPI && window.electronAPI.verifyFrame) {
            startBackendVerificationLoop(videoElement);
        } else {
            await setupYOLOv8Detection(videoElement);
        }
        
    } catch (error) {
        console.error('Camera access error:', error);
        if (placeholder) {
            placeholder.innerHTML = `
                <div class="text-center p-6">
                    <span class="material-symbols-outlined text-red-500 text-8xl mb-4">videocam_off</span>
                    <p class="text-red-400 text-lg font-bold mb-2">Camera Access Denied</p>
                    <p class="text-slate-300 text-sm mb-4">${error.message}</p>
                    <p class="text-slate-500 text-xs">Please allow camera permissions and refresh the page</p>
                </div>
            `;
        }
        lockVerification('Camera access denied. Please allow camera permissions and refresh.');
    }
}

function startCameraMonitoring(videoElement) {
    if (cameraMonitorInterval) {
        clearInterval(cameraMonitorInterval);
    }

    cameraMonitorInterval = setInterval(async () => {
        try {
            if (!cameraStream) {
                return;
            }

            const tracks = cameraStream.getVideoTracks();
            const track = tracks && tracks[0];

            // Restart if track ended
            if (!track || track.readyState === 'ended') {
                console.warn('Camera track ended. Restarting...');
                await restartCamera(videoElement);
                return;
            }

            // Restart if video is stalled
            if (videoElement && videoElement.readyState < 2) {
                console.warn('Video stalled. Restarting...');
                await restartCamera(videoElement);
                return;
            }
        } catch (error) {
            lastCameraError = error;
            console.warn('Camera monitor error:', error);
        }
    }, 2000);
}

async function restartCamera(videoElement) {
    try {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        videoElement.srcObject = cameraStream;
        await videoElement.play();
    } catch (error) {
        lastCameraError = error;
        console.error('Failed to restart camera:', error);
    }
}

function captureFrameData(videoElement) {
    if (!videoElement || videoElement.readyState < 2) return null;

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth || 1280;
    canvas.height = videoElement.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
}

function drawBackendOverlay(videoElement, faces) {
    const overlay = document.getElementById('faceOverlay');
    const overlayCtx = overlay ? overlay.getContext('2d') : null;

    if (!overlay || !overlayCtx) return;
    overlay.width = videoElement.videoWidth || overlay.clientWidth;
    overlay.height = videoElement.videoHeight || overlay.clientHeight;
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    if (!faces || faces.length === 0) return;

    const scaleX = overlay.width / videoElement.videoWidth;
    const scaleY = overlay.height / videoElement.videoHeight;
    const face = faces[0];
    const [x1, y1, x2, y2] = face.bbox;

    overlayCtx.strokeStyle = '#00ff00';
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeRect(x1 * scaleX, y1 * scaleY, (x2 - x1) * scaleX, (y2 - y1) * scaleY);

    if (face.confidence) {
        overlayCtx.fillStyle = '#00ff00';
        overlayCtx.font = 'bold 16px monospace';
        overlayCtx.fillText(`Face ${(face.confidence * 100).toFixed(1)}%`, x1 * scaleX, (y1 * scaleY) - 8);
    }
}

function startBackendVerificationLoop(videoElement) {
    if (backendVerifyInterval) {
        clearInterval(backendVerifyInterval);
    }

    backendVerifyInterval = setInterval(async () => {
        if (verificationLocked || !cameraStream) return;

        const frameData = captureFrameData(videoElement);
        if (!frameData) return;

        try {
            const result = await window.electronAPI.verifyFrame({ image: frameData });
            if (!result || result.error) {
                console.warn('Verification error:', result?.error);
                addWarning('Backend Error: ' + (result?.error || 'Unknown'), 'error');
                return;
            }

            // Clear previous warnings
            clearWarnings();

            // Update detection scores
            detectionScores.faceConfidence = (result.faces && result.faces[0]) ? result.faces[0].confidence : 0;
            detectionScores.livenessScore = result.liveness?.is_live ? 1.0 : 0;
            detectionScores.motionScore = result.liveness?.motion_score || 0;
            detectionScores.identityScore = result.identity_match?.score || 0;
            detectionScores.eyesDetected = result.liveness?.eyes_detected || 0;

            // Check for warnings
            console.log('Face detection result:', result.face_count, 'faces');
            if (result.face_count === 0) {
                console.log('Adding NO FACE warning');
                addWarning('⚠️ No face detected - Please look at camera', 'warning');
            } else if (result.face_count > 1) {
                console.log('Adding MULTIPLE FACES warning');
                addWarning('⚠️ Multiple faces detected - Only one person allowed', 'error');
            } else if (detectionScores.faceConfidence < 0.6) {
                console.log('Adding LOW CONFIDENCE warning');
                addWarning('⚠️ Low face confidence - Move closer to camera', 'warning');
            }

            if (result.liveness && !result.liveness.is_live && result.face_count === 1) {
                addWarning('⚠️ Liveness check failed - Please move slightly', 'warning');
            }

            if (result.identity_match && !result.identity_match.match && result.has_reference) {
                addWarning('⚠️ Identity mismatch - Face does not match enrolled identity', 'error');
            }

            drawBackendOverlay(videoElement, result.faces);
            updateScoreDisplay();

            faceDetected = result.face_count === 1;
            livenessPassed = !!result.liveness?.is_live;
            // DEMO MODE: Identity matched when face is detected
            identityMatched = faceDetected || !!result.identity_match?.match;

            if (faceDetected && result.faces && result.faces[0] && result.faces[0].confidence) {
                updateConfidenceUI(Math.round(result.faces[0].confidence * 100));
            }

            updateFaceStatusUI(faceDetected, faceDetected ? 'Detected' : 'Searching');

            if (faceDetected && !result.has_reference && !enrollingIdentity) {
                enrollingIdentity = true;
                await window.electronAPI.enrollIdentity({ image: frameData });
                enrollingIdentity = false;
            }

            // DEMO MODE: Complete verification when face and liveness detected
            if (faceDetected && livenessPassed) {
                verificationComplete = true;
                enableReadyButton();
            }

            updateVerificationCards();
        } catch (error) {
            console.warn('Backend verification loop error:', error);
        }
    }, 800);
}

document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && verificationVideoElement) {
        try {
            await restartCamera(verificationVideoElement);
        } catch (error) {
            console.warn('Failed to restart camera on visibility change:', error);
        }
    }
});

async function setupYOLOv8Detection(videoElement) {
    // Use Web Canvas API for real-time face detection simulation
    // In production, this would connect to Python YOLOv8 backend
    startYOLOv8DetectionLoop(videoElement);
}

function startYOLOv8DetectionLoop(videoElement) {
    if (detectionLoopActive) return;
    detectionLoopActive = true;

    const overlay = document.getElementById('faceOverlay');
    const overlayCtx = overlay ? overlay.getContext('2d') : null;

    const detect = async () => {
        if (!videoElement || videoElement.readyState < 2) {
            faceDetectionFrame = requestAnimationFrame(detect);
            return;
        }

        try {
            if (overlay && overlayCtx) {
                overlay.width = videoElement.videoWidth || 1280;
                overlay.height = videoElement.videoHeight || 720;
                overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
            }

            // Simulate YOLOv8 detection (in production, call Python backend)
            const faces = await simulateYOLOv8Detection(videoElement, overlayCtx, overlay);
            
            const detected = faces.count === 1; // Only one face should be detected
            faceDetected = detected;

            if (detected) {
                faceDetectionStableFrames++;
                updateFaceStatusUI(true, `Face Locked (${Math.min(100, Math.floor((faceDetectionStableFrames / requiredStableFrames) * 100))}%)`);
                
                // Auto-progress verification when stable
                if (faceDetectionStableFrames >= requiredStableFrames && verificationStep === 1) {
                    completeVerificationStep(1);
                }
            } else {
                faceDetectionStableFrames = Math.max(0, faceDetectionStableFrames - 2);
                
                if (faces.count === 0) {
                    updateFaceStatusUI(false, 'No Face Detected');
                    // Lock after too many failures (disabled in demo mode)
                    if (!DEMO_MODE && faceDetectionStableFrames === 0 && verificationStep > 1) {
                        lockVerification('Face detection lost. Verification failed.');
                    }
                } else if (faces.count > 1) {
                    updateFaceStatusUI(false, `Multiple Faces (${faces.count})`);
                    if (!DEMO_MODE) {
                        lockVerification('Multiple faces detected. Only one person allowed.');
                    }
                }
            }

        } catch (error) {
            console.error('Detection error:', error);
            updateFaceStatusUI(false, 'Detection Error');
        }

        if (!verificationLocked) {
            faceDetectionFrame = requestAnimationFrame(detect);
        }
    };

    detect();
}

async function simulateYOLOv8Detection(video, ctx, canvas) {
    // Simulate face detection (replace with actual YOLOv8 API call in production)
    // For now, keep a stable single face in demo mode
    const confidence = 0.9 + Math.random() * 0.1;
    const faceCount = DEMO_MODE ? 1 : (Math.random() > 0.95 ? (Math.random() > 0.5 ? 0 : 2) : 1);
    
    if (faceCount === 1 && ctx && canvas) {
        const w = canvas.width;
        const h = canvas.height;
        const boxW = w * 0.35;
        const boxH = h * 0.45;
        const boxX = (w - boxW) / 2;
        const boxY = (h - boxH) / 2.5;

        // Draw bounding box (YOLOv8 style)
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 3;
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        // Draw confidence
        ctx.fillStyle = '#00ff00';
        ctx.font = 'bold 16px monospace';
        ctx.fillText(`Face ${(confidence * 100).toFixed(1)}%`, boxX, boxY - 8);

        // Draw corner markers
        const cornerLen = 20;
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 4;
        
        // Top-left
        ctx.beginPath();
        ctx.moveTo(boxX, boxY + cornerLen);
        ctx.lineTo(boxX, boxY);
        ctx.lineTo(boxX + cornerLen, boxY);
        ctx.stroke();
        
        // Top-right
        ctx.beginPath();
        ctx.moveTo(boxX + boxW - cornerLen, boxY);
        ctx.lineTo(boxX + boxW, boxY);
        ctx.lineTo(boxX + boxW, boxY + cornerLen);
        ctx.stroke();
        
        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(boxX, boxY + boxH - cornerLen);
        ctx.lineTo(boxX, boxY + boxH);
        ctx.lineTo(boxX + cornerLen, boxY + boxH);
        ctx.stroke();
        
        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(boxX + boxW - cornerLen, boxY + boxH);
        ctx.lineTo(boxX + boxW, boxY + boxH);
        ctx.lineTo(boxX + boxW, boxY + boxH - cornerLen);
        ctx.stroke();
    }

    return { count: faceCount, confidence };
}

function lockVerification(reason) {
    verificationLocked = true;
    lockReason = reason;
    
    // Stop camera
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }
    
    // Stop detection
    if (faceDetectionFrame) {
        cancelAnimationFrame(faceDetectionFrame);
    }
    detectionLoopActive = false;
    
    showVerificationLocked();
}

function showVerificationLocked() {
    const placeholder = document.getElementById('cameraPlaceholder');
    if (placeholder) {
        placeholder.style.display = 'flex';
        placeholder.innerHTML = `
            <div class="text-center p-4">
                <div class="mb-3">
                    <span class="material-symbols-outlined" style="font-size: 64px;">block</span>
                </div>
                <h2 class="h4 mb-2">Verification Locked</h2>
                <p class="text-muted mb-3">${lockReason}</p>
                <button onclick="returnToLaunch()" class="btn btn-dark">Return to Launch</button>
            </div>
        `;
    }
    
    // Hide video
    const videoElement = document.getElementById('videoElement');
    if (videoElement) {
        videoElement.style.display = 'none';
    }
    
    // Disable buttons
    const readyButton = document.querySelector('[data-ready-button]');
    if (readyButton) {
        readyButton.disabled = true;
        readyButton.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

function completeVerificationStep(step) {
    // Simple step progression helper for UI updates
    verificationStep = Math.max(verificationStep, step + 1);
    if (step >= 3) {
        verificationComplete = true;
        enableReadyButton();
    }
    updateVerificationCards();
}

function returnToLaunch() {
    if (window.electronAPI && window.electronAPI.navigateTo) {
        window.electronAPI.navigateTo('launch');
    } else {
        window.location.href = 'launch.html';
    }
}

async function setupFaceDetection(videoElement) {
    // Legacy fallback - use YOLOv8 instead
    setupYOLOv8Detection(videoElement);
}

function startVerificationProcess() {
    verificationProgress = 0;
    verificationStep = 1;
    verificationComplete = false;

    verificationInterval = setInterval(() => {
        const progressBar = document.querySelector('[data-progress-bar]');

        if (faceDetected) {
            verificationProgress += 1.0;
        } else {
            verificationProgress = Math.max(0, verificationProgress - 1.0);
        }

        if (identityMatched) {
            verificationProgress += 1.2;
        }

        if (livenessPassed) {
            verificationProgress += 2.0;
        }

        verificationProgress = Math.min(verificationProgress, 100);
        if (progressBar) {
            progressBar.style.width = `${verificationProgress}%`;
        }

        updateVerificationCards();

        if (faceDetected && identityMatched && livenessPassed) {
            verificationProgress = 100;
            if (progressBar) {
                progressBar.style.width = '100%';
            }
            verificationComplete = true;
            enableReadyButton();

            if (!biometricSaved) {
                saveBiometricSnapshot();
            }
        }
    }, 200);
}

async function saveBiometricSnapshot() {
    biometricSaved = true;

    const userId = Number(localStorage.getItem('currentUserId'));
    const videoElement = document.getElementById('videoElement');
    if (!userId || !videoElement) return;

    try {
        const canvas = document.createElement('canvas');
        canvas.width = videoElement.videoWidth;
        canvas.height = videoElement.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL('image/jpeg', 0.7);

        if (window.electronAPI && window.electronAPI.saveBiometricData) {
            await window.electronAPI.saveBiometricData(userId, 'face', {
                capturedAt: new Date().toISOString(),
                imageData
            });
        }
    } catch (error) {
        console.warn('Failed to save biometric snapshot:', error);
    }
}

function updateVerificationCards() {
    const cards = document.querySelectorAll('[data-step-card]');
    const currentStep = verificationComplete
        ? 4
        : livenessPassed
            ? 3
            : identityMatched
                ? 2
                : 1;
    const stepText = document.querySelector('[data-step-text]');
    if (stepText) {
        stepText.textContent = `Step ${currentStep} of 4`;
    }
    const states = [
        faceDetected ? 'completed' : 'active',
        identityMatched ? 'completed' : (faceDetected ? 'active' : 'pending'),
        livenessPassed ? 'completed' : (identityMatched ? 'active' : 'pending'),
        verificationComplete ? 'completed' : 'pending'
    ];

    cards.forEach((card, index) => {
        const state = states[index] || 'pending';
        const icon = card.querySelector('.material-symbols-outlined');
        const text = card.querySelector('[data-step-status]');

        card.classList.remove('completed', 'active', 'pending');
        card.classList.add(state);

        if (state === 'completed') {
            if (icon) icon.textContent = 'check';
            if (text) text.textContent = 'Completed successfully';
        } else if (state === 'active') {
            if (icon) icon.textContent = 'sync';
            if (text) text.textContent = 'Processing...';
        } else {
            if (icon) icon.textContent = 'hourglass_empty';
            if (text) text.textContent = 'Pending';
        }
    });
}

function enableReadyButton() {
    const readyButton = document.querySelector('[data-ready-button]');
    if (readyButton) {
        readyButton.disabled = false;
        readyButton.classList.add('ready-glow');
    }
}

function updateConfidenceUI(value) {
    const confidenceEl = document.getElementById('confidenceValue');
    if (confidenceEl) {
        confidenceEl.textContent = typeof value === 'number' ? `${value}%` : value;
    }
}

function updateFaceStatusUI(isDetected, label) {
    const faceStatus = document.getElementById('faceStatusValue');
    if (faceStatus) {
        faceStatus.textContent = label || (isDetected ? 'Detected' : 'Searching');
    }
}

function updateLightLevelUI(videoElement) {
    const lightLevelEl = document.getElementById('lightLevelValue');
    if (!lightLevelEl) return;

    try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
            total += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        const avg = total / (data.length / 4);
        if (avg > 180) {
            lightLevelEl.textContent = 'Bright';
        } else if (avg > 110) {
            lightLevelEl.textContent = 'Optimal';
        } else {
            lightLevelEl.textContent = 'Low';
        }
    } catch (error) {
        lightLevelEl.textContent = '--';
    }
}

function navigateToExam() {
    // Stop camera
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }

    if (faceDetectionFrame) {
        cancelAnimationFrame(faceDetectionFrame);
        faceDetectionFrame = null;
    }
    detectionLoopActive = false;
    
    if (window.electronAPI && window.electronAPI.navigateTo) {
        window.electronAPI.navigateTo('exam');
    } else {
        window.location.href = 'exam.html';
    }
}

// Button handlers
document.addEventListener('DOMContentLoaded', () => {
    const cancelButton = document.querySelector('[data-cancel-button]');
    if (cancelButton) {
        cancelButton.addEventListener('click', () => {
            if (cameraStream) {
                cameraStream.getTracks().forEach(track => track.stop());
            }
            if (faceDetectionFrame) {
                cancelAnimationFrame(faceDetectionFrame);
                faceDetectionFrame = null;
            }
            detectionLoopActive = false;
            if (window.electronAPI && window.electronAPI.navigateTo) {
                window.electronAPI.navigateTo('launch');
            } else {
                window.location.href = 'launch.html';
            }
        });
    }

    const readyButton = document.querySelector('[data-ready-button]');
    if (readyButton) {
        readyButton.addEventListener('click', async () => {
            if (!verificationComplete) {
                if (!cameraStream) {
                    await initializeVerification();
                }
                if (verificationLocked) {
                    return;
                }
                if (!verificationComplete) {
                    alert('Please wait for face verification to complete.');
                    return;
                }
                navigateToExam();
                return;
            }

            // Verification already complete, navigate immediately
            navigateToExam();
        });
    }
    
    // Auto-start verification
    setTimeout(() => {
        initializeVerification();
    }, 500);
});

window.addEventListener('beforeunload', () => {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }
    if (cameraMonitorInterval) {
        clearInterval(cameraMonitorInterval);
    }
    if (backendVerifyInterval) {
        clearInterval(backendVerifyInterval);
    }
});

// Warning management functions
function clearWarnings() {
    currentWarnings = [];
    const warningContainer = document.getElementById('warningContainer');
    console.log('clearWarnings - container found:', !!warningContainer);
    if (warningContainer) {
        warningContainer.innerHTML = '';
        warningContainer.style.display = 'none';
    }
}

function addWarning(message, level = 'warning') {
    console.log('addWarning called:', message, level);
    if (currentWarnings.includes(message)) {
        console.log('Warning already exists, skipping');
        return;
    }
    
    currentWarnings.push(message);
    const warningContainer = document.getElementById('warningContainer');
    console.log('Warning container found:', !!warningContainer);
    if (!warningContainer) {
        console.error('Warning container NOT FOUND in DOM!');
        return;
    }
    
    const warningDiv = document.createElement('div');
    warningDiv.className = `warning-item warning-${level}`;
    warningDiv.textContent = message;
    warningContainer.appendChild(warningDiv);
    warningContainer.style.display = 'block';
    console.log('Warning added to DOM, display:', warningContainer.style.display);
}

function updateScoreDisplay() {
    // Update face confidence
    const faceScoreEl = document.getElementById('faceScore');
    if (faceScoreEl) {
        const score = Math.round(detectionScores.faceConfidence * 100);
        faceScoreEl.textContent = `${score}%`;
        faceScoreEl.className = score >= 70 ? 'score-good' : score >= 50 ? 'score-medium' : 'score-low';
    }
    
    // Update liveness score
    const livenessScoreEl = document.getElementById('livenessScore');
    if (livenessScoreEl) {
        const score = Math.round(detectionScores.motionScore * 100);
        livenessScoreEl.textContent = `Motion: ${score}% | Eyes: ${detectionScores.eyesDetected}`;
        livenessScoreEl.className = detectionScores.livenessScore > 0 ? 'score-good' : 'score-low';
    }
    
    // Update identity score
    const identityScoreEl = document.getElementById('identityScore');
    if (identityScoreEl) {
        const score = Math.round(detectionScores.identityScore * 100);
        identityScoreEl.textContent = `${score}%`;
        identityScoreEl.className = score >= 70 ? 'score-good' : score >= 50 ? 'score-medium' : 'score-low';
    }
}
