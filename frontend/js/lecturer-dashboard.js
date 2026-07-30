/* ── LECTURER + MODULE STATE ── */
let lecturerModules = [];
let currentModuleCode = null;
let currentModuleName = '';
let currentModuleCourse = '';
let lecturerDisplayName = '';
let SESSIONS = {};
let moduleTutorPool = [];
let LECTURER_CLAIMS = [];

const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function skeletonTutorCards(count = 6) {
  return (VF.skeleton && VF.skeleton.cards(count)) || '';
}

function skeletonReferralRows(count = 3) {
  return (VF.skeleton && VF.skeleton.referralRows(count)) || '';
}

function skeletonSessionRows(count = 5) {
  return (VF.skeleton && VF.skeleton.sessionRows(count)) || '';
}

function skeletonClaimCards(count = 4) {
  return (VF.skeleton && VF.skeleton.claimCards(count)) || '';
}

function asListPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

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

function getSelectedModule() {
  return lecturerModules.find(m => m.code === currentModuleCode) || null;
}

function currentPeriodLabel() {
  return new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
}

function moduleQuerySuffix() {
  return currentModuleCode
    ? `?moduleCode=${encodeURIComponent(currentModuleCode)}`
    : '';
}

function courseShortCode(course) {
  if (!course) return '';
  if (course.startsWith('BICT')) return 'BICT';
  if (course.startsWith('DICT')) return 'DICT';
  return '';
}

function applyModuleUi() {
  const mod = getSelectedModule();
  const code = currentModuleCode || '—';
  const name = currentModuleName || mod?.name || '—';
  const period = currentPeriodLabel();

  setText('#sidebar-mod-code', code);
  setText('#sidebar-mod-name', name);
  setText('#hero-module-text', `${code} · ${name} · ${period}`);
  setText('#dash-recent-title', `Recent sessions — ${code}`);
  setText('#sessions-hero-sub', `${code} · ${name} · ${period}`);
  setText('#tutors-hero-sub', `${code} · ${name} · tutors for this module`);
  setText('#report-title', `${code} Module Report`);
  setText('#report-sub', `${name} · ${lecturerDisplayName || 'lecturer'} · ${period}`);
  setText('#classlist-hero-sub', `${code} · ${name}`);
  setText('#ns-modal-module-label', `${code} · ${name}`);
  setText('#lcd-module', `${code} · ${name}`);
  setText('#view-calendar .page-hero p', `${code} · ${name} · click a date to view or create a session`);
  setText('.claims-header p', `${code} · Tutor claims for this module`);
  if (lecturerDisplayName) {
    setText('#lec-hub-name', String(lecturerDisplayName).toUpperCase());
    const av = document.getElementById('lec-hub-avatar');
    if (av) {
      const parts = String(lecturerDisplayName).split(/\s+/).filter(Boolean);
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0])
        : String(lecturerDisplayName).slice(0, 2);
      av.textContent = initials.toUpperCase();
    }
  }
  const hubMod = document.getElementById('lec-hub-module');
  if (hubMod) {
    if (code && code !== '—') {
      hubMod.innerHTML = `<b>${code}</b> · ${name}`;
    } else {
      hubMod.textContent = 'Loading module…';
    }
  }
}

function syncLecHubModules(modules) {
  const hubModules = document.getElementById('lec-hub-modules');
  if (!hubModules) return;
  if (!modules || modules.length <= 1) {
    hubModules.innerHTML = '';
    hubModules.hidden = true;
    return;
  }
  hubModules.innerHTML = modules.map((m) => `
    <button type="button" class="module-tab${m.code === currentModuleCode ? ' active' : ''}"
      data-code="${m.code}" data-name="${m.name}" data-course="${m.course || ''}"
      onclick="switchModule(this)">
      <span class="mod-code">${m.code}</span><span class="mod-name"> ${m.name}</span>
    </button>`).join('');
  hubModules.hidden = false;
}

function syncLecBottomNav(pageId) {
  const map = {
    dashboard: 'dashboard',
    sessions: 'sessions',
    claims: 'claims',
    calendar: null,
    classlist: null,
    support: null,
    report: null,
    messages: 'messages',
    tutors: 'tutors',
  };
  const active = Object.prototype.hasOwnProperty.call(map, pageId) ? map[pageId] : null;
  document.querySelectorAll('.lec-bnav-item').forEach((btn) => {
    btn.classList.toggle('active', active != null && btn.dataset.bnav === active);
  });
}

function updateLecMobileHubNext(sessions) {
  const titleEl = document.getElementById('lec-hub-next-title');
  const metaEl = document.getElementById('lec-hub-next-meta');
  const heroEl = document.getElementById('lecSessionCard') || document.getElementById('lec-hub-hero');
  if (!titleEl || !metaEl) return;

  titleEl.hidden = false;
  metaEl.hidden = false;
  titleEl.removeAttribute('hidden');
  metaEl.removeAttribute('hidden');
  titleEl.style.setProperty('display', 'block', 'important');
  metaEl.style.setProperty('display', 'block', 'important');
  titleEl.style.setProperty('visibility', 'visible', 'important');
  metaEl.style.setProperty('visibility', 'visible', 'important');
  titleEl.style.setProperty('font-size', '20px', 'important');
  titleEl.style.setProperty('color', '#ffffff', 'important');
  metaEl.style.setProperty('font-size', '12px', 'important');
  metaEl.style.setProperty('color', '#c3d8d2', 'important');

  const result = findTodayCardSession(sessions || Object.values(SESSIONS));
  let aria = 'Today / next';
  if (!result) {
    titleEl.textContent = 'No session today';
    metaEl.textContent = currentModuleCode
      ? `${currentModuleCode} · Check calendar for upcoming sessions`
      : 'Select a module to see sessions';
    aria = metaEl.textContent;
  } else {
    const { session: s, mode } = result;
    titleEl.textContent = mode === 'live'
      ? (s.topic || sessionTypeLabel(s.session_type) || 'Live session')
      : (s.topic || sessionTypeLabel(s.session_type) || 'Up next');
    const time = s.start_time ? String(s.start_time).slice(0, 5) : '—';
    const venue = s.venue || 'Venue TBA';
    const label = mode === 'live' ? 'Live now' : mode === 'due' ? 'Due now' : 'Up next';
    metaEl.textContent = `${label} · ${time} · ${venue}`;
    aria = `${titleEl.textContent}. ${metaEl.textContent}`;
  }
  if (heroEl) heroEl.setAttribute('aria-label', aria);
}

function switchModule(btn) {
  currentModuleCode = btn.dataset.code;
  currentModuleName = btn.dataset.name || btn.dataset.code;
  currentModuleCourse = btn.dataset.course || '';
  sessionStorage.setItem('vf_lecturer_module', currentModuleCode);
  document.querySelectorAll('.module-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.code === currentModuleCode);
  });
  refreshModuleData();
}

async function refreshModuleData() {
  if (!currentModuleCode) return;
  applyModuleUi();
  // Sessions + tutors + claims + class list count for hub
  await Promise.all([
    loadSessions(),
    loadMyTutors(),
    loadClaims(),
    loadClassList(),
  ]);
  renderModuleReport(Object.values(SESSIONS), moduleTutorPool);
  if (typeof refreshUnreadBadge === 'function') refreshUnreadBadge();
}

function formatSessionDate(s) {
  if (!s.session_date) return '—';
  const d = new Date(s.session_date);
  const datePart = d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  const timePart = s.start_time ? ` · ${String(s.start_time).slice(0, 5)}` : '';
  return datePart + timePart;
}

function dashboardStatusChip(status) {
  if (status === 'active')    return '<span class="status-chip live">Live</span>';
  if (status === 'completed') return '<span class="status-chip confirmed">Confirmed</span>';
  if (status === 'flagged')   return '<span class="status-chip flagged">Flagged</span>';
  if (status === 'cancelled') return '<span class="status-chip" style="background:rgba(0,0,0,.06);color:var(--muted);">Cancelled</span>';
  return '<span class="status-chip awaiting">Scheduled</span>';
}

function renderDashboardRecent(sessions) {
  const tbody = document.getElementById('dash-recent-body');
  if (!tbody) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const recent = sessions
    .filter(s => s.session_date && new Date(s.session_date) >= cutoff)
    .slice(0, 8);

  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">No sessions in the last 30 days for this module.</td></tr>';
    return;
  }

  tbody.innerHTML = recent.map(s => `
    <tr onclick="openSessionDetail(${s.id})">
      <td><div class="rs-date">${formatSessionDate(s)}</div></td>
      <td><span class="type-chip ${s.session_type === 'practical' ? 'practical' : ''}">${sessionTypeLabel(s.session_type)}</span></td>
      <td><div class="rs-tutor">${s.tutor_names || '—'}</div></td>
      <td><div class="rs-dur">${claimHint(s.session_type)}</div></td>
      <td>${dashboardStatusChip(s.status)}</td>
    </tr>`).join('');
}

