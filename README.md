# 🔒 Secure Exam Browser

> A lightweight, AI-powered desktop application built on **Electron.js** that enforces a secure, proctored online examination environment with biometric face verification, kiosk lockdown, and real-time monitoring.

---

## 📌 Project Overview

Secure Exam Browser (SEB) is a **PBL (Project Based Learning)** academic project that addresses the growing need for integrity in online examinations. It combines OS-level browser lockdown with AI-based face liveness detection and identity verification to prevent malpractice.

---

## 🧠 Key Features

| Feature | Description |
|---|---|
| 🔐 Kiosk Lockdown | Blocks Alt+F4, Esc, F11, Alt+Tab, Win key during exam |
| 👤 Face Verification | 30-frame stable face detection + liveness motion score |
| 🪪 Identity Matching | Enroll once, match on every session |
| 📋 Exam Engine | MCQ + Coding questions, 2hr timer, flag system |
| 📊 Admin Dashboard | Monitor sessions, audit logs, KPI stats, force-exit |
| 🚨 Incident Logging | Auto-log suspicious activity, tab-switch attempts |
| 🔑 Secret Admin Exit | Hidden shortcut to release kiosk mode |

---

## 🗂️ Project Structure

```
SecureExamBrowser/
├── main.js                  # Electron main process (kiosk, IPC)
├── preload.js               # Secure IPC bridge (electronAPI)
├── script.js                # Core lockdown enforcement
├── ui/
│   ├── login.html           # Login page (Admin / Student)
│   ├── dashboard.html       # Admin dashboard
│   ├── launch.html          # Student system checks
│   ├── verification.html    # Face detection & liveness
│   ├── exam.html            # Exam engine (MCQ + Code)
│   ├── submission.html      # Review & submit
│   └── js/
│       ├── login.js
│       ├── dashboard.js
│       ├── launch.js
│       ├── verification.js
│       └── exam.js
├── assets/
│   └── workflow-diagram.html
├── package.json
└── README.md
```

---

## 🔄 Workflow

```
Login
 ├── Admin  → Dashboard (monitor, logs, force-exit)
 └── Student → System Checks → Face Verification → Exam → Submission
```

---

## 🧪 Tech Stack

- **Electron.js** — Desktop shell + kiosk mode
- **HTML / CSS / JS** — UI layer
- **face-api.js / OpenCV** — Face detection & liveness
- **Node.js** — Backend logic & IPC
- **SQLite / JSON** — Question bank & session storage
- **Python (optional)** — ML proctoring modules

---

## 📚 Literature Review Summary

| # | Author | Year | Technique | Limitation |
|---|---|---|---|---|
| 1 | Alessio et al. | 2017 | Score comparison study | No technical solution |
| 2 | Jain et al. | 2004 | Biometric framework (FAR/FRR) | No liveness detection |
| 3 | Kortli et al. | 2020 | CNN face recognition >99% | High compute cost |
| 4 | Chingovska et al. | 2012 | Motion-based liveness detection | Limited to controlled lighting |
| 5 | ETH Zurich | 2020 | Safe Exam Browser (SEB) | No biometric integration |

**Research Gap:** No existing tool combines lightweight Electron kiosk lockdown + face liveness detection + identity matching in a single deployable desktop app.

---

## 🚀 Getting Started

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build for production
npm run build
```

---

## 👥 Team

- **Project:** PBL 4 — Evaluation 1
- **Domain:** Cybersecurity + AI Proctoring
- **Platform:** Electron.js Desktop App

---

## 📄 License

MIT License © 2026 Secure Exam Browser Team