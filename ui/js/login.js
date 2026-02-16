// Login Screen JavaScript

async function updateDbStatus() {
    const statusBadge = document.getElementById('dbStatus');
    if (!statusBadge || !window.electronAPI || !window.electronAPI.getDatabaseStatus) return;

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
        if (!window.electronAPI || !window.electronAPI.login) {
            showLoginError('Login service not available.');
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

function prefillDemoCredentials() {
    const username = document.getElementById('username');
    const password = document.getElementById('password');

    if (username) username.value = 'demo.student';
    if (password) password.value = 'Demo@123';
}

function bindLoginShortcuts() {
    const useDemo = document.getElementById('useDemo');
    const focusUsername = document.getElementById('focusUsername');
    const username = document.getElementById('username');
    const password = document.getElementById('password');

    if (useDemo) {
        useDemo.addEventListener('click', () => {
            prefillDemoCredentials();
            if (password) password.focus();
        });
    }

    if (focusUsername && username) {
        focusUsername.addEventListener('click', () => {
            username.focus();
        });
    }
}

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        prefillDemoCredentials();
        updateDbStatus();
        bindLoginShortcuts();
        const form = document.getElementById('loginForm');
        if (form) form.addEventListener('submit', handleLogin);
    });
} else {
    prefillDemoCredentials();
    updateDbStatus();
    bindLoginShortcuts();
    const form = document.getElementById('loginForm');
    if (form) form.addEventListener('submit', handleLogin);
}
