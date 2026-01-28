// ============================================
// DATABASE SERVICE
// Handles all database operations
// ============================================

const mysql = require('mysql2/promise');
const dbConfig = require('./config');

class DatabaseService {
    constructor() {
        this.pool = null;
        this.environment = process.env.NODE_ENV || 'development';
    }

    /**
     * Initialize database connection pool
     */
    async connect() {
        try {
            const config = dbConfig[this.environment];
            
            this.pool = mysql.createPool({
                host: config.host,
                port: config.port,
                user: config.user,
                password: config.password,
                database: config.database,
                charset: config.charset,
                timezone: config.timezone,
                connectionLimit: config.connectionLimit,
                queueLimit: config.queueLimit,
                waitForConnections: config.waitForConnections,
                ssl: config.ssl
            });

            // Test connection
            const connection = await this.pool.getConnection();
            console.log('✅ Database connected successfully!');
            console.log(`   Environment: ${this.environment}`);
            console.log(`   Database: ${config.database}`);
            console.log(`   Host: ${config.host}:${config.port}`);
            connection.release();
            
            return true;
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            console.error('   Check your database configuration in database/config.js');
            throw error;
        }
    }

    /**
     * Execute a query with parameters (prevents SQL injection)
     * @param {string} sql - SQL query with ? placeholders
     * @param {array} params - Parameters to bind to query
     */
    async query(sql, params = []) {
        try {
            const [rows] = await this.pool.execute(sql, params);
            return rows;
        } catch (error) {
            console.error('Query error:', error.message);
            console.error('SQL:', sql);
            throw error;
        }
    }

