/**
 * router.js — Navigation helper + shared toast system.
 * Imported by every page via <script type="module">.
 */

/* ============================================================ NAVIGATE */
export async function navigateTo(page) {
  try {
    const result = await window.electronAPI.navigateTo(page)
    if (!result?.success) {
      showToast(result?.error || `Cannot navigate to ${page}`, 'error')
    }
  } catch (err) {
    showToast(err.message || 'Navigation failed', 'error')
    console.error('[router] navigateTo error:', err)
  }
}

export async function navigateToLogin() {
  try {
    await window.electronAPI.navigateTo('login')
  } catch (err) {
    console.error('[router] logout nav error:', err)
  }
}

/* ============================================================ TOAST */
function ensureToastRoot() {
  let root = document.getElementById('toast-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'toast-root'
    document.body.appendChild(root)
  }
  return root
}

/**
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} [duration=3500]
 */
export function showToast(message, type = 'info', duration = 3500) {
  const root = ensureToastRoot()
  const el = document.createElement('div')
  el.className = `toast toast-${type}`

  const icons = {
    success: `<svg viewBox="0 0 20 20" fill="currentColor" style="width:15px;height:15px;color:var(--success)"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>`,
    error:   `<svg viewBox="0 0 20 20" fill="currentColor" style="width:15px;height:15px;color:var(--danger)"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"/></svg>`,
    warning: `<svg viewBox="0 0 20 20" fill="currentColor" style="width:15px;height:15px;color:var(--warning)"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"/></svg>`,
    info:    `<svg viewBox="0 0 20 20" fill="currentColor" style="width:15px;height:15px;color:var(--info)"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"/></svg>`,
  }

  el.innerHTML = `${icons[type] || icons.info}<span style="color:var(--text-primary)">${message}</span>`

  root.appendChild(el)

  setTimeout(() => {
    el.style.animation = 'none'
    el.style.opacity = '0'
    el.style.transform = 'translateX(16px)'
    el.style.transition = '200ms ease'
    setTimeout(() => el.remove(), 220)
  }, duration)
}

/* ============================================================ MODAL CONFIRM */
export function showConfirm({ title, body, confirmText = 'Confirm', dangerConfirm = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'modal-backdrop'

    const confirmClass = dangerConfirm ? 'btn-danger' : 'btn-primary'

    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-title">${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="mc-cancel">Cancel</button>
          <button class="btn ${confirmClass}" id="mc-confirm">${confirmText}</button>
        </div>
      </div>
    `

    document.body.appendChild(backdrop)

    backdrop.querySelector('#mc-cancel').addEventListener('click', () => { backdrop.remove(); resolve(false) })
    backdrop.querySelector('#mc-confirm').addEventListener('click', () => { backdrop.remove(); resolve(true) })
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(false) } })
  })
}

/* ============================================================ MISC HELPERS */
export function setButtonLoading(btn, loading) {
  if (loading) {
    btn.classList.add('btn-loading')
    btn.disabled = true
  } else {
    btn.classList.remove('btn-loading')
    btn.disabled = false
  }
}

export function formatDate(isoStr) {
  if (!isoStr) return '—'
  try {
    return new Date(isoStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return isoStr }
}

export function formatDateTime(isoStr) {
  if (!isoStr) return '—'
  try {
    return new Date(isoStr).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return isoStr }
}

export function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
