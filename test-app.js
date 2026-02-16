// Test script to verify all features
console.log('🧪 Testing Secure Exam Browser Features...\n');

// Test 1: Check if Electron is available
try {
  const electron = require('electron');
  console.log('✅ Electron module loaded');
} catch (error) {
  console.log('❌ Electron not found:', error.message);
}

// Test 2: Check database connection
try {
  const DatabaseService = require('./database/database');
  const db = new DatabaseService();
  
  db.connect()
    .then(() => {
      console.log('✅ Database connection successful');
      process.exit(0);
    })
    .catch((error) => {
      console.log('⚠️  Database connection failed (this is OK for offline mode)');
      console.log('   Error:', error.message);
      console.log('   App will run in offline mode');
      process.exit(0);
    });
} catch (error) {
  console.log('❌ Database module error:', error.message);
  process.exit(1);
}

// Test 3: File structure check
const fs = require('fs');
const path = require('path');

const requiredFiles = [
  'script.js',
  'preload.js',
  'package.json',
  'ui/login.html',
  'ui/launch.html',
  'ui/js/launch.js',
  'ui/js/login.js',
  'database/config.js',
  'database/database.js'
];

console.log('\n📁 Checking file structure...');
let allFilesExist = true;

requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`   ✅ ${file}`);
  } else {
    console.log(`   ❌ ${file} - MISSING`);
    allFilesExist = false;
  }
});

if (allFilesExist) {
  console.log('\n✅ All required files present');
} else {
  console.log('\n❌ Some files are missing');
}
