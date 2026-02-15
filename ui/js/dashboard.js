// Dashboard JavaScript

// Show incident log (called from KPI tooltip)
function showIncidentLog() {
    // Scroll to audit log sidebar
    const auditLog = document.querySelector('aside');
    if (auditLog) {
        auditLog.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Highlight it briefly
        auditLog.style.outline = '2px solid #ef4444';
        auditLog.style.outlineOffset = '4px';
        setTimeout(() => {
            auditLog.style.outline = '';
        }, 2000);
    }
}

async function updateDashboardStats() {
    if (!window.electronAPI || !window.electronAPI.getDashboardStats) return;

    const activeCountEl = document.getElementById('activeCount');
    const criticalCountEl = document.getElementById('criticalCount');

    try {
        const result = await window.electronAPI.getDashboardStats();
        if (result.success && result.data) {
            if (activeCountEl) activeCountEl.textContent = result.data.active_sessions || 0;
            if (criticalCountEl) criticalCountEl.textContent = result.data.today_violations || 0;
        }
    } catch (error) {
        console.warn('Failed to load dashboard stats:', error);
    }
}

function renderActiveSessions(sessions) {
    const grid = document.getElementById('activeSessionsGrid');
    const emptyState = document.getElementById('activeSessionsEmpty');

    if (!grid) return;

    grid.innerHTML = '';

    if (!sessions || sessions.length === 0) {
        if (emptyState) {
            grid.appendChild(emptyState);
        } else {
            const empty = document.createElement('div');
            empty.className = 'col-span-full text-center text-slate-400 text-sm py-8';
            empty.textContent = 'No active sessions';
            grid.appendChild(empty);
        }
        return;
    }

    sessions.forEach(session => {
        const card = document.createElement('div');
        card.className = 'col-md-6 col-lg-4 col-xl-3';

        const initials = (session.full_name || 'Student')
            .split(' ')
            .map(part => part[0])
            .slice(0, 2)
            .join('')
            .toUpperCase();

        const statusLabel = session.status === 'active' ? 'LIVE' : session.status;
        const statusBadgeClass = session.status === 'active' ? 'text-bg-dark' : 'text-bg-light border';

        card.innerHTML = `
            <div class="app-card p-3 h-100">
                <div class="d-flex align-items-center justify-content-between">
                    <div class="status-icon">
                        <span class="material-symbols-outlined">person</span>
                    </div>
                    <span class="badge ${statusBadgeClass}">${statusLabel}</span>
                </div>
                <div class="mt-3">
                    <div class="fw-semibold">${session.full_name || 'Student'}</div>
                    <div class="text-muted small">ID: ${session.student_id || session.user_id}</div>
                    <div class="text-muted small">${session.exam_name || 'Exam Session'}</div>
                </div>
                <div class="mt-3 app-mono text-muted">${initials}</div>
            </div>
        `;

        grid.appendChild(card);
    });
}

async function loadActiveSessions() {
    if (!window.electronAPI || !window.electronAPI.getActiveSessions) return;

    try {
        const result = await window.electronAPI.getActiveSessions();
        if (result.success) {
            renderActiveSessions(result.data || []);
        }
    } catch (error) {
        console.warn('Failed to load active sessions:', error);
    }
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    updateDashboardStats();
    loadActiveSessions();

    // Refresh every 15 seconds
    setInterval(() => {
        updateDashboardStats();
        loadActiveSessions();
    }, 15000);

    console.log('Dashboard initialized');
});
