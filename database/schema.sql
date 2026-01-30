CREATE DATABASE IF NOT EXISTS secure_exam_browser;
USE secure_exam_browser;

CREATE TABLE IF NOT EXISTS users (
	user_id INT PRIMARY KEY AUTO_INCREMENT,
	username VARCHAR(50) UNIQUE NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	full_name VARCHAR(100) NOT NULL,
	email VARCHAR(100) UNIQUE NOT NULL,
	student_id VARCHAR(50) UNIQUE,
	role ENUM('student','instructor','admin') DEFAULT 'student',
	trust_score DECIMAL(5,2) DEFAULT 100.00,
	is_active BOOLEAN DEFAULT TRUE,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	INDEX idx_username (username),
	INDEX idx_email (email),
	INDEX idx_student_id (student_id)
);

CREATE TABLE IF NOT EXISTS exams (
	exam_id INT PRIMARY KEY AUTO_INCREMENT,
	exam_name VARCHAR(150) NOT NULL,
	exam_code VARCHAR(50) UNIQUE NOT NULL,
	exam_url VARCHAR(255) NOT NULL,
	allowed_domains JSON,
	duration_minutes INT NOT NULL,
	start_time DATETIME NOT NULL,
	end_time DATETIME NOT NULL,
	security_level TINYINT DEFAULT 3,
	created_by INT NOT NULL,
	is_active BOOLEAN DEFAULT TRUE,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	INDEX idx_exam_code (exam_code),
	INDEX idx_exam_time (start_time, end_time),
	CONSTRAINT fk_exams_created_by FOREIGN KEY (created_by) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS exam_questions (
	question_id INT PRIMARY KEY AUTO_INCREMENT,
	exam_id INT NOT NULL,
	question_text TEXT NOT NULL,
	options JSON NOT NULL,
	correct_index INT,
	points DECIMAL(6,2) DEFAULT 1.00,
	order_index INT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	INDEX idx_exam_question_order (exam_id, order_index),
	CONSTRAINT fk_exam_questions_exam FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exam_sessions (
	session_id INT PRIMARY KEY AUTO_INCREMENT,
	user_id INT NOT NULL,
	exam_id INT NOT NULL,
	session_token VARCHAR(100) UNIQUE NOT NULL,
	ip_address VARCHAR(45),
	machine_info JSON,
	status ENUM('active','completed','terminated','expired') DEFAULT 'active',
	started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	ended_at TIMESTAMP NULL,
	last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	INDEX idx_session_status (status),
	INDEX idx_session_user_exam (user_id, exam_id),
	CONSTRAINT fk_exam_sessions_user FOREIGN KEY (user_id) REFERENCES users(user_id),
	CONSTRAINT fk_exam_sessions_exam FOREIGN KEY (exam_id) REFERENCES exams(exam_id)
);

CREATE TABLE IF NOT EXISTS exam_answers (
	answer_id INT PRIMARY KEY AUTO_INCREMENT,
	session_id INT NOT NULL,
	question_id INT NOT NULL,
	answer_index INT NOT NULL,
	is_flagged BOOLEAN DEFAULT FALSE,
	answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY uniq_session_question (session_id, question_id),
	CONSTRAINT fk_exam_answers_session FOREIGN KEY (session_id) REFERENCES exam_sessions(session_id) ON DELETE CASCADE,
	CONSTRAINT fk_exam_answers_question FOREIGN KEY (question_id) REFERENCES exam_questions(question_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exam_submissions (
	submission_id INT PRIMARY KEY AUTO_INCREMENT,
	session_id INT NOT NULL,
	submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	time_remaining INT DEFAULT 0,
	answers JSON NOT NULL,
	flags JSON,
	status ENUM('submitted','failed') DEFAULT 'submitted',
	CONSTRAINT fk_exam_submissions_session FOREIGN KEY (session_id) REFERENCES exam_sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_logs (
	activity_id INT PRIMARY KEY AUTO_INCREMENT,
	session_id INT NOT NULL,
	activity_type VARCHAR(50) NOT NULL,
	activity_data JSON,
	url VARCHAR(255),
	timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	INDEX idx_activity_session (session_id),
	CONSTRAINT fk_activity_logs_session FOREIGN KEY (session_id) REFERENCES exam_sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS violations (
	violation_id INT PRIMARY KEY AUTO_INCREMENT,
	session_id INT NOT NULL,
	violation_type VARCHAR(50) NOT NULL,
	description TEXT,
	severity ENUM('low','medium','high','critical') DEFAULT 'medium',
	evidence JSON,
	timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	INDEX idx_violation_session (session_id),
	CONSTRAINT fk_violations_session FOREIGN KEY (session_id) REFERENCES exam_sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_checkpoints (
	checkpoint_id INT PRIMARY KEY AUTO_INCREMENT,
	session_id INT NOT NULL,
	state_snapshot JSON NOT NULL,
	progress_percentage DECIMAL(5,2) DEFAULT 0,
	timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	INDEX idx_checkpoint_session (session_id),
	CONSTRAINT fk_checkpoints_session FOREIGN KEY (session_id) REFERENCES exam_sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS biometric_data (
	user_id INT PRIMARY KEY,
	face_descriptor JSON NOT NULL,
	has_face_data BOOLEAN DEFAULT FALSE,
	enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT fk_biometric_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS typing_patterns (
	user_id INT PRIMARY KEY,
	avg_wpm DECIMAL(6,2),
	keystroke_dynamics JSON,
	samples_collected INT DEFAULT 0,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT fk_typing_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE OR REPLACE VIEW v_active_sessions AS
SELECT
	s.session_id,
	s.user_id,
	u.full_name,
	u.student_id,
	s.exam_id,
	e.exam_name,
	e.exam_code,
	s.status,
	s.started_at,
	s.last_activity
FROM exam_sessions s
JOIN users u ON u.user_id = s.user_id
JOIN exams e ON e.exam_id = s.exam_id
WHERE s.status = 'active';

CREATE OR REPLACE VIEW v_exam_statistics AS
SELECT
	e.exam_id,
	e.exam_name,
	COUNT(DISTINCT s.session_id) AS total_sessions,
	SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) AS active_sessions,
	SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completed_sessions,
	COUNT(v.violation_id) AS total_violations
FROM exams e
LEFT JOIN exam_sessions s ON s.exam_id = e.exam_id
LEFT JOIN violations v ON v.session_id = s.session_id
GROUP BY e.exam_id, e.exam_name;