function sessionTypeIconSvg(type) {
  const icons = {
    lecture: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>`,
    practical: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    tutorial: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    online: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-10 6L2 8"/></svg>`,
    revision: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>`,
  };
  return icons[type] || icons.lecture;
}

function isSessionLiveNow(s) {
  if (!isSessionToday(s) || s.status !== 'active') return false;
  if (!s.start_time) return true;

  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const startMins = nsTimeToMinutes(String(s.start_time).slice(0, 5));
  const endStr = s.end_time
    ? String(s.end_time).slice(0, 5)
    : nsComputeEndTime(String(s.start_time).slice(0, 5), s.session_type || 'tutorial');
  const endMins = nsTimeToMinutes(endStr);
  return nowMins >= startMins && nowMins <= endMins;
}

function findLiveSessionToday(sessions) {
  const todayStr = localTodayKey();
  const liveToday = (sessions || []).filter((s) => (
    sessionDateKey(s.session_date) === todayStr && s.status === 'active'
  ));

  if (!liveToday.length) return null;
  if (liveToday.length === 1) return liveToday[0];

  const inWindow = liveToday.find(isSessionLiveNow);
  if (inWindow) return inWindow;

  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  return liveToday.reduce((best, s) => {
    if (!s.start_time) return best || s;
    const startMins = nsTimeToMinutes(String(s.start_time).slice(0, 5));
    const distance = Math.abs(startMins - nowMins);
    if (!best) return { session: s, distance };
    return distance < best.distance ? { session: s, distance } : best;
  }, null)?.session || liveToday[0];
}

function findNextSessionToday(sessions) {
  const todayStr = localTodayKey();
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();

  const candidates = (sessions || [])
    .filter((s) => {
      if (sessionDateKey(s.session_date) !== todayStr) return false;
      if (s.status === 'completed' || s.status === 'flagged') return false;
      if (s.status === 'cancelled') return false;
      if (s.status === 'active') return false; // handled by findLiveSessionToday
      return true;
    })
    .map((s) => {
      const startMins = s.start_time
        ? nsTimeToMinutes(String(s.start_time).slice(0, 5))
        : null;
      return { session: s, startMins };
    })
    .sort((a, b) => {
      // Prefer sessions that haven't started yet, then soonest start, then overdue
      const aUpcoming = a.startMins == null || a.startMins >= nowMins;
      const bUpcoming = b.startMins == null || b.startMins >= nowMins;
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      const aMins = a.startMins == null ? 9999 : a.startMins;
      const bMins = b.startMins == null ? 9999 : b.startMins;
      if (aUpcoming) return aMins - bMins;
      return bMins - aMins; // most recently due overdue first
    });

  return candidates[0]?.session || null;
}

function findTodayCardSession(sessions) {
  const live = findLiveSessionToday(sessions);
  if (live) return { session: live, mode: 'live' };
  const next = findNextSessionToday(sessions);
  if (!next) return null;

  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const startMins = next.start_time
    ? nsTimeToMinutes(String(next.start_time).slice(0, 5))
    : null;
  const mode = startMins != null && startMins < nowMins ? 'due' : 'upcoming';
  return { session: next, mode };
}

function renderTodayCardTutorAvatars(namesStr) {
  const tutors = parseTutorNames(namesStr);
  if (!tutors.length) {
    return '<span class="card-desc-tba">TBA</span>';
  }
  return `<div class="s-av-stack card-desc-av-stack">${tutors.map((t) => `<div class="s-av">${t.initials}</div>`).join('')}</div>`;
}

function renderTodayCard(sessions) {
  const card  = document.getElementById('today-card');
  const empty = document.getElementById('today-card-empty');
  if (!card || !empty) return;

  const result = findTodayCardSession(sessions);

  if (!result) {
    card.style.display = 'none';
    empty.style.display = 'block';
    empty.textContent = 'No more sessions scheduled for today on this module.';
    updateLecMobileHubNext([]);
    return;
  }

  const { session: todaySession, mode } = result;

  empty.style.display = 'none';
  card.style.display = 'block';

  const tagEl = card.querySelector('.tag');
  if (tagEl) {
    tagEl.textContent =
      mode === 'live' ? 'Live now' :
      mode === 'due' ? 'Due now' :
      'Up next';
  }

  const dotEl = card.querySelector('.status-dot');
  if (dotEl) {
    dotEl.className = mode === 'live'
      ? 'status-dot live-pulse'
      : mode === 'due'
        ? 'status-dot awaiting'
        : 'status-dot awaiting';
  }

  setText('#today-card-title', `${todaySession.module_code} — ${sessionTypeLabel(todaySession.session_type)}`);
  const descEl = document.getElementById('today-card-desc');
  if (descEl) {
    const topic = String(todaySession.topic || currentModuleName || '—')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const tutorLabel = mode === 'live' ? 'Tutor:' : 'Available:';
    const tutorNames = mode === 'live'
      ? todaySession.tutor_names
      : todaySession.tutor_confirmed_names;
    const tutorHtml = mode !== 'live' && !tutorNames
      ? '<span class="card-desc-tba">None yet</span>'
      : renderTodayCardTutorAvatars(tutorNames);
    descEl.innerHTML = `<span class="card-desc-topic">${topic} · ${tutorLabel}</span>${tutorHtml}`;
  }
  const iconEl = document.getElementById('today-card-icon');
  if (iconEl) {
    const sessionType = todaySession.session_type || 'lecture';
    iconEl.className = `card-icon icon-${sessionType}`;
    iconEl.innerHTML = sessionTypeIconSvg(sessionType);
  }
  const timeEl = document.getElementById('today-card-time');
  if (timeEl) {
    timeEl.innerHTML = todaySession.start_time
      ? `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${String(todaySession.start_time).slice(0, 5)} · ${todaySession.venue || '—'}`
      : (todaySession.venue || '—');
  }
  const typeEl = document.getElementById('today-card-type');
  if (typeEl) {
    typeEl.textContent = sessionTypeLabel(todaySession.session_type);
    typeEl.className = `type-chip ${todaySession.session_type === 'practical' ? 'practical' : ''}`;
  }
  updateLecMobileHubNext(sessions);
}

function updateSessionsHeroStats(sessions) {
  const sub = document.getElementById('sessions-hero-sub');
  if (sub && currentModuleCode) {
    sub.textContent = `${currentModuleCode} · ${currentModuleName} · ${sessions.length} session${sessions.length === 1 ? '' : 's'} total`;
  }
  const dashStats = document.querySelector('#view-dashboard .stat-box:nth-child(3) .stat-val');
  if (dashStats) dashStats.textContent = String(sessions.length);
}

function renderSidebarTutors(tutors) {
  const wrap = document.getElementById('sidebar-tutors-list');
  if (!wrap) return;

  if (!tutors.length) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No tutors on this module yet.</div>';
    return;
  }

  wrap.innerHTML = tutors.map((t, i) => {
    const initials = VF.initials(t.first_names, t.surname);
    const last = i === tutors.length - 1 ? ' style="border-bottom:none;padding-bottom:0;"' : '';
    return `<div class="tutor-item"${last}>
      <div class="tutor-av">${initials}</div>
      <div><div class="tutor-name">${t.first_names} ${t.surname}</div><div class="tutor-mod">${t.module_name || currentModuleCode}</div></div>
      <div class="tutor-sessions">—</div>
    </div>`;
  }).join('');
}

function formatClaimPeriod(c) {
  return `${MONTH_SHORT[c.period_month] || c.period_month} ${c.period_year}`;
}

function claimUiStatus(status) {
  if (status === 'pending_lecturer') return 'needs-review';
  if (status === 'pending_coordinator') return 'under-review';
  if (status === 'returned_by_lecturer' || status === 'returned_by_coordinator') return 'rejected';
  return status;
}

function claimStatusTag(status) {
  const ui = claimUiStatus(status);
  if (ui === 'needs-review') return '<span class="claim-status-tag new-tag">Pending lecturer review</span>';
  if (ui === 'under-review') return '<span class="claim-status-tag review">Pending coordinator</span>';
  if (status === 'approved') return '<span class="claim-status-tag paid">Approved</span>';
  if (status === 'returned_by_lecturer') return '<span class="claim-status-tag" style="background:rgba(200,90,90,.1);color:var(--red);border:1px solid rgba(200,90,90,.2);">Returned by lecturer</span>';
  if (status === 'returned_by_coordinator') return '<span class="claim-status-tag" style="background:rgba(200,90,90,.1);color:var(--red);border:1px solid rgba(200,90,90,.2);">Returned by coordinator</span>';
  return `<span class="claim-status-tag">${status}</span>`;
}

function formatClaimAmount(amount) {
  if (amount == null) return '—';
  return 'R' + Number(amount).toLocaleString('en-ZA');
}

function formatClaimReviewDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function lecLecturerStepState(status) {
  if (status === 'pending_lecturer') return 'pending';
  if (status === 'returned_by_lecturer') return 'returned';
  if (['pending_coordinator', 'approved', 'returned_by_coordinator'].includes(status)) return 'approved';
  return 'waiting';
}

function lecCoordinatorStepState(status) {
  if (status === 'pending_coordinator') return 'pending';
  if (status === 'returned_by_coordinator') return 'returned';
  if (status === 'approved') return 'approved';
  return 'waiting';
}

function lecStepBadge(state) {
  if (state === 'approved') return 'Approved';
  if (state === 'pending') return 'In review';
  if (state === 'returned') return 'Returned';
  return 'Upcoming';
}

function lecStepIcon(state) {
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

function lecApprovalStep(role, subtitle, state, date, note, isLast) {
  const noteHtml = note ? `<div class="at-note">${note}</div>` : '';
  const dateHtml = date ? `<div class="at-date">${date}</div>` : '';
  return `<div class="at-step at-step--${state}${isLast ? ' at-step--last' : ''}">
    <div class="at-rail">
      <div class="at-dot at-dot--${state}">${lecStepIcon(state)}</div>
      ${isLast ? '' : `<div class="at-line at-line--${state === 'approved' ? 'done' : 'idle'}"></div>`}
    </div>
    <div class="at-body">
      <div class="at-head">
        <div class="at-role">${role}</div>
        <span class="at-badge at-badge--${state}">${lecStepBadge(state)}</span>
      </div>
      ${subtitle ? `<div class="at-sub">${subtitle}</div>` : ''}
      ${dateHtml}
      ${noteHtml}
    </div>
  </div>`;
}

function lecCoordinatorFeedbackBar(claim) {
  const lecState = lecLecturerStepState(claim.status);
  const coordState = lecCoordinatorStepState(claim.status);
  const verifiedAt = lecState === 'approved' ? formatClaimReviewDate(claim.lecturer_reviewed_at) : null;
  const coordDate = coordState === 'approved' ? formatClaimReviewDate(claim.coordinator_reviewed_at) : null;
  const lecNote = lecState === 'returned' ? (claim.lecturer_note || '') : '';
  const coordNote = coordState === 'returned' ? (claim.coordinator_note || '') : '';
  const lecSub = lecState === 'pending' ? 'Awaiting your action' : (lecState === 'returned' ? 'Sent back to tutor' : 'Forwarded to coordinator');

  return `<div class="approval-track">
    ${lecApprovalStep('Your review', lecSub, lecState, verifiedAt, lecNote, false)}
    ${lecApprovalStep('Coordinator', 'FYE Office', coordState, coordDate, coordNote, true)}
  </div>`;
}

function lecClaimCardFeedback(c) {
  if (c.status === 'approved' && c.coordinator_reviewed_at) {
    const when = formatClaimReviewDate(c.coordinator_reviewed_at);
    return `<div class="claim-coord-feedback approved">Coordinator approved${when ? ` · ${when}` : ''}</div>`;
  }
  if (c.status === 'returned_by_coordinator' && c.coordinator_note) {
    return `<div class="claim-coord-feedback returned">Coordinator returned — ${c.coordinator_note}</div>`;
  }
  if (c.status === 'pending_coordinator') {
    return '<div class="claim-coord-feedback pending">With coordinator for approval</div>';
  }
  return '';
}

function tutorShortName(first, surname) {
  const f = (first || '').trim();
  const s = (surname || '').trim();
  if (!f && !s) return 'Tutor';
  return `${f.charAt(0).toUpperCase()}. ${s}`;
}

function renderDashboardClaimApprovals(claims) {
  const wrap = document.getElementById('dash-claim-approvals');
  if (!wrap) return;

  const pending = claims.filter(c => c.status === 'pending_lecturer');
  const badge = document.querySelector('#view-dashboard .panel-header span[style*="accent"]');
  if (badge) badge.textContent = String(pending.length);

  if (!pending.length) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No claims awaiting your review on this module.</div>';
    return;
  }

  wrap.innerHTML = pending.slice(0, 2).map((c, i) => {
    const last = i === Math.min(pending.length, 2) - 1 ? ' style="border-bottom:none;padding-bottom:0;"' : '';
    const dot = 'new';
    return `<div class="approval-item"${last}>
      <div class="appr-dot ${dot}"></div>
      <div class="appr-info">
        <div class="appr-name">${tutorShortName(c.tutor_first_names, c.tutor_surname)} — ${c.module_code || currentModuleCode || '—'} · ${formatClaimPeriod(c)}</div>
        <div class="appr-sub">${Number(c.total_hours || 0)} hrs · Submitted ${c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('en-ZA') : '—'}</div>
      </div>
      <div style="text-align:right;">
        <div class="appr-amt">${formatClaimAmount(c.total_amount)}</div>
        ${claimStatusTag(c.status)}
      </div>
    </div>`;
  }).join('');
}

function renderClaimsList(claims) {
  const list = document.getElementById('claims-list');
  if (!list) return;

  if (!claims.length) {
    list.innerHTML = '<div class="lec-empty-card"><p>No tutor claims for this module yet.</p></div>';
    return;
  }

  list.innerHTML = claims.map(c => {
    const uiStatus = claimUiStatus(c.status);
    const initials = VF.initials(c.tutor_first_names, c.tutor_surname);
    const pendingReview = c.status === 'pending_lecturer';
    const hoursLabel = c.total_hours != null ? `${Number(c.total_hours)} hrs` : `${c.session_count || 0} sessions`;
    return `
      <div class="claim-card lec-rec-card ${uiStatus}" id="claim-${c.id}" data-status="${uiStatus}" onclick="openClaimDetail(${c.id})">
        <div class="claim-top">
          <div class="claim-av">${initials}</div>
          <div class="claim-info">
            <div class="claim-name">${c.tutor_first_names || ''} ${c.tutor_surname || ''}</div>
            <div class="claim-meta">${c.module_code || currentModuleCode || '—'} · ${formatClaimPeriod(c)}</div>
          </div>
          <div class="claim-amount">
            <div class="claim-amt-val">${formatClaimAmount(c.total_amount)}</div>
            <div class="claim-amt-sub">${hoursLabel}</div>
          </div>
        </div>
        ${claimStatusTag(c.status)}
        <div class="claim-breakdown">
          <div class="cb-item"><div class="cb-val">${c.session_count || 0}</div><div class="cb-label">Sessions</div></div>
          <div class="cb-item"><div class="cb-val">${formatClaimPeriod(c)}</div><div class="cb-label">Period</div></div>
          <div class="cb-item"><div class="cb-val">${c.module_code || '—'}</div><div class="cb-label">Module</div></div>
        </div>
        ${lecClaimCardFeedback(c)}
        <div class="claim-footer">
          <div class="claim-footer-left">
            <span class="claim-submitted">Submitted: ${c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('en-ZA') : '—'}</span>
          </div>
          <div class="claim-actions" onclick="event.stopPropagation()">
            ${pendingReview ? `
              <button type="button" class="cl-btn reject" onclick="returnClaimToTutor(${c.id})">Return</button>
              <button type="button" class="cl-btn approve" onclick="openClaimDetail(${c.id})">View &amp; Verify</button>
            ` : `
              <button type="button" class="cl-btn" onclick="openClaimDetail(${c.id})">View Details</button>
            `}
          </div>
        </div>
      </div>`;
  }).join('');
}

function updateClaimsStats(claims) {
  const pending = claims.filter(c => c.status === 'pending_lecturer');
  const approved = claims.filter(c => c.status === 'approved');
  const coordinator = claims.filter(c => c.status === 'pending_coordinator');
  const approvedTotal = approved.reduce((sum, c) => sum + Number(c.total_amount || 0), 0);
  const submitted = claims.length;
  const approvalRate = submitted ? Math.round((approved.length / submitted) * 100) : 0;
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  setText('#pending-count', String(pending.length));
  setText('#claims-badge', pending.length ? String(pending.length) : '');
  setText('#lec-hub-claims-sub', pending.length ? `${pending.length} to review` : 'Approvals');

  setText('#claims-hero-sem', `${MONTH_SHORT[month]} ${year}`);
  setText('#claims-approval-pct', `${approvalRate}%`);
  setText('#claims-stat-pending', String(pending.length));
  setText('#claims-stat-coordinator', String(coordinator.length));
  setText('#claims-stat-submitted', String(submitted));
  setText('#claims-stat-approved', formatClaimAmount(approvedTotal));
  setText('#claims-stat-approved-sub', `${approved.length} approved`);

  const ring = document.getElementById('claims-ring-arc');
  if (ring) {
    const circ = 264;
    const offset = circ * (1 - Math.min(100, Math.max(0, approvalRate)) / 100);
    ring.setAttribute('stroke-dashoffset', String(offset));
  }
  const approvalSub = document.getElementById('claims-approval-sub');
  if (approvalSub) {
    approvalSub.innerHTML = `${approved.length} OF ${submitted}<br>SUBMITTED`;
  }

  const strip = document.querySelector('#view-claims .claims-strip');
  if (strip) {
    strip.innerHTML = `
      <div class="cl-stat"><div class="cl-stat-label">Total Submitted</div><div class="cl-stat-val">${claims.length}</div><div class="cl-stat-sub">this module</div></div>
      <div class="cl-stat"><div class="cl-stat-label">Pending Review</div><div class="cl-stat-val hi">${pending.length}</div><div class="cl-stat-sub">need your action</div></div>
      <div class="cl-stat"><div class="cl-stat-label">With Coordinator</div><div class="cl-stat-val amber">${coordinator.length}</div><div class="cl-stat-sub">awaiting approval</div></div>
      <div class="cl-stat"><div class="cl-stat-label">Total Approved</div><div class="cl-stat-val green">${formatClaimAmount(approvedTotal)}</div><div class="cl-stat-sub">${approved.length} approved</div></div>`;
  }
}

async function loadLecturerClaims() {
  const list = document.getElementById('claims-list');
  if (list) list.innerHTML = skeletonClaimCards(4);
  try {
    const qs = moduleQuerySuffix();
    const claims = asListPayload(await VF.apiFetch(`/claims/lecturer${qs}`));
    LECTURER_CLAIMS = claims;
    renderDashboardClaimApprovals(claims);
    renderClaimsList(claims);
    updateClaimsStats(claims);
    updatePendingCount();
  } catch (err) {
    if (list) list.innerHTML = '<div class="lec-empty-card"><p>Could not load claims.</p></div>';
    showToast('Could not load claims');
  }
}

async function loadClaims() {
  return loadLecturerClaims();
}

/* ── SESSION LOADING ── */
async function loadSessions() {
  const container = document.getElementById('sessions-list');
  if (container && !Object.keys(SESSIONS).length) {
    container.innerHTML = skeletonSessionRows(5);
  }
  try {
    const sessions = asListPayload(await VF.apiFetch(`/sessions${moduleQuerySuffix()}`));
    SESSIONS = {};
    sessions.forEach(s => { SESSIONS[s.id] = s; });

    renderSessionRows(sessions);
    renderDashboardRecent(sessions);
    renderTodayCard(sessions);
    updateSessionsHeroStats(sessions);
    rebuildCalendarFromSessions(sessions);
  } catch (err) {
    if (container) {
      container.innerHTML = '<div class="vf-sess-empty lec-sess-empty"><h3>Could not load sessions</h3><p>Please try again.</p></div>';
    }
    showToast('Could not load sessions');
  }
}

function sessionTypeLabel(type) {
  const map = {
    tutorial:  'Tutorial',
    practical: 'Practical',
    online:    'Online',
    revision:  'Revision',
    lecture:   'Lecture',
  };
  return map[type] || type;
}

function sessionTypeDisplay(type) {
  const map = {
    tutorial:  'Tutorial Session',
    practical: 'Practical Session',
    online:    'Online Revision',
    revision:  'Revision Session',
    lecture:   'Lecture Session',
  };
  return map[type] || `${sessionTypeLabel(type)} Session`;
}

function claimHint(type) {
  return (type === 'practical') ? '5h pay' : '3h pay';
}

function parseTutorNames(namesStr) {
  if (!namesStr) return [];
  return namesStr.split(',').map(s => s.trim()).filter(Boolean).map(full => {
    const parts = full.split(/\s+/);
    const first = parts[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1] : '';
    return { full, initials: VF.initials(first, last) };
  });
}

function formatSessionDateParts(s) {
  if (!s.session_date) return { date: '—', time: '—' };
  const d = new Date(s.session_date);
  const date = d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!s.start_time) return { date, time: '—' };
  const start = String(s.start_time).slice(0, 5);
  const [h, m] = start.split(':').map(Number);
  const endH = (h + 2) % 24;
  const end = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { date, time: `${start} - ${end}` };
}

function isSessionToday(s) {
  if (!s.session_date) return false;
  return sessionDateKey(s.session_date) === localTodayKey();
}

function getTutorMetrics(s) {
  const assigned = parseTutorNames(s.tutor_names);
  const assignedCount = Number(s.tutor_assigned_count ?? assigned.length) || 0;
  const confirmedCount = Number(s.tutor_confirmed_count ?? 0) || 0;
  const isPast = s.status === 'completed';
  return {
    assigned,
    assignedCount,
    confirmedCount,
    label: isPast ? 'TUTORS PRESENT' : 'TUTORS ASSIGNED',
    subLabel: isPast ? 'attended' : 'confirmed',
  };
}

function sessionStatusBadge(s) {
  const { assignedCount, confirmedCount } = getTutorMetrics(s);
  if (s.status === 'completed') return { cls: 'confirmed', text: 'Completed' };
  if (s.status === 'cancelled') return { cls: 'awaiting', text: 'Cancelled' };
  if (s.status === 'active') {
    return { cls: 'today-live', text: isSessionToday(s) ? 'Today · Live' : 'Live' };
  }
  if (s.status === 'flagged') return { cls: 'flagged', text: 'Flagged' };
  if (assignedCount === 0) return { cls: 'awaiting', text: 'No tutors assigned' };
  if (confirmedCount === 0) return { cls: 'awaiting', text: `Awaiting ${assignedCount}` };
  if (confirmedCount < assignedCount) {
    return { cls: 'awaiting', text: `Awaiting ${assignedCount - confirmedCount}` };
  }
  return { cls: 'all-confirmed', text: 'All confirmed' };
}

function sessionFilterType(status) {
  if (status === 'completed' || status === 'cancelled') return 'past';
  if (status === 'flagged') return 'flagged';
  return 'upcoming';
}

function sessionActionButton(s) {
  const actions = [];
  if (s.status === 'scheduled') {
    actions.push(`<button type="button" class="sess-act-btn activate lec-session-activate" id="sess-${s.id}-act" onclick="event.stopPropagation(); activateSession(${s.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg> Activate</button>`);
  }
  if (s.status === 'active') {
    actions.push(`<button type="button" class="sess-act-btn end lec-session-activate" id="sess-${s.id}-act" onclick="event.stopPropagation(); endSession(${s.id})">■ End Session</button>`);
  }
  if (s.status === 'scheduled' || s.status === 'active') {
    actions.push(`<button type="button" class="sess-act-btn" onclick="event.stopPropagation(); openPostponeSession(${s.id})">Postpone</button>`);
    actions.push(`<button type="button" class="sess-act-btn end" onclick="event.stopPropagation(); cancelSession(${s.id})">Cancel</button>`);
  }
  return actions.join('');
}