    /**
     * Execute a query and return single row
     */
    async queryOne(sql, params = []) {
        const rows = await this.query(sql, params);
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Begin a transaction
     */
    async beginTransaction() {
        const connection = await this.pool.getConnection();
        await connection.beginTransaction();
        return connection;
    }

    /**
     * Commit a transaction
     */
    async commit(connection) {
        await connection.commit();
        connection.release();
    }

    /**
     * Rollback a transaction
     */
    async rollback(connection) {
        await connection.rollback();
        connection.release();
    }

    /**
     * Close all connections (for graceful shutdown)
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('Database connections closed');
        }
    }

    // ============================================
    // USER OPERATIONS
    // ============================================

    /**
     * Create a new user
     */
    async createUser(userData) {
        const sql = `
            INSERT INTO users (username, password_hash, full_name, email, student_id, role)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const params = [
            userData.username,
            userData.password_hash,
            userData.full_name,
            userData.email,
            userData.student_id || null,
            userData.role || 'student'
        ];
        
        const result = await this.query(sql, params);
        return result.insertId;
    }

    /**
     * Get user by username
     */
    async getUserByUsername(username) {
        const sql = 'SELECT * FROM users WHERE username = ? AND is_active = TRUE';
        return await this.queryOne(sql, [username]);
    }

    /**
     * Get user by ID
     */
    async getUserById(userId) {
        const sql = 'SELECT * FROM users WHERE user_id = ?';
        return await this.queryOne(sql, [userId]);
    }

    /**
     * Update user trust score
     */
    async updateTrustScore(userId) {
        const sql = 'CALL sp_update_trust_score(?)';
        await this.query(sql, [userId]);
    }

    // ============================================
    // EXAM OPERATIONS
    // ============================================

    /**
     * Create a new exam
     */
    async createExam(examData) {
        const sql = `
            INSERT INTO exams (exam_name, exam_code, exam_url, allowed_domains, 
                             duration_minutes, start_time, end_time, security_level, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
            examData.exam_name,
            examData.exam_code,
            examData.exam_url,
            JSON.stringify(examData.allowed_domains || []),
            examData.duration_minutes,
            examData.start_time,
            examData.end_time,
            examData.security_level || 3,
            examData.created_by
        ];
        
        const result = await this.query(sql, params);
        return result.insertId;
    }

    /**
     * Get all active exams
     */
    async getActiveExams() {
        const sql = `
            SELECT * FROM exams 
            WHERE is_active = TRUE 
            AND NOW() BETWEEN start_time AND end_time
            ORDER BY start_time ASC
        `;
        return await this.query(sql);
    }

    /**
     * Get exam by code
     */
    async getExamByCode(examCode) {
        const sql = 'SELECT * FROM exams WHERE exam_code = ? AND is_active = TRUE';
        return await this.queryOne(sql, [examCode]);
    }

    // ============================================
    // SESSION OPERATIONS
    // ============================================

    /**
     * Start a new exam session
     */
    async startSession(sessionData) {
        const sql = 'CALL sp_start_exam_session(?, ?, ?, ?, ?)';
        const params = [
            sessionData.user_id,
            sessionData.exam_id,
            sessionData.session_token,
            sessionData.ip_address,
            JSON.stringify(sessionData.machine_info)
        ];
        
        const result = await this.query(sql, params);
        return result[0][0].session_id;
    }

    /**
     * End an exam session
     */
    async endSession(sessionId, status = 'completed') {
        const sql = 'CALL sp_end_exam_session(?, ?)';
        await this.query(sql, [sessionId, status]);
    }

    /**
     * Get active session for user
     */
    async getActiveSession(userId, examId) {
        const sql = `
            SELECT * FROM exam_sessions 
            WHERE user_id = ? AND exam_id = ? AND status = 'active'
            ORDER BY started_at DESC LIMIT 1
        `;
        return await this.queryOne(sql, [userId, examId]);
    }

    /**
     * Get session by token
     */
    async getSessionByToken(sessionToken) {
        const sql = 'SELECT * FROM exam_sessions WHERE session_token = ?';
        return await this.queryOne(sql, [sessionToken]);
    }

    // ============================================
    // ACTIVITY LOGGING
    // ============================================

    /**
     * Log an activity
     */
    async logActivity(activityData) {
        const sql = 'CALL sp_log_activity(?, ?, ?, ?)';
        const params = [
            activityData.session_id,
            activityData.activity_type,
            JSON.stringify(activityData.activity_data),
            activityData.url || null
        ];
        await this.query(sql, params);
    }

    /**
     * Get activities for a session
     */
    async getSessionActivities(sessionId, limit = 100) {
        const sql = `
            SELECT * FROM activity_logs 
            WHERE session_id = ? 
            ORDER BY timestamp DESC LIMIT ?
        `;
        return await this.query(sql, [sessionId, limit]);
    }

    // ============================================
    // VIOLATION OPERATIONS
    // ============================================

    /**
     * Record a violation
     */
    async recordViolation(violationData) {
        const sql = `
            INSERT INTO violations (session_id, violation_type, description, severity, evidence)
            VALUES (?, ?, ?, ?, ?)
        `;
        const params = [
            violationData.session_id,
            violationData.violation_type,
            violationData.description,
            violationData.severity || 'medium',
            JSON.stringify(violationData.evidence || {})
        ];
        
        const result = await this.query(sql, params);
        return result.insertId;
    }

    /**
     * Get violations for a session
     */
    async getSessionViolations(sessionId) {
        const sql = 'SELECT * FROM violations WHERE session_id = ? ORDER BY timestamp DESC';
        return await this.query(sql, [sessionId]);
    }

    // ============================================
    // CHECKPOINT OPERATIONS (Session Recovery)
    // ============================================

    /**
     * Save session checkpoint
     */
    async saveCheckpoint(checkpointData) {
        const sql = `
            INSERT INTO session_checkpoints (session_id, state_snapshot, progress_percentage)
            VALUES (?, ?, ?)
        `;
        const params = [
            checkpointData.session_id,
            JSON.stringify(checkpointData.state_snapshot),
            checkpointData.progress_percentage
        ];
        await this.query(sql, params);
    }

    /**
     * Get latest checkpoint for session
     */
    async getLatestCheckpoint(sessionId) {
        const sql = `
            SELECT * FROM session_checkpoints 
            WHERE session_id = ? 
            ORDER BY timestamp DESC LIMIT 1
        `;
        return await this.queryOne(sql, [sessionId]);
    }

    // ============================================
    // ANALYTICS OPERATIONS
    // ============================================

    /**
     * Get dashboard statistics
     */
    async getDashboardStats() {
        const sql = `
            SELECT 
                (SELECT COUNT(*) FROM exam_sessions WHERE status = 'active') as active_sessions,
                (SELECT COUNT(*) FROM exam_sessions WHERE DATE(started_at) = CURDATE()) as today_exams,
                (SELECT COUNT(*) FROM violations WHERE DATE(timestamp) = CURDATE()) as today_violations,
                (SELECT COUNT(DISTINCT user_id) FROM exam_sessions WHERE DATE(started_at) = CURDATE()) as active_students
        `;
        return await this.queryOne(sql);
    }

    /**
     * Get exam statistics
     */
    async getExamStats(examId) {
        const sql = 'SELECT * FROM v_exam_statistics WHERE exam_id = ?';
        return await this.queryOne(sql, [examId]);
    }

    /**
     * Get active sessions view
     */
    async getActiveSessions() {
        const sql = 'SELECT * FROM v_active_sessions ORDER BY started_at DESC';
        return await this.query(sql);
    }

    // ============================================
    // BIOMETRIC OPERATIONS
    // ============================================

    /**
     * Save biometric data
     */
    async saveBiometricData(userId, biometricType, data) {
        const sql = `
            INSERT INTO biometric_data (user_id, face_descriptor, has_face_data)
            VALUES (?, ?, TRUE)
            ON DUPLICATE KEY UPDATE 
                face_descriptor = VALUES(face_descriptor),
                has_face_data = TRUE,
                enrolled_at = CURRENT_TIMESTAMP
        `;
        await this.query(sql, [userId, JSON.stringify(data)]);
    }

    /**
     * Get biometric data
     */
    async getBiometricData(userId) {
        const sql = 'SELECT * FROM biometric_data WHERE user_id = ?';
        return await this.queryOne(sql, [userId]);
    }

    // ============================================
    // TYPING PATTERN OPERATIONS
    // ============================================

    /**
     * Save typing pattern
     */
    async saveTypingPattern(userId, patternData) {
        const sql = `
            INSERT INTO typing_patterns (user_id, avg_wpm, keystroke_dynamics, samples_collected)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                avg_wpm = VALUES(avg_wpm),
                keystroke_dynamics = VALUES(keystroke_dynamics),
                samples_collected = samples_collected + 1
        `;
        const params = [
            userId,
            patternData.avg_wpm,
            JSON.stringify(patternData.keystroke_dynamics),
            1
        ];
        await this.query(sql, params);
    }

    /**
     * Get typing pattern
     */
    async getTypingPattern(userId) {
        const sql = 'SELECT * FROM typing_patterns WHERE user_id = ?';
        return await this.queryOne(sql, [userId]);
    }
}

// Export the class (not an instance)
module.exports = DatabaseService;
