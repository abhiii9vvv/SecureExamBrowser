# 🔑 Admin Exit Shortcut Guide

## How to Exit the Secure Exam Browser

### The ONLY Way to Exit

```
╔══════════════════════════════════════════╗
║                                          ║
║   Press: Ctrl + Alt + Shift + Q          ║
║                                          ║
║   On Mac: Cmd + Alt + Shift + Q          ║
║                                          ║
╚══════════════════════════════════════════╝
```

### What Happens When You Press It?

1. A **confirmation dialog** appears
2. You see two options:
   - **Cancel** - Return to exam
   - **Exit Exam** - Close the application
3. If you click "Exit Exam":
   - The action is **logged** in the database
   - The application **closes immediately**
   - The exam session is **terminated**

### Why This Shortcut?

- Students cannot easily discover it
- Prevents accidental exits
- Requires admin knowledge
- All exits are logged for security

### What's Blocked?

All normal exit methods are BLOCKED:
- ❌ Alt + F4
- ❌ Escape key
- ❌ F11
- ❌ Window close button (removed)
- ❌ Alt + Tab (switching apps)
- ❌ Ctrl + W
- ❌ Task Manager close (prevented)

### Emergency Exit

If the shortcut doesn't work:
1. Open Task Manager: `Ctrl + Shift + Esc`
2. Find "Secure Exam Browser"
3. Click "End Task"

**Note:** This will be logged as an unauthorized exit!

### Visual Reminder

```
    Ctrl   +   Alt   +   Shift   +   Q
     ⌃         ⌥         ⇧         Q
   (Hold)   (Hold)    (Hold)    (Press)
```

### Testing the Shortcut

1. Start the application
2. Press `Ctrl + Alt + Shift + Q`
3. You should see the exit dialog
4. Click "Cancel" to continue
5. Click "Exit Exam" to close

### For Administrators

Remember to:
- ✅ Test the shortcut before exams
- ✅ Keep this information confidential
- ✅ Train proctors on the exit method
- ✅ Have backup exit procedures
- ✅ Monitor exit logs after exams

### Console Messages

When the shortcut is triggered, you'll see:
```
🔑 Admin exit shortcut triggered
```

When exiting is blocked:
```
⚠️ Window close blocked - exam mode active
🚫 Blocked shortcut: [key name]
```

### Configuration

To change the shortcut, edit `script.js`:
```javascript
globalShortcut.register('CommandOrControl+Alt+Shift+Q', () => {
  // Exit logic here
})
```

---

**Keep this guide secure and away from students!**
