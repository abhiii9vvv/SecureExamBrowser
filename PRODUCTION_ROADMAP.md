# Production Roadmap (Secure Exam Browser)

## Phase 0 — Immediate Hardening (Now)
- Replace mock/demo logic with database-backed flows (completed in this commit).
- Enforce real session context for activity logging, submissions, and monitoring.
- Remove hardcoded credentials and use environment variables for DB access.
- Add live camera face detection UI overlay and status indicators.

## Phase 1 — Authentication & Identity
- Implement secure login (SSO/OAuth or institution IdP).
- Store and validate `currentUserId` + `currentExamId` server-side.
- Enforce role-based access (student/instructor/admin).
- Add MFA for admin users.

## Phase 2 — Exam Lifecycle
- Admin UI to create exams, questions, and schedules.
- Student exam enrollment + access control.
- Server-side auto-save of answers and session checkpoints.
- Resume-on-failure with checkpoint restore.

## Phase 3 — Proctoring & Biometrics
- Replace FaceDetector fallback with model-backed recognition (on-device or server).
- Add liveness checks (blink detection + head movement thresholds).
- Store hashed face embeddings (not raw images) + encryption-at-rest.
- Event stream for violations (tab switch, noise spike, face absent).

## Phase 4 — Monitoring & Reporting
- Real-time dashboard with WebSocket updates.
- Incident review + evidence audit trail.
- Exportable compliance reports (CSV/PDF).

## Phase 5 — Reliability & Security
- Centralized logging (SIEM integration).
- Load testing and failover database replicas.
- Full audit of permissions, data retention, and GDPR/FERPA compliance.

## Phase 6 — CI/CD & Operations
- Automated migrations with rollback.
- Secret management (Azure Key Vault / AWS Secrets Manager).
- Health checks + uptime monitoring.
