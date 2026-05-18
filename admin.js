/* SIDEON QR Admin Dashboard */

const API = (window.SIDEON_API_BASE || 'https://sideon-qr-backend.onrender.com') + '/api';

let feedData = [];
let startTime = Date.now();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, opts);
  if (!res.ok && res.status !== 200) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
  }
  return res.json();
}

function setResult(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `result-box ${type}`;
  el.classList.remove('hidden');
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function fmtUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function refreshStats() {
  try {
    const stats = await apiFetch('/admin/stats');
    setStat('statTotal', stats.totalMembers ?? '—');
    setStat('statChecked', stats.checkedIn ?? '—');
    setStat('statPending', stats.pending ?? '—');
    setStat('statTokens', stats.activeTokens ?? '—');
  } catch (_) {
    // non-fatal: leave previous values
  }

  // Footer uptime (local approximation)
  const uptimeSec = Math.round((Date.now() - startTime) / 1000);
  document.getElementById('footerUptime').textContent = `Session uptime: ${fmtUptime(uptimeSec)}`;
}

function setStat(cardId, value) {
  const card = document.getElementById(cardId);
  if (card) card.querySelector('.stat-value').textContent = value;
}

// ── Live feed ─────────────────────────────────────────────────────────────────

async function refreshFeed() {
  try {
    feedData = await apiFetch('/admin/members');
    renderFeed();
  } catch (_) {}
}

function renderFeed() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const tbody = document.getElementById('feedBody');
  if (!tbody) return;

  const rows = q
    ? feedData.filter(r => (r.member_id + ' ' + r.name).toLowerCase().includes(q))
    : feedData;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const tokenDisplay = r.token ? r.token.slice(0, 24) + '…' : '—';
    const badge = badgeFor(r.status);
    return `<tr>
      <td>${esc(r.member_id)}</td>
      <td>${esc(r.name || '—')}</td>
      <td class="mono-cell">${esc(tokenDisplay)}</td>
      <td>${badge}</td>
      <td>${fmtTime(r.checked_in_at)}</td>
      <td>${fmtTime(r.expiresAt)}</td>
    </tr>`;
  }).join('');
}

function badgeFor(status) {
  if (status === 'checked_in') return '<span class="badge badge-green">Checked In</span>';
  if (status === 'expired')    return '<span class="badge badge-red">Expired</span>';
  return '<span class="badge badge-yellow">Pending</span>';
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportCSV() {
  const headers = ['Member ID', 'Name', 'Token', 'Status', 'Check-In Time', 'Expires'];
  const rows = feedData.map(r => [
    r.member_id, r.name, r.token || '',
    r.status, r.checked_in_at || '', r.expiresAt || ''
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sideon-checkins-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Generate QR ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('generateForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        member_id: document.getElementById('memberId').value.trim(),
        name:      document.getElementById('memberName').value.trim(),
        email:     document.getElementById('memberEmail').value.trim() || undefined,
        mobile:    document.getElementById('memberMobile').value.trim() || undefined,
        agent:     document.getElementById('memberAgent').value.trim() || undefined,
      };
      try {
        const data = await apiFetch('/generate-qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = [
          `Token: ${data.token}`,
          `Expires: ${fmtTime(data.expiresAt)}`,
        ].filter(Boolean).join('\n');
        setResult('generateResult', text, 'success');
        form.reset();
        // Auto-fill token fields and load QR image immediately
        const qrTokenInput = document.getElementById('qrToken');
        const lookupInput = document.getElementById('lookupToken');
        if (qrTokenInput) { qrTokenInput.value = data.token; loadQRImage('png'); }
        if (lookupInput) lookupInput.value = data.token;
        refreshFeed();
        refreshStats();
      } catch (err) {
        setResult('generateResult', err.message, 'error');
      }
    });
  }

  // Env tag
  fetch(API + '/status').then(r => r.json()).then(d => {
    const tag = document.getElementById('envTag');
    if (tag) tag.textContent = d.environment || 'unknown';
  }).catch(() => {});

  // Live dot: turns red on connection failure
  async function pingHealth() {
    try {
      await apiFetch('/health');
      const dot = document.getElementById('liveDot');
      if (dot) { dot.style.background = 'var(--green)'; }
    } catch (_) {
      const dot = document.getElementById('liveDot');
      if (dot) { dot.style.background = 'var(--red)'; }
    }
  }

  // Initial load
  pingHealth();
  refreshStats();
  refreshFeed();

  // Auto-refresh every 3s
  setInterval(() => { pingHealth(); refreshStats(); refreshFeed(); }, 3000);
});

// ── Verify / Check-In ─────────────────────────────────────────────────────────

async function verifyToken() {
  const token = document.getElementById('lookupToken').value.trim();
  if (!token) return;
  try {
    const data = await apiFetch(`/verify?token=${encodeURIComponent(token)}`);
    if (data.success) {
      const ts = data.token_status || {};
      const text = [
        `Valid: ${data.success}`,
        `Member: ${data.member_id} — ${data.member?.name || '—'}`,
        ts.is_checked_in ? `Checked in: ${fmtTime(ts.checked_in_at)}` : 'Not yet checked in',
        `Expires: ${fmtTime(ts.expiresAt)}`,
      ].join('\n');
      setResult('lookupResult', text, 'success');
    } else {
      setResult('lookupResult', data.error || 'Token invalid', data.is_expired ? 'error' : 'info');
    }
  } catch (err) {
    setResult('lookupResult', err.message, 'error');
  }
}

async function checkIn() {
  const token = document.getElementById('lookupToken').value.trim();
  if (!token) return;
  try {
    const data = await apiFetch('/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (data.success) {
      setResult('lookupResult', `Checked in: ${data.member_id}\n${fmtTime(data.checked_in_at)}`, 'success');
      refreshFeed();
      refreshStats();
    } else {
      setResult('lookupResult', data.error || 'Check-in failed', 'error');
    }
  } catch (err) {
    setResult('lookupResult', err.message, 'error');
  }
}

// ── QR Image ──────────────────────────────────────────────────────────────────

async function loadQRImage(format) {
  const token = document.getElementById('qrToken').value.trim();
  if (!token) return;

  const display = document.getElementById('qrDisplay');
  display.innerHTML = 'Loading…';
  display.classList.remove('hidden');

  try {
    const url = `${API}/generate-qr-image?token=${encodeURIComponent(token)}&format=${format}`;

    if (format === 'svg') {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const svg = await res.text();
      display.innerHTML = svg;
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'QR Code';
      img.onerror = () => { display.textContent = 'Failed to load QR image'; };
      display.innerHTML = '';
      display.appendChild(img);
    }
  } catch (err) {
    display.textContent = err.message;
  }
}
