'use strict';

let toastT;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

let tutorModules = [];
let currentModuleCode = null;
let currentModuleName = '';
let currentModuleCourse = '';
let tutorDisplayName = '';
let tutorApplication = null;
let tutorCurrentUser = null;
let tutorOnboardingProfile = null;
let SESSIONS = {};
let CLAIMS = [];
let currentTimesheet = null;
let claimsPeriodMonth = new Date().getMonth() + 1;
let claimsPeriodYear = new Date().getFullYear();

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SEMESTER_HOURS_DEFAULT = 160;
let semesterHoursCap = SEMESTER_HOURS_DEFAULT;

function getSemesterHoursCap() {
  return semesterHoursCap;
}

async function loadSemesterHours() {
  try {
    const s = await VF.apiFetch('/public/settings-extended');
    if (s.max_hours_per_semester) {
      semesterHoursCap = Number(s.max_hours_per_semester) || SEMESTER_HOURS_DEFAULT;
    }
  } catch (err) {
    semesterHoursCap = SEMESTER_HOURS_DEFAULT;
  }
}

function sessionClaimHours(sessionType) {
  return sessionType === 'practical' ? 5 : 3;
}

function sessionClaimPay(hourlyRate, sessionType) {
  const rate = Number(hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(rate * sessionClaimHours(sessionType) * 100) / 100;
}

function timesheetClaimTotal(ts) {
  if (ts.claim) return Number(ts.claim.total_amount);
  const rate = Number(ts.ratePerHour);
  if (!Number.isFinite(rate) || rate <= 0) return ts.totalAmount ?? 0;
  const amount = (ts.sessions || []).reduce(
    (sum, s) => sum + sessionClaimPay(rate, s.session_type),
    0
  );
  return Math.round(amount * 100) / 100;
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function programmeShort(course) {
  if (!course) return '';
  if (course.startsWith('BICT')) return 'BICT';
  if (course.startsWith('DICT')) return 'DICT';
  return course.split(' ')[0];
}

function currentPeriodLabel() {
  return new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
}

function moduleQuerySuffix() {
  return currentModuleCode
    ? `?moduleCode=${encodeURIComponent(currentModuleCode)}`
    : '';
}

function moduleFromApplication(app) {
  if (!app) return null;
  const name = (app.module_name || '').trim();
  const code = (app.module_code || '').trim();
  if (!name && !code) return null;
  return {
    code: code || name.split(/\s+/)[0],
    name: name || code,
    course: app.course || '',
  };
}

function modulesFromApplication(app) {
  const m = moduleFromApplication(app);
  return m ? [m] : [];
}

function renderEmptyModulePanels() {
  renderDashboardUpcoming([]);
  renderSessionsTable([]);
  renderHourLogTable([]);
  updateDashboardStats([]);
  renderClaimsPanels([]);
  rebuildCalendarFromSessions([]);
}

async function setupTutorModules(modules) {
  if (!modules.length && tutorApplication) {
    modules = modulesFromApplication(tutorApplication);
  }
  tutorModules = modules;

  const desktopTabs = document.getElementById('module-tabs');
  const hubModules = document.getElementById('td-hub-modules');

  if (modules.length) {
    const html = modules.map((m, i) => `
      <button type="button" class="module-tab ${i === 0 ? 'active' : ''}"
        data-code="${m.code}" data-name="${m.name}" data-course="${m.course || ''}"
        onclick="switchModule(this)">
        <span class="mod-code">${m.code}</span><span class="mod-name"> ${m.name}</span>
      </button>`).join('');
    if (desktopTabs) desktopTabs.innerHTML = html;
    // Hub chips only when switching modules is useful
    if (hubModules) {
      hubModules.innerHTML = modules.length > 1 ? html : '';
      hubModules.hidden = modules.length <= 1;
    }

    const saved = sessionStorage.getItem('vf_tutor_module');
    const initial = modules.find(m => m.code === saved) || modules[0];
    currentModuleCode = initial.code;
    currentModuleName = initial.name;
    currentModuleCourse = initial.course || '';
    document.querySelectorAll('.module-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.code === currentModuleCode);
    });
    await refreshModuleData();
  } else {
    const empty = '<span style="font-size:12px;color:var(--muted);padding:8px 4px">No module linked yet - contact your lecturer.</span>';
    if (desktopTabs) desktopTabs.innerHTML = empty;
    if (hubModules) {
      hubModules.innerHTML = '';
      hubModules.hidden = true;
    }
    currentModuleCode = null;
    currentModuleName = '';
    currentModuleCourse = '';
    applyModuleUi();
    renderEmptyModulePanels();
  }
}

function applyModuleUi() {
  const code = currentModuleCode || '-';
  const name = currentModuleName || '-';
  const period = currentPeriodLabel();
  const prog = programmeShort(currentModuleCourse);

  setText('#sidebar-mod-code', code);
  setText('#sidebar-mod-name', name);
  setText('#hero-module-text', `${code} · ${name} · ${period}${prog ? ' · ' + prog : ''}`);
  setText('#td-hub-module', `${code} · ${name}`);
  const hubMod = document.getElementById('td-hub-module');
  if (hubMod && code && code !== '-') {
    hubMod.innerHTML = `<b>${code}</b> · ${name}`;
  }
  setText('#dash-upcoming-label', code);
  setText('#sessions-page-title', code);
  setText('#hourlog-hero-sub', `${code} · ${name} · ${period}`);
  setText('#hourlog-hero-sub-desktop', `${code} · ${name} · ${period}`);
  setText('#calendar-hero-sub', `${code} · ${name} · highlighted dates have sessions`);
  setText('#claims-hero-sub', `${code} · Submit monthly timesheet to your lecturer`);
  setText('#reg-eyebrow', `${code} · ${name}`);
}

function switchModule(btn) {
  document.querySelectorAll('.module-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  currentModuleCode = btn.dataset.code;
  currentModuleName = btn.dataset.name || btn.dataset.code;
  currentModuleCourse = btn.dataset.course || '';
  sessionStorage.setItem('vf_tutor_module', currentModuleCode);
  refreshModuleData();
}

async function refreshModuleData() {
  if (!currentModuleCode) return;
  applyModuleUi();
  // Hub only needs sessions + claims list; timesheet is loaded when Claims is opened.
  await Promise.all([loadSessions(), loadClaimsList()]);
  if (typeof refreshUnreadBadge === 'function') refreshUnreadBadge();
}

function sessionTypeLabel(type) {
  const map = {
    tutorial: 'Tutorial', practical: 'Practical', online: 'Online',
    revision: 'Revision', lecture: 'Lecture',
  };
  return map[type] || type || '-';
}

function tutorStatusChip(status) {
  if (status === 'active') return '<span class="sc confirmed">In progress</span>';
  if (status === 'completed') return '<span class="sc confirmed">Confirmed</span>';
  if (status === 'flagged') return '<span class="sc flagged">Flagged</span>';
  if (status === 'cancelled') return '<span class="sc cancelled">Cancelled</span>';
  return '<span class="sc upcoming">Upcoming</span>';
}

function formatSessionDate(s, withWeekday) {
  if (!s.session_date) return '-';
  const d = new Date(s.session_date);
  const opts = withWeekday
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short' };
  return d.toLocaleDateString('en-ZA', opts);
}

function formatTimeRange(s) {
  if (!s.start_time) return '-';
  return String(s.start_time).slice(0, 5);
}

function isUpcoming(status) {
  return status === 'scheduled' || status === 'active';
}

function isScheduled(status) {
  return status === 'scheduled';
}

let qrCountdownTimer = null;
let qrCurrentSessionId = null;
let qrRotationSeconds = 10;

function formatQrDesc(data) {
  const date = data.sessionDate
    ? new Date(data.sessionDate).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
    : '';
  const time = data.startTime ? String(data.startTime).slice(0, 5) : '';
  return `${data.moduleCode}${data.topic ? ' · ' + data.topic : ''} - ${date}${time ? ' · ' + time : ''}${data.venue ? ' · ' + data.venue : ''}`;
}

function updateQrCountdown(seconds, total) {
  const secsEl = document.getElementById('qr-countdown-seconds');
  const subEl  = document.getElementById('qr-countdown');
  const fillEl = document.getElementById('qr-countdown-fill');
  const wrapEl = document.getElementById('qr-countdown-wrap');
  const max = total || qrRotationSeconds || 10;

  if (secsEl) secsEl.textContent = String(Math.max(0, seconds));
  if (subEl) {
    subEl.textContent = seconds === 1 ? 'second left - scan now' : 'seconds left - scan now';
  }
  if (fillEl) {
    const pct = Math.max(0, Math.min(100, (seconds / max) * 100));
    fillEl.style.width = pct + '%';
    fillEl.classList.toggle('urgent', seconds <= 5);
  }
  if (wrapEl) wrapEl.classList.toggle('urgent', seconds <= 5);
}

async function refreshQrCode() {
  if (!qrCurrentSessionId) return;
  const descEl = document.getElementById('qrDesc');
  try {
    const data = await VF.apiFetch(`/sessions/${qrCurrentSessionId}/qr`);
    qrRotationSeconds = data.rotationSeconds || 10;
    if (descEl) descEl.textContent = formatQrDesc(data);

    const img = document.getElementById('qr-image');
    if (img && data.qrDataUrl) {
      img.src = data.qrDataUrl;
      img.style.display = 'block';
    } else if (img) {
      img.style.display = 'none';
    }

    const hint = document.getElementById('qr-network-hint');
    if (hint && data.networkUrl) {
      hint.textContent = data.networkUrl;
      hint.style.display = 'block';
    }

    let remaining = data.secondsRemaining ?? qrRotationSeconds;
    updateQrCountdown(remaining, qrRotationSeconds);
    clearInterval(qrCountdownTimer);
    qrCountdownTimer = setInterval(() => {
      remaining -= 1;
      updateQrCountdown(remaining, qrRotationSeconds);
      if (remaining <= 0) {
        clearInterval(qrCountdownTimer);
        refreshQrCode();
      }
    }, 1000);
  } catch (err) {
    const msg = (err.errors && err.errors[0]) || err.message || 'Could not load QR code';
    if (descEl) descEl.textContent = msg;
    const img = document.getElementById('qr-image');
    if (img) img.style.display = 'none';
    showToast(msg);
  }
}

function openQR(sessionId) {
  const modal = document.getElementById('qrModal');
  if (!modal) {
    showToast('Register modal not found');
    return;
  }
  qrCurrentSessionId = sessionId;
  modal.classList.add('open');
  const descEl = document.getElementById('qrDesc');
  if (descEl) descEl.textContent = 'Loading QR code…';
  updateQrCountdown(qrRotationSeconds, qrRotationSeconds);
  refreshQrCode();
}

function closeQR() {
  const modal = document.getElementById('qrModal');
  if (modal) modal.classList.remove('open');
  clearInterval(qrCountdownTimer);
  qrCurrentSessionId = null;
  showToast('Register closed');
}

function viewCurrentQrRegister() {
  if (qrCurrentSessionId) openRegister(qrCurrentSessionId);
  else showToast('No active session');
}

window.openQR = openQR;
window.closeQR = closeQR;
window.viewCurrentQrRegister = viewCurrentQrRegister;

let currentRegisterSessionId = null;
let currentRegisterData = null;
let registerRefreshTimer = null;

function formatSignInTime(recordedAt) {
  if (!recordedAt) return '-';
  return new Date(recordedAt).toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' });
}

function renderRegisterModal(data) {
  const session = data.session || {};
  const modCode = session.module_code || currentModuleCode || '-';
  const modName = currentModuleName || session.module_name || '';
  const date = session.session_date
    ? new Date(session.session_date).toLocaleDateString('en-ZA', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '-';
  const dateShort = session.session_date
    ? new Date(session.session_date).toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '';
  const time = session.start_time ? String(session.start_time).slice(0, 5) : '';
  const meta = [
    time,
    session.venue,
    session.topic,
    sessionTypeLabel(session.session_type),
  ].filter(Boolean).join(' · ');

  const students = data.students || (data.attendance || []).map((a) => ({
    student_number: a.student_number,
    full_name: a.full_name || '-',
    recorded_at: a.recorded_at,
    present: true,
  }));

  const enrolled = data.enrolled || students.length;
  const present = students.filter((s) => s.present).length;
  const absent = Math.max(0, enrolled - present);
  const pct = enrolled ? Math.round((present / enrolled) * 100) : (present ? 100 : 0);

  const titleEl = document.getElementById('reg-title');
  const eyebrowEl = document.getElementById('reg-eyebrow');
  const metaEl = document.getElementById('reg-meta');
  const headCountEl = document.getElementById('reg-head-count');
  const footerNoteEl = document.getElementById('reg-footer-note');
  const tbody = document.getElementById('reg-tbody');

  const isMobileReg = window.matchMedia('(max-width: 900px)').matches;
  if (titleEl) {
    titleEl.textContent = isMobileReg
      ? `${modCode}${modName ? ' - ' + modName : ''}`
      : `Attendance Register - ${date}`;
  }
  if (eyebrowEl) {
    eyebrowEl.textContent = isMobileReg
      ? 'enrolled'
      : `${modCode}${modName ? ' · ' + modName : ''}`;
  }
  if (headCountEl) headCountEl.textContent = String(enrolled);
  if (metaEl) {
    metaEl.textContent = isMobileReg
      ? [date !== '-' ? date : null, meta || null].filter(Boolean).join(' · ') || '-'
      : (meta || '-');
  }
  if (footerNoteEl) {
    footerNoteEl.innerHTML = isMobileReg
      ? `<span class="reg-footer-dot" aria-hidden="true"></span> Updated ${dateShort || '-'}`
      : 'Read-only · Locked after session end<br>Linked to your timesheet claim';
  }

  setText('#reg-enrolled', String(enrolled));
  setText('#reg-present', String(present));
  setText('#reg-absent', String(absent));
  setText('#reg-pct', `${pct}%`);

  if (!tbody) return;

  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:24px">No sign-ins yet for this session.</td></tr>';
    return;
  }

  tbody.innerHTML = students.map((s, i) => `
    <tr class="${!s.present ? 'absent-row' : ''}">
      <td class="reg-idx">${String(i + 1).padStart(2, '0')}</td>
      <td class="reg-info">
        <div class="reg-sname"${!s.present ? ' style="color:var(--muted);font-weight:400"' : ''}>${s.full_name || '-'}</div>
        <div class="reg-detail">
          <span class="reg-snum">${s.student_number}</span>
          <span class="reg-detail-sep" aria-hidden="true">·</span>
          <span class="reg-time">${formatSignInTime(s.recorded_at)}</span>
        </div>
      </td>
      <td class="reg-status-cell"><span class="reg-badge ${s.present ? 'present' : 'absent'}">${s.present ? 'Present' : 'Absent'}</span></td>
    </tr>`).join('');
}

async function loadRegister(sessionId, silent) {
  const data = await VF.apiFetch(`/attendance/${sessionId}`);
  currentRegisterSessionId = sessionId;
  currentRegisterData = data;
  renderRegisterModal(data);

  clearInterval(registerRefreshTimer);
  if (data.session?.status === 'active') {
    registerRefreshTimer = setInterval(() => {
      loadRegister(sessionId, true).catch(() => {});
    }, 8000);
  }
  return data;
}

async function openRegister(sessionId) {
  const modal = document.getElementById('regModal');
  if (!modal) {
    showToast('Register view not available');
    return;
  }

  const tbody = document.getElementById('reg-tbody');
  if (tbody && VF.skeleton) {
    tbody.innerHTML = VF.skeleton.tbody(3, 6);
  } else if (tbody) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">Loading register…</td></tr>';
  }
  modal.classList.add('open');

  try {
    await loadRegister(sessionId);
  } catch (err) {
    modal.classList.remove('open');
    showToast(err.errors?.[0] || err.message || 'Could not load register');
  }
}

function closeRegister() {
  const modal = document.getElementById('regModal');
  if (modal) modal.classList.remove('open');
  clearInterval(registerRefreshTimer);
  registerRefreshTimer = null;
  currentRegisterSessionId = null;
  currentRegisterData = null;
}

function regCloseOutside(e) {
  if (e.target === document.getElementById('regModal')) closeRegister();
}

function downloadRegister() {
  if (!currentRegisterData) return;

  const data = currentRegisterData;
  const session = data.session || {};
  const students = data.students || [];
  const enrolled = data.enrolled || students.length;
  const present = students.filter((s) => s.present).length;
  const absent = Math.max(0, enrolled - present);
  const pct = enrolled ? Math.round((present / enrolled) * 100) : (present ? 100 : 0);
  const modCode = session.module_code || currentModuleCode || '-';
  const dateLabel = session.session_date
    ? new Date(session.session_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Session';
  const meta = [
    session.start_time ? String(session.start_time).slice(0, 5) : '',
    session.venue,
    session.topic,
    sessionTypeLabel(session.session_type),
  ].filter(Boolean).join(' · ');

  const rows = students.map((s, i) => `
    <tr class="${!s.present ? 'absent-row' : ''}">
      <td>${String(i + 1).padStart(2, '0')}</td>
      <td>${s.student_number}</td>
      <td>${s.full_name || '-'}</td>
      <td>${formatSignInTime(s.recorded_at)}</td>
      <td class="${s.present ? 'p-cell' : 'a-cell'}">${s.present ? 'Present' : 'Absent'}</td>
    </tr>`).join('');

  const app = typeof tutorApplication !== 'undefined' ? tutorApplication : null;
  const st = VF.getState();
  const tutorFullName = app
    ? `${app.first_names || ''} ${app.surname || ''}`.trim()
    : `${st.user?.firstNames || ''} ${st.user?.surname || ''}`.trim() || 'Tutor';
  const studentNo = app?.student_number || st.user?.studentNumber || '-';
  const lecturerName = app?.lecturer_first_names
    ? `${app.lecturer_first_names} ${app.lecturer_surname || ''}`.trim()
    : '-';

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Attendance Register - ${dateLabel}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'DM Sans',sans-serif;font-size:13px;color:#111;background:#fff;padding:44px 52px;max-width:860px;margin:0 auto}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:18px;border-bottom:2px solid #111}
.hdr h1{font-size:26px;font-weight:700;margin-bottom:4px}.hdr p{font-size:12px;color:#666}
.brand{font-size:20px;font-weight:800;letter-spacing:3px;text-align:right;margin-bottom:3px}
.meta{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;margin-bottom:18px}
.mb{padding:10px 14px;border-right:1px solid #e5e5e5}.mb:last-child{border-right:none}
.ml{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#999;font-family:'DM Mono',monospace;margin-bottom:3px}.mv{font-size:12px;font-weight:600}
.sum{display:flex;gap:20px;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:8px;padding:12px 18px;margin-bottom:18px}
.si label{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#999;font-family:'DM Mono',monospace;display:block;margin-bottom:2px}.si span{font-size:18px;font-weight:700}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
thead tr{background:#f7f7f7}th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#999;font-family:'DM Mono',monospace;padding:9px 12px;border-bottom:1px solid #e5e5e5}
td{padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:12px}
tr.absent-row td{color:#bbb}.p-cell{color:#1a7a52;font-weight:600}.a-cell{color:#c0392b;font-weight:600}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:44px;padding-top:16px;border-top:1px solid #e5e5e5}
.sl{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#999;font-family:'DM Mono',monospace;margin-bottom:34px}
.ss{border-top:1px solid #bbb;padding-top:5px;font-size:11px;color:#999}
.ftr{margin-top:28px;padding-top:12px;border-top:1px solid #eee;font-size:10px;color:#ccc;font-family:'DM Mono',monospace;display:flex;justify-content:space-between}
@media print{body{padding:18mm 22mm}@page{margin:0;size:A4}}</style></head><body>
<div class="hdr"><div><h1>Attendance Register</h1><p>${modCode}${currentModuleName ? ' - ' + currentModuleName : ''} · ${dateLabel}</p><p style="margin-top:3px;font-size:11px;color:#999;font-family:'DM Mono',monospace">${meta}</p></div><div><div class="brand">VERIFLOW</div><p style="font-size:11px;color:#999;font-family:'DM Mono',monospace">Tutor Management System</p></div></div>
<div class="meta"><div class="mb"><div class="ml">Tutor</div><div class="mv">${tutorFullName}</div></div><div class="mb"><div class="ml">Student No.</div><div class="mv" style="font-family:'DM Mono',monospace">${studentNo}</div></div><div class="mb"><div class="ml">Module</div><div class="mv">${modCode}</div></div><div class="mb"><div class="ml">Present</div><div class="mv" style="color:#1a7a52">${present} / ${enrolled}</div></div><div class="mb"><div class="ml">Rate</div><div class="mv" style="color:#c8a84b">${pct}%</div></div></div>
<div class="sum"><div class="si"><label>Enrolled</label><span>${enrolled}</span></div><div class="si"><label>Present</label><span style="color:#1a7a52">${present}</span></div><div class="si"><label>Absent</label><span style="color:#c0392b">${absent}</span></div><div class="si"><label>Attendance</label><span style="color:#c8a84b">${pct}%</span></div></div>
<table><thead><tr><th>#</th><th>Student Number</th><th>Full Name</th><th>Sign-in Time</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sig"><div><div class="sl">Tutor Signature</div><div class="ss">${tutorFullName} · ${studentNo}</div></div><div><div class="sl">Lecturer Verification</div><div class="ss">${lecturerName}</div></div></div>
<div class="ftr"><span>Generated by VeriFlow · ${modCode} · ${dateLabel}</span><span>Read-only · Linked to timesheet claim</span></div>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `VeriFlow_Register_${modCode}_${dateLabel.replace(/ /g, '_')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Register exported - ${dateLabel}`);
}

window.openRegister = openRegister;
window.closeRegister = closeRegister;
window.regCloseOutside = regCloseOutside;
window.downloadRegister = downloadRegister;

function sessionActionHtml(s, dateLabel) {
  if (s.status === 'active') {
    const count = s.attendance_count || 0;
    const signIns = count
      ? `<button type="button" class="view-reg-btn" onclick="openRegister(${s.id})"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${count} signed in</button>`
      : `<button type="button" class="view-reg-btn" onclick="openRegister(${s.id})"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View sign-ins</button>`;
    return `<button type="button" class="avail-yes" onclick="openQR(${s.id})">Open Register</button> ${signIns}`;
  }
  if (isScheduled(s.status)) {
    if (s.my_confirmed_at) {
      return '<span style="font-size:11px;color:var(--green);font-family:\'DM Mono\',monospace">Available - waiting for session to start</span>';
    }
    if (s.my_declined_at) {
      return '<span style="font-size:11px;color:var(--red);font-family:\'DM Mono\',monospace">Unavailable</span>';
    }
    return `<button type="button" class="avail-yes" onclick="confirmSessionAvailability(${s.id}, true, this)">Available</button>`
      + `<button type="button" class="avail-no" onclick="confirmSessionAvailability(${s.id}, false, this)">Not available</button>`;
  }
  if (s.status === 'completed') {
    let action = `<button type="button" class="view-reg-btn" onclick="openRegister(${s.id})"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View Register</button>`;
    if (s.attendance_count) {
      action += `<span style="font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;margin-left:8px;">${s.attendance_count} logged</span>`;
    }
    return action;
  }
  if (s.status === 'flagged') {
    return '<span style="color:var(--red);font-size:11px;font-family:\'DM Mono\',monospace">No confirmation submitted</span>';
  }
  if (s.status === 'cancelled') {
    return '<span style="color:var(--muted);font-size:11px;font-family:\'DM Mono\',monospace">Cancelled by lecturer</span>';
  }
  return '<span style="color:var(--muted);font-size:11px">-</span>';
}

function tutorAvailCornerHtml(s) {
  const tickSvg = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
  const xSvg = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  if (isScheduled(s.status)) {
    if (s.my_confirmed_at) {
      return `<div class="vf-sess-corner" title="Available"><svg width="16" height="16" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>`;
    }
    if (s.my_declined_at) {
      return `<div class="vf-sess-corner vf-sess-corner--no" title="Not available"><svg width="14" height="14" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>`;
    }
    return `<div class="vf-sess-corner-pair">
      <button type="button" class="vf-sess-icon-btn vf-sess-icon-btn--no" aria-label="Not available" onclick="event.stopPropagation();confirmSessionAvailability(${s.id}, false, this)">${xSvg}</button>
      <button type="button" class="vf-sess-icon-btn vf-sess-icon-btn--yes" aria-label="Available" onclick="event.stopPropagation();confirmSessionAvailability(${s.id}, true, this)">${tickSvg}</button>
    </div>`;
  }
  if (s.status === 'active') {
    return `<div class="vf-sess-corner vf-sess-corner--live" title="Live"><svg width="16" height="16" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>`;
  }
  if (s.status === 'completed') {
    return `<div class="vf-sess-corner vf-sess-corner--done" title="Completed"><svg width="16" height="16" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>`;
  }
  if (s.status === 'flagged') {
    return `<div class="vf-sess-corner vf-sess-corner--no" title="Flagged"><svg width="14" height="14" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>`;
  }
  if (s.status === 'cancelled') {
    return `<div class="vf-sess-corner vf-sess-corner--no" title="Cancelled"><svg width="14" height="14" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>`;
  }
  return '';
}

function sessionNeedsResponse(s) {
  return isScheduled(s.status) && !s.my_confirmed_at && !s.my_declined_at;
}

function sessionSortKey(s) {
  const day = sessionDateKey(s.session_date) || '9999-99-99';
  const time = s.start_time ? String(s.start_time).slice(0, 5) : '99:99';
  return `${day}T${time}`;
}

function groupTutorSessions(sessions) {
  const needs = [];
  const live = [];
  const upcoming = [];
  const cancelled = [];
  const past = [];

  sessions.forEach((s) => {
    if (s.status === 'active') live.push(s);
    else if (s.status === 'cancelled') cancelled.push(s);
    else if (sessionNeedsResponse(s)) needs.push(s);
    else if (isScheduled(s.status)) upcoming.push(s);
    else past.push(s);
  });

  const bySoonest = (a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b));
  const byLatest = (a, b) => sessionSortKey(b).localeCompare(sessionSortKey(a));
  needs.sort(bySoonest);
  live.sort(bySoonest);
  upcoming.sort(bySoonest);
  cancelled.sort(byLatest);
  past.sort(byLatest);

  return { needs, live, upcoming, cancelled, past };
}

function updateSessionsSummary(sessions) {
  const titleEl = document.getElementById('tm-sess-summary-title');
  const subEl = document.getElementById('tm-sess-summary-sub');
  const statsEl = document.getElementById('tm-sess-summary-stats');
  const chipEl = document.getElementById('tm-sess-summary-chip');
  if (!titleEl || !subEl || !statsEl) return;

  const list = Array.isArray(sessions) ? sessions : [];
  const groups = groupTutorSessions(list);
  const now = new Date();
  const monthCount = sessionsInMonth(list, now.getMonth() + 1, now.getFullYear()).length;
  const next = groups.live[0] || groups.needs[0] || groups.upcoming[0] || null;

  if (chipEl) {
    if (groups.needs.length) {
      chipEl.hidden = false;
      chipEl.textContent = `${groups.needs.length} need reply`;
    } else if (groups.live.length) {
      chipEl.hidden = false;
      chipEl.textContent = `${groups.live.length} live`;
    } else {
      chipEl.hidden = true;
    }
  }

  if (!next) {
    titleEl.textContent = 'No upcoming sessions';
    subEl.textContent = 'Past sessions stay available for registers below.';
  } else {
    const isToday = sessionDateKey(next.session_date) === localTodayKey();
    const dateLabel = isToday ? 'Today' : formatSessionDate(next, true);
    const time = next.start_time ? String(next.start_time).slice(0, 5) : '-';
    const typeLabel = sessionTypeLabel(next.session_type);
    titleEl.textContent = next.topic || typeLabel || 'Session';
    subEl.textContent = `${dateLabel} · ${time} · ${next.venue || 'Venue TBA'}`;
  }

  statsEl.textContent = `${monthCount} this month`;
}

function tutorMobileCardActions(s) {
  if (s.status === 'active') {
    const count = s.attendance_count || 0;
    return `<div class="vf-sess-cta-row">
      <button type="button" class="vf-sess-cta vf-sess-cta--primary" onclick="event.stopPropagation();openQR(${s.id})">Open QR</button>
      <button type="button" class="vf-sess-cta vf-sess-cta--ghost" onclick="event.stopPropagation();openRegister(${s.id})">${count} sign-ins</button>
    </div>`;
  }
  if (s.status === 'completed') {
    return `<div class="vf-sess-cta-row">
      <button type="button" class="vf-sess-cta vf-sess-cta--primary" onclick="event.stopPropagation();openRegister(${s.id})">View register</button>
    </div>`;
  }
  if (isScheduled(s.status) && s.my_confirmed_at) {
    return '<div class="vf-sess-status-note">Available - waiting for session to start</div>';
  }
  if (isScheduled(s.status) && s.my_declined_at) {
    return '<div class="vf-sess-status-note vf-sess-status-note--warn">Marked unavailable</div>';
  }
  if (s.status === 'flagged') {
    return '<div class="vf-sess-status-note vf-sess-status-note--warn">No confirmation submitted</div>';
  }
  if (s.status === 'cancelled') {
    return '<div class="vf-sess-status-note vf-sess-status-note--warn">Cancelled by lecturer</div>';
  }
  return '';
}

function renderOneSessionCard(s) {
  const isToday = sessionDateKey(s.session_date) === localTodayKey();
  const dateLabel = isToday ? `Today · ${formatSessionDate(s)}` : formatSessionDate(s, true);
  const timeLabel = formatTimeRange(s);
  const typeLabel = sessionTypeLabel(s.session_type);
  const title = (s.topic || typeLabel || 'Session').replace(/</g, '&lt;');
  const desc = `${dateLabel} · ${s.venue || 'Venue TBA'}`.replace(/</g, '&lt;');
  const startLabel = s.start_time ? String(s.start_time).slice(0, 5) : timeLabel;
  const tone = s.status === 'completed' || s.status === 'flagged' || s.status === 'cancelled' ? ' vf-sess-card--muted' : '';
  const live = s.status === 'active' ? ' vf-sess-card--live' : '';
  const pendingAvail = sessionNeedsResponse(s);
  const desktopActions = pendingAvail ? '' : sessionActionHtml(s, dateLabel);
  const mobileActions = pendingAvail ? '' : tutorMobileCardActions(s);
  const statusPill = s.status === 'cancelled'
    ? '<span class="vf-sess-pill vf-sess-pill--cancelled">Cancelled</span>'
    : `<span class="vf-sess-pill vf-sess-pill--due">Starts ${startLabel}</span>`;

  return `<article class="vf-sess-card${tone}${live}" data-session-id="${s.id}">
    <div class="vf-sess-card-top">
      <div class="vf-sess-card-copy">
        <h3 class="vf-sess-card-title">${title}</h3>
        <p class="vf-sess-card-desc">${desc}</p>
      </div>
      ${tutorAvailCornerHtml(s)}
    </div>
    <div class="vf-sess-card-tags">
      <span class="vf-sess-pill">${typeLabel}</span>
      ${statusPill}
    </div>
    ${desktopActions ? `<div class="vf-sess-card-actions">${desktopActions}</div>` : ''}
    ${mobileActions}
  </article>`;
}

function renderSessionSection(label, items) {
  if (!items.length) return '';
  return `<section class="tm-sess-section">
    <div class="tm-sess-section-head">
      <span class="tm-sess-section-label">${label}</span>
      <span class="tm-sess-section-count">${items.length}</span>
    </div>
    <div class="tm-sess-section-list">
      ${items.map(renderOneSessionCard).join('')}
    </div>
  </section>`;
}

function renderSessionsCards(sessions) {
  const wrap = document.getElementById('sessions-cards');
  if (!wrap) return;

  const list = Array.isArray(sessions) ? sessions : [];
  updateSessionsSummary(list);

  if (!list.length) {
    wrap.innerHTML = `<div class="vf-sess-empty">
      <div class="vf-sess-empty-ico" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </div>
      <h3>No sessions assigned yet</h3>
      <p>Once your lecturer assigns a session on this module, it'll show up here with the date, time, and register.</p>
    </div>`;
    return;
  }

  const groups = groupTutorSessions(list);
  wrap.innerHTML = [
    renderSessionSection('Needs your response', groups.needs),
    renderSessionSection('Live now', groups.live),
    renderSessionSection('Upcoming', groups.upcoming),
    renderSessionSection('Cancelled', groups.cancelled),
    renderSessionSection('Past', groups.past),
  ].filter(Boolean).join('');
}

function renderDashboardUpcoming(sessions) {
  const tbody = document.getElementById('dash-upcoming-body');
  if (!tbody) return;

  const upcoming = sessions
    .filter(s => isUpcoming(s.status))
    .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))
    .slice(0, 5);

  updateMobileHubNextSession(upcoming[0] || null, upcoming.length);

  if (!upcoming.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">No upcoming sessions for this module.</td></tr>';
    return;
  }

  tbody.innerHTML = upcoming.map(s => `
    <tr onclick="showPage('sessions',document.getElementById('nav-sessions'))">
      <td style="font-weight:600;color:var(--text)">${s.module_code}</td>
      <td style="color:var(--muted);font-family:'DM Mono',monospace">${formatSessionDate(s, true)}</td>
      <td style="color:var(--muted);font-family:'DM Mono',monospace">${s.start_time ? String(s.start_time).slice(0, 5) : '-'}</td>
      <td><span class="type-chip ${s.session_type === 'practical' ? 'practical' : ''}">${sessionTypeLabel(s.session_type)}</span></td>
      <td>${s.status === 'active'
        ? `<button type="button" class="avail-yes" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();openQR(${s.id})">Open Register</button>`
        : tutorStatusChip(s.status)}</td>
    </tr>`).join('');
}

function updateMobileHubNextSession(next, upcomingCount) {
  const titleEl = document.getElementById('td-hub-next-title');
  const metaEl = document.getElementById('td-hub-next-meta');
  const sessSub = document.getElementById('hub-sessions-sub');
  if (sessSub) {
    sessSub.textContent = upcomingCount
      ? `${upcomingCount} upcoming`
      : 'No upcoming sessions';
  }
  if (!titleEl || !metaEl) return;
  if (!next) {
    titleEl.textContent = 'No upcoming session';
    metaEl.textContent = 'Check the calendar for open dates';
    return;
  }
  titleEl.textContent = next.topic || sessionTypeLabel(next.session_type) || 'Session';
  const time = next.start_time ? String(next.start_time).slice(0, 5) : '-';
  const venue = next.venue || 'Venue TBA';
  metaEl.textContent = `${formatSessionDate(next, true)} · ${time} · ${venue}`;
}

function sessionRegisterLabel(s, dateLabel) {
  const time = s.start_time ? ` · ${String(s.start_time).slice(0, 5)}` : '';
  return `${s.module_code} - ${dateLabel}${time}`;
}

function renderSessionsTable(sessions) {
  const tbody = document.getElementById('sessions-table-body');
  renderSessionsCards(sessions);
  if (!tbody) return;

  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">No sessions assigned on this module yet.</td></tr>';
    return;
  }

  tbody.innerHTML = sessions.map(s => {
    const isPast = s.status === 'completed' || s.status === 'cancelled' || s.status === 'flagged';
    const isToday = sessionDateKey(s.session_date) === localTodayKey();
    const dateLabel = isToday ? `Today · ${formatSessionDate(s)}` : formatSessionDate(s, true);
    const dateStyle = isToday && s.status !== 'cancelled'
      ? 'color:var(--text);font-weight:700'
      : (isPast ? 'color:var(--muted)' : 'color:var(--text);font-weight:500');
    const action = sessionActionHtml(s, dateLabel);

    return `<tr${isPast ? ' style="background:rgba(0,0,0,.02)"' : ''}>
      <td style="${dateStyle}">${dateLabel}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">${formatTimeRange(s)}</td>
      <td style="color:var(--muted)">${s.topic || '-'}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">${s.venue || '-'}</td>
      <td><span class="type-chip ${s.session_type === 'practical' ? 'practical' : ''}">${sessionTypeLabel(s.session_type)}</span></td>
      <td>${tutorStatusChip(s.status)}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

function renderHourLogTable(sessions) {
  const tbody = document.getElementById('hourlog-table-body');
  if (!tbody) return;

  const completed = sessions.filter(s => s.status === 'completed' || s.status === 'flagged');
  if (!completed.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">No logged hours for this module yet.</td></tr>';
    return;
  }

  tbody.innerHTML = completed.slice(0, 10).map(s => `
    <tr>
      <td style="color:var(--text);font-weight:500">${formatSessionDate(s)}</td>
      <td style="color:var(--muted)">${s.topic || '-'}</td>
      <td><span class="type-chip ${s.session_type === 'practical' ? 'practical' : ''}">${sessionTypeLabel(s.session_type)}</span></td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">${sessionClaimHours(s.session_type)} hrs</td>
      <td>${tutorStatusChip(s.status)}</td>
    </tr>`).join('');
}

function sessionsInMonth(sessions, month, year) {
  return sessions.filter((s) => {
    const key = sessionDateKey(s.session_date);
    if (!key) return false;
    const [y, m] = key.split('-').map(Number);
    return m === month && y === year;
  });
}

function buildDashboardMonthSeries(sessions, monthsBack = 6) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const series = [];
  for (let i = monthsBack; i >= 0; i -= 1) {
    const d = new Date(year, month - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    series.push({
      month: m,
      year: y,
      label: MONTH_SHORT[m],
      count: sessionsInMonth(sessions, m, y).length,
      isCurrent: m === month && y === year,
    });
  }
  return series;
}

function buildHourLogMonthSeries(sessions, monthsBack = 6) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const series = [];
  for (let i = monthsBack; i >= 0; i -= 1) {
    const d = new Date(year, month - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const monthSessions = sessionsInMonth(sessions, m, y)
      .filter((s) => s.status === 'completed' || s.status === 'flagged');
    const hours = monthSessions.reduce(
      (sum, s) => sum + sessionClaimHours(s.session_type),
      0
    );
    series.push({
      month: m,
      year: y,
      label: MONTH_SHORT[m],
      hours,
      isCurrent: m === month && y === year,
    });
  }
  return series;
}

function renderHourLogMonthChart(sessions) {
  const series = buildHourLogMonthSeries(sessions, 6);
  const maxHours = Math.max(...series.map((s) => s.hours), 1);
  const current = series[series.length - 1];
  const mobile = window.matchMedia('(max-width: 900px)').matches;

  const summaryEl = document.getElementById('hourlog-month-summary');
  if (summaryEl) {
    if (mobile && current) {
      summaryEl.textContent = `${current.hours} HRS IN ${MONTH_SHORT[current.month].toUpperCase()}`;
    } else {
      summaryEl.textContent = current
        ? `${current.hours} hr${current.hours === 1 ? '' : 's'} logged in ${MONTH_NAMES[current.month - 1]}`
        : 'Hours logged per month';
    }
  }

  const chartEl = document.getElementById('hourlog-month-chart');
  if (chartEl) {
    if (mobile) {
      chartEl.classList.add('hl-month-track');
      chartEl.innerHTML = series.map((m) => `
        <div class="hl-mbar-wrap">
          <div class="hl-mbar${m.isCurrent ? ' active' : ''}" title="${m.hours} hrs"></div>
          <div class="hl-mbar-label${m.isCurrent ? ' active' : ''}">${m.label}</div>
        </div>`).join('');
    } else {
      chartEl.classList.remove('hl-month-track');
      chartEl.innerHTML = series.map((m, i) => {
        const height = m.hours ? Math.max(8, Math.round((m.hours / maxHours) * 100)) : 4;
        return `<div class="chart-bar${m.isCurrent ? ' active' : ''}" title="${m.hours} hrs" style="height:${height}%;animation-delay:${0.2 + i * 0.05}s;"></div>`;
      }).join('');
      chartEl.querySelectorAll('.chart-bar').forEach((bar) => {
        bar.addEventListener('click', () => {
          chartEl.querySelectorAll('.chart-bar').forEach((b) => b.classList.remove('active'));
          bar.classList.add('active');
        });
      });
    }
  }

  const labelsEl = document.getElementById('hourlog-month-chart-labels');
  if (labelsEl) {
    if (mobile) {
      labelsEl.innerHTML = '';
      labelsEl.hidden = true;
    } else {
      labelsEl.hidden = false;
      labelsEl.innerHTML = series.map((m) =>
        `<span class="${m.isCurrent ? 'is-current' : ''}">${m.label}</span>`
      ).join('');
    }
  }
}

function renderDashboardMonthPanel(sessions) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthSessions = sessionsInMonth(sessions, month, year);
  const total = monthSessions.length;
  const confirmed = monthSessions.filter((s) => s.status === 'completed').length;
  const progressPct = total ? Math.round((confirmed / total) * 100) : 0;

  const subEl = document.getElementById('dash-month-sessions-sub');
  if (subEl) {
    subEl.textContent = total
      ? `${total} session${total === 1 ? '' : 's'} · ${confirmed} confirmed`
      : 'No sessions this month';
  }

  const pctEl = document.getElementById('dash-month-progress-pct');
  if (pctEl) pctEl.textContent = `${progressPct}%`;

  const barEl = document.getElementById('dash-month-progress-bar');
  if (barEl) barEl.style.width = `${progressPct}%`;

  const series = buildDashboardMonthSeries(sessions, 6);
  const maxCount = Math.max(...series.map((s) => s.count), 1);
  const chartEl = document.getElementById('dash-month-chart');
  if (chartEl) {
    chartEl.innerHTML = series.map((m, i) => {
      const height = m.count ? Math.max(8, Math.round((m.count / maxCount) * 100)) : 4;
      return `<div class="chart-bar${m.isCurrent ? ' active' : ''}" style="height:${height}%;animation-delay:${0.6 + i * 0.05}s;"></div>`;
    }).join('');
    chartEl.querySelectorAll('.chart-bar').forEach((bar) => {
      bar.addEventListener('click', () => {
        chartEl.querySelectorAll('.chart-bar').forEach((b) => b.classList.remove('active'));
        bar.classList.add('active');
      });
    });
  }

  const labelsEl = document.getElementById('dash-month-chart-labels');
  if (labelsEl) {
    labelsEl.innerHTML = series.map((m) =>
      `<span${m.isCurrent ? ' style="color:var(--text);font-weight:600;"' : ''}>${m.label}</span>`
    ).join('');
  }
}

function updateDashboardStats(sessions) {
  const now = new Date();
  const monthSessions = sessionsInMonth(sessions, now.getMonth() + 1, now.getFullYear());

  const completed = monthSessions.filter(s => s.status === 'completed').length;
  const pending = monthSessions.filter(s => isUpcoming(s.status)).length;
  const flagged = monthSessions.filter(s => s.status === 'flagged').length;

  const allCompleted = sessions.filter(s => s.status === 'completed' || s.status === 'flagged');
  const hoursUsed = allCompleted.reduce((sum, s) => {
    return sum + sessionClaimHours(s.session_type);
  }, 0);
  const hoursLeft = Math.max(0, getSemesterHoursCap() - hoursUsed);
  const pct = Math.min(100, Math.round((hoursUsed / getSemesterHoursCap()) * 100));

  setText('#stat-hours-used', String(hoursUsed));
  setText('#stat-hours-left', String(hoursLeft));
  setText('#stat-sessions-month', String(monthSessions.length));
  setText('#stat-sessions-sub', `${completed} confirmed · ${pending} pending`);
  setText('#semester-hours-label', `${hoursUsed} / ${getSemesterHoursCap()} hrs (${pct}%)`);

  const cap = getSemesterHoursCap();
  setText('#td-hub-hrs-used', String(hoursUsed));
  setText('#td-hub-hrs-left', String(hoursLeft));
  setText('#td-hub-hrs-total', String(cap));
  setText('#td-hub-pct', `${pct}%`);
  setText('#td-hub-sess-month', String(monthSessions.length));
  setText('#td-hub-month-sub', `${completed} confirmed · ${pending} pending`);
  setText('#hub-hourlog-sub', 'Track logged time');
  setText('#hub-hourlog-meta', `${hoursUsed} / ${cap}`);

  const ring = document.getElementById('td-hub-ring');
  if (ring) {
    const circ = 282.7;
    ring.setAttribute('stroke-dashoffset', String(circ * (1 - pct / 100)));
  }

  const semLabel = document.getElementById('td-hub-sem-label');
  if (semLabel) {
    const d = new Date();
    semLabel.textContent = `${MONTH_SHORT[d.getMonth() + 1]} ${d.getFullYear()}`;
  }
  const stripMeta = document.getElementById('td-hub-strip-meta');
  if (stripMeta) {
    const d = new Date();
    stripMeta.textContent = `${MONTH_SHORT[d.getMonth() + 1].toUpperCase()} ${d.getFullYear()}`;
  }
  renderHubMonthStrip(sessions);

  const semFill = document.querySelector('#page-dashboard .sem-fill');
  if (semFill) semFill.style.width = pct + '%';

  setText('#hl-hours-used', String(hoursUsed));
  setText('#hl-hours-left', String(hoursLeft));
  setText('#hl-sessions-month', String(monthSessions.length));
  setText('#hl-sessions-sub', `${completed} confirmed · ${pending} pending · ${flagged} flagged`);
  setText('#hourlog-semester-label', `${hoursUsed} / ${getSemesterHoursCap()} hrs (${pct}%)`);
  setText('#hl-pulse-used', String(hoursUsed));
  setText('#hl-pulse-cap', ` / ${getSemesterHoursCap()}`);
  setText('#hl-pulse-pct', `${pct}%`);
  setText('#hl-pulse-left', String(hoursLeft));
  setText('#hl-pulse-sess', `${completed} · ${pending}`);
  setText('#hl-pulse-sess-lbl', 'CONFIRMED · PENDING');

  const hlFill = document.querySelector('#page-hourlog .sem-fill');
  if (hlFill) hlFill.style.width = pct + '%';

  renderDashboardMonthPanel(sessions);
  renderHourLogMonthChart(sessions);
}

function renderHubMonthStrip(sessions) {
  const strip = document.getElementById('td-hub-strip');
  const msg = document.getElementById('td-hub-strip-msg');
  if (!strip) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = now.getDate();

  const sessionDays = new Set();
  (sessions || []).forEach((s) => {
    const key = sessionDateKey(s.session_date);
    if (!key) return;
    const [y, m, d] = key.split('-').map(Number);
    if (y === year && m === month + 1) sessionDays.add(d);
  });

  if (msg) {
    msg.textContent = sessionDays.size
      ? `${sessionDays.size} day${sessionDays.size === 1 ? '' : 's'} with sessions this month`
      : "No sessions logged yet this month - once you're assigned one, it'll light up here.";
  }

  let html = '';
  for (let i = 1; i <= daysInMonth; i++) {
    const classes = ['td-hub-day-dot'];
    if (sessionDays.has(i)) classes.push('has-session');
    if (i === today) classes.push('is-today');
    const showLabel = i === 1 || i === today || i === daysInMonth;
    html += `<div class="td-hub-day-wrap"><div class="${classes.join(' ')}"></div>${
      showLabel ? `<div class="td-hub-day-label">${i}</div>` : ''
    }</div>`;
  }
  strip.innerHTML = html;
}

function claimStatusLabel(status) {
  const map = {
    pending_lecturer: 'Pending lecturer review',
    pending_coordinator: 'Pending coordinator approval',
    approved: 'Approved',
    returned_by_lecturer: 'Returned by lecturer',
    returned_by_coordinator: 'Returned by coordinator',
  };
  return map[status] || status;
}

function formatClaimAmount(amount) {
  if (amount == null) return '-';
  return 'R' + Number(amount).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function monthYearLabel(month, year) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function dueDateLabel(month, year) {
  return `Due 15 ${MONTH_NAMES[month - 1]} ${year}`;
}

function formatTimesheetDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function formatTimesheetTimeRange(startTime, sessionType) {
  if (!startTime) return '-';
  const start = String(startTime).slice(0, 5);
  const mins = sessionType === 'practical' ? 180 : 45;
  const parts = start.split(':').map(Number);
  const endDate = new Date(2000, 0, 1, parts[0], parts[1] + mins);
  const end = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
  return `${start}-${end}`;
}

function attendanceCountClass(present, enrolled) {
  if (!enrolled) return '';
  return (present / enrolled) >= 0.75 ? 'good' : 'low';
}

function claimStatusBadgeClass(status) {
  if (status === 'approved') return 'paid';
  if (status === 'pending_lecturer' || status === 'pending_coordinator') return 'review';
  if (status === 'returned_by_lecturer' || status === 'returned_by_coordinator') return 'not-sub';
  return 'not-sub';
}

function isReturnedClaimStatus(status) {
  return status === 'returned_by_lecturer' || status === 'returned_by_coordinator';
}

function formatClaimReviewDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function tutorApprovalStepBadge(state) {
  if (state === 'approved') return 'Approved';
  if (state === 'pending') return 'In review';
  if (state === 'returned') return 'Returned';
  return 'Upcoming';
}

function tutorLecturerStepState(status) {
  if (status === 'pending_lecturer') return 'pending';
  if (status === 'returned_by_lecturer') return 'returned';
  if (['pending_coordinator', 'approved', 'returned_by_coordinator'].includes(status)) return 'approved';
  return 'waiting';
}

function tutorCoordinatorStepState(status) {
  if (status === 'pending_coordinator') return 'pending';
  if (status === 'returned_by_coordinator') return 'returned';
  if (status === 'approved') return 'approved';
  return 'waiting';
}

function tutorStepIcon(state) {
  if (state === 'approved') {
    return '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
  }
  if (state === 'pending') {
    return '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>';
  }
  if (state === 'returned') {
    return '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }
  return '<span class="at-dot-idle"></span>';
}

function enrichTutorClaim(claim) {
  if (!claim) return null;
  const fromList = CLAIMS.find((c) => c.id === claim.id);
  const app = typeof tutorApplication !== 'undefined' ? tutorApplication : null;
  return {
    ...claim,
    ...(fromList || {}),
    lecturer_first_names: (fromList || claim).lecturer_first_names || app?.lecturer_first_names,
    lecturer_surname: (fromList || claim).lecturer_surname || app?.lecturer_surname,
  };
}

function renderTutorApprovalStep(role, subtitle, state, date, note, isLast) {
  const statusLabel = tutorApprovalStepBadge(state);
  const noteHtml = note ? `<div class="at-note">${note}</div>` : '';
  const dateHtml = date ? `<div class="at-date">${date}</div>` : '';
  return `<div class="at-step at-step--${state}${isLast ? ' at-step--last' : ''}">
    <div class="at-rail">
      <div class="at-dot at-dot--${state}">${tutorStepIcon(state)}</div>
      ${isLast ? '' : `<div class="at-line at-line--${state === 'approved' ? 'done' : 'idle'}"></div>`}
    </div>
    <div class="at-body">
      <div class="at-head">
        <div class="at-role">${role}</div>
        <span class="at-badge at-badge--${state}">${statusLabel}</span>
      </div>
      ${subtitle ? `<div class="at-sub">${subtitle}</div>` : ''}
      ${dateHtml}
      ${noteHtml}
    </div>
  </div>`;
}

function tutorLecturerStepSubtitle(state, lecturerName) {
  if (state === 'pending') return lecturerName || 'Awaiting review';
  if (state === 'returned') return 'Sent back to you';
  if (state === 'approved') return 'Forwarded to coordinator';
  return lecturerName || 'Not yet';
}

function tutorCoordinatorStepSubtitle(state) {
  if (state === 'waiting') return 'After lecturer approval';
  return 'FYE Office';
}

function renderTutorApprovalTimeline(claim) {
  if (!claim) return '';

  const lecturerName = claim.lecturer_first_names
    ? `${claim.lecturer_first_names} ${claim.lecturer_surname || ''}`.trim()
    : 'Assigned lecturer';
  const lecState = tutorLecturerStepState(claim.status);
  const coordState = tutorCoordinatorStepState(claim.status);
  const lecDate = lecState === 'approved' ? formatClaimReviewDate(claim.lecturer_reviewed_at) : null;
  const coordDate = coordState === 'approved' ? formatClaimReviewDate(claim.coordinator_reviewed_at) : null;
  const lecNote = lecState === 'returned' ? (claim.lecturer_note || '') : '';
  const coordNote = coordState === 'returned' ? (claim.coordinator_note || '') : '';

  return `<div class="approval-track">
    ${renderTutorApprovalStep('Lecturer review', tutorLecturerStepSubtitle(lecState, lecturerName), lecState, lecDate, lecNote, false)}
    ${renderTutorApprovalStep('Coordinator', tutorCoordinatorStepSubtitle(coordState), coordState, coordDate, coordNote, true)}
  </div>`;
}

function renderTutorClaimHistoryRow(c) {
  const lecState = tutorLecturerStepState(c.status);
  const coordState = tutorCoordinatorStepState(c.status);
  return `<button type="button" class="claim-history-row" onclick="goToClaimMonth(${c.period_month}, ${c.period_year})">
    <div class="chr-track" aria-hidden="true">
      <span class="chr-pip chr-pip--${lecState}"></span>
      <span class="chr-pip-line ${lecState === 'approved' ? 'done' : ''}"></span>
      <span class="chr-pip chr-pip--${coordState}"></span>
    </div>
    <div class="chr-body">
      <div class="chr-title">${monthYearLabel(c.period_month, c.period_year)}</div>
      <div class="chr-meta">${c.session_count || 0} session${c.session_count === 1 ? '' : 's'} · ${formatClaimAmount(c.total_amount)}</div>
    </div>
    <span class="stag ${claimStatusBadgeClass(c.status)}">${claimStatusLabel(c.status)}</span>
    <svg class="chr-chevron" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
  </button>`;
}

function goToClaimMonth(month, year) {
  claimsPeriodMonth = month;
  claimsPeriodYear = year;
  const nav = document.getElementById('nav-claims');
  if (typeof showPage === 'function' && nav) {
    showPage('claims', nav);
  } else {
    loadClaims();
  }
  requestAnimationFrame(() => {
    document.getElementById('claims-list-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function timesheetStatusSub(ts) {
  if (ts.claim) {
    const submitted = ts.claim.submitted_at
      ? new Date(ts.claim.submitted_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
      : '-';
    return `${claimStatusLabel(ts.claim.status)} · Submitted ${submitted}`;
  }
  if (ts.pastDue) return `Not submitted · ${dueDateLabel(ts.periodMonth, ts.periodYear)}`;
  return `Not submitted · ${dueDateLabel(ts.periodMonth, ts.periodYear)}`;
}

function timesheetClaimMetaHtml(ts, dueLine) {
  if (ts.claim) {
    return `<div class="ts-claim-summary-sub">${timesheetStatusSub(ts)}</div>`;
  }
  if (ts.pastDue) {
    return `<div class="ts-claim-summary-sub">Not submitted · ${dueLine}<br>Past due · ${dueLine}</div>`;
  }
  return `<div class="ts-claim-summary-sub">Not submitted · ${dueLine}</div>`;
}

function renderTimesheetRows(ts) {
  const rows = ts.sessions || [];
  const claimedIds = new Set(ts.claimedSessionIds || []);

  if (!rows.length) {
    return '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">No completed sessions this month for this module.</td></tr>';
  }

  return rows.map((row) => {
    const sessionId = row.id;
    const present = row.attendance_count ?? 0;
    const enrolled = row.enrolled_count ?? 0;
    const sessionType = row.session_type;
    const hours = row.claimed_hours ?? '-';
    const notOnClaim = ts.claim && !claimedIds.has(sessionId);
    const rowStyle = notOnClaim ? ' style="background:rgba(200,168,75,.06)"' : '';

    return `<tr${rowStyle}>
      <td style="font-weight:500">${formatTimesheetDate(row.session_date)}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted);font-size:11px">${formatTimesheetTimeRange(row.start_time, sessionType)}</td>
      <td style="color:var(--muted)">${row.venue || '-'}</td>
      <td>${row.topic || '-'}${notOnClaim ? ' <span style="font-size:10px;color:var(--yellow);margin-left:6px">Not on claim</span>' : ''}</td>
      <td><span class="type-chip ${sessionType === 'practical' ? 'practical' : ''}">${sessionTypeLabel(sessionType)}</span></td>
      <td><span class="att-count ${attendanceCountClass(present, enrolled)}">${present} / ${enrolled || '-'}</span></td>
      <td style="font-family:'DM Mono',monospace">${hours} hrs</td>
    </tr>`;
  }).join('');
}

function renderTimesheetSessionCards(ts) {
  const rows = ts.sessions || [];
  const claimedIds = new Set(ts.claimedSessionIds || []);

  if (!rows.length) {
    return '<div class="ts-session-empty">No completed sessions this month for this module.</div>';
  }

  return rows.map((row) => {
    const present = row.attendance_count ?? 0;
    const enrolled = row.enrolled_count ?? 0;
    const sessionType = row.session_type;
    const hours = row.claimed_hours ?? '-';
    const notOnClaim = ts.claim && !claimedIds.has(row.id);
    const timeLabel = formatTimesheetTimeRange(row.start_time, sessionType);
    const startOnly = timeLabel.includes('-') ? timeLabel.split('-')[0] : timeLabel;

    return `<article class="ts-session-card${notOnClaim ? ' ts-session-card--warn' : ''}">
      <div class="ts-session-top">
        <div class="ts-session-when">${formatTimesheetDate(row.session_date)} · ${startOnly}</div>
        <div class="ts-session-hrs">${hours} hrs</div>
      </div>
      <div class="ts-session-title">${row.topic || '-'} · ${sessionTypeLabel(sessionType)}</div>
      <div class="ts-session-meta">
        <span>${row.venue || '-'}</span>
        <span class="att-count ${attendanceCountClass(present, enrolled)}">${present}/${enrolled || '-'} attended</span>
      </div>
      ${notOnClaim ? '<div class="ts-session-flag">Not on claim</div>' : ''}
    </article>`;
  }).join('');
}

function renderTimesheetView(ts) {
  const wrap = document.getElementById('claims-list-wrap');
  if (!wrap) return;

  if (!ts) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">Could not load timesheet.</div>';
    return;
  }

  currentTimesheet = ts;
  const label = monthYearLabel(ts.periodMonth, ts.periodYear);
  const totalHours = ts.claim ? ts.lineItems.reduce((s, r) => s + Number(r.claimed_hours || 0), 0) : ts.totalHours;
  const totalAmount = timesheetClaimTotal(ts);
  const monthShort = MONTH_NAMES[ts.periodMonth - 1];
  let claimForView = enrichTutorClaim(ts.claim);
  const statusClass = claimForView ? claimStatusBadgeClass(claimForView.status) : 'not-sub';
  const statusText = claimForView ? claimStatusLabel(claimForView.status) : 'Not submitted';
  const canSubmit = ts.canSubmit;
  const canUpdate = ts.canUpdate;
  const unclaimedCount = (ts.unclaimedSessions || []).length;
  const isReturned = claimForView && isReturnedClaimStatus(claimForView.status);
  const returnNote = claimForView
    ? (claimForView.lecturer_note || claimForView.coordinator_note || '')
    : '';
  const submitLabel = isReturned
    ? 'Resubmit to Lecturer'
    : (canUpdate ? 'Update claim' : (ts.claim ? 'Submitted' : 'Submit to Lecturer'));
  const pastClaims = CLAIMS.filter((c) =>
    !(c.period_month === ts.periodMonth && c.period_year === ts.periodYear)
  );
  const nextDisabled = ts.periodMonth === new Date().getMonth() + 1 && ts.periodYear === new Date().getFullYear();
  const dueLine = dueDateLabel(ts.periodMonth, ts.periodYear);

  const unclaimedBanner = unclaimedCount && ts.claim
    ? (ts.claim.status === 'approved'
      ? `<div class="ts-info-bar returned">You completed ${unclaimedCount} session(s) after this claim was approved. Contact the Student Employment Office to have the claim returned so you can resubmit with all sessions.</div>`
      : (canUpdate
        ? `<div class="ts-info-bar">You have ${unclaimedCount} new completed session(s) not yet on this claim. Click <strong>Update claim</strong> to include them before your lecturer reviews.</div>`
        : ''))
    : '';

  wrap.innerHTML = `
    <div class="ts-month-nav">
      <button type="button" class="ts-month-btn" onclick="changeClaimsMonth(-1)">‹ Prev</button>
      <span class="ts-month-label">${label}</span>
      <button type="button" class="ts-month-btn" onclick="changeClaimsMonth(1)" ${nextDisabled ? 'disabled' : ''}>Next ›</button>
    </div>
    ${ts.pastDue && !ts.claim ? `<div class="ts-info-bar ts-banner-warn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>
      <span>Submission deadline passed (${dueLine}). Contact your lecturer if you still need to submit.</span>
    </div>` : ''}
    ${unclaimedBanner}
    <div class="ts-claim-summary">
      <div class="ts-claim-summary-top">
        <div class="ts-claim-summary-label">Claim</div>
        <span class="stag ${statusClass}">${statusText}</span>
      </div>
      <div class="ts-claim-summary-figures">
        <div class="ts-claim-summary-nums">
          <span class="ts-claim-hours">${totalHours} <span class="ts-claim-hours-unit">hrs</span></span>
          <span class="ts-claim-amt">${formatClaimAmount(totalAmount)}</span>
        </div>
        <button type="button" class="ts-claim-dl" onclick="downloadTimesheet()" aria-label="Download timesheet">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        </button>
      </div>
      ${timesheetClaimMetaHtml(ts, dueLine)}
    </div>
    ${claimForView ? renderTutorApprovalTimeline(claimForView) : ''}
    ${isReturned && returnNote ? `<div class="ts-info-bar returned">Please review the feedback above, correct your timesheet, and resubmit below.</div>` : ''}
    <div class="ts-table-wrap">
      <div class="ts-table-header">
        <div>
          <div class="ts-table-title">${label} - Timesheet</div>
          <div class="ts-table-sub">${timesheetStatusSub(ts)}</div>
        </div>
        <div class="ts-table-actions">
          <span class="stag ${statusClass}">${statusText}</span>
          <button type="button" class="dl-btn" onclick="downloadTimesheet()">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download
          </button>
        </div>
      </div>
      <table class="ts-table">
        <thead>
          <tr>
            <th>Date</th><th>Time</th><th>Venue</th><th>Topic</th><th>Type</th><th>Attendance</th><th>Hours</th>
          </tr>
        </thead>
        <tbody>${renderTimesheetRows(ts)}</tbody>
      </table>
      <div class="ts-session-list" aria-label="Sessions this month">
        <div class="ts-session-list-head">
          <span class="ts-session-list-title">Sessions</span>
          <span class="ts-session-list-count">${(ts.sessions || []).length}</span>
        </div>
        ${renderTimesheetSessionCards(ts)}
      </div>
    </div>
    <div class="submit-bar">
      <div class="submit-info">
        ${monthShort} so far: <strong>${totalHours} hrs</strong> · <strong class="submit-amt">${formatClaimAmount(totalAmount)}</strong> · ${dueLine}
      </div>
      <button type="button" class="submit-btn" onclick="submitTimesheet()" ${(canSubmit || canUpdate) ? '' : 'disabled'}>${submitLabel}</button>
    </div>
    ${pastClaims.length ? `
      <div class="claim-history-section">
        <div class="claim-history-heading">Claim history</div>
        <div class="claim-history-list">
          ${pastClaims.slice(0, 8).map((c) => renderTutorClaimHistoryRow(c)).join('')}
        </div>
      </div>` : ''}`;
}

function changeClaimsMonth(delta) {
  claimsPeriodMonth += delta;
  if (claimsPeriodMonth < 1) {
    claimsPeriodMonth = 12;
    claimsPeriodYear -= 1;
  } else if (claimsPeriodMonth > 12) {
    claimsPeriodMonth = 1;
    claimsPeriodYear += 1;
  }
  const now = new Date();
  if (claimsPeriodYear > now.getFullYear() || (claimsPeriodYear === now.getFullYear() && claimsPeriodMonth > now.getMonth() + 1)) {
    claimsPeriodMonth = now.getMonth() + 1;
    claimsPeriodYear = now.getFullYear();
  }
  loadClaims();
}

async function submitTimesheet() {
  if (!currentTimesheet?.canSubmit && !currentTimesheet?.canUpdate) return;
  const sessionIds = currentTimesheet.sessions.map((s) => s.id);
  if (!sessionIds.length) {
    showToast('No sessions to submit for this month');
    return;
  }

  const btn = document.querySelector('.submit-btn');
  const isResubmit = currentTimesheet.claim && isReturnedClaimStatus(currentTimesheet.claim.status);
  const isUpdate = currentTimesheet.canUpdate && !isResubmit;
  if (btn) {
    btn.disabled = true;
    btn.textContent = isResubmit ? 'Resubmitting…' : (isUpdate ? 'Updating…' : 'Submitting…');
  }

  try {
    if (isResubmit) {
      await VF.apiFetch(`/claims/${currentTimesheet.claim.id}/resubmit`, {
        method: 'PATCH',
        body: { sessionIds },
      });
      showToast('Timesheet resubmitted to your lecturer');
    } else if (isUpdate) {
      await VF.apiFetch(`/claims/${currentTimesheet.claim.id}/update-sessions`, {
        method: 'PATCH',
        body: { sessionIds },
      });
      showToast('Claim updated with all completed sessions');
    } else {
      await VF.apiFetch('/claims', {
        method: 'POST',
        body: {
          periodMonth: currentTimesheet.periodMonth,
          periodYear: currentTimesheet.periodYear,
          lecturerId: currentTimesheet.lecturerId,
          moduleCode: currentTimesheet.moduleCode || currentModuleCode,
          sessionIds,
        },
      });
      showToast('Timesheet submitted to your lecturer');
    }
    await loadClaims();
  } catch (err) {
    showToast(err.errors?.[0] || err.message || 'Could not submit timesheet');
    if (btn) {
      btn.disabled = false;
      btn.textContent = isResubmit ? 'Resubmit to Lecturer' : (isUpdate ? 'Update claim' : 'Submit to Lecturer');
    }
  }
}

async function downloadTimesheet() {
  if (!currentTimesheet) return;

  const ts = currentTimesheet;
  const label = monthYearLabel(ts.periodMonth, ts.periodYear);
  const modCode = currentModuleCode || ts.moduleCode || '-';
  const qs = new URLSearchParams({
    periodMonth: String(ts.periodMonth),
    periodYear: String(ts.periodYear),
    moduleCode: modCode,
  });

  const btn = document.querySelector('.ts-table-header .dl-btn');
  if (btn) btn.disabled = true;

  try {
    const token = VF.getToken();
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${VF.API_BASE}/claims/timesheet/pdf?${qs.toString()}`, { headers });
    if (!res.ok) {
      let msg = 'Could not download timesheet';
      try {
        const data = await res.json();
        msg = data.errors?.[0] || data.error || msg;
      } catch (_) { /* not JSON */ }
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VeriFlow_Timesheet_${modCode}_${label.replace(/ /g, '_')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`PDF downloaded - ${label}`);
  } catch (err) {
    showToast(err.message || 'Could not download timesheet');
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.changeClaimsMonth = changeClaimsMonth;
window.submitTimesheet = submitTimesheet;
window.downloadTimesheet = downloadTimesheet;
window.goToClaimMonth = goToClaimMonth;

function renderClaimsPanels(claims) {
  const pendingPanel = document.getElementById('dash-claims-pending');
  const historyPanel = document.getElementById('dash-claims-history');
  const pendingAmt = document.getElementById('stat-pending-claim');
  const pendingSub = document.getElementById('stat-pending-claim-sub');
  const claimsBadge = document.getElementById('nav-claims-badge');

  const pending = claims.filter(c => ['pending_lecturer', 'pending_coordinator'].includes(c.status));
  if (pendingAmt) {
    if (pending.length === 0) {
      pendingAmt.textContent = formatClaimAmount(0);
    } else if (pending.length === 1) {
      pendingAmt.textContent = formatClaimAmount(pending[0].total_amount);
    } else {
      const total = pending.reduce((sum, c) =>
        sum + Number(c.total_amount || 0), 0);
      pendingAmt.textContent = formatClaimAmount(total);
    }
  }
  if (pendingSub) {
    if (pending.length === 0) {
      pendingSub.textContent = '0 pending · this module';
    } else if (pending.length === 1) {
      pendingSub.textContent = 'pending · this module';
    } else {
      pendingSub.textContent = `${pending.length} claims pending`;
    }
  }
  if (claimsBadge) {
    if (pending.length) {
      claimsBadge.textContent = String(pending.length);
      claimsBadge.hidden = false;
      claimsBadge.style.display = '';
    } else {
      claimsBadge.textContent = '';
      claimsBadge.hidden = true;
      claimsBadge.style.display = 'none';
    }
  }

  const hubClaimsBadge = document.getElementById('hub-claims-badge');
  if (hubClaimsBadge) {
    if (pending.length) {
      hubClaimsBadge.hidden = false;
      hubClaimsBadge.textContent = String(pending.length);
    } else {
      hubClaimsBadge.hidden = true;
    }
  }
  const hubClaimsSub = document.getElementById('hub-claims-sub');
  if (hubClaimsSub) {
    hubClaimsSub.textContent = pending.length
      ? `${pending.length} pending review`
      : 'Submit or review a claim';
  }

  let claimTotal = 0;
  if (pending.length === 1) claimTotal = Number(pending[0].total_amount || 0);
  else if (pending.length > 1) {
    claimTotal = pending.reduce((sum, c) => sum + Number(c.total_amount || 0), 0);
  }
  setText('#td-hub-claim-amt', formatClaimAmount(claimTotal));
  setText('#td-hub-claim-sub', pending.length ? `${pending.length} pending` : 'nothing submitted');

  if (pendingPanel) {
    pendingPanel.innerHTML = pending.length
      ? pending.slice(0, 2).map(c => `
        <button type="button" class="claim-item claim-item--clickable" onclick="goToClaimMonth(${c.period_month}, ${c.period_year})">
          <div class="c-dot review"></div>
          <div class="c-info"><div class="c-name">${monthYearLabel(c.period_month, c.period_year)} claim</div><div class="c-sub">Submitted ${c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('en-ZA') : '-'}</div></div>
          <div style="text-align:right"><div class="c-amt">${formatClaimAmount(c.total_amount)}</div><span class="stag review">${claimStatusLabel(c.status)}</span></div>
        </button>`).join('')
      : '<div style="font-size:12px;color:var(--muted);padding:8px 0">No pending claims for this module.</div>';
  }

  if (historyPanel) {
    historyPanel.innerHTML = claims.length
      ? `<div class="claim-history-list">${claims.slice(0, 5).map((c) => renderTutorClaimHistoryRow(c)).join('')}</div>`
      : '<div style="font-size:12px;color:var(--muted);padding:8px 0">No claims yet for this module.</div>';
  }
}

async function loadSessions() {
  const sessTbody = document.getElementById('sessions-table-body');
  const sessCards = document.getElementById('sessions-cards');
  const hourTbody = document.getElementById('hourlog-table-body');
  const dashUpcoming = document.getElementById('dash-upcoming-body');
  if (sessTbody && VF.skeleton) sessTbody.innerHTML = VF.skeleton.tbody(7, 5);
  if (sessCards && VF.skeleton) sessCards.innerHTML = VF.skeleton.sessionRows(4);
  if (hourTbody && VF.skeleton) hourTbody.innerHTML = VF.skeleton.tbody(5, 5);
  if (dashUpcoming && VF.skeleton) dashUpcoming.innerHTML = VF.skeleton.tbody(5, 4);

  try {
    const raw = await VF.apiFetch(`/sessions${moduleQuerySuffix()}`);
    const sessions = Array.isArray(raw) ? raw : [];
    SESSIONS = {};
    sessions.forEach(s => { SESSIONS[s.id] = s; });

    renderDashboardUpcoming(sessions);
    renderSessionsTable(sessions);
    renderHourLogTable(sessions);
    updateDashboardStats(sessions);
    rebuildCalendarFromSessions(sessions);
  } catch (err) {
    showToast('Could not load sessions');
    renderDashboardUpcoming([]);
    renderSessionsTable([]);
    renderHourLogTable([]);
    updateDashboardStats([]);
    rebuildCalendarFromSessions([]);
  }
}

async function confirmSessionAvailability(sessionId, available, btn) {
  const td = btn?.parentElement;
  try {
    await VF.apiFetch(`/sessions/${sessionId}/availability`, {
      method: 'PATCH',
      body: { available },
    });
    if (SESSIONS[sessionId]) {
      if (available) {
        SESSIONS[sessionId].my_confirmed_at = new Date().toISOString();
        SESSIONS[sessionId].my_declined_at = null;
      } else {
        SESSIONS[sessionId].my_declined_at = new Date().toISOString();
        SESSIONS[sessionId].my_confirmed_at = null;
      }
    }
    renderSessionsTable(Object.values(SESSIONS));
    renderDashboardUpcoming(Object.values(SESSIONS));
    showToast(available ? 'Availability confirmed' : 'Unavailability recorded');
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not update availability');
  }
}

function initTutorEmptyInbox() {
  /* replaced by messaging.js loadMessageThreads */
}

async function loadClaimsList() {
  const wrap = document.getElementById('claims-list-wrap');
  if (wrap && VF.skeleton) wrap.innerHTML = VF.skeleton.claimCards(4);
  try {
    const claimsRaw = await VF.apiFetch(`/claims${moduleQuerySuffix()}`);
    CLAIMS = Array.isArray(claimsRaw) ? claimsRaw : [];
    renderClaimsPanels(CLAIMS);
  } catch (err) {
    console.error('loadClaimsList error:', err);
    CLAIMS = [];
    renderClaimsPanels([]);
    showToast(err.errors ? err.errors[0] : 'Could not load claims');
  }
}

async function loadTimesheet() {
  try {
    const qs = new URLSearchParams({
      periodMonth: String(claimsPeriodMonth),
      periodYear: String(claimsPeriodYear),
    });
    if (currentModuleCode) qs.set('moduleCode', currentModuleCode);
    const timesheet = await VF.apiFetch(`/claims/timesheet?${qs.toString()}`);
    renderTimesheetView(timesheet);
  } catch (err) {
    console.error('loadTimesheet error:', err);
    renderTimesheetView(null);
    showToast(err.errors ? err.errors[0] : 'Could not load timesheet');
  }
}

async function loadClaims() {
  await Promise.all([loadClaimsList(), loadTimesheet()]);
}

let calEventData = {};
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const statusColors = { confirmed:'var(--green)', flagged:'var(--red)', today:'var(--accent)', upcoming:'var(--text)', cancelled:'var(--muted)' };

function sessionDateKey(sessionDate) {
  if (!sessionDate) return null;
  if (typeof sessionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sessionDate.trim())) {
    return sessionDate.trim();
  }
  const parsed = sessionDate instanceof Date ? sessionDate : new Date(sessionDate);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(sessionDate).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function localTodayKey() {
  return sessionDateKey(new Date());
}

function sessionDateParts(sessionDate) {
  const key = sessionDateKey(sessionDate);
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  return { year, month: month - 1, day };
}

function sessionToCalType(status) {
  if (status === 'active') return 'today';
  if (status === 'flagged') return 'flagged';
  if (status === 'completed') return 'confirmed';
  if (status === 'cancelled') return 'cancelled';
  return 'upcoming';
}

function calTypePriority(type) {
  return ({ today: 4, flagged: 3, confirmed: 2, cancelled: 2, upcoming: 1 })[type] || 0;
}

function calStatusLabel(status) {
  if (status === 'active') return 'In progress';
  if (status === 'completed') return 'Confirmed';
  if (status === 'flagged') return 'Flagged';
  if (status === 'scheduled') return 'Scheduled';
  if (status === 'cancelled') return 'Cancelled';
  return status || '-';
}

function sessionToCalEvent(s) {
  return {
    type: sessionToCalType(s.status),
    rawStatus: s.status,
    time: formatTimeRange(s),
    topic: s.topic || s.module_code,
    venue: s.venue || '-',
    sessionType: sessionTypeLabel(s.session_type),
    status: calStatusLabel(s.status),
    att: s.attendance_count != null ? `${s.attendance_count} logged` : '-',
    sessionId: s.id,
  };
}

function rebuildCalendarFromSessions(sessions) {
  calEventData = {};
  sessions.forEach((s) => {
    const parts = sessionDateParts(s.session_date);
    if (!parts || parts.year !== calYear || parts.month !== calMonth) return;
    const d = parts.day;
    const ev = sessionToCalEvent(s);
    if (!calEventData[d]) calEventData[d] = { type: ev.type, items: [] };
    calEventData[d].items.push(ev);
    if (calTypePriority(ev.type) > calTypePriority(calEventData[d].type)) {
      calEventData[d].type = ev.type;
    }
  });
  buildCalGrid();
}

function resetCalDetail() {
  document.getElementById('cal-detail-empty').style.display = 'flex';
  document.getElementById('cal-detail-content').style.display = 'none';
}

function renderCalSessionActions(ev) {
  const actionsEl = document.getElementById('cd-actions');
  if (!actionsEl) return;
  actionsEl.style.display = 'flex';
  const buttons = [];
  if (ev.rawStatus === 'active') {
    buttons.push(`<button type="button" class="cal-action-btn primary" onclick="openQR(${ev.sessionId})">Show QR code</button>`);
    buttons.push(`<button type="button" class="cal-action-btn" onclick="openRegister(${ev.sessionId})">View register</button>`);
  } else if (ev.rawStatus === 'completed' || ev.rawStatus === 'flagged') {
    buttons.push(`<button type="button" class="cal-action-btn" onclick="openRegister(${ev.sessionId})">View register</button>`);
  } else if (ev.rawStatus === 'cancelled') {
    buttons.push(`<button type="button" class="cal-action-btn" onclick="showPage('sessions',document.getElementById('nav-sessions'))">View cancelled session</button>`);
  } else {
    buttons.push(`<button type="button" class="cal-action-btn" onclick="showPage('sessions',document.getElementById('nav-sessions'))">View in sessions</button>`);
  }
  actionsEl.innerHTML = buttons.join('');
}

function renderCalSession(ev, dateStr) {
  document.getElementById('cal-detail-empty').style.display = 'none';
  document.getElementById('cal-detail-content').style.display = 'block';
  document.getElementById('cal-detail-title').textContent = dateStr;
  document.getElementById('cd-date').textContent = dateStr;
  document.getElementById('cd-time').textContent = ev.time;
  document.getElementById('cd-topic').textContent = ev.topic;
  document.getElementById('cd-venue').textContent = ev.venue;
  document.getElementById('cd-type').textContent = ev.sessionType;
  const sEl = document.getElementById('cd-status');
  sEl.textContent = ev.status;
  sEl.style.color = statusColors[ev.type] || 'var(--text)';
  const attRow = document.getElementById('cd-att-row');
  const attEl = document.getElementById('cd-att');
  if (ev.att && ev.att !== '-') {
    attRow.style.display = 'flex';
    attEl.textContent = ev.att;
  } else {
    attRow.style.display = ev.type === 'upcoming' ? 'none' : 'flex';
    attEl.textContent = ev.att;
  }
  const listEl = document.getElementById('cd-sessions-list');
  if (listEl) listEl.style.display = 'none';
  renderCalSessionActions(ev);
}

function showCalDetail(d, dayEvents) {
  const dateStr = `${d} ${monthNames[calMonth]} ${calYear}`;
  const items = dayEvents.items || [];
  if (!items.length) return;

  if (items.length === 1) {
    renderCalSession(items[0], dateStr);
    return;
  }

  document.getElementById('cal-detail-empty').style.display = 'none';
  document.getElementById('cal-detail-content').style.display = 'block';
  document.getElementById('cal-detail-title').textContent = dateStr;
  document.getElementById('cd-date').textContent = dateStr;
  document.getElementById('cd-time').textContent = `${items.length} sessions`;
  document.getElementById('cd-topic').textContent = 'Select a session below';
  document.getElementById('cd-venue').textContent = '-';
  document.getElementById('cd-type').textContent = '-';
  document.getElementById('cd-status').textContent = 'Multiple';
  document.getElementById('cd-att-row').style.display = 'none';

  const listEl = document.getElementById('cd-sessions-list');
  if (listEl) {
    listEl.style.display = 'block';
    listEl.innerHTML = items.map((ev) => `
      <button type="button" class="cal-session-pick" onclick="showCalSessionById(${d}, ${ev.sessionId})">
        <span class="cal-session-pick-time">${ev.time}</span>
        <span class="cal-session-pick-topic">${ev.topic}</span>
        <span class="cal-session-pick-type">${ev.sessionType}</span>
      </button>`).join('');
  }
  const actionsEl = document.getElementById('cd-actions');
  if (actionsEl) {
    actionsEl.style.display = 'none';
    actionsEl.innerHTML = '';
  }
}

function showCalSessionById(d, sessionId) {
  const ev = calEventData[d]?.items.find((i) => i.sessionId === sessionId);
  if (ev) renderCalSession(ev, `${d} ${monthNames[calMonth]} ${calYear}`);
}

function buildCalGrid() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const mobile = window.matchMedia('(max-width: 900px)').matches;
  const title = mobile
    ? monthNames[calMonth]
    : (monthNames[calMonth] + ' ' + calYear);
  setText('#calendar-page-title', monthNames[calMonth] + ' ' + calYear);
  setText('#cal-title', title);
  setText('.cal-title', title);

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDay; i++) {
    const c = document.createElement('div');
    c.className = 'cal-cell empty';
    grid.appendChild(c);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    const dayEvents = calEventData[d];
    const isToday = today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === d;
    let cls = 'cal-cell';
    const isPast = new Date(calYear, calMonth, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (isPast) cls += ' past';
    if (dayEvents) {
      cls += ' has-event';
      cls += ` ev-${dayEvents.type}`;
      if (dayEvents.type === 'today' || isToday) cls += ' today';
      cell.onclick = () => showCalDetail(d, dayEvents);
    } else if (isToday) {
      cls += ' today';
    }
    cell.className = cls;
    cell.textContent = d;
    if (dayEvents && dayEvents.items.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'cal-count-badge';
      badge.textContent = String(dayEvents.items.length);
      cell.appendChild(badge);
    }
    grid.appendChild(cell);
  }
}

function calChangeMonth(dir) {
  // Mobile calendar is current-month only
  if (window.matchMedia('(max-width: 900px)').matches) return;
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  resetCalDetail();
  rebuildCalendarFromSessions(Object.values(SESSIONS));
}

function lockCalToCurrentMonth() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}

function showPage(id, navEl) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  if (navEl) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    navEl.classList.add('active');
  }
  document.body.classList.toggle('td-on-hub', id === 'dashboard');
  if (id !== 'messages' && typeof closeMobileMessageChat === 'function') {
    closeMobileMessageChat();
  }
  syncBottomNav(id);
  if (id === 'sessions') loadSessions();
  if (id === 'hourlog') loadSessions();
  if (id === 'calendar') {
    if (window.matchMedia('(max-width: 900px)').matches) lockCalToCurrentMonth();
    rebuildCalendarFromSessions(Object.values(SESSIONS));
  }
  if (id === 'claims') loadClaims();
  if (id === 'support') loadTutorTickets();
  if (id === 'messages') {
    loadMessageThreads();
    if (typeof renderTutorMessagePeople === 'function') renderTutorMessagePeople();
  }
  if (id === 'profile') loadProfile();
  closeTutorSidebar();
}

function syncBottomNav(pageId) {
  const map = {
    dashboard: 'dashboard',
    sessions: 'sessions',
    hourlog: null,
    calendar: null,
    claims: 'claims',
    support: null,
    messages: 'messages',
    profile: 'profile',
  };
  const active = Object.prototype.hasOwnProperty.call(map, pageId) ? map[pageId] : null;
  document.querySelectorAll('.td-bnav-item').forEach((btn) => {
    btn.classList.toggle('active', active != null && btn.dataset.bnav === active);
  });
}

function toggleTutorSidebar() {
  const open = document.body.classList.toggle('td-sidebar-open');
  const backdrop = document.getElementById('tdSidebarBackdrop');
  const btn = document.getElementById('tdMenuBtn');
  if (backdrop) backdrop.hidden = !open;
  if (btn) btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

function closeTutorSidebar() {
  document.body.classList.remove('td-sidebar-open');
  const backdrop = document.getElementById('tdSidebarBackdrop');
  const btn = document.getElementById('tdMenuBtn');
  if (backdrop) backdrop.hidden = true;
  if (btn) btn.setAttribute('aria-label', 'Open menu');
}

function formatCostCentreLabel(costCentre) {
  if (costCentre === 'ucdg') return 'UCDG (Mr. Machava, Building 10)';
  if (costCentre === 'school_of_computing') return 'School of Computing (Head of School)';
  return 'Not assigned yet';
}

function costCentreContact(costCentre) {
  if (costCentre === 'ucdg') return 'Mr. Machava, Building 10';
  if (costCentre === 'school_of_computing') return 'Head of School, School of Computing';
  return 'Contact the Student Employment Office';
}

function renderProfile() {
  const s = VF.getState();
  const u = s.user || {};
  const a = s.academic || {};
  const ob = s.onboardingDetails || {};
  const tp = s.tutorProfile || {};
  const app = tutorApplication;
  const user = tutorCurrentUser;
  const profile = tutorOnboardingProfile;
  const moduleLabel = currentModuleName || app?.module_name || a.module;
  const courseLabel = currentModuleCourse || app?.course || a.course;
  const fullName = app
    ? `${app.first_names || ''} ${app.surname || ''}`.trim()
    : [u.firstNames, u.surname].filter(Boolean).join(' ') || 'Tutor';
  const properName = fullName || 'Tutor';
  const displayNameLower = properName.toLowerCase();
  const initials = VF.initials(
    app?.first_names || u.firstNames,
    app?.surname || u.surname
  );
  const dash = (v) => (v === null || v === undefined || v === '') ? '-' : v;
  const esc = (v) => String(v == null ? '' : v).replace(/</g, '&lt;');
  const monoVal = (v) => {
    const t = dash(v);
    if (t === '-') return '-';
    return `<span class="profile-mono">${esc(t)}</span>`;
  };

  function profileDocHtml(filename, originalName) {
    if (!filename && !originalName) {
      return '<span class="profile-muted">Not uploaded</span>';
    }
    const label = originalName || String(filename || '').split('/').pop() || 'Document';
    const safe = String(label).replace(/</g, '&lt;');
    const short = safe.length > 28
      ? `${safe.slice(0, 12)}…${safe.slice(-8)}`
      : safe;
    if (!filename) {
      return `<span class="profile-mono">${short}</span>`;
    }
    return `<a class="profile-doc-link profile-mono" href="#" onclick="event.preventDefault(); VF.openUploadDocument(${JSON.stringify(filename)})">${short}</a>`;
  }

  const idDoc = user?.id_document_filename || profile?.id_document_filename || app?.id_filename || app?.id_copy_filename;
  const taxDoc = user?.tax_proof_filename || profile?.tax_proof_filename || app?.tax_filename || app?.tax_proof_filename;
  const bankDoc = user?.bank_proof_filename || profile?.bank_proof_filename || app?.bank_filename || app?.bank_proof_filename;
  const idDocName = app?.id_original_name || app?.id_copy_original_name;
  const taxDocName = app?.tax_original_name || app?.tax_proof_original_name;
  const bankDocName = app?.bank_original_name || app?.bank_proof_original_name;

  const studentNum = user?.student_number || u.studentNumber || app?.student_number;
  const idNum = ob.idnum || profile?.id_number;
  const bankName = tp.bank || profile?.bank_name;
  const accountNum = tp.accnum || profile?.account_number;
  const profileWarnings = [];
  if (!studentNum) profileWarnings.push('Student number not yet added');
  if (!idNum) profileWarnings.push('ID number not yet added');
  if (!bankName || !accountNum) profileWarnings.push('Banking details not yet completed');

  const warningStripHtml = profileWarnings.length
    ? `<div class="profile-warnings">
        ${profileWarnings.map((msg) => `
          <span class="profile-warning-pill">${msg}</span>
        `).join('')}
      </div>`
    : '';

  const qualLabel = app?.qualification_level || a.qualificationLevel;
  const titleLabel = u.title || app?.title;
  const roleLine = [titleLabel, moduleLabel, qualLabel ? `${qualLabel} student` : null]
    .filter(Boolean)
    .join(' · ') || 'Tutor';

  const heroSub = document.getElementById('profile-hero-sub');
  if (heroSub) {
    heroSub.textContent = [
      displayNameLower,
      moduleLabel || null,
      qualLabel ? `${qualLabel} student` : null,
    ].filter(Boolean).join(' · ');
  }
  const heroSubDesktop = document.getElementById('profile-hero-sub-desktop');
  if (heroSubDesktop) {
    heroSubDesktop.textContent =
      displayNameLower +
      (moduleLabel ? ` · ${moduleLabel}` : '') +
      (qualLabel ? ` · ${qualLabel}` : '');
  }

  const section = (title, rows, extraClass = '') => `
    <div class="profile-card${extraClass ? ` ${extraClass}` : ''}">
      <div class="profile-section-title">${title}</div>
      ${rows.map(([label, valHtml]) => `
        <div class="profile-row">
          <span class="profile-row-label">${label}</span>
          <span class="profile-row-val">${valHtml}</span>
        </div>`).join('')}
    </div>`;

  const postalAddr = ob.postal
    ? `${ob.postal.street}, ${ob.postal.city} ${ob.postal.code}`
    : (profile?.street_address
      ? `${profile.street_address}, ${profile.city || ''} ${profile.postal_code || ''}`.trim()
      : null);
  const resAddr = user?.residential_same_as_postal
    ? 'Same as postal address'
    : (user?.residential_street
      ? `${user.residential_street}, ${user.residential_city || ''} ${user.residential_postal_code || ''}`.trim()
      : (ob.residential
        ? (ob.residential.sameAsPostal ? 'Same as postal address' : `${ob.residential.street}, ${ob.residential.city} ${ob.residential.code}`)
        : null));

  const content = document.getElementById('profile-content');
  if (!content) return;

  const gpaRaw = app?.gpa ?? a.gpa;
  const gpaLabel = gpaRaw != null && gpaRaw !== ''
    ? (String(gpaRaw).includes('%') ? String(gpaRaw) : `${gpaRaw}%`)
    : null;

  const costCentreLabel = formatCostCentreLabel(app?.cost_centre);
  const isApproved = app?.status === 'approved' || s.applicationStatus === 'approved';
  const isOnboarded = VF.onboardingCompleteFromApp(app)
    || !!(profile?.step1_complete && profile?.step2_complete)
    || !!(VF.tutorStateFromToken()?.onboardingComplete);

  content.innerHTML = `
    ${warningStripHtml}
    <div class="profile-card profile-card-main">
      <div class="profile-av-wrap">
        <div class="profile-av">${initials}</div>
        <div>
          <div class="profile-name">${esc(properName)}</div>
          <div class="profile-meta">${esc(roleLine)}</div>
        </div>
      </div>
    </div>
    ${isApproved ? section('Cost centre', [
      ['Assigned cost centre', esc(costCentreLabel)],
      ['Finance contact', esc(costCentreContact(app?.cost_centre))],
    ], 'profile-card--cost-centre') : ''}
    ${section('Personal information', [
      ['Title', esc(dash(titleLabel))],
      ['Initials', esc(dash(u.initials))],
      ['First names', esc(dash(app?.first_names || u.firstNames))],
      ['Surname', esc(dash(app?.surname || u.surname))],
      ['Email', monoVal(app?.email || u.email)],
      ['Cell phone', monoVal(app?.cell_phone || u.cell)],
    ])}
    ${section('Academic information', [
      ['Faculty', esc(dash(app?.faculty || a.faculty))],
      ['Programme', esc(dash(courseLabel))],
      ['Qualification level', esc(dash(qualLabel))],
      ['Module year level', esc(dash(app?.module_year || a.year))],
      ['Module to tutor', esc(dash(moduleLabel))],
      ['Module code', monoVal(app?.module_code || currentModuleCode)],
      ['GPA / average', esc(dash(gpaLabel))],
    ])}
    ${section('Documents & declaration', [
      ['CV', profileDocHtml(app?.cv_filename, app?.cv_original_name)],
      ['Academic record', profileDocHtml(app?.transcript_filename, app?.transcript_original_name)],
      ['ID document', profileDocHtml(idDoc, idDocName)],
      ['Tax proof', profileDocHtml(taxDoc, taxDocName)],
      ['Bank letter', profileDocHtml(bankDoc, bankDocName)],
      ['Declaration', app?.declared ? 'Yes' : 'No'],
      ['Application status', esc(dash(app?.status || s.applicationStatus))],
      ['HR Staff Number', user?.staff_number || app?.staff_number
        ? esc(user?.staff_number || app?.staff_number)
        : '<span style="color:var(--yellow)">Not yet assigned - contact the Student Employment Office</span>'],
    ], 'profile-card--docs')}
    ${(!idDoc || !taxDoc || !bankDoc) ? `
    <div class="profile-card profile-card--upload" id="profile-doc-upload-card">
      <div class="profile-section-title">Upload supporting documents</div>
      <p class="profile-help">
        Some onboarding documents were not saved. Upload any missing files below (PDF or image, max 5MB each).
      </p>
      <div class="um-grid one" style="gap:12px;">
        ${!idDoc ? `<div class="um-field"><div class="um-label">ID document</div><input type="file" id="profile-id-file" class="um-input" accept=".pdf,.jpg,.jpeg,.png" style="padding:8px;height:auto"/></div>` : ''}
        ${!taxDoc ? `<div class="um-field"><div class="um-label">Tax proof</div><input type="file" id="profile-tax-file" class="um-input" accept=".pdf,.jpg,.jpeg,.png" style="padding:8px;height:auto"/></div>` : ''}
        ${!bankDoc ? `<div class="um-field"><div class="um-label">Bank letter</div><input type="file" id="profile-bank-file" class="um-input" accept=".pdf,.jpg,.jpeg,.png" style="padding:8px;height:auto"/></div>` : ''}
      </div>
      <div class="um-actions" style="margin-top:14px;">
        <button type="button" class="btn-primary" id="profile-doc-upload-btn" onclick="uploadProfileDocuments()">Upload documents</button>
      </div>
    </div>` : ''}
    ${section('Onboarding - address', [
      ['ID number', monoVal(idNum)],
      ['Postal address', `<span class="profile-addr">${esc(dash(postalAddr))}</span>`],
      ['Residential address', esc(dash(resAddr))],
    ], 'profile-card--address')}
    ${section('Onboarding - banking & tax', [
      ['Bank', esc(dash(tp.bank || profile?.bank_name))],
      ['Branch code', monoVal(tp.branch || profile?.branch_code)],
      ['Account type', esc(dash(tp.acctype || profile?.account_type))],
      ['Account number', (tp.accnum || profile?.account_number)
        ? `<span class="profile-mono">••••${esc(String(tp.accnum || profile?.account_number).slice(-4))}</span>`
        : '-'],
      ['Account holder', esc(dash(tp.accholder || profile?.account_holder))],
      ['Income tax number', monoVal(tp.taxnum || profile?.tax_number)],
    ], 'profile-card--bank')}
    ${isApproved && isOnboarded ? `
    <div class="profile-card profile-card--hr-forms">
      <div class="profile-section-title">${app?.offer_accepted_at ? 'Appointment accepted' : 'Accept your appointment'}</div>
      <div class="profile-row">
        <span class="profile-row-label">Appointment Form D</span>
        <span class="profile-row-val">
          <a class="profile-doc-link" href="#" onclick="event.preventDefault(); viewHrForm('appointment-form-d')">View</a>
          <span class="profile-muted"> · </span>
          <a class="profile-doc-link" href="#" onclick="event.preventDefault(); downloadHrForm('appointment-form-d')">Download</a>
        </span>
      </div>
      <div class="profile-row">
        <span class="profile-row-label">Confirmation Form</span>
        <span class="profile-row-val">
          <a class="profile-doc-link" href="#" onclick="event.preventDefault(); viewHrForm('confirmation-form')">View</a>
          <span class="profile-muted"> · </span>
          <a class="profile-doc-link" href="#" onclick="event.preventDefault(); downloadHrForm('confirmation-form')">Download</a>
        </span>
      </div>
      <div class="profile-row">
        <span class="profile-row-label">Offer</span>
        <span class="profile-row-val">${app?.offer_accepted_at
          ? esc(`Accepted ${formatHrAcceptedDate(app.offer_accepted_at)}`)
          : 'Not accepted yet'}</span>
      </div>
      ${app?.offer_accepted_at ? '' : `
      <div class="um-actions" style="margin-top:14px;">
        <button type="button" class="btn-primary" onclick="acceptHrOffer()">I accept</button>
      </div>`}
    </div>` : ''}
    <div class="profile-card profile-card--update" id="profile-update-card">
      <div class="profile-section-title">Update profile</div>
      <p class="profile-help">
        Add or update your student number and cell phone number below.
      </p>
      <div class="um-grid one" style="gap:12px;">
        <div class="um-field">
          <div class="um-label">Student number</div>
          <input type="text" id="profile-student-number" class="um-input" placeholder="e.g. 220012345" value="${String(studentNum || '').replace(/"/g, '&quot;')}"/>
        </div>
        <div class="um-field">
          <div class="um-label">Cell phone</div>
          <input type="tel" id="profile-cell-phone" class="um-input" placeholder="e.g. 0821234567" value="${String(app?.cell_phone || user?.cell || u.cell || '').replace(/"/g, '&quot;')}"/>
        </div>
      </div>
      <div class="um-actions" style="margin-top:14px;">
        <button type="button" class="btn-primary" id="profile-save-btn" onclick="saveProfileUpdate()">Save</button>
      </div>
    </div>
    <button type="button" class="pf-logout-btn" onclick="VF.logout()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
      Log out
    </button>
  `;
}

async function loadProfile() {
  const content = document.getElementById('profile-content');
  if (content && VF.skeleton) {
    content.innerHTML = VF.skeleton.cards(2) + VF.skeleton.block(true);
  } else if (content) {
    content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">Loading profile…</div>';
  }

  try {
    const results = await Promise.allSettled([
      VF.apiFetch('/applications/me'),
      VF.fetchCurrentUser(),
      VF.apiFetch('/users/me/tutor-profile'),
    ]);

    if (results[0].status === 'fulfilled') {
      tutorApplication = results[0].value;
      window.tutorApplication = tutorApplication;
      VF.syncApplicationState(tutorApplication);
    }
    if (results[1].status === 'fulfilled') {
      tutorCurrentUser = results[1].value;
      window.tutorCurrentUser = tutorCurrentUser;
    }
    if (results[2].status === 'fulfilled') {
      tutorOnboardingProfile = results[2].value;
      window.tutorOnboardingProfile = tutorOnboardingProfile;
    }

    renderProfile();
    updateHrFormsNotice();
  } catch (err) {
    if (content) {
      content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">Could not load profile.</div>';
    }
    showToast('Could not load profile');
  }
}

async function saveProfileUpdate() {
  const studentNumber = document.getElementById('profile-student-number')?.value?.trim() ?? '';
  const cellPhone = document.getElementById('profile-cell-phone')?.value?.trim() ?? '';
  const btn = document.getElementById('profile-save-btn');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }

  try {
    const updated = await VF.apiFetch('/users/me/profile', {
      method: 'PATCH',
      body: { studentNumber, cellPhone },
    });

    tutorCurrentUser = updated;
    window.tutorCurrentUser = updated;
    const prev = VF.getState().user || {};
    VF.setState({
      user: {
        ...prev,
        studentNumber: updated.student_number || '',
        cell: updated.cell || '',
      },
    });

    showToast('Profile updated');
    renderProfile();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not update profile');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }
}

async function uploadProfileDocuments() {
  const idFile = document.getElementById('profile-id-file')?.files[0];
  const taxFile = document.getElementById('profile-tax-file')?.files[0];
  const bankFile = document.getElementById('profile-bank-file')?.files[0];

  if (!idFile && !taxFile && !bankFile) {
    showToast('Select at least one file to upload');
    return;
  }

  const btn = document.getElementById('profile-doc-upload-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Uploading…';
  }

  const formData = new FormData();
  if (idFile) formData.append('id_document', idFile);
  if (taxFile) formData.append('tax_proof', taxFile);
  if (bankFile) formData.append('bank_proof', bankFile);

  try {
    await VF.apiFetch('/users/me/onboarding/documents', {
      method: 'POST',
      body: formData,
      isFormData: true,
    });
    showToast('Documents uploaded');
    await loadProfile();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not upload documents');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Upload documents';
    }
  }
}

window.showPage = showPage;
window.toggleTutorSidebar = toggleTutorSidebar;
window.closeTutorSidebar = closeTutorSidebar;
window.syncBottomNav = syncBottomNav;
window.renderProfile = renderProfile;
window.loadProfile = loadProfile;
window.saveProfileUpdate = saveProfileUpdate;
window.uploadProfileDocuments = uploadProfileDocuments;
window.calChangeMonth = calChangeMonth;
window.showCalSessionById = showCalSessionById;

async function loadTutorTickets() {
  const wrap = document.getElementById('tutor-tickets-list');
  if (wrap && VF.skeleton) wrap.innerHTML = VF.skeleton.listRows(4);
  try {
    const tickets = await VF.apiFetch('/support/tickets');
    renderTutorTickets(tickets);
  } catch (err) {
    if (wrap) {
      wrap.innerHTML = '<div class="st-ticket-empty">Could not load support tickets.</div>';
    }
    updateSupportSummary([]);
    showToast(err.errors ? err.errors[0] : 'Could not load support tickets');
  }
}

function ticketStatusMeta(status) {
  if (status === 'resolved') return { label: 'Resolved', cls: 'st-badge--resolved' };
  if (status === 'in_progress') return { label: 'In progress', cls: 'st-badge--progress' };
  return { label: 'Open', cls: 'st-badge--open' };
}

function ticketPriorityLabel(priority) {
  const p = String(priority || 'medium').toLowerCase();
  if (p === 'high') return 'High';
  if (p === 'low') return 'Low';
  return 'Medium';
}

function updateSupportSummary(tickets) {
  const list = Array.isArray(tickets) ? tickets : [];
  const countEl = document.getElementById('st-tickets-count');
  if (countEl) {
    countEl.textContent = list.length ? String(list.length) : '';
    countEl.hidden = !list.length;
  }
}

function renderTutorTickets(tickets) {
  const wrap = document.getElementById('tutor-tickets-list');
  if (!wrap) return;

  const list = Array.isArray(tickets) ? tickets : [];
  updateSupportSummary(list);

  if (!list.length) {
    wrap.innerHTML = `<div class="st-empty-card">
      <div class="st-empty-state">
        <div class="st-empty-ico" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 2-3 4"/><path d="M12 17h.01"/></svg>
        </div>
        <h3>No tickets yet</h3>
        <p>Tap New Ticket below if you need help from the Student Employment Office.</p>
      </div>
    </div>`;
    return;
  }

  wrap.innerHTML = list.map((t) => {
    const status = ticketStatusMeta(t.status);
    const date = t.created_at
      ? new Date(t.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
      : '-';
    const replies = t.reply_count
      ? `${t.reply_count} repl${t.reply_count === 1 ? 'y' : 'ies'}`
      : null;
    const metaParts = [
      ticketPriorityLabel(t.priority),
      date,
      replies,
    ].filter(Boolean);

    return `<article class="st-ticket-card">
      <div class="st-ticket-top">
        <div class="st-ticket-title"><span class="st-ticket-id">#${t.id}</span> · ${t.subject || '-'}</div>
        <span class="st-badge ${status.cls}">${status.label}</span>
      </div>
      <div class="st-ticket-meta">${metaParts.join(' · ')}</div>
      <div class="st-ticket-details">${t.details || ''}</div>
    </article>`;
  }).join('');
}

function openNewTicketModal() {
  document.getElementById('ticket-subject').value = '';
  document.getElementById('ticket-details').value = '';
  document.getElementById('ticket-priority').value = 'medium';
  document.getElementById('new-ticket-overlay').classList.add('open');
}

function closeNewTicketModal(e) {
  if (e && e.target !== document.getElementById('new-ticket-overlay')) return;
  document.getElementById('new-ticket-overlay').classList.remove('open');
}

async function submitNewTicket() {
  const subject = document.getElementById('ticket-subject').value.trim();
  const details = document.getElementById('ticket-details').value.trim();
  const priority = document.getElementById('ticket-priority').value;

  if (!subject) {
    document.getElementById('ticket-subject').focus();
    return;
  }
  if (!details) {
    document.getElementById('ticket-details').focus();
    return;
  }

  try {
    await VF.apiFetch('/support/tickets', {
      method: 'POST',
      body: { subject, details, priority },
    });
    closeNewTicketModal();
    showToast('Ticket submitted - the coordinator will respond shortly');
    loadTutorTickets();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not submit ticket');
  }
}

window.loadTutorTickets = loadTutorTickets;
window.openNewTicketModal = openNewTicketModal;
window.closeNewTicketModal = closeNewTicketModal;
window.submitNewTicket = submitNewTicket;

function openTutorLecturerMessage() {
  const subject = document.getElementById('tutor-message-subject');
  const body = document.getElementById('tutor-message-body');
  if (subject) subject.value = '';
  if (body) body.value = '';
  document.getElementById('tutor-message-overlay')?.classList.add('open');
  setTimeout(() => subject?.focus(), 200);
}

function closeTutorLecturerMessage(e) {
  if (e && e.target !== document.getElementById('tutor-message-overlay')) return;
  document.getElementById('tutor-message-overlay')?.classList.remove('open');
}

async function sendTutorLecturerMessage() {
  const subject = document.getElementById('tutor-message-subject')?.value.trim() || '';
  const body = document.getElementById('tutor-message-body')?.value.trim() || '';

  if (!body) {
    document.getElementById('tutor-message-body')?.focus();
    return;
  }

  const btn = document.getElementById('tutor-message-send-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending…';
  }

  try {
    const result = await sendTutorMessage(subject, body);
    if (result) {
      closeTutorLecturerMessage();
      showToast('Message sent');
      if (typeof showPage === 'function') {
        showPage('messages', document.getElementById('nav-messages'));
      }
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  }
}

window.openNewTutorMessage = openTutorLecturerMessage;
window.closeTutorLecturerMessage = closeTutorLecturerMessage;
window.sendTutorLecturerMessage = sendTutorLecturerMessage;

function setHubDisplayName(name) {
  const display = String(name || '').trim() || 'tutor';
  setText('#tutor-hero-name', display);
  setText('#td-hub-name', display);
  const av = document.getElementById('td-hub-avatar');
  if (av) {
    const parts = display.split(/\s+/).filter(Boolean);
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0])
      : display.slice(0, 2);
    av.textContent = initials.toUpperCase();
  }
}

function hydrateHeroFromLocalState() {
  const s = VF.getState();
  if (s.user) {
    const first = (s.user.firstNames || '').trim();
    const surname = (s.user.surname || '').trim();
    tutorDisplayName = `${first} ${surname}`.trim().toLowerCase();
    if (tutorDisplayName) setHubDisplayName(tutorDisplayName);
  }
}

async function hydrateHeroFromApi() {
  try {
    const user = await VF.fetchCurrentUser();
    tutorCurrentUser = user;
    window.tutorCurrentUser = user;
    tutorDisplayName = `${user.first_names || ''} ${user.surname || ''}`.trim().toLowerCase();
    setHubDisplayName(tutorDisplayName || 'tutor');
  } catch (e) {
    hydrateHeroFromLocalState();
    if (!tutorDisplayName) setHubDisplayName('tutor');
  }

  if (!tutorDisplayName && tutorApplication) {
    tutorDisplayName = `${tutorApplication.first_names || ''} ${tutorApplication.surname || ''}`.trim().toLowerCase();
    setHubDisplayName(tutorDisplayName || 'tutor');
  }
}

async function loadTutorModules() {
  try {
    const modules = await VF.apiFetch('/users/me/modules');
    await setupTutorModules(modules);
  } catch (err) {
    showToast('Could not load your modules');
    await setupTutorModules([]);
  }
}

function isApprovedAndOnboarded(app, tokenState) {
  const status = app?.status ?? tokenState?.applicationStatus;
  const fromApp = app ? VF.onboardingCompleteFromApp(app) : false;
  const fromToken = !!tokenState?.onboardingComplete;
  return status === 'approved' && (fromApp || fromToken);
}

async function initTutorDashboard() {
  if (typeof VF === 'undefined') {
    console.error('VeriFlow app.js failed to load');
    return;
  }
  if (!VF.requireRole('tutor', 'login.html')) return;

  const token = VF.getToken();
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.tempFlag) {
        VF.navigate('change-password.html');
        return;
      }
    } catch (e) { /* ignore */ }
  }

  window.MESSAGING_ROLE = 'tutor';
  hydrateHeroFromLocalState();
  initTutorEmptyInbox();

  const tokenState = VF.tutorStateFromToken() || {};

  try {
    tutorApplication = await VF.apiFetch('/applications/me');
    window.tutorApplication = tutorApplication;
    VF.syncApplicationState(tutorApplication);

    const onboarded = isApprovedAndOnboarded(tutorApplication, tokenState);
    if (!onboarded) {
      // Prefer fresh JWT flag after step-2 submit so a stale /applications/me
      // response cannot bounce the tutor back into onboarding.
      const complete =
        VF.onboardingCompleteFromApp(tutorApplication) ||
        !!tokenState.onboardingComplete;
      VF.routeTutor({
        applicationStatus: tutorApplication.status || tokenState.applicationStatus,
        onboardingComplete: complete,
      });
      return;
    }
  } catch (err) {
    if (err.status === 404) {
      VF.routeTutor(tokenState);
      return;
    }
    if (!isApprovedAndOnboarded(null, tokenState)) {
      showToast('Could not load your profile');
      await setupTutorModules([]);
      return;
    }
    showToast('Some profile data could not be refreshed');
  }

  // Parallelize remaining first-paint work (remote DB makes serial RTTs feel slow).
  await Promise.all([
    loadSemesterHours(),
    hydrateHeroFromApi(),
    loadTutorModules(),
  ]);
  updateHrFormsNotice();
}

let hrFormViewerUrl = null;

function hrFormTitle(kind) {
  if (kind === 'confirmation-form') return 'Confirmation Form';
  return 'Appointment Form D';
}

async function fetchHrFormFile(kind, inline) {
  const token = VF.getToken();
  if (!token) throw new Error('Please log in again.');
  const qs = inline ? '?inline=1' : '';
  const res = await fetch(
    VF.API_BASE + '/users/me/hr-forms/' + encodeURIComponent(kind) + qs,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  if (!res.ok) {
    let msg = inline ? 'Could not open form.' : 'Could not download form.';
    try {
      const data = await res.json();
      if (data.errors && data.errors[0]) msg = data.errors[0];
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="?([^"]+)"?/i);
  const filename = match ? match[1] : (kind + '.pdf');
  return { blob, filename };
}

async function downloadHrForm(kind) {
  try {
    const file = await fetchHrFormFile(kind, false);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file.blob);
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    showToast('Download started.');
  } catch (err) {
    showToast(err.message || 'Could not download form.');
  }
}

function closeHrFormViewer(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('hrFormModal');
  const frame = document.getElementById('hr-form-frame');
  if (overlay) overlay.classList.remove('open');
  if (frame) frame.src = 'about:blank';
  if (hrFormViewerUrl) {
    URL.revokeObjectURL(hrFormViewerUrl);
    hrFormViewerUrl = null;
  }
}

async function viewHrForm(kind) {
  const overlay = document.getElementById('hrFormModal');
  const frame = document.getElementById('hr-form-frame');
  const title = document.getElementById('hr-form-modal-title');
  const downloadBtn = document.getElementById('hr-form-download-btn');
  if (!overlay || !frame) {
    showToast('Could not open form viewer.');
    return;
  }
  try {
    const file = await fetchHrFormFile(kind, true);
    if (hrFormViewerUrl) URL.revokeObjectURL(hrFormViewerUrl);
    hrFormViewerUrl = URL.createObjectURL(file.blob);
    if (title) title.textContent = hrFormTitle(kind);
    frame.src = hrFormViewerUrl;
    if (downloadBtn) {
      downloadBtn.onclick = () => downloadHrForm(kind);
    }
    overlay.classList.add('open');
  } catch (err) {
    showToast(err.message || 'Could not open form.');
  }
}

function formatHrAcceptedDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function closeHrAcceptModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('hrAcceptModal');
  if (overlay) overlay.classList.remove('open');
  const btn = document.getElementById('hr-accept-confirm-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'I accept';
  }
}

function acceptHrOffer() {
  const app = tutorApplication || window.tutorApplication;
  const user = tutorCurrentUser || window.tutorCurrentUser;
  const name = `${user?.first_names || app?.first_names || ''} ${user?.surname || app?.surname || ''}`.trim()
    || 'the appointee';
  const role = app?.position_type === 'demonstrator' ? 'Demonstrator' : 'Tutor';
  const statement = document.getElementById('hr-accept-statement');
  if (statement) {
    statement.textContent =
      `I, ${name}, hereby confirm that I accept the employment offer as a ${role} in the Academic Support Services department (FYE Programme).`;
  }
  const overlay = document.getElementById('hrAcceptModal');
  if (!overlay) {
    showToast('Could not open acceptance dialog.');
    return;
  }
  overlay.classList.add('open');
}

async function confirmHrOffer() {
  const btn = document.getElementById('hr-accept-confirm-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Accepting…';
  }
  try {
    const data = await VF.apiFetch('/applications/me/accept-offer', { method: 'POST' });
    if (tutorApplication) tutorApplication.offer_accepted_at = data.offer_accepted_at;
    if (window.tutorApplication) window.tutorApplication.offer_accepted_at = data.offer_accepted_at;
    closeHrAcceptModal();
    updateHrFormsNotice();
    if (document.getElementById('page-profile')?.classList.contains('active')
      || document.getElementById('profile-content')) {
      try { renderProfile(); } catch (_) { /* profile not on screen */ }
    }
    showToast('Offer accepted. Your forms now show your name and the date.');
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'I accept';
    }
    showToast(err.message || 'Could not accept the offer.');
  }
}

function updateHrFormsNotice() {
  const app = tutorApplication || window.tutorApplication;
  const user = tutorCurrentUser || window.tutorCurrentUser;
  const approved = app?.status === 'approved';
  const onboarded = VF.onboardingCompleteFromApp(app)
    || !!(tutorOnboardingProfile?.step1_complete && tutorOnboardingProfile?.step2_complete)
    || !!(VF.tutorStateFromToken()?.onboardingComplete);
  const hasStaffNumber = !!(user?.staff_number || app?.staff_number);
  const show = approved && onboarded && !hasStaffNumber;
  const acceptedAt = app?.offer_accepted_at;
  const accepted = !!acceptedAt;

  ['td-hub-hr-forms', 'td-desktop-hr-forms'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !show;
  });

  const title = accepted ? 'Appointment accepted' : 'Appointment forms';
  const text = accepted
    ? `You accepted this offer on ${formatHrAcceptedDate(acceptedAt)}. View the signed forms here. You cannot submit claims until a staff number is on file.`
    : 'View your appointment forms here. Accept the offer from your profile. You cannot submit claims until a staff number is on file.';

  document.querySelectorAll('[data-hr-forms-title]').forEach((el) => {
    el.textContent = title;
  });
  document.querySelectorAll('[data-hr-forms-text]').forEach((el) => {
    el.textContent = text;
  });
}

window.downloadHrForm = downloadHrForm;
window.viewHrForm = viewHrForm;
window.closeHrFormViewer = closeHrFormViewer;
window.acceptHrOffer = acceptHrOffer;
window.confirmHrOffer = confirmHrOffer;
window.closeHrAcceptModal = closeHrAcceptModal;
window.updateHrFormsNotice = updateHrFormsNotice;

let tutorDashboardStarted = false;

function bootTutorDashboard() {
  if (!document.getElementById('page-dashboard')) return;
  initTutorDashboard().catch((err) => {
    console.error('Dashboard init failed:', err);
    setupTutorModules([]).catch(() => {});
  });
}

/** Called from dashboard.html after inline helpers load; safe if scripts are cached mismatched. */
function startTutorDashboard() {
  if (tutorDashboardStarted) return;
  tutorDashboardStarted = true;
  bootTutorDashboard();
}

window.startTutorDashboard = startTutorDashboard;
window.bootTutorDashboard = bootTutorDashboard;
window.initTutorDashboard = initTutorDashboard;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('qrModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeQR();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const acceptModal = document.getElementById('hrAcceptModal');
    if (acceptModal?.classList.contains('open')) {
      closeHrAcceptModal();
      return;
    }
    const hrModal = document.getElementById('hrFormModal');
    if (hrModal?.classList.contains('open')) {
      closeHrFormViewer();
      return;
    }
    closeTutorSidebar();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) closeTutorSidebar();
  });
  if (!document.getElementById('page-dashboard')) return;
  setTimeout(startTutorDashboard, 0);
});