function renderSessionRows(sessions) {
  const container = document.getElementById('sessions-list');
  if (!container) return;

  if (!sessions.length) {
    container.innerHTML = `
      <div class="vf-sess-empty lec-sess-empty">
        <div class="vf-sess-empty-ico" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        </div>
        <h3>No sessions yet</h3>
        <p>Create one using the button below.</p>
      </div>`;
    return;
  }

  container.innerHTML = sessions.map(s => {
    const { date, time } = formatSessionDateParts(s);
    const metrics = getTutorMetrics(s);
    const badge = sessionStatusBadge(s);
    const warnCount = metrics.assignedCount === 0
      || (metrics.confirmedCount < metrics.assignedCount);
    const avatars = metrics.assigned.length
      ? metrics.assigned.slice(0, 3).map(t => `<div class="s-av">${t.initials}</div>`).join('')
      : '<div class="s-av">—</div>';
    const countLabel = metrics.assignedCount
      ? `${metrics.confirmedCount} / ${metrics.assignedCount}`
      : '0 / 0';
    const liveClass = s.status === 'active' ? ' is-live' : '';
    const title = (s.topic || `${s.module_code} — ${sessionTypeDisplay(s.session_type)}`).replace(/</g, '&lt;');
    const desc = `${date} · ${time}`.replace(/</g, '&lt;');
    const due = (time || '—').replace(/</g, '&lt;');
    const typeLabel = `${sessionTypeDisplay(s.session_type)} Session`.replace(/</g, '&lt;');
    const awaitLabel = metrics.assignedCount
      ? (metrics.confirmedCount < metrics.assignedCount
          ? `Awaiting ${metrics.assignedCount - metrics.confirmedCount}`
          : 'Confirmed')
      : 'No tutors';

    return `
      <div class="session-row${liveClass}" id="sess-${s.id}" data-type="${sessionFilterType(s.status)}" onclick="openSessionDetail(${s.id})">
        <div class="session-row-desktop">
          <div>
            <div class="s-date">${date}</div>
            <div class="s-time">${time}</div>
          </div>
          <div>
            <div class="s-title">${s.module_code} — ${sessionTypeDisplay(s.session_type)}</div>
            <div class="s-module">${s.topic || '—'}</div>
          </div>
          <div>
            <div class="s-tutors-label">${metrics.label}</div>
            <div class="s-tutors-row">
              <div class="s-av-stack">${avatars}</div>
              <div>
                <div class="s-avail-count${warnCount ? ' warn' : ''}">${countLabel}</div>
                <div class="s-avail-sub">${metrics.subLabel}</div>
              </div>
            </div>
          </div>
          <div class="s-dur">2 hrs</div>
          <div><span class="status-chip ${badge.cls}" id="sess-${s.id}-status">${badge.text}</span></div>
          <div class="sess-actions">${sessionActionButton(s)}</div>
        </div>
        <article class="vf-sess-card lec-sess-card lec-session-card${s.status === 'active' ? ' vf-sess-card--live' : ''}${s.status === 'completed' || s.status === 'flagged' || s.status === 'cancelled' ? ' vf-sess-card--muted' : ''}">
          <div class="vf-sess-card-top">
            <div class="vf-sess-card-copy">
              <h3 class="vf-sess-card-title">${title}</h3>
              <p class="vf-sess-card-desc">${desc}</p>
            </div>
            <div class="vf-sess-confirm">
              <span class="vf-sess-confirm-label">Confirm tutors</span>
              <div class="s-av-stack card-desc-av-stack">${avatars}</div>
              <span class="vf-sess-confirm-count${warnCount ? ' warn' : ''}">${countLabel}</span>
            </div>
          </div>
          <div class="vf-sess-card-tags">
            <span class="vf-sess-pill">${typeLabel}</span>
            <span class="vf-sess-pill vf-sess-pill--due">Due: ${due}</span>
            <span class="vf-sess-pill">${awaitLabel}</span>
          </div>
          <div class="vf-sess-card-actions">${sessionActionButton(s)}</div>
        </article>
      </div>`;
  }).join('');
}

/* ── ACTIVATE / END / CANCEL / POSTPONE SESSION ── */
async function activateSession(id) {
  try {
    const result = await VF.apiFetch(`/sessions/${id}/activate`, { method: 'PATCH' });
    SESSIONS[id] = { ...SESSIONS[id], status: 'active', session_code: result.sessionCode };
    showToast('Session activated — code: ' + result.sessionCode);
    renderSessionRows(Object.values(SESSIONS));
    renderTodayCard(Object.values(SESSIONS));
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not activate session');
  }
}

async function endSession(id) {
  try {
    await VF.apiFetch(`/sessions/${id}/complete`, { method: 'PATCH' });
    SESSIONS[id] = { ...SESSIONS[id], status: 'completed', session_code: null };
    showToast('Session ended — moved to Past');
    renderSessionRows(Object.values(SESSIONS));
    renderTodayCard(Object.values(SESSIONS));
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not end session');
  }
}

async function cancelSession(id) {
  const s = SESSIONS[id];
  if (!s) return;
  const label = s.topic || s.module_code || 'this session';
  if (!window.confirm(`Cancel "${label}"?\n\nTutors will no longer see it as upcoming. This cannot be undone.`)) {
    return;
  }
  try {
    await VF.apiFetch(`/sessions/${id}/cancel`, { method: 'PATCH' });
    SESSIONS[id] = { ...SESSIONS[id], status: 'cancelled', session_code: null };
    showToast('Session cancelled');
    renderSessionRows(Object.values(SESSIONS));
    renderTodayCard(Object.values(SESSIONS));
    renderDashboardRecent(Object.values(SESSIONS));
    rebuildCalendarFromSessions(Object.values(SESSIONS));
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not cancel session');
  }
}

let postponeSessionId = null;

function ppDefaultDurationHours(session) {
  return session && session.session_type === 'practical' ? 3 : 2;
}

function ppCapEndFromStart(startHHMM, hours) {
  if (!startHHMM || !/^\d{2}:\d{2}$/.test(startHHMM)) return '';
  const [h, m] = startHHMM.split(':').map(Number);
  const total = Math.min(h * 60 + m + hours * 60, 20 * 60);
  const eh = Math.floor(total / 60);
  const em = total % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

function syncPostponeEndFromStart() {
  const s = postponeSessionId != null ? SESSIONS[postponeSessionId] : null;
  const startEl = document.getElementById('pp-start');
  const endEl = document.getElementById('pp-end');
  if (!startEl || !endEl || !startEl.value) return;
  endEl.value = ppCapEndFromStart(startEl.value, ppDefaultDurationHours(s));
}

function openPostponeSession(id) {
  const s = SESSIONS[id];
  if (!s) return;
  postponeSessionId = id;

  const title = document.getElementById('pp-modal-title');
  if (title) title.textContent = s.topic || `${s.module_code} — ${sessionTypeLabel(s.session_type)}`;

  const dateEl = document.getElementById('pp-date');
  const startEl = document.getElementById('pp-start');
  const endEl = document.getElementById('pp-end');
  const venueEl = document.getElementById('pp-venue');

  const dateKey = sessionDateKey(s.session_date) || '';
  const start = s.start_time ? String(s.start_time).slice(0, 5) : '';
  let end = s.end_time ? String(s.end_time).slice(0, 5) : '';
  if (start) {
    const startMins = nsTimeToMinutes(start);
    const endMins = end ? nsTimeToMinutes(end) : null;
    if (endMins == null || endMins <= startMins || endMins > 20 * 60) {
      end = ppCapEndFromStart(start, ppDefaultDurationHours(s));
    }
  }

  if (dateEl) dateEl.value = dateKey;
  if (startEl) startEl.value = start;
  if (endEl) endEl.value = end;
  if (venueEl) venueEl.value = s.venue || '';

  if (startEl && !startEl._ppBound) {
    startEl.addEventListener('change', syncPostponeEndFromStart);
    startEl.addEventListener('input', syncPostponeEndFromStart);
    startEl._ppBound = true;
  }

  document.getElementById('pp-overlay')?.classList.add('open');
}

function closePostponeSession(e) {
  if (e && e.target !== document.getElementById('pp-overlay')) return;
  document.getElementById('pp-overlay')?.classList.remove('open');
  postponeSessionId = null;
}

async function submitPostponeSession() {
  if (!postponeSessionId) return;
  const sessionDate = document.getElementById('pp-date')?.value;
  const startTime = document.getElementById('pp-start')?.value || null;
  const endTime = document.getElementById('pp-end')?.value || null;
  const venue = document.getElementById('pp-venue')?.value?.trim() || null;

  if (!sessionDate) {
    document.getElementById('pp-date')?.focus();
    showToast('Choose a new session date');
    return;
  }

  try {
    await VF.apiFetch(`/sessions/${postponeSessionId}/postpone`, {
      method: 'PATCH',
      body: { sessionDate, startTime, endTime, venue },
    });
    const id = postponeSessionId;
    SESSIONS[id] = {
      ...SESSIONS[id],
      session_date: sessionDate,
      start_time: startTime,
      end_time: endTime,
      venue: venue || SESSIONS[id].venue,
      status: 'scheduled',
      session_code: null,
      tutor_confirmed_names: null,
      tutors_confirmed: 0,
    };
    closePostponeSession();
    showToast('Session postponed — tutors will need to re-confirm');
    await loadSessions();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not postpone session');
  }
}

window.cancelSession = cancelSession;
window.openPostponeSession = openPostponeSession;
window.closePostponeSession = closePostponeSession;
window.submitPostponeSession = submitPostponeSession;

/* ── SESSION FILTER TABS ── */
function filterSessions(type, btn) {
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const all = Object.values(SESSIONS);
  let filtered;
  if (type === 'all')      { filtered = all; }
  else if (type === 'upcoming') { filtered = all.filter(s => s.status === 'scheduled' || s.status === 'active'); }
  else if (type === 'past')     { filtered = all.filter(s => s.status === 'completed' || s.status === 'cancelled'); }
  else if (type === 'flagged')  { filtered = all.filter(s => s.status === 'flagged'); }
  else { filtered = all; }
  renderSessionRows(filtered);
}

/* ── SESSION DETAIL ── */
function openSessionDetail(id) {
  const s = SESSIONS[id];
  if (!s) return;
  showToast('Session: ' + (s.topic || s.module_code));
  // Full detail modal can be built later — for now just a toast
}

/* ── NEW SESSION MODAL ── */
let nsPrefilledDate = null;

const NS_SESSION_HOUR_START = 8;
const NS_SESSION_HOUR_END = 20;

function nsPad2(n) {
  return String(n).padStart(2, '0');
}

function nsTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function nsIsWithinSessionHours(timeStr) {
  const mins = nsTimeToMinutes(timeStr);
  if (mins == null) return true;
  return mins >= NS_SESSION_HOUR_START * 60 && mins <= NS_SESSION_HOUR_END * 60;
}

function nsComputeEndTime(startTime, sessionType) {
  const [h, m] = startTime.split(':').map(Number);
  const addHours = sessionType === 'practical' ? 3 : 2;
  const totalMins = h * 60 + m + addHours * 60;
  return `${nsPad2(Math.floor(totalMins / 60) % 24)}:${nsPad2(totalMins % 60)}`;
}

function nsDefaultPickerTime() {
  const now = new Date();
  let h = now.getHours();
  let m = Math.floor(now.getMinutes() / 5) * 5;
  if (h < NS_SESSION_HOUR_START) { h = NS_SESSION_HOUR_START; m = 0; }
  if (h > NS_SESSION_HOUR_END) { h = NS_SESSION_HOUR_END; m = 0; }
  if (h === NS_SESSION_HOUR_END && m > 0) m = 0;
  return { h: nsPad2(h), m: nsPad2(m) };
}

function nsValidateSessionTimes(startTime, endTime, sessionType) {
  if (!startTime) return 'Please select a start time between 08:00 and 20:00.';
  if (!nsIsWithinSessionHours(startTime)) {
    return 'Start time must be between 08:00 and 20:00.';
  }
  if (endTime && !nsIsWithinSessionHours(endTime)) {
    return 'End time must be between 08:00 and 20:00.';
  }
  const resolvedEnd = endTime || nsComputeEndTime(startTime, sessionType);
  if (!nsIsWithinSessionHours(resolvedEnd)) {
    return 'Session must finish by 20:00. Choose an earlier start or end time.';
  }
  if (endTime && nsTimeToMinutes(endTime) <= nsTimeToMinutes(startTime)) {
    return 'End time must be after start time.';
  }
  return null;
}

function initNsTimePickers() {
  document.querySelectorAll('.ns-time-picker').forEach((pickerEl) => {
    if (pickerEl.dataset.initialized === '1') return;
    pickerEl.dataset.initialized = '1';

    const hiddenId = pickerEl.dataset.hiddenId;
    const hidden = document.getElementById(hiddenId);
    const trigger = pickerEl.querySelector('.ns-time-trigger');
    const valueEl = pickerEl.querySelector('.ns-time-trigger-value');
    const panel = pickerEl.querySelector('.ns-time-panel');
    const hourSel = pickerEl.querySelector('.ns-time-hour');
    const minSel = pickerEl.querySelector('.ns-time-minute');
    const isEnd = hiddenId === 'ns-time-end';
    const emptyLabel = isEnd ? 'Optional' : 'Select time';

    for (let h = NS_SESSION_HOUR_START; h <= NS_SESSION_HOUR_END; h++) {
      hourSel.add(new Option(nsPad2(h), nsPad2(h)));
    }
    for (let m = 0; m < 60; m += 5) {
      minSel.add(new Option(nsPad2(m), nsPad2(m)));
    }

    function syncDisplay() {
      const v = hidden.value;
      valueEl.textContent = v || emptyLabel;
      valueEl.classList.toggle('is-placeholder', !v);
      if (v) {
        const [h, m] = v.split(':');
        hourSel.value = h;
        const snapped = nsPad2(Math.round(Number(m) / 5) * 5 % 60);
        minSel.value = minSel.querySelector(`option[value="${snapped}"]`) ? snapped : '00';
      }
    }

    function closePanel() {
      panel.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function openPanel() {
      if (typeof closeNsDatePicker === 'function') closeNsDatePicker();
      document.querySelectorAll('.ns-time-panel.open').forEach((p) => {
        if (p !== panel) {
          p.classList.remove('open');
          p.closest('.ns-time-picker')?.querySelector('.ns-time-trigger')?.setAttribute('aria-expanded', 'false');
        }
      });
      panel.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      if (!hidden.value) {
        const { h, m } = nsDefaultPickerTime();
        hourSel.value = h;
        minSel.value = m;
      }
    }

    function applyTime() {
      const candidate = `${hourSel.value}:${minSel.value}`;
      if (!nsIsWithinSessionHours(candidate)) {
        showToast('Time must be between 08:00 and 20:00.');
        return;
      }
      hidden.value = candidate;
      syncDisplay();
      closePanel();
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel.classList.contains('open')) closePanel();
      else openPanel();
    });

    panel.addEventListener('click', (e) => e.stopPropagation());
    panel.querySelector('.ns-time-apply').addEventListener('click', applyTime);
    panel.querySelector('.ns-time-clear').addEventListener('click', () => {
      hidden.value = '';
      syncDisplay();
      closePanel();
    });

    pickerEl._reset = () => {
      hidden.value = '';
      syncDisplay();
      closePanel();
    };
    syncDisplay();
  });
}

