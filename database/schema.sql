-- CREATE DATABASE IF NOT EXISTS secure_exam_browser;
-- USE secure_exam_browser;

-- CREATE TABLE users(
-- 	user_id INT PRIMARY KEY AUTO_INCREMENT,
-- 	username VARCHAR(50) UNIQUE NOT NULL,
--     password_hash VARCHAR(255) NOT NULL,
--     full_name VARCHAR(100) NOT NULL,
--     email VARCHAR(100) UNIQUE NOT NULL,
--     student_id VARCHAR(50) UNIQUE,
--     role ENUM('student','instructor','admin') DEFAULT 'student',
--     is_active BOOLEAN DEFAULT TRUE,
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--     INDEX idx_username (username),
--     INDEX idx_email (email),
--     INDEX idx_student_id (student_id)
-- );

SELECT * FROM users;