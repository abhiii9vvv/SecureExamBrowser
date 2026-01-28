// ============================================
// DATABASE CONFIGURATION
// ============================================

module.exports = {
    // MySQL Connection Settings
    development: {
        host: 'localhost',
        port: 3306,
        user: 'root',  // Change this to your MySQL username
        password: 'abhiii9vvv',  // Change this to your MySQL password
        database: 'secure_exam_browser',
        charset: 'utf8mb4',
        timezone: '+00:00',
        
        // Connection Pool Settings
        connectionLimit: 10,
        queueLimit: 0,
        waitForConnections: true,
        
        // SSL Settings (for production)
        ssl: false
    },
    
    production: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'exam_app',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'secure_exam_browser',
        charset: 'utf8mb4',
        timezone: '+00:00',
        
        // Connection Pool Settings
        connectionLimit: 50,
        queueLimit: 0,
        waitForConnections: true,
        
        // SSL Settings (recommended for production)
        ssl: {
            rejectUnauthorized: false
        }
    },
    
    test: {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        database: 'secure_exam_browser_test',
        charset: 'utf8mb4',
        timezone: '+00:00',
        connectionLimit: 5
    }
};

// ============================================
// INSTRUCTIONS FOR SETUP
// ============================================

/*
STEP 1: Install MySQL
-----------------------
1. Download MySQL from: https://dev.mysql.com/downloads/mysql/
2. Install MySQL Server (choose version 8.0 or higher)
3. During installation, set a root password
4. Make sure MySQL service is running

STEP 2: Configure Database Connection
---------------------------------------
1. Open this file (database/config.js)
2. Update the 'development' section:
   - user: Your MySQL username (default: 'root')
   - password: Your MySQL password
   - host: Usually 'localhost' for local development

STEP 3: Create Database and Tables
------------------------------------
Option A: Using MySQL Workbench (GUI):
1. Open MySQL Workbench
2. Connect to your MySQL server
3. Click "File" → "Open SQL Script"
4. Select the schema.sql file
5. Click the lightning bolt icon to execute

Option B: Using Command Line:
1. Open Command Prompt/Terminal
2. Run: mysql -u root -p < database/schema.sql
3. Enter your MySQL password when prompted

STEP 4: Test Connection
-------------------------
1. Run: npm start
2. Check console for "Database connected successfully"
3. If error, verify your credentials in this config file

SECURITY NOTES:
----------------
- NEVER commit real passwords to version control
- For production, use environment variables
- Create a dedicated MySQL user (not root) for the app
- Enable SSL for production databases
- Regularly backup your database

COMMON ISSUES:
--------------
Issue: "Access denied for user"
Solution: Check username/password in config

Issue: "Database does not exist"
Solution: Run schema.sql to create database

Issue: "Can't connect to MySQL server"
Solution: Make sure MySQL service is running

Issue: "SSL connection error"
Solution: Set ssl: false in development config
*/