function resetNsTimePickers() {
  document.querySelectorAll('.ns-time-picker').forEach((p) => p._reset?.());
}

document.addEventListener('click', () => {
  document.querySelectorAll('.ns-time-panel.open').forEach((p) => {
    p.classList.remove('open');
    p.closest('.ns-time-picker')?.querySelector('.ns-time-trigger')?.setAttribute('aria-expanded', 'false');
  });
});

function openNewSession(prefillDate) {
  ['ns-date','ns-venue','ns-topic'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const dateDisplay = document.getElementById('ns-date-display');
  if (dateDisplay) dateDisplay.value = '';
  closeNsDatePicker();
  resetNsTimePickers();
  document.getElementById('ns-type-value').value = '';
  document.querySelectorAll('.ns-type-pill').forEach(p => p.classList.remove('selected'));
  document.querySelectorAll('.ns-tutor-row').forEach(r => {
    r.classList.remove('checked');
    const check = r.querySelector('.ns-tutor-check');
    if (check) check.innerHTML = '';
  });
  const indicator = document.getElementById('ns-claim-indicator');
  if (indicator) indicator.style.display = 'none';
  document.getElementById('ns-modal-module-label').textContent =
    currentModuleCode ? currentModuleCode + ' · ' + currentModuleName : 'Select a module tab first';
  if (prefillDate) {
    setNsDateValue(prefillDate);
    nsPrefilledDate = prefillDate;
  } else {
    nsPrefilledDate = null;
  }
  document.getElementById('ns-overlay').classList.add('open');
  loadTutorsForModal();
  setTimeout(() => {
    const focusEl = prefillDate
      ? document.querySelector('[data-hidden-id="ns-time-start"] .ns-time-trigger')
      : document.getElementById('ns-date-display');
    focusEl?.focus();
  }, 300);
}

function closeNewSession() {
  closeNsDatePicker();
  document.getElementById('ns-overlay').classList.remove('open');
}
function nsCloseOutside(e) { if (e.target === document.getElementById('ns-overlay')) closeNewSession(); }

/* ── New Session date picker (desktop + mobile) ── */
let nsDpCursor = new Date();
const NS_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isoToDisplayDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}
function setNsDateValue(iso) {
  const hidden = document.getElementById('ns-date');
  const display = document.getElementById('ns-date-display');
  const wrap = document.getElementById('ns-date-wrap');
  if (hidden) hidden.value = iso || '';
  if (display) display.value = iso ? isoToDisplayDate(iso) : '';
  wrap?.classList.remove('ns-error');
  if (iso) {
    const [y, m] = iso.split('-').map(Number);
    nsDpCursor = new Date(y, m - 1, 1);
  }
}
function closeNsDatePicker() {
  const picker = document.getElementById('ns-date-picker');
  if (picker) {
    picker.hidden = true;
    picker.classList.remove('open');
  }
}
function openNsDatePicker() {
  document.querySelectorAll('.ns-time-panel.open').forEach((p) => {
    p.classList.remove('open');
    p.closest('.ns-time-picker')?.querySelector('.ns-time-trigger')?.setAttribute('aria-expanded', 'false');
  });
  const picker = document.getElementById('ns-date-picker');
  if (!picker) return;
  const current = document.getElementById('ns-date')?.value;
  if (current) {
    const [y, m] = current.split('-').map(Number);
    nsDpCursor = new Date(y, m - 1, 1);
  } else {
    const now = new Date();
    nsDpCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  buildNsCalendar();
  picker.hidden = false;
  picker.classList.add('open');
}
function toggleNsDatePicker(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  const picker = document.getElementById('ns-date-picker');
  if (!picker) return;
  if (picker.hidden) openNsDatePicker();
  else closeNsDatePicker();
}
function nsDateShift(delta) {
  nsDpCursor = new Date(nsDpCursor.getFullYear(), nsDpCursor.getMonth() + delta, 1);
  buildNsCalendar();
}
function buildNsCalendar() {
  const grid = document.getElementById('ns-dp-grid');
  const monthEl = document.getElementById('ns-dp-month');
  if (!grid || !monthEl) return;
  const y = nsDpCursor.getFullYear();
  const m = nsDpCursor.getMonth();
  monthEl.textContent = `${NS_MONTHS[m]} ${y}`;
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const selected = document.getElementById('ns-date')?.value || '';
  const dows = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html = dows.map(d => `<div class="ns-dp-dow">${d}</div>`).join('');
  for (let i = firstDow - 1; i >= 0; i--) {
    html += `<div class="ns-dp-day muted">${prevDays - i}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const sel = iso === selected ? ' selected' : '';
    html += `<button type="button" class="ns-dp-day${sel}" data-iso="${iso}" onclick="event.stopPropagation(); selectNsDay('${iso}')">${d}</button>`;
  }
  const cellsUsed = firstDow + daysInMonth;
  const trailing = (7 - (cellsUsed % 7)) % 7;
  for (let d = 1; d <= trailing; d++) {
    html += `<div class="ns-dp-day muted">${d}</div>`;
  }
  grid.innerHTML = html;
}
function selectNsDay(iso) {
  setNsDateValue(iso);
  closeNsDatePicker();
}
function clearNsDate() {
  setNsDateValue('');
  buildNsCalendar();
}
function selectNsToday() {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  selectNsDay(iso);
}
window.toggleNsDatePicker = toggleNsDatePicker;
window.openNsDatePicker = openNsDatePicker;
window.nsDateShift = nsDateShift;
window.selectNsDay = selectNsDay;
window.clearNsDate = clearNsDate;
window.selectNsToday = selectNsToday;

document.addEventListener('click', (e) => {
  const field = document.querySelector('#ns-overlay .ns-field-date');
  const picker = document.getElementById('ns-date-picker');
  if (!field || !picker || picker.hidden) return;
  if (!field.contains(e.target)) closeNsDatePicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const picker = document.getElementById('ns-date-picker');
  if (picker && !picker.hidden) closeNsDatePicker();
});

const CLAIM_TYPE_MAP = {
  'tutorial': 'Tutorial (3h claim)',  'online':   'Tutorial (3h claim)',
  'revision': 'Tutorial (3h claim)',  'lecture':  'Tutorial (3h claim)',
  'practical': 'Practical (5h claim)',
};
const CLAIM_BADGE_MAP = {
  'tutorial': '3h pay', 'online': '3h pay', 'revision': '3h pay',
  'lecture': '3h pay',  'practical': '5h pay',
};

function selectType(el, val) {
  document.querySelectorAll('.ns-type-pill').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('ns-type-value').value = val;
  const cat   = CLAIM_TYPE_MAP[val]  || 'Tutorial (3h claim)';
  const badge = CLAIM_BADGE_MAP[val] || '3h pay';
  const catEl = document.getElementById('ns-claim-category');
  const bdgEl = document.getElementById('ns-claim-badge');
  const indEl = document.getElementById('ns-claim-indicator');
  if (catEl) catEl.textContent = cat;
  if (bdgEl) bdgEl.textContent = badge;
  if (indEl) indEl.style.display = 'flex';
}

async function createSession() {
  const topic     = document.getElementById('ns-topic').value.trim();
  const type      = document.getElementById('ns-type-value').value;
  const date      = document.getElementById('ns-date').value;
  const startTime = document.getElementById('ns-time-start').value;
  const endTime   = document.getElementById('ns-time-end').value;
  const venue     = document.getElementById('ns-venue').value.trim();

  if (!topic) { hlt('ns-topic'); return; }
  if (!type)  { shakePills(); return; }
  if (!date)  { hlt('ns-date-display'); document.getElementById('ns-date-wrap')?.classList.add('ns-error'); return; }
  if (!currentModuleCode) { showToast('Select a module tab before creating a session'); return; }

  const timeError = nsValidateSessionTimes(startTime, endTime, type);
  if (timeError) { showToast(timeError); return; }

  const assignedTutorIds = [...document.querySelectorAll('.ns-tutor-row.checked')]
    .map(r => parseInt(r.dataset.tutor))
    .filter(Boolean);

  try {
    await VF.apiFetch('/sessions', {
      method: 'POST',
      body: {
        moduleCode:  currentModuleCode,
        topic,
        sessionType: type,
        sessionDate: date,
        startTime:   startTime || null,
        endTime:     endTime || null,
        venue:       venue || null,
        tutorIds:    assignedTutorIds,
      },
    });
    closeNewSession();
    loadSessions();
    showToast('Session created — ' + topic);
  } catch (err) {
    showToast('Could not create session');
  }
}

function shakePills() {
  const g = document.getElementById('ns-type-grid');
  if (!g) return;
  g.style.outline = '1px solid var(--red)';
  g.style.borderRadius = '8px';
  setTimeout(() => g.style.outline = '', 1600);
}

function hlt(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = 'var(--red)';
  el.focus();
  setTimeout(() => el.style.borderColor = '', 1800);
}

/* ── CALENDAR DATE CLICK ── */
let calEmptyDateValue = null;
function openNewSessionOnDate() {
  if (calEmptyDateValue) openNewSession(calEmptyDateValue);
}

/* ── TUTOR TOGGLES ── */
function toggleTutor(row) {
  row.classList.toggle('checked');
  const check = row.querySelector('.ns-tutor-check');
  if (!check) return;
  check.innerHTML = row.classList.contains('checked')
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
    : '';
}
function toggleSelectAllTutors() {
  const rows = document.querySelectorAll('.ns-tutor-row');
  const allChecked = [...rows].every(r => r.classList.contains('checked'));
  rows.forEach(r => {
    r.classList.toggle('checked', !allChecked);
    const check = r.querySelector('.ns-tutor-check');
    if (!check) return;
    check.innerHTML = !allChecked
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
      : '';
  });
}

/* ── LOAD TUTORS INTO NEW SESSION MODAL ── */
function renderNsTutorList(tutors) {
  const wrap = document.getElementById('ns-tutor-list');
  if (!wrap) return;
  if (!tutors.length) {
    wrap.innerHTML = '<div class="ns-tutor-empty">No approved tutors on this module yet.</div>';
    return;
  }
  wrap.innerHTML = tutors.map(t => {
    const initials = VF.initials(t.first_names, t.surname);
    return `<div class="ns-tutor-row" data-tutor="${t.id}" onclick="toggleTutor(this)">
        <div class="ns-tutor-av">${initials}</div>
        <div class="ns-tutor-info">
          <div class="ns-tutor-name">${t.first_names} ${t.surname}</div>
          <div class="ns-tutor-meta">${t.module_name || currentModuleCode}</div>
        </div>
        <div class="ns-tutor-check" aria-hidden="true"></div>
      </div>`;
  }).join('');
}

async function loadTutorsForModal() {
  try {
    if (Array.isArray(moduleTutorPool) && moduleTutorPool.length) {
      renderNsTutorList(moduleTutorPool);
      return;
    }
    const tutors = await VF.apiFetch(`/users/tutors${moduleQuerySuffix()}`);
    renderNsTutorList(tutors);
  } catch (err) {
    /* optional */
  }
}


/* REFER A TUTOR */
function openReferTutor() {
  ['rt-name','rt-surname','rt-email','rt-qualification'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const courseEl = document.getElementById('rt-course');
  const moduleEl = document.getElementById('rt-module');
  if (courseEl) courseEl.value = courseShortCode(currentModuleCourse);
  if (moduleEl) moduleEl.value = currentModuleCode || '';
  document.getElementById('rt-overlay').classList.add('open');
  setTimeout(()=>document.getElementById('rt-name').focus(),300);
}
function closeReferTutor() { document.getElementById('rt-overlay').classList.remove('open'); }
function rtCloseOutside(e) { if (e.target===document.getElementById('rt-overlay')) closeReferTutor(); }
async function submitReferral() {
  const n=document.getElementById('rt-name').value.trim();
  const s=document.getElementById('rt-surname').value.trim();
  const e=document.getElementById('rt-email').value.trim();
  const c=document.getElementById('rt-course').value;
  const m=document.getElementById('rt-module').value.trim();
  const q=document.getElementById('rt-qualification').value;
  if (!n)   { hlt('rt-name');    return; }
  if (!s)   { hlt('rt-surname'); return; }
  if (!e||!e.includes('@')) { hlt('rt-email'); return; }
  if (!c)   { hlt('rt-course'); return; }
  if (!m)   { hlt('rt-module'); return; }
  if (m.includes(' ') && m.length > 10) {
    showToast('Please enter a module code (e.g. DICT111), not a full module name');
    hlt('rt-module');
    return;
  }
  if (!q)   { hlt('rt-qualification'); return; }
  try {
    await VF.apiFetch('/referrals', {
      method: 'POST',
      body: {
        firstName: n,
        surname: s,
        email: e,
        course: c,
        moduleCode: m,
        qualificationLevel: q,
      },
    });
    closeReferTutor();
    showToast('Referral submitted — '+n+' '+s+' · '+q);
    loadMyReferrals();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not submit referral');
  }
}

/* MESSAGE ALL */
function openMsgAll() {
  const tutors = Array.isArray(moduleTutorPool) ? moduleTutorPool : [];
  const chips = document.getElementById('ma-chips');
  const hint = document.getElementById('ma-hint');
  if (chips) {
    if (!tutors.length) {
      chips.innerHTML = '<span class="ma-chip ma-chip-empty">No tutors on this module</span>';
    } else {
      chips.innerHTML = tutors.map(t => {
        const initials = VF.initials(t.first_names, t.surname);
        const name = `${t.first_names || ''} ${t.surname || ''}`.trim();
        return `<span class="ma-chip">${escapeHtml(initials)} · ${escapeHtml(name)}</span>`;
      }).join('');
    }
  }
  if (hint) {
    hint.textContent = tutors.length
      ? `Sent to ${tutors.length} tutor${tutors.length === 1 ? '' : 's'} via VeriFlow`
      : 'No tutors to message';
  }
  document.getElementById('ma-subject').value = '';
  document.getElementById('ma-body').value = '';
  document.getElementById('ma-overlay').classList.add('open');
  setTimeout(() => document.getElementById('ma-subject').focus(), 300);
}
function closeMsgAll() { document.getElementById('ma-overlay').classList.remove('open'); }
function maCloseOutside(e) { if(e.target===document.getElementById('ma-overlay')) closeMsgAll(); }
function sendMsgAll() {
  const tutors = Array.isArray(moduleTutorPool) ? moduleTutorPool : [];
  if (!tutors.length) {
    showToast('No tutors on this module');
    return;
  }
  const subject = document.getElementById('ma-subject').value.trim();
  const body = document.getElementById('ma-body').value.trim();
  if (!body) {
    const el = document.getElementById('ma-body');
    el.style.borderColor = 'var(--red)';
    el.focus();
    setTimeout(() => { el.style.borderColor = ''; }, 1800);
    return;
  }
  closeMsgAll();
  sendBroadcastMessage(subject, body);
}

/* CLAIMS */
function filterClaims(status, btn) {
  document.querySelectorAll('#view-claims .filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#claims-list .claim-card').forEach(card => {
    card.style.display = (status === 'all' || card.dataset.status === status) ? '' : 'none';
  });
}

async function verifyAndForwardClaim(claimId) {
  try {
    await VF.apiFetch(`/claims/${claimId}/lecturer-approve`, { method: 'PATCH', body: {} });
    showToast('Claim forwarded to coordinator');
    closeClaimDetail();
    await loadLecturerClaims();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not forward claim');
  }
}

async function returnClaimToTutor(claimId) {
  openReturnClaimModal(claimId);
}

let pendingReturnClaimId = null;

function openReturnClaimModal(claimId) {
  const claim = LECTURER_CLAIMS.find((c) => c.id === claimId);
  pendingReturnClaimId = claimId;
  const tutor = claim ? `${claim.tutor_first_names || ''} ${claim.tutor_surname || ''}`.trim() : 'Tutor';
  const period = claim ? formatClaimPeriod(claim) : '—';
  const module = claim?.module_code || currentModuleCode || '—';
  document.getElementById('cr-subtitle').textContent = `${tutor} · ${module} · ${period}`;
  document.getElementById('cr-reason').value = '';
  document.getElementById('cr-overlay').classList.add('open');
  setTimeout(() => document.getElementById('cr-reason')?.focus(), 120);
}

function closeReturnClaimModal() {
  document.getElementById('cr-overlay')?.classList.remove('open');
  pendingReturnClaimId = null;
}

function crCloseOutside(e) {
  if (e.target === document.getElementById('cr-overlay')) closeReturnClaimModal();
}

function fillReturnReason(text) {
  const ta = document.getElementById('cr-reason');
  if (ta) {
    ta.value = text;
    ta.focus();
  }
}

async function confirmReturnClaim() {
  const reason = document.getElementById('cr-reason')?.value.trim();
  if (!reason) {
    showToast('Please enter a reason for returning this claim');
    return;
  }
  if (!pendingReturnClaimId) return;

  const btn = document.getElementById('cr-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    await VF.apiFetch(`/claims/${pendingReturnClaimId}/lecturer-return`, {
      method: 'PATCH',
      body: { note: reason },
    });
    showToast('Claim returned to tutor');
    closeReturnClaimModal();
    closeClaimDetail();
    await loadLecturerClaims();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not return claim');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function updatePendingCount() {
  const pending = LECTURER_CLAIMS.filter(c => c.status === 'pending_lecturer').length;
  setText('#pending-count', String(pending));
  setText('#claims-badge', pending ? String(pending) : '');
  setText('#lec-hub-claims-sub', pending ? `${pending} to review` : 'Approvals');
}

const RESP_DISPLAY = {
  standard: 'Junior Tutor',
  senior: 'Senior Tutor',
  lead: 'Lead Tutor',
};

async function openClaimDetail(id) {
  try {
    const data = await VF.apiFetch(`/claims/${id}/sessions`);
    const d = data.claim;
    const sessions = data.sessions || [];
    const tutor = `${d.tutor_first_names || ''} ${d.tutor_surname || ''}`.trim();
    const period = formatClaimPeriod(d);
    document.getElementById('cd-title').textContent = `${tutor} — Claim`;
    document.getElementById('cd-period').textContent = `${period} · ${d.module_code || '—'}`;

    const qual = QUAL_DISPLAY[d.qualification_level] || d.qualification_level || '—';
    const resp = RESP_DISPLAY[d.responsibility_level] || d.responsibility_level || '—';
    const rate = d.pay_rate != null ? `R${Number(d.pay_rate).toFixed(2)}/hr` : '—';
    const totalHours = Number(d.total_hours || 0);

    const sessionBlocks = sessions.filter(s => s.included !== false).map(s => {
      const date = s.session_date
        ? new Date(String(s.session_date).slice(0, 10)).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
        : '—';
      const time = s.start_time ? String(s.start_time).slice(0, 5) : '—';
      const present = s.attendance_count ?? 0;
      const enrolled = s.enrolled_count ?? 0;
      const attCls = enrolled && (present / enrolled) >= 0.75 ? 'att-good' : (enrolled ? 'att-low' : '');
      const sessionId = s.session_id || s.id;
      const att = `${present} / ${enrolled || '—'}`;
      return `
        <div class="lec-cd-field-group">
          <div class="lec-cd-field-row"><span class="k">Date</span><span class="v">${date}</span></div>
          <div class="lec-cd-field-row"><span class="k">Time</span><span class="v">${time}</span></div>
          <div class="lec-cd-field-row"><span class="k">Venue</span><span class="v lec-cd-venue">${(s.venue || '—').replace(/</g, '&lt;')}</span></div>
          <div class="lec-cd-field-row"><span class="k">Topic</span><span class="v">${(s.topic || '—').replace(/</g, '&lt;')}</span></div>
          <div class="lec-cd-field-row"><span class="k">Type</span><span class="v"><span class="lec-cd-type">${(s.session_type || '—').replace(/</g, '&lt;')}</span></span></div>
          <button type="button" class="lec-cd-field-row lec-cd-att-btn ${attCls}" onclick="event.stopPropagation();openRegister(${sessionId})">
            <span class="k">Attendance</span>
            <span class="v">${att} <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span>
          </button>
          <div class="lec-cd-field-row"><span class="k">Hours</span><span class="v">${s.claimed_hours || '—'} hrs</span></div>
        </div>`;
    }).join('');

    const pending = d.status === 'pending_lecturer';
    const timeline = `
      <div class="lec-cd-timeline">
        <div class="lec-cd-timeline-row">
          <div class="lec-cd-timeline-left">
            <div class="lec-cd-timeline-icn ${pending ? 'is-amber' : 'is-done'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            </div>
            <div>
              <div class="lec-cd-timeline-title">Your review</div>
              <div class="lec-cd-timeline-sub">${pending ? 'Awaiting your action' : 'Completed'}</div>
            </div>
          </div>
          <span class="lec-cd-timeline-badge ${pending ? 'is-amber' : 'is-done'}">${pending ? 'IN REVIEW' : 'DONE'}</span>
        </div>
        <div class="lec-cd-timeline-connector"></div>
        <div class="lec-cd-timeline-row">
          <div class="lec-cd-timeline-left">
            <div class="lec-cd-timeline-icn is-muted">•</div>
            <div>
              <div class="lec-cd-timeline-title">Coordinator</div>
              <div class="lec-cd-timeline-sub">FYE Office</div>
            </div>
          </div>
          <span class="lec-cd-timeline-badge is-muted">${d.status === 'pending_coordinator' || d.status === 'approved' ? String(d.status).replace('_', ' ').toUpperCase() : 'UPCOMING'}</span>
        </div>
      </div>`;

    document.getElementById('cd-body').innerHTML = `
      <div class="lec-cd-stats">
        <div class="lec-cd-stat"><span class="l">Qualification level</span><div class="v">${qual}</div></div>
        <div class="lec-cd-stat"><span class="l">Responsibility level</span><div class="v">${resp}</div></div>
        <div class="lec-cd-stat"><span class="l">Claimed rate</span><div class="v">${rate}</div></div>
        <div class="lec-cd-stat"><span class="l">Total hours</span><div class="v">${totalHours} hrs</div></div>
      </div>
      <div class="lec-cd-stat lec-cd-stat-total"><span class="l">Total amount</span><div class="v green">${formatClaimAmount(d.total_amount)}</div></div>
      ${timeline}
      ${lecCoordinatorFeedbackBar(d)}
      <div class="lec-cd-breakdown-label">Session breakdown · ${sessions.length} session(s)</div>
      ${sessionBlocks || '<div class="lec-empty-card"><p>No sessions</p></div>'}
      <div class="lec-cd-desk-only claims-strip cd-verify-strip">
        <div class="cl-stat"><div class="cl-stat-label">Qualification Level</div><div class="cl-stat-val">${qual}</div></div>
        <div class="cl-stat"><div class="cl-stat-label">Responsibility Level</div><div class="cl-stat-val">${resp}</div></div>
        <div class="cl-stat"><div class="cl-stat-label">Claimed Rate</div><div class="cl-stat-val">${rate}</div></div>
        <div class="cl-stat"><div class="cl-stat-label">Total Hours</div><div class="cl-stat-val">${totalHours} hrs</div></div>
        <div class="cl-stat"><div class="cl-stat-label">Total Amount</div><div class="cl-stat-val green">${formatClaimAmount(d.total_amount)}</div></div>
      </div>`;

    const footer = document.getElementById('cd-footer');
    if (pending) {
      footer.innerHTML = `<button type="button" class="ns-cancel" onclick="closeClaimDetail()">Close</button>
        <div class="lec-cd-footer-actions">
          <button type="button" class="cl-btn reject" onclick="returnClaimToTutor(${id})">Return</button>
          <button type="button" class="ns-create lec-btn-glow" onclick="verifyAndForwardClaim(${id})"><span class="lec-btn-glow-label">Verify &amp; Forward</span></button>
        </div>`;
    } else {
      footer.innerHTML = `<button type="button" class="ns-cancel" style="width:100%" onclick="closeClaimDetail()">Close</button>`;
    }
    document.getElementById('cd-overlay').classList.add('open');
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not load claim details');
  }
}
function closeClaimDetail(){document.getElementById('cd-overlay').classList.remove('open');}
function cdCloseOutside(e){if(e.target===document.getElementById('cd-overlay'))closeClaimDetail();}

/* ── ATTENDANCE REGISTER (claim detail + sessions) ── */
let lecRegisterSessionId = null;
let lecRegisterData = null;
let lecRegisterRefreshTimer = null;

function formatRegisterSignInTime(recordedAt) {
  if (!recordedAt) return '—';
  return new Date(recordedAt).toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' });
}

function renderLecturerRegisterModal(data) {
  const session = data.session || {};
  const modCode = session.module_code || currentModuleCode || '—';
  const date = session.session_date
    ? new Date(String(session.session_date).slice(0, 10)).toLocaleDateString('en-ZA', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—';
  const time = session.start_time ? String(session.start_time).slice(0, 5) : '';
  const meta = [time, session.venue, session.topic, sessionTypeLabel(session.session_type)]
    .filter(Boolean).join(' · ');

  const students = data.students || (data.attendance || []).map((a) => ({
    student_number: a.student_number,
    full_name: a.full_name || '—',
    recorded_at: a.recorded_at,
    present: true,
  }));

  const enrolled = data.enrolled || students.length;
  const present = students.filter((s) => s.present).length;
  const absent = Math.max(0, enrolled - present);
  const pct = enrolled ? Math.round((present / enrolled) * 100) : (present ? 100 : 0);

  setText('#reg-eyebrow', `${modCode}${currentModuleName ? ' · ' + currentModuleName : ''}`);
  setText('#reg-title', `Attendance Register — ${date}`);
  setText('#reg-meta', meta || '—');
  setText('#reg-enrolled', String(enrolled));
  setText('#reg-present', String(present));
  setText('#reg-absent', String(absent));
  setText('#reg-pct', `${pct}%`);

  const tbody = document.getElementById('reg-tbody');
  if (!tbody) return;

  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">No students on the class list for this module.</td></tr>';
    const mobileList = document.getElementById('reg-mobile-list');
    if (mobileList) mobileList.innerHTML = '<div class="lec-empty-card"><p>No students on the class list for this module.</p></div>';
    return;
  }

  tbody.innerHTML = students.map((s, i) => `
    <tr class="${!s.present ? 'absent-row' : ''}">
      <td style="color:var(--muted);font-size:10px;font-family:'DM Mono',monospace">${String(i + 1).padStart(2, '0')}</td>
      <td class="reg-snum">${s.student_number}</td>
      <td class="reg-sname" style="${!s.present ? 'color:var(--muted);font-weight:400;' : ''}">${s.full_name || '—'}</td>
      <td class="reg-time">${formatRegisterSignInTime(s.recorded_at)}</td>
      <td><span class="reg-badge ${s.present ? 'present' : 'absent'}">${s.present ? 'Present' : 'Absent'}</span></td>
    </tr>`).join('');

  const mobileList = document.getElementById('reg-mobile-list');
  if (mobileList) {
    mobileList.innerHTML = students.map((s, i) => `
      <div class="lec-att-row">
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <div class="ainfo">
          <div class="nm">${(s.full_name || '—').replace(/</g, '&lt;')}</div>
          <div class="sid">${s.student_number || '—'}</div>
        </div>
        <span class="status-tag ${s.present ? 'present' : 'absent'}">${s.present ? 'Present' : 'Absent'}</span>
      </div>`).join('');
  }
}

async function loadLecturerRegister(sessionId) {
  const data = await VF.apiFetch(`/attendance/${sessionId}`);
  lecRegisterSessionId = sessionId;
  lecRegisterData = data;
  renderLecturerRegisterModal(data);

  clearInterval(lecRegisterRefreshTimer);
  if (data.session?.status === 'active') {
    lecRegisterRefreshTimer = setInterval(() => {
      loadLecturerRegister(sessionId).catch(() => {});
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
  if (tbody) {
    tbody.innerHTML = (VF.skeleton && VF.skeleton.tbody(5, 6)) ||
      '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">Loading register…</td></tr>';
  }
  modal.classList.add('open');

  try {
    await loadLecturerRegister(sessionId);
  } catch (err) {
    modal.classList.remove('open');
    showToast(err.errors?.[0] || err.message || 'Could not load register');
  }
}

function closeRegister() {
  const modal = document.getElementById('regModal');
  if (modal) modal.classList.remove('open');
  clearInterval(lecRegisterRefreshTimer);
  lecRegisterRefreshTimer = null;
  lecRegisterSessionId = null;
  lecRegisterData = null;
}

function regCloseOutside(e) {
  if (e.target === document.getElementById('regModal')) closeRegister();
}

function downloadRegister() {
  if (!lecRegisterData) return;
  const data = lecRegisterData;
  const session = data.session || {};
  const students = data.students || [];
  const enrolled = data.enrolled || students.length;
  const present = students.filter((s) => s.present).length;
  const absent = Math.max(0, enrolled - present);
  const pct = enrolled ? Math.round((present / enrolled) * 100) : (present ? 100 : 0);
  const modCode = session.module_code || currentModuleCode || '—';
  const dateLabel = session.session_date
    ? new Date(String(session.session_date).slice(0, 10)).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Session';

  const rows = students.map((s, i) => `
    <tr><td>${String(i + 1).padStart(2, '0')}</td><td>${s.student_number}</td><td>${s.full_name || '—'}</td>
    <td>${formatRegisterSignInTime(s.recorded_at)}</td><td>${s.present ? 'Present' : 'Absent'}</td></tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Register — ${dateLabel}</title>
<style>body{font-family:sans-serif;padding:40px;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5;font-size:11px;text-transform:uppercase}</style></head>
<body><h1>Attendance Register</h1><p>${modCode} · ${dateLabel}</p>
<p>Enrolled: ${enrolled} · Present: ${present} · Absent: ${absent} · Rate: ${pct}%</p>
<table><thead><tr><th>#</th><th>Student No.</th><th>Name</th><th>Sign-in</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `register-${modCode}-${dateLabel.replace(/\s+/g, '-')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showToast('Register exported');
}

window.openRegister = openRegister;
window.closeRegister = closeRegister;
window.regCloseOutside = regCloseOutside;
window.downloadRegister = downloadRegister;
window.openReturnClaimModal = openReturnClaimModal;
window.closeReturnClaimModal = closeReturnClaimModal;
window.crCloseOutside = crCloseOutside;
window.fillReturnReason = fillReturnReason;
window.confirmReturnClaim = confirmReturnClaim;
window.returnClaimToTutor = returnClaimToTutor;

/* MESSAGE MODAL */
let modalRecipientId = null;

function openMsg(tutorId, name) {
  modalRecipientId = tutorId ? Number(tutorId) : null;
  document.getElementById('modal-tutor-name').textContent = name || '—';
  document.getElementById('modal-subject').value = '';
  document.getElementById('modal-body').value = '';
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('modal-subject').focus(), 300);
}

function closeMsg() { document.getElementById('modal-overlay').classList.remove('open'); modalRecipientId = null; }
function closeModalOutside(e) { if (e.target === document.getElementById('modal-overlay')) closeMsg(); }

async function sendMsg() {
  const body = document.getElementById('modal-body').value.trim();
  const subject = document.getElementById('modal-subject').value.trim();
  if (!body) { document.getElementById('modal-body').focus(); return; }
  if (!modalRecipientId) { showToast('Select a tutor to message'); return; }
  const name = document.getElementById('modal-tutor-name').textContent;
  closeMsg();
  const result = await sendDirectMessage(modalRecipientId, subject, body);
  if (result) showToast('Message sent to ' + name);
}

window.openMsg = openMsg;
window.openMsgAll = openMsgAll;
window.closeMsgAll = closeMsgAll;
window.sendMsg = sendMsg;
window.closeMsg = closeMsg;
function goView(id,navEl){
  document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
  if(navEl)navEl.classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const target=document.getElementById('view-'+id);
  if(target)target.classList.add('active');
  document.body.classList.toggle('lec-on-hub', id === 'dashboard');
  if (id !== 'messages' && typeof closeMobileMessageChat === 'function') {
    closeMobileMessageChat();
  }
  syncLecBottomNav(id);
  if(id==='sessions') loadSessions();
  if(id==='tutors')   loadMyTutors();
  if(id==='claims')   loadLecturerClaims();
  if(id==='classlist') loadClassList();
  if(id==='report')   loadSessions();
  if(id==='calendar') rebuildCalendarFromSessions(Object.values(SESSIONS));
  if(id==='messages') loadMessageThreads();
  if(id==='support') loadLecturerTickets();
}

window.goView = goView;
window.syncLecBottomNav = syncLecBottomNav;
window.syncLecHubModules = syncLecHubModules;

async function loadLecturerTickets() {
  const wrap = document.getElementById('lecturer-tickets-list');
  if (wrap && VF.skeleton) wrap.innerHTML = VF.skeleton.listRows(4);
  try {
    const tickets = await VF.apiFetch('/support/tickets');
    renderLecturerTickets(tickets);
  } catch (err) {
    if (wrap) {
      wrap.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0">Could not load support tickets.</div>';
    }
    showToast(err.errors ? err.errors[0] : 'Could not load support tickets');
  }
}

function renderLecturerTickets(tickets) {
  const wrap = document.getElementById('lecturer-tickets-list');
  if (!wrap) return;

  if (!tickets.length) {
    wrap.innerHTML = `
      <div class="lec-sup-card">
        <div class="lec-sup-empty">
          <div class="lec-sup-empty-ico" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 2-3 4"/><path d="M12 17h.01"/></svg>
          </div>
          <h3>No tickets yet</h3>
          <p>Tap New Ticket below if you need help.</p>
        </div>
      </div>`;
    return;
  }

  wrap.innerHTML = tickets.map((t) => {
    const statusLabel =
      t.status === 'resolved' ? 'Resolved' :
      t.status === 'in_progress' ? 'In progress' : 'Open';
    const statusCls =
      t.status === 'resolved' ? 'is-resolved' :
      t.status === 'in_progress' ? 'is-progress' : 'is-open';
    const date = t.created_at
      ? new Date(t.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
      : '—';
    const details = String(t.details || '—').replace(/</g, '&lt;');
    const subject = String(t.subject || '—').replace(/</g, '&lt;');
    return `<div class="lec-ticket-card">
      <div class="lec-ticket-top">
        <div>
          <div class="lec-ticket-title">#${t.id} · ${subject}</div>
          <div class="lec-ticket-sub">${t.priority} priority · ${date}</div>
        </div>
        <span class="lec-ticket-status ${statusCls}">${statusLabel}</span>
      </div>
      <div class="lec-ticket-body">${details}</div>
    </div>`;
  }).join('');
}

function openLecturerTicketModal() {
  document.getElementById('lec-ticket-subject').value = '';
  document.getElementById('lec-ticket-details').value = '';
  document.getElementById('lec-ticket-priority').value = 'medium';
  document.getElementById('lec-ticket-overlay').classList.add('open');
}

function closeLecturerTicketModal(e) {
  if (e && e.target !== document.getElementById('lec-ticket-overlay')) return;
  document.getElementById('lec-ticket-overlay').classList.remove('open');
}

async function submitLecturerTicket() {
  const subject = document.getElementById('lec-ticket-subject').value.trim();
  const details = document.getElementById('lec-ticket-details').value.trim();
  const priority = document.getElementById('lec-ticket-priority').value;

  if (!subject) {
    document.getElementById('lec-ticket-subject').focus();
    return;
  }
  if (!details) {
    document.getElementById('lec-ticket-details').focus();
    return;
  }

  try {
    await VF.apiFetch('/support/tickets', {
      method: 'POST',
      body: { subject, details, priority },
    });
    closeLecturerTicketModal();
    showToast('Ticket submitted — the coordinator will respond shortly');
    loadLecturerTickets();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not submit ticket');
  }
}

window.loadLecturerTickets = loadLecturerTickets;
window.openLecturerTicketModal = openLecturerTicketModal;
window.closeLecturerTicketModal = closeLecturerTicketModal;
window.submitLecturerTicket = submitLecturerTicket;

/* TOAST */
let toastTmt;
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTmt);toastTmt=setTimeout(()=>t.classList.remove('show'),2800);}

