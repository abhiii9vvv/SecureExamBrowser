// Login Screen JavaScript

const UI_ONLY = true;

async function updateDbStatus() {
    const statusBadge = document.getElementById('dbStatus');
    if (!statusBadge) return;

    if (UI_ONLY || !window.electronAPI || !window.electronAPI.getDatabaseStatus) {
        statusBadge.textContent = 'UI Only';
        statusBadge.className = 'badge text-bg-secondary';
        return;
    }

    try {
        const status = await window.electronAPI.getDatabaseStatus();
        if (status.connected) {
            statusBadge.textContent = 'DB Connected';
            statusBadge.className = 'badge text-bg-success';
        } else {
            statusBadge.textContent = 'DB Offline';
            statusBadge.className = 'badge text-bg-warning';
        }
    } catch (error) {
        statusBadge.textContent = 'DB Unknown';
        statusBadge.className = 'badge text-bg-secondary';
    }
}

function showLoginError(message) {
    const errorEl = document.getElementById('loginError');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

function clearLoginError() {
    const errorEl = document.getElementById('loginError');
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.style.display = 'none';
}

async function handleLogin(event) {
    event.preventDefault();
    clearLoginError();

    const username = document.getElementById('username');
    const password = document.getElementById('password');
    const button = document.getElementById('loginButton');

    if (!username || !password || !button) return;

    button.disabled = true;
    button.textContent = 'Signing In...';

    try {
        if (UI_ONLY || !window.electronAPI || !window.electronAPI.login) {
            const displayName = username.value.trim() || 'Candidate';
            const localUser = {
                user_id: -1,
                full_name: displayName,
                role: 'student',
                student_id: 'SEB-LOCAL'
            };

            localStorage.setItem('currentUserId', localUser.user_id);
            localStorage.setItem('currentUserName', localUser.full_name);
            localStorage.setItem('currentUserRole', localUser.role);
            localStorage.setItem('currentUserCourse', '');
            localStorage.setItem('currentUserBranch', '');
            localStorage.setItem('currentUserUniversity', '');
            localStorage.setItem('currentUserLocation', '');

            window.location.href = 'launch.html';
            return;
        }

        const result = await window.electronAPI.login(username.value.trim(), password.value);
        if (!result.success) {
            showLoginError(result.error || 'Login failed');
            return;
        }

        localStorage.setItem('currentUserId', result.data.user_id);
        localStorage.setItem('currentUserName', result.data.full_name || 'Student');
        localStorage.setItem('currentUserRole', result.data.role || 'student');
        localStorage.setItem('currentUserCourse', 'B.Tech');
        localStorage.setItem('currentUserBranch', 'Computer Science & Engineering (CSE)');
        localStorage.setItem('currentUserUniversity', 'Sharda University');
        localStorage.setItem('currentUserLocation', 'Greater Noida, Uttar Pradesh');

        const role = (result.data.role || 'student').toLowerCase();
        const destination = role === 'admin' || role === 'instructor' ? 'dashboard' : 'launch';
        await window.electronAPI.navigateTo(destination);
    } catch (error) {
        showLoginError(error.message || 'Login failed');
    } finally {
        button.disabled = false;
        button.textContent = 'Sign In';
    }
}

function bindLoginShortcuts() {
    const focusUsername = document.getElementById('focusUsername');
    const username = document.getElementById('username');
    const password = document.getElementById('password');

    if (focusUsername && username) {
        focusUsername.addEventListener('click', () => {
            username.focus();
        });
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        updateDbStatus();
        bindLoginShortcuts();
        const form = document.getElementById('loginForm');
        if (form) form.addEventListener('submit', handleLogin);
    });
} else {
    updateDbStatus();
    bindLoginShortcuts();
    const form = document.getElementById('loginForm');
    if (form) form.addEventListener('submit', handleLogin);
}
