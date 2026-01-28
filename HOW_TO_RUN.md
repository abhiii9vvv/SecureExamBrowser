# 🚀 HOW TO RUN - Secure Exam Browser

## Quick Start (3 Steps)

### Step 1: Install Dependencies

**Double-click:** `INSTALL.bat`

This will install all required packages:
- Electron (the app framework)
- MySQL2 (database driver)
- Bcrypt (password encryption)

Wait for it to complete (~2-5 minutes depending on internet speed).

---

### Step 2: Start the Application

**Choose one method:**

#### Method A: Using START.bat (Recommended)
**Double-click:** `START.bat`

#### Method B: Using Direct Launch
**Double-click:** `START_DIRECT.bat`

#### Method C: Using Command Line
Open PowerShell in this folder and run:
```powershell
cmd /c npm start
```

---

### Step 3: Exit the Application

**Press:** `Ctrl + Alt + Shift + Q`

Then click "Exit Exam" in the dialog box.

---

## 🧪 Testing

### Test the Application Structure
**Double-click:** `TEST.bat`

This checks:
- ✅ All required files exist
- ✅ Database connection (optional)
- ✅ Electron is installed

---

## 🐛 Troubleshooting

### Problem: "npm is not recognized"

**Solution 1:** Install Node.js
1. Download from: https://nodejs.org/
2. Install the LTS version
3. Restart your computer
4. Run INSTALL.bat again

**Solution 2:** Use Direct Launch
- Just double-click `START_DIRECT.bat`

---

### Problem: INSTALL.bat doesn't work

**Solution:** Install manually via PowerShell
```powershell
cd "e:\PROJECT\Secure Exam Browser"
cmd /c npm install
```

---

### Problem: App won't start

**Check 1:** Did you run INSTALL.bat first?
- If not, run it now

**Check 2:** Is Node.js installed?
```powershell
cmd /c node --version
```
Should show: v18.x.x or higher

**Check 3:** Try direct launch
- Use `START_DIRECT.bat`

---

### Problem: Database connection fails

**This is OK!** The app works without a database in offline mode.

To set up the database (optional):
1. Install MySQL 8.0+
2. Edit `database/config.js` with your credentials
3. Run: `mysql -u root -p < database/schema.sql`

---

### Problem: Can't exit the app

**Solution 1:** Admin Shortcut
- Press `Ctrl + Alt + Shift + Q`

**Solution 2:** Task Manager
1. Press `Ctrl + Shift + Esc`
2. Find "Secure Exam Browser" or "Electron"
3. Click "End Task"

---

### Problem: Shortcuts are blocked

**This is intentional!** Security feature.

Blocked shortcuts:
- ❌ Alt + F4
- ❌ Escape
- ❌ F11
- ❌ Alt + Tab
- ❌ Ctrl + W

**Only way to exit:** `Ctrl + Alt + Shift + Q`

---

## 📋 File Overview

### Batch Files (Windows)

- **INSTALL.bat** - Install all dependencies
- **START.bat** - Start the application (uses npm)
- **START_DIRECT.bat** - Start directly with electron
- **TEST.bat** - Test the installation

### Main Files

- **script.js** - Main application (Electron main process)
- **preload.js** - Security bridge between main and renderer
- **package.json** - Project configuration

### UI Files (ui/ folder)

- **launch.html/js/css** - Launch screen (completed)
- **verification.html/js/css** - Verification screen
- **exam.html/js/css** - Exam screen
- **submission.html/js/css** - Submission screen

### Database Files (database/ folder)

- **config.js** - Database configuration
- **database.js** - Database operations
- **schema.sql** - Complete database schema (28 tables)
- **test-connection.js** - Test database connection

---

## 🎯 What to Run First Time

```
1. Double-click: INSTALL.bat
   (Wait for completion)

2. Double-click: START.bat
   (Application launches in full-screen)

3. Press: Ctrl+Alt+Shift+Q
   (To exit when testing is done)
```

