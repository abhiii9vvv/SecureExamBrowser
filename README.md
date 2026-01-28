# Secure Exam Browser

A secure, locked-down browser application for conducting online examinations with enhanced security features.

## Features

- **Kiosk Mode**: Full-screen locked environment preventing access to other applications
- **Security Controls**: Disables screenshot, copy/paste, and system shortcuts
- **Exam Management**: Launch, take, and submit exams securely
- **Database Integration**: MySQL backend for storing exam data and submissions
- **Modern UI**: Clean, responsive interface built with HTML/CSS/JavaScript

## Prerequisites

- Node.js (v14 or higher)
- MySQL database
- Windows OS

## Installation

```bash
# Clone the repository
git clone https://github.com/abhiii9vvv/SecureExamBrowser.git

# Navigate to project directory
cd SecureExamBrowser

# Install dependencies
npm install
```

## Configuration

1. Set up MySQL database using the schema in `database/schema.sql`
2. Configure database connection in `database/config.js`

## Usage

```bash
# Run the application
npm start
```

## Project Structure

- `/ui` - User interface files (HTML, CSS, JavaScript)
- `/database` - Database configuration and schema
- `/assets` - Static resources
- `preload.js` - Electron preload script
- `script.js` - Main application logic

## Documentation

- [How to Run](HOW_TO_RUN.md)
- [Development Mode](DEVELOPMENT_MODE.md)
- [Admin Exit Guide](ADMIN_EXIT_GUIDE.md)
- [Integration Guide](INTEGRATION_GUIDE.md)

## License

MIT

## Author

Abhinav

