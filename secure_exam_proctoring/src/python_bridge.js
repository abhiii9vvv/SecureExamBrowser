/**
 * Python Process Manager - Handles face detection subprocess
 */

const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class PythonFaceDetectionBridge extends EventEmitter {
    constructor() {
        super();
        this.pythonProcess = null;
        this.isRunning = false;
    }

    /**
     * Start the face detection process
     * @param {string} examId - Exam ID for proctoring session
     */
    startDetection(examId) {
        if (this.isRunning) {
            console.warn('Face detection already running');
            return;
        }

        const pythonScript = path.join(__dirname, 'face_detection.py');
        
        try {
            this.pythonProcess = spawn('python', [pythonScript], {
                cwd: path.join(__dirname, '..'),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.isRunning = true;

            // Handle stdout
            this.pythonProcess.stdout.on('data', (data) => {
                const message = data.toString().trim();
                console.log('[Python]', message);
                this.emit('message', { type: 'log', data: message });
            });

            // Handle stderr
            this.pythonProcess.stderr.on('data', (data) => {
                const error = data.toString().trim();
                console.error('[Python Error]', error);
                this.emit('error', { type: 'python_error', data: error });
            });

            // Handle process exit
            this.pythonProcess.on('exit', (code) => {
                this.isRunning = false;
                console.log(`Face detection process exited with code ${code}`);
                this.emit('exit', { code });
            });

            this.emit('started', { examId });
            console.log(`✓ Face detection started for exam ${examId}`);

        } catch (error) {
            console.error('Failed to start face detection:', error);
            this.emit('error', { type: 'start_error', data: error.message });
        }
    }

    /**
     * Stop the face detection process
     */
    stopDetection() {
        if (!this.isRunning || !this.pythonProcess) {
            console.warn('Face detection not running');
            return;
        }

        try {
            this.pythonProcess.kill();
            this.isRunning = false;
            this.emit('stopped', {});
            console.log('✓ Face detection stopped');
        } catch (error) {
            console.error('Error stopping face detection:', error);
            this.emit('error', { type: 'stop_error', data: error.message });
        }
    }

    /**
     * Check if detection is running
     */
    isDetectionRunning() {
        return this.isRunning;
    }

    /**
     * Get detection status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            pid: this.pythonProcess?.pid || null
        };
    }
}

module.exports = PythonFaceDetectionBridge;