/* MODULE REPORT */
let lastModuleReport = null;

const TYPE_BAR_COLORS = {
  tutorial:  'var(--muted)',
  practical: 'var(--accent)',
  online:    'var(--green)',
  revision:  'var(--yellow)',
  lecture:   '#8b8bff',
};

function sessionsInMonth(sessions, month, year) {
  return sessions.filter((s) => {
    if (!s.session_date) return false;
    const key = sessionDateKey(s.session_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
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

function renderDashboardMonthPanel(sessions) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthSessions = sessionsInMonth(sessions, month, year);
  const planned = monthSessions.length;
  const completed = monthSessions.filter((s) => s.status === 'completed').length;
  const flagged = monthSessions.filter((s) => s.status === 'flagged').length;
  const completionRate = planned ? Math.round((completed / planned) * 100) : 0;

  const monthSub = document.getElementById('dash-month-sessions-sub');
  if (monthSub) {
    monthSub.textContent = planned
      ? `${planned} session${planned === 1 ? '' : 's'} · ${completed} completed${flagged ? ` · ${flagged} flagged` : ''}`
      : 'No sessions this month';
  }

  const pctEl = document.getElementById('dash-month-progress-pct');
  if (pctEl) pctEl.textContent = `${completionRate}%`;

  const barEl = document.getElementById('dash-month-progress-bar');
  if (barEl) barEl.style.width = `${completionRate}%`;

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

function tutorOnSession(session, tutor) {
  const full = `${tutor.first_names || ''} ${tutor.surname || ''}`.trim().toLowerCase();
  if (!full) return false;
  const names = (session.tutor_names || '').toLowerCase();
  return names.split(',').some((n) => n.trim() === full);
}

function tutorGrade(rate) {
  if (rate >= 80) return { grade: 'A', color: 'var(--green)' };
  if (rate >= 60) return { grade: 'B', color: 'var(--yellow)' };
  if (rate >= 40) return { grade: 'C', color: 'var(--muted)' };
  return { grade: 'D', color: 'var(--red)' };
}

function renderModuleReport(sessions, tutors) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthSessions = sessionsInMonth(sessions, month, year);
  const planned = monthSessions.length;
  const completed = monthSessions.filter((s) => s.status === 'completed').length;
  const flagged = monthSessions.filter((s) => s.status === 'flagged').length;
  const completionRate = planned ? Math.round((completed / planned) * 100) : 0;

  const pastSessions = monthSessions.filter((s) => ['completed', 'flagged'].includes(s.status));
  let tutorRateSum = 0;
  let tutorRateCount = 0;
  pastSessions.forEach((s) => {
    const assigned = Number(s.tutor_assigned_count) || 0;
    const confirmed = Number(s.tutor_confirmed_count) || 0;
    if (assigned > 0) {
      tutorRateSum += (confirmed / assigned) * 100;
      tutorRateCount += 1;
    }
  });
  const tutorAttendance = tutorRateCount ? Math.round(tutorRateSum / tutorRateCount) : 0;
  const tutorNamesShort = tutors.slice(0, 3).map((t) => t.first_names).filter(Boolean).join(', ') || '—';
  const mod = getSelectedModule();
  const modName = currentModuleName || mod?.name || '—';
  const generated = now.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

  setText('#report-eyebrow', `Academic Report · ${MONTH_SHORT[month]} ${year}`);
  setText('#report-title', `${currentModuleCode || '—'} Module Report`);
  setText('#report-sub', `${modName} · ${lecturerDisplayName || 'lecturer'} · Generated ${generated}`);
  setText('#report-type-badge', `${planned} total`);
  setText('#report-tutor-badge', `${currentModuleCode || '—'} · ${MONTH_SHORT[month]} ${year}`);
  setText('#report-hero-sem', `${MONTH_SHORT[month]} ${year}`);
  setText('#report-completion-pct', `${completionRate}%`);
  setText('#report-stat-sessions', String(planned));
  setText('#report-stat-attendance', `${tutorAttendance}%`);
  setText('#report-stat-tutors', String(tutors.length));
  setText('#report-stat-tutors-sub', tutorNamesShort);
  setText('#report-stat-flagged', String(flagged));

  const ring = document.getElementById('report-ring-arc');
  if (ring) {
    const circ = 264;
    const offset = circ * (1 - Math.min(100, Math.max(0, completionRate)) / 100);
    ring.setAttribute('stroke-dashoffset', String(offset));
  }
  const completionSub = document.getElementById('report-completion-sub');
  if (completionSub) {
    completionSub.innerHTML = `${completed} OF ${planned}<br>COMPLETED`;
  }

  renderDashboardMonthPanel(sessions);

  const kpiStrip = document.getElementById('report-kpi-strip');
  if (kpiStrip) {
    kpiStrip.innerHTML = `
      <div class="kpi-box"><div class="kpi-label">Sessions Run</div><div class="kpi-val">${planned}</div><div class="kpi-sub">scheduled this month</div></div>
      <div class="kpi-box"><div class="kpi-label">Completion Rate</div><div class="kpi-val green">${completionRate}%</div><div class="kpi-sub">${completed} completed</div></div>
      <div class="kpi-box"><div class="kpi-label">Tutor Attendance</div><div class="kpi-val yellow">${tutorAttendance}%</div><div class="kpi-sub">avg confirmation</div></div>
      <div class="kpi-box"><div class="kpi-label">Flagged Sessions</div><div class="kpi-val red">${flagged}</div><div class="kpi-sub">need attention</div></div>
      <div class="kpi-box"><div class="kpi-label">Active Tutors</div><div class="kpi-val">${tutors.length}</div><div class="kpi-sub">${tutorNamesShort}</div></div>`;
  }

  const typeCounts = {};
  monthSessions.forEach((s) => {
    typeCounts[s.session_type] = (typeCounts[s.session_type] || 0) + 1;
  });
  const typeOrder = ['practical', 'tutorial', 'online', 'revision', 'lecture'];
  const typeTotal = Math.max(planned, 1);
  const byTypeEl = document.getElementById('report-by-type');
  if (byTypeEl) {
    const rows = typeOrder.filter((t) => typeCounts[t]).map((type, i) => {
      const count = typeCounts[type];
      const pct = Math.round((count / typeTotal) * 100);
      return `<div class="type-row"><div class="type-info"><div class="type-name">${sessionTypeLabel(type)} <span>${count} session${count === 1 ? '' : 's'}</span></div><div class="type-bar"><div class="type-bar-fill" style="width:${pct}%;background:${TYPE_BAR_COLORS[type] || 'var(--accent)'};animation-delay:${0.3 + i * 0.1}s;"></div></div></div></div>`;
    });
    byTypeEl.innerHTML = rows.length
      ? rows.join('')
      : '<div style="padding:16px;color:var(--muted);font-size:12px">No sessions this month.</div>';
  }

  const monthCounts = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(year, month - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const count = sessionsInMonth(sessions, m, y).length;
    monthCounts.push({ month: m, year: y, count, label: MONTH_SHORT[m] });
  }
  const maxCount = Math.max(...monthCounts.map((m) => m.count), 1);
  const chartEl = document.getElementById('report-month-chart');
  if (chartEl) {
    chartEl.innerHTML = monthCounts.map((m, i) => {
      const height = m.count ? Math.max(8, Math.round((m.count / maxCount) * 100)) : 4;
      const isCurrent = m.month === month && m.year === year;
      return `<div class="mc-bar-wrap">
        <div class="mc-count"${isCurrent ? ' style="color:var(--text);font-weight:700;"' : ''}>${m.count}</div>
        <div class="mc-bar${isCurrent ? ' current' : ''}" style="height:${height}%;animation-delay:${0.5 + i * 0.05}s;" onclick="mcActivate(this)"></div>
        <div class="mc-label"${isCurrent ? ' style="color:var(--text);"' : ''}>${m.label}</div>
      </div>`;
    }).join('');
    const first = monthCounts[0];
    const last = monthCounts[monthCounts.length - 1];
    setText('#report-month-badge', `${MONTH_SHORT[first.month]} ${first.year} – ${MONTH_SHORT[last.month]} ${last.year}`);
  }

  const tbody = document.getElementById('report-tutor-tbody');
  if (tbody) {
    if (!tutors.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">No tutors assigned to this module.</td></tr>';
    } else {
      tbody.innerHTML = tutors.map((tutor) => {
        const assignedSessions = monthSessions.filter((s) => tutorOnSession(s, tutor));
        const attended = assignedSessions.filter((s) => s.status === 'completed').length;
        const missed = assignedSessions.filter((s) => s.status === 'flagged').length;
        const total = assignedSessions.length;
        const rate = total ? Math.round((attended / total) * 100) : 0;
        const grade = tutorGrade(rate);
        const initials = VF.initials(tutor.first_names, tutor.surname);
        const modLabel = tutor.module_code || tutor.module_name || currentModuleCode || '—';
        return `<tr>
          <td><div class="pt-av" style="color:${grade.color};border:1px solid ${grade.color};">${initials}</div></td>
          <td style="font-weight:600;">${tutor.first_names} ${tutor.surname}</td>
          <td style="color:var(--muted);font-size:12px;font-family:'DM Mono',monospace;">${modLabel}</td>
          <td><div class="pt-ratio">${attended}<span> / ${total || '—'}</span></div><div class="pt-mini-bar"><div class="pt-mini-fill" style="width:${rate}%;background:${grade.color};"></div></div></td>
          <td style="font-family:'DM Mono',monospace;font-weight:700;color:${grade.color};">${rate}%</td>
          <td style="font-family:'DM Mono',monospace;color:var(--muted);">${missed}</td>
          <td><span class="pt-grade ${grade.grade}">${grade.grade}</span></td>
        </tr>`;
      }).join('');
    }
  }

  lastModuleReport = { month, year, monthSessions, tutors, planned, completed, flagged, completionRate, tutorAttendance };
}

function exportModuleReport() {
  if (!lastModuleReport) {
    showToast('Report not loaded yet');
    return;
  }
  const r = lastModuleReport;
  const label = `${MONTH_SHORT[r.month]} ${r.year}`;
  const modCode = currentModuleCode || '—';
  const rows = r.tutors.map((tutor) => {
    const assignedSessions = r.monthSessions.filter((s) => tutorOnSession(s, tutor));
    const attended = assignedSessions.filter((s) => s.status === 'completed').length;
    const total = assignedSessions.length;
    const rate = total ? Math.round((attended / total) * 100) : 0;
    return `<tr><td>${tutor.first_names} ${tutor.surname}</td><td>${attended} / ${total}</td><td>${rate}%</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>${modCode} Module Report</title>
<style>body{font-family:Arial,sans-serif;padding:40px;color:#111}h1{font-size:24px}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left}th{background:#f5f5f5}</style></head><body>
<h1>${modCode} Module Report — ${label}</h1>
<p>${currentModuleName || ''} · ${lecturerDisplayName || ''}</p>
<ul><li>Sessions: ${r.planned}</li><li>Completed: ${r.completed}</li><li>Flagged: ${r.flagged}</li><li>Completion rate: ${r.completionRate}%</li><li>Tutor attendance: ${r.tutorAttendance}%</li></ul>
<h2>Tutor performance</h2>
<table><thead><tr><th>Name</th><th>Sessions attended</th><th>Rate</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No tutors</td></tr>'}</tbody></table>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `VeriFlow_Report_${modCode}_${label.replace(/ /g, '_')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Report exported — ${label}`);
}

window.exportModuleReport = exportModuleReport;

/* REPORT CHART */
function mcActivate(bar){bar.closest('.month-chart').querySelectorAll('.mc-bar').forEach(b=>b.classList.remove('current'));bar.classList.add('current');}

/* CLASS LIST */
let classListData = null;

function formatClassListDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderClassList(data) {
  classListData = data;
  const wrap = document.getElementById('classlist-module-wrap');
  if (!wrap) return;

  const code = data?.moduleCode || currentModuleCode || '—';
  const name = data?.moduleName || currentModuleName || '—';
  const entries = data?.entries || [];
  const count = entries.length;

  setText('#cl-stat-enrolled', String(count));
  setText('#cl-stat-module', code);
  setText('#cl-stat-updated', formatClassListDate(data?.lastUpdated));
  setText('#lec-hub-classlist-badge', String(count));

  if (!count) {
    wrap.innerHTML = `
      <div class="cl-module-section">
        <div class="cl-mod-header">
          <div>
            <div class="cl-mod-title">${code} — ${name}</div>
            <div class="cl-mod-count-sub">enrolled</div>
          </div>
          <div class="cl-mod-count">0</div>
        </div>
        <div class="cl-empty-note">
          No students on this class list yet. Upload a CSV above to add enrolled students for ${code}.
        </div>
      </div>`;
    return;
  }

  const preview = entries.slice(0, 50);
  const more = count - preview.length;
  const rows = preview.map(e => `
    <tr>
      <td class="cl-snum">${e.student_number}</td>
      <td class="cl-sname">${e.full_name}</td>
      <td style="color:var(--muted);font-size:12px;font-family:'DM Mono',monospace;">${e.email || '—'}</td>
      <td><span class="cl-status-active">${e.status || 'Active'}</span></td>
    </tr>`).join('');

  const moreRow = more > 0
    ? `<tr><td style="color:var(--muted);font-size:11px;font-family:'DM Mono',monospace;padding-top:10px;" colspan="4">… ${more} more student${more === 1 ? '' : 's'} · Upload a new CSV to replace this list</td></tr>`
    : '';

  wrap.innerHTML = `
    <div class="cl-module-section">
      <div class="cl-mod-header">
        <div>
          <div class="cl-mod-title">${code} — ${name}</div>
          <div class="cl-mod-count-sub">enrolled</div>
        </div>
        <div class="cl-mod-count">${count}</div>
      </div>
      <table class="cl-table">
        <thead><tr><th>Student No.</th><th>Full Name</th><th>Email</th><th>Status</th></tr></thead>
        <tbody>${rows}${moreRow}</tbody>
      </table>
      ${data.lastUpdated ? `<div class="cl-updated cl-updated-footer"><div class="cl-updated-dot"></div>Updated ${formatClassListDate(data.lastUpdated)}</div>` : ''}
    </div>`;
}

async function loadClassList() {
  if (!currentModuleCode) return;
  const wrap = document.getElementById('classlist-module-wrap');
  if (wrap && VF.skeleton) {
    wrap.innerHTML = VF.skeleton.stats(3) + VF.skeleton.sessionRows(5);
  } else if (wrap) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted)">Loading class list…</div>';
  }
  try {
    const data = await VF.apiFetch(`/class-lists?moduleCode=${encodeURIComponent(currentModuleCode)}`);
    renderClassList(data);
  } catch (err) {
    if (wrap) {
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--muted)">Could not load class list for ${currentModuleCode}.</div>`;
    }
  }
}

function parseCsvLine(line) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { parts.push(current.trim()); current = ''; continue; }
    current += c;
  }
  parts.push(current.trim());
  return parts.map(s => s.replace(/^"|"$/g, ''));
}

function normalizeCsvHeader(h) {
  return h.trim().replace(/^\ufeff/, '').toLowerCase().replace(/\s+/g, '_');
}

function colIndex(headers, ...names) {
  for (const name of names) {
    const idx = headers.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseClassListCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map(normalizeCsvHeader);
  const hasHeader = headers.some(h =>
    h.includes('student_number') || h.includes('student_no') ||
    h.includes('first_name') || h === 'first_names' ||
    h === 'surname' || h === 'email'
  );
  const start = hasHeader ? 1 : 0;

  const idxStudent   = hasHeader ? colIndex(headers, 'student_number', 'student_no', 'studentno') : -1;
  const idxFirst     = hasHeader ? colIndex(headers, 'first_names', 'first_name', 'firstname', 'first') : -1;
  const idxSurname   = hasHeader ? colIndex(headers, 'surname', 'last_name', 'lastname', 'last') : -1;
  const idxFull      = hasHeader ? colIndex(headers, 'full_name', 'fullname', 'name') : -1;
  const idxYear      = hasHeader ? colIndex(headers, 'year_level', 'yearlevel', 'year') : -1;
  const idxEmail     = hasHeader ? colIndex(headers, 'email', 'email_address') : -1;
  const idxProgramme = hasHeader ? colIndex(headers, 'programme', 'program', 'course') : -1;

  const entries = [];

  for (let i = start; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    if (!parts.length) continue;

    let student_number, full_name, year_level, email;

    if (hasHeader) {
      student_number = idxStudent >= 0 ? parts[idxStudent] : '';
      const first = idxFirst >= 0 ? parts[idxFirst] : '';
      const surname = idxSurname >= 0 ? parts[idxSurname] : '';
      full_name = (idxFull >= 0 && parts[idxFull])
        ? parts[idxFull]
        : `${first} ${surname}`.trim();
      email = idxEmail >= 0 ? (parts[idxEmail] || null) : null;
      year_level = idxYear >= 0 ? (parts[idxYear] || null) : null;
    } else if (parts.length >= 4 && /@/.test(parts[2])) {
      // first_names, surname, email, student_number, programme, year_level[, module]
      full_name = `${parts[0]} ${parts[1]}`.trim();
      email = parts[2] || null;
      student_number = parts[3];
      year_level = parts[5] || null;
    } else {
      student_number = parts[0];
      full_name = parts[1];
      email = parts.length > 3 && /@/.test(parts[2]) ? parts[2] : null;
      year_level = email ? (parts[5] || parts[4] || null) : (parts[2] || null);
    }

    student_number = String(student_number || '').trim();
    full_name = String(full_name || '').trim();
    email = email ? String(email).trim() : null;
    if (!student_number || !full_name) continue;

    entries.push({
      student_number,
      full_name,
      email,
      year_level,
      first_names: idxFirst >= 0 ? (parts[idxFirst] || '') : (parts[0] || ''),
      surname: idxSurname >= 0 ? (parts[idxSurname] || '') : (parts[1] || ''),
      programme: idxProgramme >= 0 ? (parts[idxProgramme] || null) : (parts[4] || null),
    });
  }
  return entries;
}

async function uploadClassListFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.csv')) {
    showToast('Please upload a CSV file');
    return;
  }
  if (!currentModuleCode) {
    showToast('Select a module tab first');
    return;
  }

  showToast('Uploading ' + file.name + '…');

  try {
    const text = await file.text();
    const entries = parseClassListCsv(text);
    if (!entries.length) {
      showToast('No valid rows found in CSV');
      return;
    }

    const result = await VF.apiFetch('/class-lists/import', {
      method: 'POST',
      body: { moduleCode: currentModuleCode, entries },
    });

    showToast(`${result.imported} student${result.imported === 1 ? '' : 's'} imported for ${currentModuleCode}`);
    await loadClassList();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not import class list');
  }
}

function handleClassListDrop(e) {
  e.preventDefault();
  document.getElementById('cl-upload-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) uploadClassListFile(file);
}

function handleClassListUpload(input) {
  const file = input.files[0];
  if (file) uploadClassListFile(file);
  input.value = '';
}

/* CALENDAR */
let lecCalEvents = {};
const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();

function sessionDateKeyFromParts(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function calDateKey(year, monthIndex, day) {
  return sessionDateKeyFromParts(year, monthIndex, day);
}

function sessionToCalType(status) {
  if (status === 'active') return 'today';
  if (status === 'flagged') return 'flagged';
  if (status === 'completed') return 'confirmed';
  if (status === 'cancelled') return 'confirmed';
  return 'upcoming';
}

function calTypePriority(type) {
  return ({ today: 4, flagged: 3, confirmed: 2, upcoming: 1 })[type] || 0;
}

function sessionToLecCalEvent(s) {
  return {
    type: sessionToCalType(s.status),
    rawStatus: s.status,
    time: s.start_time ? String(s.start_time).slice(0, 5) : '—',
    venue: s.venue || '—',
    topic: s.topic || s.module_code,
    sessionType: sessionTypeLabel(s.session_type),
    tutors: s.tutor_names ? s.tutor_names.split(', ').filter(Boolean) : [],
    att: s.attendance_count != null ? `${s.attendance_count} logged` : '—',
    sessionId: s.id,
  };
}

function rebuildCalendarFromSessions(sessions) {
  lecCalEvents = {};
  sessions.forEach((s) => {
    const key = sessionDateKey(s.session_date);
    if (!key) return;
    const ev = sessionToLecCalEvent(s);
    if (!lecCalEvents[key]) lecCalEvents[key] = { type: ev.type, items: [] };
    lecCalEvents[key].items.push(ev);
    if (calTypePriority(ev.type) > calTypePriority(lecCalEvents[key].type)) {
      lecCalEvents[key].type = ev.type;
    }
  });
  buildCalGrid();
}

function selectCalDay(d) {
  document.querySelectorAll('#lec-cal-grid .cal-cell.selected').forEach((el) => {
    el.classList.remove('selected');
  });
  const cell = document.querySelector(`#lec-cal-grid .cal-cell[data-day="${d}"]`);
  if (cell) cell.classList.add('selected');
}

function resetLecCalDetail() {
  document.getElementById('lec-detail-empty').style.display = 'flex';
  document.getElementById('lec-detail-empty-date').style.display = 'none';
  document.getElementById('lec-detail-content').style.display = 'none';
  document.querySelectorAll('#lec-cal-grid .cal-cell.selected').forEach((el) => {
    el.classList.remove('selected');
  });
}

function showLecEmptyDatePanel(d) {
  selectCalDay(d);
  const dateStr = calDateKey(calYear, calMonth, d);
  calEmptyDateValue = dateStr;
  document.getElementById('lec-detail-empty').style.display = 'none';
  document.getElementById('lec-detail-content').style.display = 'none';
  document.getElementById('lec-detail-empty-date').style.display = 'flex';
  document.getElementById('lec-empty-date-label').innerHTML =
    `<strong>${d} ${monthNames[calMonth]} ${calYear}</strong><br>No session scheduled. Create one?`;
}

const LEC_CAL_TAG = {
  today: { label: 'Today · Live', bg: 'rgba(255,255,255,.1)', color: 'var(--text)', border: 'var(--border)' },
  upcoming: { label: 'Upcoming', bg: 'rgba(255,255,255,.06)', color: 'var(--text)', border: 'var(--border)' },
  confirmed: { label: 'Completed', bg: 'rgba(92,200,138,.12)', color: 'var(--green)', border: 'rgba(92,200,138,.2)' },
  flagged: { label: 'Flagged', bg: 'rgba(200,90,90,.12)', color: 'var(--red)', border: 'rgba(200,90,90,.2)' },
};

function renderLecCalSession(ev, dateStr) {
  document.getElementById('lec-detail-empty').style.display = 'none';
  document.getElementById('lec-detail-empty-date').style.display = 'none';
  document.getElementById('lec-detail-content').style.display = 'block';

  document.getElementById('lcd-title').textContent = dateStr;
  document.getElementById('lcd-module').textContent = `${currentModuleCode || ''} · ${currentModuleName || ''}`;
  document.getElementById('lcd-date').textContent = dateStr;
  document.getElementById('lcd-time').textContent = ev.time;
  document.getElementById('lcd-venue').textContent = ev.venue;
  document.getElementById('lcd-topic').textContent = ev.topic;
  document.getElementById('lcd-type').textContent = ev.sessionType;

  const tag = document.getElementById('lcd-tag');
  const t = LEC_CAL_TAG[ev.type] || LEC_CAL_TAG.upcoming;
  tag.textContent = t.label;
  tag.style.background = t.bg;
  tag.style.color = t.color;
  tag.style.border = `1px solid ${t.border}`;

  const tutorWrap = document.getElementById('lcd-tutors');
  if (ev.tutors.length) {
    tutorWrap.innerHTML = ev.tutors.map((name) => `<span class="cal-tutor-pill">${name}</span>`).join('');
  } else {
    tutorWrap.innerHTML = '<span style="font-size:12px;color:var(--red);">No tutors assigned</span>';
  }

  const attRow = document.getElementById('lcd-att-row');
  const attEl = document.getElementById('lcd-att');
  if (ev.type === 'upcoming' || ev.att === '—') {
    attRow.style.display = 'none';
  } else {
    attRow.style.display = 'flex';
    attEl.textContent = ev.att;
    attEl.style.color = ev.type === 'flagged' ? 'var(--red)' : 'var(--text)';
  }

  const listEl = document.getElementById('lcd-sessions-list');
  const actionsEl = document.getElementById('lcd-actions');
  if (listEl) listEl.style.display = 'none';
  if (actionsEl) {
    actionsEl.style.display = 'flex';
    const dateIso = sessionDateKey(SESSIONS[ev.sessionId]?.session_date) || '';
    actionsEl.innerHTML = `
      <button type="button" class="cal-create-btn" onclick="goView('sessions',document.getElementById('nav-sessions'))">
        View in sessions
      </button>
      <button type="button" class="cal-create-btn" onclick="openNewSession('${dateIso}')">
        Schedule another
      </button>`;
  }
}

function showLecCalDetail(d, dayEvents) {
  selectCalDay(d);
  const dateStr = `${d} ${monthNames[calMonth]} ${calYear}`;
  const items = dayEvents.items || [];
  if (!items.length) return;

  if (items.length === 1) {
    renderLecCalSession(items[0], dateStr);
    return;
  }

  document.getElementById('lec-detail-empty').style.display = 'none';
  document.getElementById('lec-detail-empty-date').style.display = 'none';
  document.getElementById('lec-detail-content').style.display = 'block';
  document.getElementById('lcd-title').textContent = dateStr;
  document.getElementById('lcd-module').textContent = `${items.length} sessions · ${currentModuleCode || ''}`;
  document.getElementById('lcd-date').textContent = dateStr;
  document.getElementById('lcd-time').textContent = 'Multiple';
  document.getElementById('lcd-venue').textContent = '—';
  document.getElementById('lcd-topic').textContent = 'Select a session below';
  document.getElementById('lcd-type').textContent = '—';
  document.getElementById('lcd-tag').textContent = `${items.length} sessions`;
  document.getElementById('lcd-tutors').innerHTML = '';
  document.getElementById('lcd-att-row').style.display = 'none';

  const listEl = document.getElementById('lcd-sessions-list');
  if (listEl) {
    listEl.style.display = 'block';
    listEl.innerHTML = items.map((ev) => `
      <button type="button" class="cal-session-pick" onclick="showLecCalSessionById(${d}, ${ev.sessionId})">
        <span class="cal-session-pick-time">${ev.time}</span>
        <span class="cal-session-pick-topic">${ev.topic}</span>
        <span class="cal-session-pick-type">${ev.sessionType}</span>
      </button>`).join('');
  }
  const actionsEl = document.getElementById('lcd-actions');
  if (actionsEl) {
    actionsEl.style.display = 'flex';
    actionsEl.innerHTML = `<button type="button" class="cal-create-btn" onclick="openNewSession('${calDateKey(calYear, calMonth, d)}')">Add session</button>`;
  }
}

function buildCalGrid() {
  const grid = document.getElementById('lec-cal-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const titleEl = document.getElementById('cal-month-title');
  if (titleEl) titleEl.textContent = monthNames[calMonth];

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
    const key = calDateKey(calYear, calMonth, d);
    const dayEvents = lecCalEvents[key];
    const isToday = today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === d;
    const cellDate = new Date(calYear, calMonth, d);
    const isPast = cellDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());

    let cls = 'cal-cell';
    if (isPast) cls += ' past';
    if (isToday && dayEvents) cls += ' today has-event';
    else if (isToday) cls += ' today';
    else if (dayEvents) cls += ` has-event ev-${dayEvents.type}`;
    else cls += ' no-event';

    cell.className = cls;
    cell.dataset.day = String(d);
    cell.textContent = d;

    if (dayEvents && dayEvents.items.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'cal-count-badge';
      badge.textContent = String(dayEvents.items.length);
      cell.appendChild(badge);
    }

    if (dayEvents) {
      cell.onclick = () => showLecCalDetail(d, dayEvents);
    } else {
      cell.onclick = () => showLecEmptyDatePanel(d);
    }

    grid.appendChild(cell);
  }
}

function showLecCalSessionById(d, sessionId) {
  const key = calDateKey(calYear, calMonth, d);
  const ev = lecCalEvents[key]?.items.find((i) => i.sessionId === sessionId);
  if (ev) renderLecCalSession(ev, `${d} ${monthNames[calMonth]} ${calYear}`);
}

function calChangeMonth(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  resetLecCalDetail();
  buildCalGrid();
}

window.goView = goView;
window.calChangeMonth = calChangeMonth;
window.openNewSessionOnDate = openNewSessionOnDate;
window.openNewSession = openNewSession;
window.renderLecCalSession = renderLecCalSession;
window.showLecCalSessionById = showLecCalSessionById;
/* ── MY TUTORS VIEW ── */
const QUAL_DISPLAY = {
  '3rd_year': '3rd Year Student', '4th_year_honours': '4th Year / Honours',
  'masters': 'Masters Student', 'masters_holder': 'Masters Holder', 'phd': 'PhD',
};

async function loadMyReferrals() {
  const wrap = document.getElementById('my-referrals-list');
  if (wrap) wrap.innerHTML = skeletonReferralRows(3);
  try {
    let referrals = asListPayload(await VF.apiFetch('/referrals' + moduleQuerySuffix()));
    if (currentModuleCode) {
      referrals = referrals.filter(r =>
        String(r.module_code || '').toUpperCase() === currentModuleCode.toUpperCase()
      );
    }
    if (!wrap) return;

    if (!referrals.length) {
      wrap.innerHTML = '<div class="lec-referrals-empty">No referrals submitted yet for this module.</div>';
      return;
    }

    wrap.innerHTML = referrals.map(r => {
      const statusColor =
        r.status === 'approved' ? 'var(--green)' :
        r.status === 'rejected' ? 'var(--red)' :
        'var(--yellow)';
      const statusLabel =
        r.status === 'approved' ? 'Approved' :
        r.status === 'rejected' ? 'Rejected' :
        'Pending';
      const fullName = `${r.first_names || ''} ${r.surname || ''}`.trim() || '—';
      return `<div class="lec-ref-row">
        <div>
          <div class="lec-ref-name">${escapeHtml(fullName)}</div>
          <div class="lec-ref-meta">${escapeHtml(r.module_code || '—')} · ${escapeHtml(r.qualification_level || '—')}</div>
        </div>
        <span class="lec-ref-status" style="color:${statusColor}">${statusLabel}</span>
      </div>`;
    }).join('');
  } catch (err) {
    if (wrap) {
      wrap.innerHTML = '<div class="lec-referrals-empty">Could not load referrals.</div>';
    }
  }
}

async function loadMyTutors() {
  const grid = document.getElementById('tutors-grid');
  if (grid) grid.innerHTML = skeletonTutorCards(6);

  try {
    const tutors = asListPayload(await VF.apiFetch(`/users/tutors${moduleQuerySuffix()}`));
    moduleTutorPool = tutors;
    const count  = document.getElementById('tutors-count');
    const appr   = document.getElementById('tutors-approved');
    if (count) count.textContent = tutors.length;
    if (appr)  appr.textContent  = tutors.length;

    const dashTutorStat = document.querySelector('#view-dashboard .stat-box:nth-child(1) .stat-val');
    if (dashTutorStat) dashTutorStat.textContent = String(tutors.length);
    setText('#lec-hub-tutors-sub', "Manage this module's tutors");
    setText('#lec-hub-tutors-badge', String(tutors.length));

    renderSidebarTutors(tutors);
    renderNsTutorList(tutors);

    if (Object.keys(SESSIONS).length) {
      renderSessionRows(Object.values(SESSIONS));
    }

    if (!grid) {
      loadMyReferrals();
      return;
    }
    if (!tutors.length) {
      grid.innerHTML = '<div class="lec-tutors-loading">No tutors on this module yet.</div>';
      loadMyReferrals();
      return;
    }

    grid.innerHTML = tutors.map(t => {
      const initials = VF.initials(t.first_names, t.surname);
      const qual     = QUAL_DISPLAY[t.qualification_level] || t.qualification_level || '—';
      const resp     = t.responsibility_level
        ? t.responsibility_level.charAt(0).toUpperCase() + t.responsibility_level.slice(1) + ' Tutor'
        : '—';
      const fullName = `${t.first_names || ''} ${t.surname || ''}`.trim();
      return `
        <div class="tutor-card">
          <div class="tc-top">
            <div class="tc-av">${escapeHtml(initials)}</div>
            <div class="tc-who">
              <div class="tc-name">${escapeHtml(fullName)}</div>
              <div class="tc-module">${escapeHtml(t.module_name || currentModuleName || '—')}</div>
            </div>
          </div>
          <div class="tc-chips">
            <span class="tc-chip attend">${escapeHtml(t.student_number || '—')}</span>
          </div>
          <div class="tc-qual">
            <div class="tc-qual-item"><strong>${escapeHtml(qual)}</strong>Qualification Level</div>
            <div class="tc-qual-item"><strong>${escapeHtml(resp)}</strong>Responsibility Level</div>
          </div>
          <button type="button" class="msg-btn" data-msg-tutor="${Number(t.id)}" data-msg-name="${escapeHtml(fullName)}">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            Message
          </button>
        </div>`;
    }).join('');

    grid.querySelectorAll('[data-msg-tutor]').forEach(btn => {
      btn.addEventListener('click', () => {
        openMsg(btn.getAttribute('data-msg-tutor'), btn.getAttribute('data-msg-name'));
      });
    });
    loadMyReferrals();
  } catch (err) {
    if (grid) grid.innerHTML = '<div class="lec-tutors-loading">Could not load tutors.</div>';
    const wrap = document.getElementById('my-referrals-list');
    if (wrap) wrap.innerHTML = '<div class="lec-referrals-empty">Could not load referrals.</div>';
    showToast('Could not load tutors');
  }
}

initNsTimePickers();