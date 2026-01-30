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
        card.className = 'group relative rounded-lg overflow-hidden bg-[#0b1016] aspect-video border border-white/10 hover:border-primary/50 transition-colors';

        const initials = (session.full_name || 'Student')
            .split(' ')
            .map(part => part[0])
            .slice(0, 2)
            .join('')
            .toUpperCase();

        const statusLabel = session.status === 'active' ? 'LIVE' : session.status;
        const statusClass = session.status === 'active' ? 'bg-accent-green/20 text-accent-green border-accent-green/30' : 'bg-accent-yellow/20 text-accent-yellow border-accent-yellow/30';

        card.innerHTML = `
            <div class="absolute inset-0 flex items-center justify-center text-4xl font-bold text-slate-700">
                ${initials}
            </div>
            <div class="absolute top-3 left-3 flex gap-2">
                <span class="bg-black/60 backdrop-blur text-white text-[10px] px-1.5 py-0.5 rounded font-mono border border-white/10">ID: ${session.student_id || session.user_id}</span>
                <span class="flex items-center gap-1 ${statusClass} backdrop-blur text-[10px] px-1.5 py-0.5 rounded border font-bold">
                    <span class="size-1.5 rounded-full ${session.status === 'active' ? 'bg-accent-green' : 'bg-accent-yellow'}"></span> ${statusLabel}
                </span>
            </div>
            <div class="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent">
                <p class="text-white text-sm font-medium">${session.full_name || 'Student'}</p>
                <p class="text-slate-400 text-xs">${session.exam_name || 'Exam Session'}</p>
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