---

## 💻 Command Line Reference

### PowerShell Commands

```powershell
# Install dependencies
cmd /c npm install

# Start the app
cmd /c npm start

# Test database
cmd /c npm run test-db

# Test app structure
cmd /c node test-app.js

# Start with direct electron
cmd /c npx electron .
```

---

## ✅ Success Indicators

### Installation Successful
You should see:
```
added 200+ packages
```

### App Started Successfully
You should see:
- Full-screen window
- "Secure Exam Browser - Launch" screen
- System check indicators
- Clock ticking
- "Proceed to Verification" button

### Database Connected (if configured)
Console shows:
```
✅ Database connected successfully!
   Environment: development
   Database: secure_exam_browser
```

### Database Not Connected (offline mode)
Console shows:
```
⚠️ Database connection failed - running in offline mode
```
**This is OK!** App still works.

---

## 🎓 Admin Training

### For Proctors/Administrators

1. **Starting an Exam Session:**
   - Run `START.bat`
   - App enters full-screen kiosk mode
   - Student cannot exit

2. **Monitoring:**
   - Watch for system check results
   - All indicators should be green ✓
   - Session ID displayed in footer

3. **Emergency Exit:**
   - Press `Ctrl + Alt + Shift + Q`
   - Confirm in dialog
   - Exit is logged in database

4. **After Exam:**
   - Use admin shortcut to exit
   - Check logs (if database configured)
   - Review any warnings

---

## 📦 Package Contents

### Required for Running
- ✅ script.js
- ✅ preload.js
- ✅ package.json
- ✅ ui/ folder (all HTML/JS/CSS files)
- ✅ database/ folder
- ✅ node_modules/ (created after npm install)

### Optional/Documentation
- 📄 README.md
- 📄 QUICK_START.md
- 📄 COMPLETION_REPORT.md
- 📄 ADMIN_EXIT_GUIDE.md
- 📄 HOW_TO_RUN.md (this file)

---

## 🔐 Security Notes

### What's Locked Down

1. **Screen:** Full-screen kiosk, cannot minimize
2. **Keyboard:** All exit shortcuts blocked
3. **Mouse:** Right-click disabled
4. **Navigation:** Cannot visit external websites
5. **Window:** No close/minimize buttons
6. **Taskbar:** App hidden from taskbar
7. **Dev Tools:** F12 and inspect blocked

### What's Allowed

1. **Admin Exit:** Ctrl+Alt+Shift+Q
2. **Task Manager:** Ctrl+Shift+Esc (logged as violation)
3. **System Shutdown:** Power button (logged)

---

## 🎉 You're Ready!

### Normal Workflow

1. **Install:** Run `INSTALL.bat` (first time only)
2. **Start:** Run `START.bat`
3. **Use:** Complete system checks → Proceed
4. **Exit:** Press `Ctrl+Alt+Shift+Q`

### Development Workflow

1. Install dependencies
2. Start app with `START.bat`
3. Test features
4. Exit with admin shortcut
5. Edit code
6. Repeat

---

## 📞 Support

### Check Logs

**Main Process (Terminal):**
- Where you ran `npm start`
- Shows backend errors

**Renderer Process (Dev Tools):**
- Enable dev tools in script.js
- Press Ctrl+Shift+I
- Check Console tab

### Common Messages

✅ Good:
- "Database connected successfully"
- "Admin exit shortcut registered"
- "System checks passed"

⚠️ Info:
- "Database connection failed - running in offline mode"
- "Camera/Mic check failed - marking as OK for demo"

❌ Error:
- "Electron not found" → Run INSTALL.bat
- "Cannot find module" → Run INSTALL.bat

---

**Last Updated:** January 28, 2026

**Questions?** Check the other documentation files:
- QUICK_START.md
- COMPLETION_REPORT.md
- ADMIN_EXIT_GUIDE.md
