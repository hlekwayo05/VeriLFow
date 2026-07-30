'use strict';

/** Admin dashboard — API-backed claims, flagged sessions, dashboard, analysis, messages */

const AD_MONTH = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const AD_QUAL_DISPLAY = {
  '3rd_year': '3rd Year',
  '4th_year_honours': '4th Yr / Hons',
  'masters': 'Masters Student',
  'masters_holder': 'Masters Holder',
  'phd': 'PhD',
};

const AD_RESP_DISPLAY = {
  standard: 'Junior Tutor',
  senior: 'Senior Tutor',
  lead: 'Lead Tutor',
};

let ADMIN_CLAIMS = {};
let FLAGGED_SESSIONS = {};
let adminSessionsCache = [];
let adminClaimsCache = [];
let adminTutorsCache = [];
let adminSupportTicketsCache = [];

function adFormatClaimPeriod(c) {
  return `${AD_MONTH[c.period_month] || c.period_month} ${c.period_year}`;
}

function adFormatMoney(n) {
  if (n == null || n === '') return '—';
  return 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function adCourseShort(course) {
  if (!course) return '—';
  if (course.startsWith('BICT')) return 'BICT';
  if (course.startsWith('DICT')) return 'DICT';
  return String(course).split(/[\s—-]/)[0].trim() || course;
}

function adAppModuleLabel(app) {
  const code = app.module_code || '';
  const name = app.module_name || '';
  const course = adCourseShort(app.course);
  const label = code || name || '—';
  return `${label} · ${course}`;
}

function adRelativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24 && d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function adEscapeHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function adBarWidth(value, max) {
  const v = Number(value) || 0;
  const m = Math.max(Number(max) || 0, 1);
  return Math.min(100, Math.round((v / m) * 100));
}

function adFormatSessionDate(iso, startTime) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10));
  const datePart = d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  const timePart = startTime ? ` · ${String(startTime).slice(0, 5)}` : '';
  return datePart + timePart;
}

function adSessionTypeLabel(t) {
  const map = { tutorial: 'Tutorial', practical: 'Practical', online: 'Online', revision: 'Revision', lecture: 'Lecture' };
  return map[t] || t || '—';
}

function adClaimStatusChip(status) {
  if (status === 'approved') return '<span class="claim-status-tag paid">Approved</span>';
  if (status === 'returned_by_coordinator') return '<span class="claim-status-tag" style="background:rgba(200,90,90,.1);color:var(--red);border:1px solid rgba(200,90,90,.2)">Returned</span>';
  if (status === 'pending_coordinator') return '<span class="stag review">Pending approval</span>';
  if (status === 'pending_lecturer') return '<span class="stag review">With lecturer</span>';
  return '<span class="stag review">Under review</span>';
}

function adClaimActionButtons(id, status) {
  const view = `<button class="btn-sm" onclick="openClaimDetail(${id})">View Details</button>`;
  if (status !== 'pending_coordinator') return view;
  return `${view}<button class="btn-approve" onclick="approveClaim(${id})">Approve</button><button class="btn-decline" onclick="rejectClaim(${id})">Return</button>`;
}

function adQualChip(level) {
  if (!level) return '<span class="qual-chip">—</span>';
  const label = AD_QUAL_DISPLAY[level] || level;
  const cls = ['masters', 'masters_holder', 'phd', '4th_year_honours'].includes(level) ? ' honours' : '';
  return `<span class="qual-chip${cls}">${label}</span>`;
}

async function loadClaims() {
  const tbody = document.getElementById('claims-tbody');
  const cards = document.getElementById('claims-cards');
  if (tbody && VF.skeleton) tbody.innerHTML = VF.skeleton.tbody(10, 6);
  if (cards && VF.skeleton) cards.innerHTML = VF.skeleton.claimCards(4);

  try {
    const claims = await VF.apiFetch('/admin/claims');
    ADMIN_CLAIMS = {};
    claims.forEach((c) => { ADMIN_CLAIMS[c.id] = c; });
    adminClaimsCache = claims;

    const pending = claims.filter((c) => c.status === 'pending_coordinator');
    const sub = document.querySelector('#page-claims .page-hero p');
    if (sub) {
      sub.textContent = pending.length
        ? `${pending.length} claim${pending.length === 1 ? '' : 's'} awaiting approval before finance handoff`
        : 'No claims awaiting approval';
    }

    if (!tbody) return;

    if (!claims.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px">No claims submitted yet.</td></tr>';
      if (cards) {
        cards.innerHTML = `<div class="ad-empty-card"><div class="ad-empty-state">
          <div class="ad-empty-ico"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg></div>
          <h3>No claims submitted yet</h3>
          <p>Tutor timesheet claims will appear here once submitted for approval.</p>
        </div></div>`;
      }
      updateNavBadges();
      return;
    }

    tbody.innerHTML = claims.map((c) => {
      const tutor = `${c.tutor_first_names || ''} ${c.tutor_surname || ''}`.trim();
      const hours = c.total_hours != null ? `${Number(c.total_hours)} hrs` : `${c.session_count || 0} sessions`;
      const rate = c.pay_rate != null ? `R${Number(c.pay_rate).toFixed(0)}/hr` : '—';
      const resp = AD_RESP_DISPLAY[c.responsibility_level] || c.responsibility_level || '—';
      return `<tr data-claim-id="${c.id}" data-status="${c.status}">
        <td style="font-weight:600;color:var(--text)">${tutor || '—'}</td>
        <td style="font-family:'DM Mono',monospace;color:var(--muted)">${c.module_code || '—'}</td>
        <td style="color:var(--muted)">${adFormatClaimPeriod(c)}</td>
        <td style="font-family:'DM Mono',monospace;color:var(--muted)">${hours}</td>
        <td style="font-family:'DM Mono',monospace;color:var(--muted)">${rate}</td>
        <td>${adQualChip(c.qualification_level)}</td>
        <td style="font-family:'DM Mono',monospace;color:var(--green)">${resp}</td>
        <td style="font-family:'DM Mono',monospace;color:var(--text)">${adFormatMoney(c.total_amount)}</td>
        <td>${adClaimStatusChip(c.status)}</td>
        <td>${adClaimActionButtons(c.id, c.status)}</td>
      </tr>`;
    }).join('');

    if (cards) {
      cards.innerHTML = claims.map((c) => {
        const tutor = `${c.tutor_first_names || ''} ${c.tutor_surname || ''}`.trim() || '—';
        const hours = c.total_hours != null ? `${Number(c.total_hours)} hrs` : `${c.session_count || 0} sessions`;
        return `<button type="button" class="ad-rec-card" onclick="openClaimDetail(${c.id})">
          <div class="ad-rec-name">${tutor}</div>
          <div class="ad-rec-sub">${c.module_code || '—'} · ${adFormatClaimPeriod(c)}</div>
          <div class="ad-rec-grid">
            <div class="item"><div class="k">${hours}</div><div class="l">Hours</div></div>
            <div class="item"><div class="k">${adFormatMoney(c.total_amount)}</div><div class="l">Amount</div></div>
            <div class="item"><div class="k">${c.pay_rate != null ? `R${Number(c.pay_rate).toFixed(0)}/hr` : '—'}</div><div class="l">Rate</div></div>
          </div>
          <div>${adClaimStatusChip(c.status)}</div>
        </button>`;
      }).join('');
    }

    updateNavBadges();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not load claims');
  }
}

function adClaimStatusTag(status) {
  if (status === 'pending_lecturer') return '<span class="claim-status-tag new-tag">Pending lecturer review</span>';
  if (status === 'pending_coordinator') return '<span class="claim-status-tag review">Pending coordinator</span>';
  if (status === 'approved') return '<span class="claim-status-tag paid">Approved</span>';
  if (status === 'returned_by_lecturer') return '<span class="claim-status-tag" style="background:rgba(200,90,90,.1);color:var(--red);border:1px solid rgba(200,90,90,.2);">Returned by lecturer</span>';
  if (status === 'returned_by_coordinator') return '<span class="claim-status-tag" style="background:rgba(200,90,90,.1);color:var(--red);border:1px solid rgba(200,90,90,.2);">Returned by coordinator</span>';
  return `<span class="claim-status-tag">${status}</span>`;
}

function adLecturerApprovalBar(claim) {
  const lecturer = `${claim.lecturer_first_names || ''} ${claim.lecturer_surname || ''}`.trim() || '—';
  const reviewedAt = claim.lecturer_reviewed_at
    ? new Date(claim.lecturer_reviewed_at).toLocaleDateString('en-ZA', {
        day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null;

  let approvalHtml = '';
  if (['pending_coordinator', 'approved'].includes(claim.status)) {
    approvalHtml = `<div class="cd-lecturer-approval">
      <span class="claim-status-tag paid">Approved by lecturer</span>
      ${reviewedAt ? `<div class="cd-lecturer-sub">Verified ${reviewedAt}</div>` : ''}
    </div>`;
  } else if (claim.status === 'pending_lecturer') {
    approvalHtml = `<div class="cd-lecturer-approval">
      <span class="claim-status-tag review">Awaiting lecturer review</span>
    </div>`;
  } else if (claim.status === 'returned_by_lecturer') {
    approvalHtml = `<div class="cd-lecturer-approval">
      <span class="claim-status-tag" style="background:rgba(200,90,90,.1);color:var(--red);border:1px solid rgba(200,90,90,.2);">Returned by lecturer</span>
    </div>`;
  }

  return `<div class="cd-lecturer-bar">
    <div class="cd-lecturer-left">
      <div class="cd-lecturer-label">Assigned lecturer</div>
      <div class="cd-lecturer-name">${lecturer}</div>
    </div>
    ${approvalHtml}
  </div>`;
}

async function openClaimDetail(id) {
  try {
    const data = await VF.apiFetch(`/claims/${id}/sessions`);
    const claim = data.claim;
    const sessions = data.sessions || [];
    ADMIN_CLAIMS[id] = { ...ADMIN_CLAIMS[id], ...claim };

    const tutor = `${claim.tutor_first_names || ''} ${claim.tutor_surname || ''}`.trim();
    const period = adFormatClaimPeriod(claim);
    document.getElementById('cd-title').textContent = `${tutor} — Claim`;
    document.getElementById('cd-period').textContent = `${period} · ${claim.module_code || '—'}`;

    const qual = AD_QUAL_DISPLAY[claim.qualification_level] || claim.qualification_level || '—';
    const resp = AD_RESP_DISPLAY[claim.responsibility_level] || claim.responsibility_level || '—';
    const rate = claim.pay_rate != null ? `R${Number(claim.pay_rate).toFixed(2)}/hr` : '—';
    const totalHours = Number(claim.total_hours || 0);

    const rows = sessions.filter((s) => s.included !== false).map((s) => {
      const date = s.session_date
        ? new Date(String(s.session_date).slice(0, 10)).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
        : '—';
      const time = s.start_time ? String(s.start_time).slice(0, 5) : '—';
      const flagged = s.session_status === 'flagged';
      const present = s.attendance_count ?? 0;
      const enrolled = s.enrolled_count ?? 0;
      const attCls = enrolled && (present / enrolled) >= 0.75 ? 'att-good' : (enrolled ? 'att-low' : '');
      const sessionId = s.session_id || s.id;
      const att = `${present} / ${enrolled || '—'}`;
      return `<tr class="${flagged ? 'flagged-row' : ''}">
        <td style="font-weight:600;color:${flagged ? 'var(--red)' : 'var(--text)'}">${date}</td>
        <td style="font-family:'DM Mono',monospace;color:var(--muted);">${time}</td>
        <td style="color:var(--muted);">${s.venue || '—'}</td>
        <td style="color:var(--muted);">${s.topic || '—'}</td>
        <td><span class="type-chip">${s.session_type || '—'}</span></td>
        <td><button type="button" class="att-reg-link ${attCls}" onclick="event.stopPropagation();openRegister(${sessionId})" title="View attendance register">${att}</button></td>
        <td style="font-family:'DM Mono',monospace;color:var(--muted);">${s.claimed_hours || '—'} hrs</td>
      </tr>`;
    }).join('');

    const note = claim.lecturer_note || claim.coordinator_note || '';
    document.getElementById('cd-body').innerHTML = `
      <div class="claims-strip cd-verify-strip">
        <div class="cl-stat"><div class="cl-stat-label">Qualification Level</div><div class="cl-stat-val">${qual}</div></div>
        <div class="cl-stat"><div class="cl-stat-label">Responsibility Level</div><div class="cl-stat-val">${resp}</div></div>
        <div class="cl-stat"><div class="cl-stat-label">Claimed Rate</div><div class="cl-stat-val">${rate}</div></div>
        <div class="cl-stat"><div class="cl-stat-label">Total Hours</div><div class="cl-stat-val">${totalHours} hrs</div></div>
        <div class="cl-stat"><div class="cl-stat-label">Total Amount</div><div class="cl-stat-val green">${adFormatMoney(claim.total_amount)}</div></div>
      </div>
      ${adLecturerApprovalBar(claim)}
      <div class="ts-modal-wrap">
        <div class="ts-modal-head">
          <div>
            <div class="ts-modal-head-title">${tutor} — ${period}</div>
            <div class="ts-modal-head-sub">${claim.module_code || '—'} · ${sessions.length} session(s)</div>
          </div>
          ${adClaimStatusTag(claim.status)}
        </div>
        <table class="ts-modal-table">
          <thead><tr><th>Date</th><th>Time</th><th>Venue</th><th>Topic</th><th>Type</th><th>Attendance</th><th>Hours</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px">No sessions</td></tr>'}</tbody>
        </table>
      </div>
      ${note ? `<div class="cm-note">${note}</div>` : ''}`;

    const footer = document.getElementById('cd-footer');
    if (claim.status === 'pending_coordinator') {
      footer.innerHTML = `<button type="button" class="ns-cancel" onclick="closeClaimDetail()">Close</button>
        <div style="display:flex;gap:8px;">
          <button type="button" class="cl-btn reject" style="padding:10px 18px;" onclick="rejectClaim(${id})">Return</button>
          <button type="button" class="ns-create" onclick="approveClaim(${id})">Approve</button>
        </div>`;
    } else {
      footer.innerHTML = `<div></div><button type="button" class="ns-cancel" onclick="closeClaimDetail()">Close</button>`;
    }
    document.getElementById('cd-overlay').classList.add('open');
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not load claim details');
  }
}

async function approveClaim(id) {
  try {
    await VF.apiFetch(`/claims/${id}/coordinator-approve`, { method: 'PATCH', body: {} });
    showToast('Claim approved');
    closeClaimDetail();
    await loadClaims();
    await loadDashboardOverview();
    await loadAnalysis();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not approve claim');
  }
}

async function rejectClaim(id) {
  openClaimReturnModal(id);
}

let pendingClaimReturnId = null;

function openClaimReturnModal(id) {
  const claim = ADMIN_CLAIMS[id] || adminClaimsCache.find((c) => c.id === id);
  pendingClaimReturnId = id;
  const tutor = claim ? `${claim.tutor_first_names || ''} ${claim.tutor_surname || ''}`.trim() : 'Tutor';
  const period = claim ? adFormatClaimPeriod(claim) : '—';
  const module = claim?.module_code || '—';
  document.getElementById('claim-return-subtitle').textContent = `${tutor} · ${module} · ${period}`;
  document.getElementById('claim-return-reason').value = '';
  document.getElementById('claim-return-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('claim-return-reason')?.focus(), 120);
}

function closeClaimReturnModal() {
  document.getElementById('claim-return-overlay')?.classList.remove('open');
  pendingClaimReturnId = null;
  if (!document.getElementById('cd-overlay')?.classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

function claimReturnCloseOutside(e) {
  if (e.target === document.getElementById('claim-return-overlay')) closeClaimReturnModal();
}

function fillClaimReturnReason(text) {
  const ta = document.getElementById('claim-return-reason');
  if (ta) {
    ta.value = text;
    ta.focus();
  }
}

async function confirmClaimReturn() {
  const reason = document.getElementById('claim-return-reason')?.value.trim();
  if (!reason) {
    showToast('Please enter a reason for returning this claim');
    return;
  }
  if (!pendingClaimReturnId) return;

  const btn = document.getElementById('claim-return-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    await VF.apiFetch(`/claims/${pendingClaimReturnId}/coordinator-return`, {
      method: 'PATCH',
      body: { note: reason },
    });
    showToast('Claim returned to tutor');
    closeClaimReturnModal();
    closeClaimDetail();
    await loadClaims();
    await loadDashboardOverview();
    await loadAnalysis();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not return claim');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function adFlagIssueLabel(session) {
  if (session.status === 'flagged') return 'Flagged for review';
  return 'Requires attention';
}

function adFlaggedRow(session) {
  const tutor = session.tutor_names || '—';
  const lecturer = `${session.lecturer_first_names || ''} ${session.lecturer_surname || ''}`.trim() || 'System';
  const dateStr = adFormatSessionDate(session.session_date, session.start_time);
  return `<tr data-flag-id="${session.id}" data-status="open">
    <td style="font-weight:600;color:var(--text)">${tutor}</td>
    <td style="font-family:'DM Mono',monospace;color:var(--muted)">${session.module_code || '—'}</td>
    <td style="font-family:'DM Mono',monospace;color:var(--muted)">${dateStr}</td>
    <td style="color:var(--muted)">${adSessionTypeLabel(session.session_type)}</td>
    <td><span class="issue-chip no-confirm">${adFlagIssueLabel(session)}</span></td>
    <td style="color:var(--muted)">${lecturer}</td>
    <td>
      <button class="btn-sm" onclick="investigateFlaggedSession(${session.id})">Investigate</button>
      <button class="btn-sm" onclick="resolveFlaggedSession(${session.id})">Resolve</button>
    </td>
  </tr>`;
}

async function loadFlaggedSessions() {
  const tbodyPre = document.getElementById('flagged-tbody');
  const flaggedCardsPre = document.getElementById('flagged-cards');
  const dashBodyPre = document.getElementById('dash-flagged-tbody');
  if (tbodyPre && VF.skeleton) tbodyPre.innerHTML = VF.skeleton.tbody(7, 5);
  if (flaggedCardsPre && VF.skeleton) flaggedCardsPre.innerHTML = VF.skeleton.claimCards(3);
  if (dashBodyPre && VF.skeleton) dashBodyPre.innerHTML = VF.skeleton.tbody(5, 4);

  try {
    const sessions = await VF.apiFetch('/sessions');
    adminSessionsCache = sessions;
    const flagged = sessions.filter((s) => s.status === 'flagged');
    FLAGGED_SESSIONS = {};
    flagged.forEach((s) => { FLAGGED_SESSIONS[s.id] = s; });

    const sub = document.querySelector('#page-flagged .page-hero p');
    if (sub) {
      sub.textContent = flagged.length
        ? `${flagged.length} disputed or suspicious session${flagged.length === 1 ? '' : 's'} requiring investigation`
        : 'No flagged sessions';
    }

    const dashSub = document.getElementById('dash-flagged-sub');
    if (dashSub) dashSub.textContent = flagged.length ? `${flagged.length} open` : 'None open';

    const tbody = document.getElementById('flagged-tbody');
    if (tbody) {
      tbody.innerHTML = flagged.length
        ? flagged.map(adFlaggedRow).join('')
        : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">No flagged sessions.</td></tr>';
    }

    const flaggedCards = document.getElementById('flagged-cards');
    if (flaggedCards) {
      flaggedCards.innerHTML = flagged.length
        ? flagged.map((s) => {
          const tutor = s.tutor_names || '—';
          const dateStr = adFormatSessionDate(s.session_date, s.start_time);
          return `<button type="button" class="ad-rec-card flag" onclick="investigateFlaggedSession(${s.id})">
            <div class="ad-rec-name">${tutor}</div>
            <div class="ad-rec-sub">${s.module_code || '—'} · ${dateStr}</div>
            <div class="ad-rec-grid">
              <div class="item"><div class="k">${adSessionTypeLabel(s.session_type)}</div><div class="l">Type</div></div>
              <div class="item"><div class="k">${adFlagIssueLabel(s)}</div><div class="l">Issue</div></div>
            </div>
          </button>`;
        }).join('')
        : `<div class="ad-empty-card"><div class="ad-empty-state">
          <div class="ad-empty-ico"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg></div>
          <h3>No flagged sessions</h3>
          <p>Sessions with attendance or scheduling disputes will appear here.</p>
        </div></div>`;
    }

    const dashBody = document.getElementById('dash-flagged-tbody');
    if (dashBody) {
      dashBody.innerHTML = flagged.length
        ? flagged.slice(0, 5).map((s) => {
          const tutor = s.tutor_names || '—';
          const dateStr = adFormatSessionDate(s.session_date, s.start_time);
          return `<tr>
            <td style="font-weight:600;color:var(--text)">${tutor}</td>
            <td style="font-family:'DM Mono',monospace;color:var(--muted)">${s.module_code || '—'}</td>
            <td style="font-family:'DM Mono',monospace;color:var(--muted)">${dateStr}</td>
            <td><span class="issue-chip no-confirm">${adFlagIssueLabel(s)}</span></td>
            <td><button class="btn-sm" onclick="investigateFlaggedSession(${s.id})">Investigate</button></td>
          </tr>`;
        }).join('')
        : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">No flagged sessions</td></tr>';
    }

    updateNavBadges();
  } catch (err) {
    showToast('Could not load flagged sessions');
  }
}

let activeFlagId = null;
let activeResolveId = null;

function investigateFlaggedSession(id) {
  openFlagModal(id);
}

function resolveFlaggedSession(id) {
  openResolveModal(id);
}

function openFlagModal(flagId) {
  const session = FLAGGED_SESSIONS[flagId];
  if (!session) return;
  activeFlagId = flagId;
  const tutor = session.tutor_names || '—';
  const lecturer = `${session.lecturer_first_names || ''} ${session.lecturer_surname || ''}`.trim();
  const dateStr = adFormatSessionDate(session.session_date, session.start_time);
  document.getElementById('flag-title').textContent = `${tutor} · ${session.module_code || '—'}`;
  document.getElementById('flag-detail-note').innerHTML = `<strong>Issue:</strong> ${adFlagIssueLabel(session)} · <strong>Session:</strong> ${dateStr}`;
  document.getElementById('flag-tutor').textContent = tutor;
  document.getElementById('flag-module').textContent = session.module_code || '—';
  document.getElementById('flag-session').textContent = dateStr;
  document.getElementById('flag-type').textContent = adSessionTypeLabel(session.session_type);
  document.getElementById('flag-reported').textContent = lecturer || 'System';
  document.getElementById('flag-attendance').textContent = session.attendance_count != null
    ? `${session.attendance_count} student(s) logged`
    : 'No attendance data recorded';
  document.getElementById('flag-investigation-notes').value = '';
  document.getElementById('flag-message-subject').value = `Flag follow-up — ${session.module_code || ''} · ${dateStr}`;
  document.getElementById('flag-message-body').value = '';
  document.getElementById('flag-overlay').classList.add('open');
}

function openResolveModal(flagId) {
  const session = FLAGGED_SESSIONS[flagId];
  if (!session) return;
  activeResolveId = flagId;
  const labelEl = document.getElementById('resolve-session-label');
  if (labelEl) {
    labelEl.textContent = `${session.tutor_names || '—'} · ${session.module_code || '—'} · ${adFormatSessionDate(session.session_date, session.start_time)}`;
  }
  document.getElementById('resolve-outcome').value = '';
  document.getElementById('resolve-note').value = '';
  document.getElementById('resolve-overlay').classList.add('open');
}

function closeFlagModal(e) {
  if (e && e.target !== document.getElementById('flag-overlay')) return;
  document.getElementById('flag-overlay').classList.remove('open');
  activeFlagId = null;
}

function closeResolveModal(e) {
  if (e && e.target !== document.getElementById('resolve-overlay')) return;
  document.getElementById('resolve-overlay').classList.remove('open');
  activeResolveId = null;
}

function closeClaimDetail() {
  document.getElementById('cd-overlay').classList.remove('open');
}

function cdCloseOutside(e) {
  if (e.target === document.getElementById('cd-overlay')) closeClaimDetail();
}

/* ── ATTENDANCE REGISTER (claim detail) ── */
let adminRegisterData = null;
let adminRegisterRefreshTimer = null;

function adSetText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function formatAdminRegisterSignInTime(recordedAt) {
  if (!recordedAt) return '—';
  return new Date(recordedAt).toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' });
}

function renderAdminRegisterModal(data) {
  const session = data.session || {};
  const modCode = session.module_code || '—';
  const date = session.session_date
    ? new Date(String(session.session_date).slice(0, 10)).toLocaleDateString('en-ZA', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—';
  const time = session.start_time ? String(session.start_time).slice(0, 5) : '';
  const meta = [time, session.venue, session.topic, adSessionTypeLabel(session.session_type)]
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

  adSetText('#reg-eyebrow', modCode);
  adSetText('#reg-title', `Attendance Register — ${date}`);
  adSetText('#reg-meta', meta || '—');
  adSetText('#reg-enrolled', String(enrolled));
  adSetText('#reg-present', String(present));
  adSetText('#reg-absent', String(absent));
  adSetText('#reg-pct', `${pct}%`);

  const tbody = document.getElementById('reg-tbody');
  if (!tbody) return;

  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">No students on the class list for this module.</td></tr>';
    return;
  }

  tbody.innerHTML = students.map((s, i) => `
    <tr class="${!s.present ? 'absent-row' : ''}">
      <td style="color:var(--muted);font-size:10px;font-family:'DM Mono',monospace">${String(i + 1).padStart(2, '0')}</td>
      <td class="reg-snum">${s.student_number}</td>
      <td class="reg-sname" style="${!s.present ? 'color:var(--muted);font-weight:400;' : ''}">${s.full_name || '—'}</td>
      <td class="reg-time">${formatAdminRegisterSignInTime(s.recorded_at)}</td>
      <td><span class="reg-badge ${s.present ? 'present' : 'absent'}">${s.present ? 'Present' : 'Absent'}</span></td>
    </tr>`).join('');
}

async function loadAdminRegister(sessionId) {
  const data = await VF.apiFetch(`/attendance/${sessionId}`);
  adminRegisterData = data;
  renderAdminRegisterModal(data);

  clearInterval(adminRegisterRefreshTimer);
  if (data.session?.status === 'active') {
    adminRegisterRefreshTimer = setInterval(() => {
      loadAdminRegister(sessionId).catch(() => {});
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
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">Loading register…</td></tr>';
  }
  modal.classList.add('open');

  try {
    await loadAdminRegister(sessionId);
  } catch (err) {
    modal.classList.remove('open');
    showToast(err.errors?.[0] || err.message || 'Could not load register');
  }
}

function closeRegister() {
  const modal = document.getElementById('regModal');
  if (modal) modal.classList.remove('open');
  clearInterval(adminRegisterRefreshTimer);
  adminRegisterRefreshTimer = null;
  adminRegisterData = null;
}

function regCloseOutside(e) {
  if (e.target === document.getElementById('regModal')) closeRegister();
}

function downloadRegister() {
  if (!adminRegisterData) return;
  const data = adminRegisterData;
  const session = data.session || {};
  const students = data.students || [];
  const enrolled = data.enrolled || students.length;
  const present = students.filter((s) => s.present).length;
  const absent = Math.max(0, enrolled - present);
  const pct = enrolled ? Math.round((present / enrolled) * 100) : (present ? 100 : 0);
  const modCode = session.module_code || '—';
  const dateLabel = session.session_date
    ? new Date(String(session.session_date).slice(0, 10)).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Session';

  const rows = students.map((s, i) => `
    <tr><td>${String(i + 1).padStart(2, '0')}</td><td>${s.student_number}</td><td>${s.full_name || '—'}</td>
    <td>${formatAdminRegisterSignInTime(s.recorded_at)}</td><td>${s.present ? 'Present' : 'Absent'}</td></tr>`).join('');

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

async function confirmResolution() {
  const session = FLAGGED_SESSIONS[activeResolveId];
  if (!session) return;
  const outcome = document.getElementById('resolve-outcome').value;
  const note = document.getElementById('resolve-note').value.trim();
  const outcomeLabels = {
    confirmed: 'Session confirmed',
    invalid: 'Session invalid',
    warned: 'Tutor warned',
  };
  const parts = [];
  if (outcome) parts.push(outcomeLabels[outcome] || outcome);
  if (note) parts.push(note);
  const fullNote = parts.join(' — ') || null;
  try {
    await VF.apiFetch(`/sessions/${activeResolveId}/resolve-flag`, {
      method: 'PATCH',
      body: { note: fullNote },
    });
    closeResolveModal();
    showToast('Session resolved');
    await loadFlaggedSessions();
    await loadDashboardOverview();
    await loadAnalysis();
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not resolve session');
  }
}

function sendFlagMessage() {
  showToast('Open Messages to reply in the tutor–lecturer thread');
  closeFlagModal();
  showPage('messages', document.querySelector('.nav-item[onclick*="messages"]'));
  if (typeof loadMessageThreads === 'function') loadMessageThreads();
}

function markFlagInvestigating() {
  showToast('Investigation noted — use Messages to contact the tutor or lecturer');
}

async function loadDashboardOverview() {
  const notif = document.getElementById('dash-notifications');
  const apps = document.getElementById('dash-recent-apps');
  const reports = document.getElementById('dash-reports');
  const dashFlagged = document.getElementById('dash-flagged-tbody');
  if (notif && VF.skeleton) notif.innerHTML = VF.skeleton.panel(4);
  if (apps && VF.skeleton) apps.innerHTML = VF.skeleton.panel(4);
  if (reports && VF.skeleton) reports.innerHTML = VF.skeleton.panel(3);
  if (dashFlagged && VF.skeleton) dashFlagged.innerHTML = VF.skeleton.tbody(5, 4);

  try {
    const [applications, claims, sessions, tutors, referrals, supportTickets, postings] = await Promise.all([
      VF.apiFetch('/applications?includeIncomplete=true'),
      VF.apiFetch('/admin/claims'),
      VF.apiFetch('/sessions'),
      VF.apiFetch('/users/tutors'),
      VF.apiFetch('/referrals'),
      VF.apiFetch('/support/tickets'),
      VF.apiFetch('/postings'),
    ]);

    adminClaimsCache = claims;
    adminSessionsCache = sessions;
    adminTutorsCache = tutors;
    adminSupportTicketsCache = supportTickets;

    const openApps = applications.filter((a) =>
      ['submitted', 'under_review', 'shortlisted'].includes(a.status)
    );
    const pendingClaims = claims.filter((c) => c.status === 'pending_coordinator');
    const flagged = sessions.filter((s) => s.status === 'flagged');
    const pendingReferrals = referrals.filter((r) => r.status === 'pending');
    const openSupport = supportTickets.filter((t) => t.status === 'open' || t.status === 'in_progress');
    const openPostings = (Array.isArray(postings) ? postings : []).filter((p) => {
      const status = String(p.status || 'open').toLowerCase();
      return status !== 'closed' && status !== 'archived' && status !== 'inactive';
    });

    const statApps = document.getElementById('stat-open-apps');
    if (statApps) statApps.textContent = String(openApps.length);

    const statClaims = document.getElementById('stat-pending-claims');
    if (statClaims) statClaims.textContent = String(pendingClaims.length);

    const statFlagged = document.getElementById('stat-flagged-sessions');
    if (statFlagged) statFlagged.textContent = String(flagged.length);

    updateAdminMobileHub({
      openApps: openApps.length,
      pendingClaims: pendingClaims.length,
      pendingReferrals: pendingReferrals.length,
      flagged: flagged.length,
      openSupport: openSupport.length,
      openPostings: openPostings.length,
    });

    renderLatestApplicants(applications);
    renderDashboardNotifications(applications, claims, flagged, referrals, supportTickets);
    renderDashboardReports(sessions, claims, tutors, flagged);

    updateNavBadges();

    // Use referrals already fetched above — avoid a second /referrals round-trip.
    const pendingRefCount = pendingReferrals.length;
    const refStat = document.getElementById('stat-referrals-pending');
    if (refStat) refStat.textContent = String(pendingRefCount);
    const refBadge = document.getElementById('nav-referrals-badge')
      || document.querySelector('[onclick*="referrals"] .nav-badge');
    if (refBadge) {
      refBadge.textContent = pendingRefCount ? String(pendingRefCount) : '—';
      if (refBadge.id === 'nav-referrals-badge') {
        refBadge.style.display = pendingRefCount ? '' : 'none';
      }
    }
    const hubRefs = document.getElementById('ad-hub-refs-badge');
    if (hubRefs) {
      if (pendingRefCount > 0) {
        hubRefs.textContent = String(pendingRefCount);
        hubRefs.hidden = false;
      } else {
        hubRefs.textContent = '';
        hubRefs.hidden = true;
      }
    }
  } catch (err) {
    console.error('loadDashboardOverview:', err);
    showToast(err.errors ? err.errors[0] : 'Could not refresh dashboard');
    ['stat-open-apps', 'stat-pending-claims', 'stat-flagged-sessions'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    updateAdminMobileHub({ openApps: 0, pendingClaims: 0, pendingReferrals: 0, flagged: 0, openSupport: 0, openPostings: 0 });
    const notif = document.getElementById('dash-notifications');
    if (notif) notif.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted);text-align:center">Could not load notifications.</div>';
    const apps = document.getElementById('dash-latest-applicants');
    if (apps) apps.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted);text-align:center">Could not load applicants.</div>';
    const reports = document.getElementById('dash-reports-panel');
    if (reports) reports.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted);text-align:center">Could not load reports.</div>';
    const dashFlagged = document.getElementById('dash-flagged-tbody');
    if (dashFlagged) dashFlagged.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">Could not load flagged sessions.</td></tr>';
  }
}

function renderLatestApplicants(applications) {
  const wrap = document.getElementById('dash-latest-applicants');
  if (!wrap) return;

  const open = applications.filter((a) =>
    ['submitted', 'under_review', 'shortlisted'].includes(a.status)
  );
  const pool = open.length
    ? open
    : applications.filter((a) => a.status !== 'incomplete');

  const recent = pool
    .sort((a, b) => new Date(b.submitted_at || b.created_at) - new Date(a.submitted_at || a.created_at))
    .slice(0, 4);

  if (!recent.length) {
    wrap.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted);text-align:center">No applications yet.</div>';
    return;
  }

  const statusLabel = {
    submitted: '<span class="sc new-app">New</span>',
    under_review: '<span class="sc review">In review</span>',
    shortlisted: '<span class="sc shortl">Shortlisted</span>',
    approved: '<span class="sc active-u">Approved</span>',
    rejected: '<span class="sc inactive-u">Rejected</span>',
  };

  wrap.innerHTML = recent.map((a) => {
    const initials = VF.initials(a.first_names, a.surname);
    const name = adEscapeHtml(`${a.first_names || ''} ${a.surname || ''}`.trim());
    const mod = adEscapeHtml(adAppModuleLabel(a));
    return `<div class="app-item app-item-clickable" style="cursor:pointer" onclick="openNotificationTarget('application', ${a.id})">
      <div class="app-av">${adEscapeHtml(initials)}</div>
      <div style="flex:1"><div class="app-name">${name}</div><div class="app-mod">${mod}</div></div>
      ${statusLabel[a.status] || statusLabel.submitted}
    </div>`;
  }).join('');
}

function notificationIconSvg(type) {
  const icons = {
    application: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`,
    claim: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h2"/></svg>`,
    referral: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`,
    flagged: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
    support: `<svg fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/></svg>`,
  };
  return icons[type] || icons.support;
}

function buildDashboardActivityFeed(applications, claims, flagged, referrals, supportTickets) {
  const items = [];

  applications
    .filter((a) => ['submitted', 'under_review', 'shortlisted'].includes(a.status))
    .forEach((a) => {
      const title = a.status === 'submitted' ? 'New application' : 'Application in review';
      items.push({
        type: 'application',
        targetId: a.id,
        ts: new Date(a.submitted_at || a.created_at).getTime(),
        title,
        sub: `${a.first_names} ${a.surname} — ${adAppModuleLabel(a)}`,
        time: adRelativeTime(a.submitted_at || a.created_at),
        unread: ['submitted', 'under_review', 'shortlisted'].includes(a.status),
      });
    });

  claims
    .filter((c) => c.status === 'pending_coordinator')
    .forEach((c) => {
      items.push({
        type: 'claim',
        targetId: c.id,
        ts: new Date(c.submitted_at || c.lecturer_reviewed_at || 0).getTime(),
        title: 'Claim ready for approval',
        sub: `${c.tutor_first_names} ${c.tutor_surname} — ${adFormatClaimPeriod(c)}${c.module_code ? ` · ${c.module_code}` : ''}`,
        time: adRelativeTime(c.submitted_at),
        unread: true,
      });
    });

  (referrals || [])
    .filter((r) => r.status === 'pending')
    .forEach((r) => {
      const lecturer = `${r.lecturer_title ? `${r.lecturer_title} ` : ''}${r.lecturer_first_names || ''} ${r.lecturer_surname || ''}`.trim();
      items.push({
        type: 'referral',
        targetId: r.id,
        ts: new Date(r.created_at || 0).getTime(),
        title: 'Referral pending',
        sub: `${r.first_names} ${r.surname} — ${r.module_code || r.module_name || 'module'} · ${lecturer || 'lecturer'}`,
        time: adRelativeTime(r.created_at),
        unread: true,
      });
    });

  flagged.forEach((s) => {
    items.push({
      type: 'flagged',
      targetId: s.id,
      ts: new Date(s.session_date || s.created_at || 0).getTime(),
      title: 'Flagged session',
      sub: `${s.module_code || 'Session'} · ${s.tutor_names || 'tutor'}`,
      time: adRelativeTime(s.session_date),
      unread: true,
    });
  });

  (supportTickets || [])
    .filter((t) => t.status === 'open' || t.status === 'in_progress')
    .forEach((t) => {
      const roleLabel = t.created_by_role === 'lecturer' ? 'Lecturer' : 'Tutor';
      items.push({
        type: 'support',
        targetId: t.id,
        ts: new Date(t.created_at || 0).getTime(),
        title: t.status === 'in_progress' ? 'Support ticket in progress' : 'New support ticket',
        sub: `${t.created_by_name || roleLabel} — ${t.subject || 'No subject'} · ${t.priority || 'medium'} priority`,
        time: adRelativeTime(t.created_at),
        unread: t.status === 'open',
      });
    });

  return items
    .filter((i) => i.ts && !Number.isNaN(i.ts))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 6);
}

function renderDashboardNotifications(applications, claims, flagged, referrals, supportTickets) {
  const panel = document.getElementById('dash-notifications');
  if (!panel) return;

  const tickets = supportTickets || adminSupportTicketsCache;
  const items = buildDashboardActivityFeed(applications, claims, flagged, referrals, tickets);
  const unreadCount = items.filter((i) => i.unread).length;

  const header = panel.closest('.panel')?.querySelector('.panel-header h3');
  if (header) {
    header.innerHTML = unreadCount
      ? `Notifications <span style="background:var(--accent);color:#fff;font-size:10px;padding:1px 7px;border-radius:20px;font-family:'DM Mono',monospace;font-weight:700;margin-left:6px">${unreadCount}</span>`
      : 'Notifications';
  }

  if (!items.length) {
    panel.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted);text-align:center">No recent activity.</div>';
    return;
  }

  panel.innerHTML = items.map((n) => `
    <div class="notif-item notif-clickable" role="button" tabindex="0"
      onclick="openNotificationTarget('${n.type}', ${n.targetId})"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openNotificationTarget('${n.type}', ${n.targetId})}">
      ${n.unread ? '<div class="notif-dot"></div>' : '<div class="notif-dot read"></div>'}
      <div class="notif-icon notif-icon-${n.type}">${notificationIconSvg(n.type)}</div>
      <div style="flex:1"><div class="notif-title">${adEscapeHtml(n.title)}</div><div class="notif-sub">${adEscapeHtml(n.sub)}</div></div>
      <div class="notif-time">${adEscapeHtml(n.time)}</div>
    </div>`).join('');
}

async function ensureApplicationLoaded(id) {
  if (typeof APPLICATIONS !== 'undefined' && APPLICATIONS[id]) return;
  const apps = await VF.apiFetch('/applications?includeIncomplete=true');
  if (typeof APPLICATIONS !== 'undefined') {
    apps.forEach((a) => { APPLICATIONS[a.id] = a; });
  }
}

async function ensureReferralLoaded(id) {
  if (typeof REFERRALS !== 'undefined' && REFERRALS[id]) return;
  const refs = await VF.apiFetch('/referrals');
  if (typeof REFERRALS !== 'undefined') {
    refs.forEach((r) => { REFERRALS[r.id] = r; });
  }
}

async function ensureFlaggedSessionLoaded(id) {
  if (FLAGGED_SESSIONS[id]) return;
  await loadFlaggedSessions();
}

async function openNotificationTarget(type, id) {
  try {
    if (type === 'application') {
      await ensureApplicationLoaded(id);
      if (typeof openApplicationDetail === 'function') openApplicationDetail(id);
      else showToast('Could not open application');
      return;
    }
    if (type === 'claim') {
      if (typeof openClaimDetail === 'function') await openClaimDetail(id);
      else showToast('Could not open claim');
      return;
    }
    if (type === 'referral') {
      await ensureReferralLoaded(id);
      if (typeof openReferralApprovalModal === 'function') openReferralApprovalModal(id);
      else showToast('Could not open referral');
      return;
    }
    if (type === 'flagged') {
      await ensureFlaggedSessionLoaded(id);
      if (typeof investigateFlaggedSession === 'function') investigateFlaggedSession(id);
      else showToast('Could not open flagged session');
      return;
    }
    if (type === 'support') {
      if (typeof showPage === 'function') {
        showPage('support', document.querySelector('.nav-item[onclick*="support"]'));
      }
      await openSupportRespondModal(id);
      return;
    }
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not open notification');
  }
}

function renderDashboardReports(sessions, claims, tutors, flagged) {
  const wrap = document.getElementById('dash-reports-panel');
  if (!wrap) return;

  const periodEl = document.getElementById('dash-reports-period');
  if (periodEl) {
    periodEl.textContent = new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  }

  const completed = sessions.filter((s) => s.status === 'completed').length;
  const totalSessions = sessions.length;
  const approvedClaims = claims.filter((c) => c.status === 'approved');
  const pendingClaims = claims.filter((c) =>
    ['pending_lecturer', 'pending_coordinator'].includes(c.status)
  );
  const paidTotal = approvedClaims.reduce((s, c) => s + Number(c.total_amount || 0), 0);
  const pendingTotal = pendingClaims.reduce((s, c) => s + Number(c.total_amount || 0), 0);
  const hoursLogged = approvedClaims.reduce((s, c) => s + Number(c.total_hours || 0), 0);
  const processedPct = claims.length
    ? Math.round((approvedClaims.length / claims.length) * 100)
    : 0;
  const flaggedPct = totalSessions ? ((flagged.length / totalSessions) * 100).toFixed(1) : '0';

  const maxSessions = Math.max(totalSessions, 1);
  const maxHours = Math.max(hoursLogged, 1);
  const maxMoney = Math.max(paidTotal, pendingTotal, 1);
  const maxTutors = Math.max(tutors.length, 1);

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px"><span style="font-size:12px;color:var(--muted)">Claims processed</span><span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text)">${processedPct}%</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${processedPct}%"></div></div>
    <div class="report-row"><span class="report-label">Sessions</span><div class="report-bar-wrap"><div class="report-bar-fill" style="width:${adBarWidth(completed, maxSessions)}%"></div></div><span class="report-val">${totalSessions}</span></div>
    <div class="report-row"><span class="report-label">Hours logged</span><div class="report-bar-wrap"><div class="report-bar-fill" style="width:${adBarWidth(hoursLogged, maxHours)}%"></div></div><span class="report-val">${Math.round(hoursLogged)}</span></div>
    <div class="report-row"><span class="report-label">Claims paid</span><div class="report-bar-wrap"><div class="report-bar-fill" style="width:${adBarWidth(paidTotal, maxMoney)}%"></div></div><span class="report-val">${adFormatMoney(paidTotal)}</span></div>
    <div class="report-row"><span class="report-label">Active tutors</span><div class="report-bar-wrap"><div class="report-bar-fill" style="width:${adBarWidth(tutors.length, maxTutors)}%"></div></div><span class="report-val">${tutors.length}</span></div>
    <div class="report-row"><span class="report-label">Flagged</span><div class="report-bar-wrap"><div class="report-bar-fill red" style="width:${adBarWidth(flagged.length, totalSessions || 1)}%"></div></div><span class="report-val">${flagged.length}</span></div>
    <div style="font-size:10px;color:var(--muted);margin-top:8px;font-family:'DM Mono',monospace">Pending claims: ${adFormatMoney(pendingTotal)} · Flagged rate: ${flaggedPct}%</div>`;
}

async function loadAnalysis() {
  const payoutEl = document.getElementById('analysis-payout-chart');
  const modEl = document.getElementById('analysis-module-chart');
  if (payoutEl && VF.skeleton) payoutEl.innerHTML = VF.skeleton.block(true);
  if (modEl && VF.skeleton) modEl.innerHTML = VF.skeleton.block(true);

  try {
    const [sessions, claims, tutorsRaw] = await Promise.all([
      VF.apiFetch('/sessions'),
      VF.apiFetch('/admin/claims'),
      VF.apiFetch('/users/tutors'),
    ]);

    const tutors = Array.isArray(tutorsRaw)
      ? [...new Map(tutorsRaw.map((t) => [t.id, t])).values()]
      : [];

    const flagged = sessions.filter((s) => s.status === 'flagged');
    const approved = claims.filter((c) => c.status === 'approved');
    const pending = claims.filter((c) => c.status === 'pending_coordinator');
    const paidTotal = approved.reduce((s, c) => s + Number(c.total_amount || 0), 0);
    const pendingTotal = pending.reduce((s, c) => s + Number(c.total_amount || 0), 0);
    const hours = claims.reduce((s, c) => s + Number(c.total_hours || 0), 0);
    const flaggedRateNum = sessions.length ? (flagged.length / sessions.length) * 100 : 0;
    const flaggedRate = sessions.length ? flaggedRateNum.toFixed(flaggedRateNum % 1 ? 1 : 0) : '0';

    const modules = {};
    sessions.forEach((s) => {
      const code = s.module_code || 'Other';
      modules[code] = (modules[code] || 0) + 1;
    });
    const maxMod = Math.max(1, ...Object.values(modules));

    const tutorPayouts = {};
    approved.forEach((c) => {
      const name = `${c.tutor_first_names || ''} ${c.tutor_surname || ''}`.trim() || 'Tutor';
      tutorPayouts[name] = (tutorPayouts[name] || 0) + Number(c.total_amount || 0);
    });
    const payoutEntries = Object.entries(tutorPayouts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxPay = Math.max(1, ...payoutEntries.map((e) => e[1]));

    const now = new Date();
    const periodLong = now.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
    const periodShort = now.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });

    const sub = document.getElementById('analysis-page-sub');
    if (sub) {
      sub.textContent = `Session totals, active tutors and payout summaries — ${periodLong}`;
    }
    const sem = document.getElementById('analysis-hero-sem');
    if (sem) sem.textContent = periodShort;

    const ring = document.getElementById('analysis-ring-arc');
    if (ring) {
      const circ = 264;
      const offset = circ * (1 - Math.min(100, Math.max(0, flaggedRateNum)) / 100);
      ring.setAttribute('stroke-dashoffset', String(offset));
    }

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    setText('analysis-flagged-pct', `${flaggedRate}%`);
    const flaggedSub = document.getElementById('analysis-flagged-sub');
    if (flaggedSub) {
      flaggedSub.innerHTML = `${flagged.length} OF ${sessions.length}<br>SESSIONS`;
    }
    setText('analysis-stat-sessions', String(sessions.length));
    setText('analysis-stat-hours', String(Math.round(hours)));
    setText('analysis-stat-pending', adFormatMoney(pendingTotal));
    setText('analysis-stat-tutors', String(tutors.length));
    setText('analysis-stat-payouts', adFormatMoney(paidTotal));

    const payoutEl = document.getElementById('analysis-payout-chart');
    if (payoutEl) {
      payoutEl.innerHTML = payoutEntries.length
        ? payoutEntries.map(([name, amt]) => `
          <div class="ad-an-bar-row">
            <span class="ad-an-bar-label">${String(name).replace(/</g, '&lt;')}</span>
            <div class="ad-an-bar-wrap"><div class="ad-an-bar-fill" style="width:${Math.round((amt / maxPay) * 100)}%"></div></div>
            <span class="ad-an-bar-val">${adFormatMoney(amt)}</span>
          </div>`).join('')
        : '<div class="ad-analysis-empty">No approved payouts yet.</div>';
    }

    const modEl = document.getElementById('analysis-module-chart');
    if (modEl) {
      const modEntries = Object.entries(modules).sort((a, b) => b[1] - a[1]);
      modEl.innerHTML = modEntries.length
        ? modEntries.map(([code, count]) => `
          <div class="ad-an-bar-row">
            <span class="ad-an-bar-label">${String(code).replace(/</g, '&lt;')}</span>
            <div class="ad-an-bar-wrap"><div class="ad-an-bar-fill" style="width:${Math.round((count / maxMod) * 100)}%"></div></div>
            <span class="ad-an-bar-val">${count}</span>
          </div>`).join('')
        : '<div class="ad-analysis-empty">No session data yet this month.</div>';
    }
  } catch (err) {
    showToast('Could not load analysis');
  }
}

let activeSupportTicketId = null;
let activeSupportResolveTicketId = null;
let activeSupportTicketCache = null;

function supportEscapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function supportPriorityChip(priority) {
  const p = String(priority || 'medium').toLowerCase();
  const label = p.charAt(0).toUpperCase() + p.slice(1);
  if (p === 'high') return `<span class="issue-chip no-confirm">${label}</span>`;
  if (p === 'medium') return `<span class="issue-chip mismatch">${label}</span>`;
  return label;
}

function supportRoleChip(role) {
  if (role === 'tutor') return '<span class="sc new-app">Tutor</span>';
  if (role === 'lecturer') return '<span class="sc review">Lecturer</span>';
  return supportEscapeHtml(role || '—');
}

function supportFormatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function renderSupportThread(replies, containerEl) {
  if (!containerEl) return;
  if (!replies || !replies.length) {
    containerEl.innerHTML = '<div class="um-note">No replies yet.</div>';
    return;
  }
  containerEl.innerHTML = replies.map((r) => {
    const out = r.author_role === 'admin';
    const meta = `${supportEscapeHtml(r.author_name || r.author_role || '—')} · ${supportFormatDate(r.created_at)}`;
    return `<div class="support-message${out ? ' out' : ''}">` +
      `<div class="support-message-meta">${meta}</div>` +
      `<div class="support-message-bubble">${supportEscapeHtml(r.message)}</div>` +
      `</div>`;
  }).join('');
}

function renderSupportTicketTable(tickets) {
  const tbody = document.getElementById('support-tbody');
  const cards = document.getElementById('support-cards');
  if (!tbody) return;

  if (!tickets.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">No support tickets yet.</td></tr>';
    if (cards) {
      cards.innerHTML = `<div class="ad-empty-card"><div class="ad-empty-state">
        <div class="ad-empty-ico"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 2-3 4"/><path d="M12 17h.01"/></svg></div>
        <h3>No support tickets yet</h3>
        <p>Tickets raised by tutors and lecturers will appear here.</p>
      </div></div>`;
    }
    return;
  }

  tbody.innerHTML = tickets.map((t) => {
    const detailsText = supportEscapeHtml(
      (t.details || '').length > 60 ? `${t.details.slice(0, 60)}…` : (t.details || '—')
    );
    const actions = t.status === 'resolved'
      ? '<span class="sc active-u">Resolved</span>'
      : `<button type="button" class="btn-approve" onclick="openSupportRespondModal(${t.id})">Respond</button>` +
        `<button type="button" class="btn-sm" style="margin-left:6px;" onclick="openSupportResolveModal(${t.id})">Resolve</button>`;

    return `<tr data-ticket-id="${t.id}" data-ticket-status="${t.status}">` +
      `<td style="font-family:'DM Mono',monospace;">#${t.id}</td>` +
      `<td>${supportEscapeHtml(t.created_by_name || '—')}</td>` +
      `<td>${supportRoleChip(t.created_by_role)}</td>` +
      `<td>${detailsText}</td>` +
      `<td>${supportPriorityChip(t.priority)}</td>` +
      `<td>${supportFormatDate(t.created_at)}</td>` +
      `<td>${actions}</td>` +
      `</tr>`;
  }).join('');

  if (cards) {
    cards.innerHTML = tickets.map((t) => {
      const openFn = t.status === 'resolved'
        ? `openSupportRespondModal(${t.id})`
        : `openSupportRespondModal(${t.id})`;
      return `<button type="button" class="ad-rec-card" onclick="${openFn}">
        <div class="ad-rec-name">${supportEscapeHtml(t.created_by_name || 'Ticket #' + t.id)}</div>
        <div class="ad-rec-sub">${supportEscapeHtml(t.subject || t.details || '—')}</div>
        <div class="ad-rec-grid">
          <div class="item"><div class="k">#${t.id}</div><div class="l">Ticket</div></div>
          <div class="item"><div class="k">${supportEscapeHtml(t.priority || '—')}</div><div class="l">Priority</div></div>
          <div class="item"><div class="k">${supportFormatDate(t.created_at)}</div><div class="l">Date</div></div>
        </div>
      </button>`;
    }).join('');
  }
}

async function loadSupportTickets() {
  const tbody = document.getElementById('support-tbody');
  const cards = document.getElementById('support-cards');
  if (tbody && VF.skeleton) tbody.innerHTML = VF.skeleton.tbody(7, 5);
  if (cards && VF.skeleton) cards.innerHTML = VF.skeleton.claimCards(4);

  try {
    const tickets = await VF.apiFetch('/support/tickets');
    renderSupportTicketTable(tickets);
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">Could not load support tickets.</td></tr>';
    }
    const msg = err.errors ? err.errors[0] : 'Could not load support tickets';
    if (typeof showToast === 'function') showToast(msg);
    else VF.toast(msg, 'err');
  }
}

async function openSupportRespondModal(ticketId) {
  try {
    const ticket = await VF.apiFetch(`/support/tickets/${ticketId}`);
    activeSupportTicketId = ticketId;
    activeSupportTicketCache = ticket;

    setText('#support-respond-title', `Ticket #${ticket.id}`);
    setText('#support-respond-from', ticket.created_by_name || '—');
    setText('#support-respond-role', ticket.created_by_role || '—');
    setText('#support-respond-subject', ticket.subject || '—');
    setText('#support-respond-priority', ticket.priority || '—');
    const detailsEl = document.getElementById('support-respond-details');
    if (detailsEl) detailsEl.textContent = ticket.details || '—';
    const msgEl = document.getElementById('support-respond-message');
    if (msgEl) msgEl.value = '';
    renderSupportThread(ticket.replies, document.getElementById('support-respond-history'));

    document.getElementById('support-respond-overlay')?.classList.add('open');
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast(err.errors ? err.errors[0] : 'Could not open ticket');
    }
  }
}

function closeSupportRespondModal(e) {
  if (e && e.target !== document.getElementById('support-respond-overlay')) return;
  document.getElementById('support-respond-overlay')?.classList.remove('open');
  activeSupportTicketId = null;
}

async function sendSupportReply() {
  if (!activeSupportTicketId) return;
  const message = document.getElementById('support-respond-message')?.value.trim();
  if (!message) {
    document.getElementById('support-respond-message')?.focus();
    return;
  }

  try {
    const reply = await VF.apiFetch(`/support/tickets/${activeSupportTicketId}/reply`, {
      method: 'POST',
      body: { message },
    });

    if (!activeSupportTicketCache) {
      activeSupportTicketCache = { replies: [] };
    }
    if (!activeSupportTicketCache.replies) {
      activeSupportTicketCache.replies = [];
    }
    activeSupportTicketCache.replies.push(reply);

    renderSupportThread(
      activeSupportTicketCache.replies,
      document.getElementById('support-respond-history')
    );
    document.getElementById('support-respond-message').value = '';
    if (typeof showToast === 'function') showToast('Reply sent');
    loadSupportTickets();
    loadDashboardOverview();
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast(err.errors ? err.errors[0] : 'Could not send reply');
    }
  }
}

async function openSupportResolveModal(ticketId) {
  try {
    const ticket = await VF.apiFetch(`/support/tickets/${ticketId}`);
    activeSupportResolveTicketId = ticketId;
    activeSupportTicketCache = ticket;

    setText('#support-resolve-title', `Resolve Ticket #${ticket.id}`);
    const summaryEl = document.getElementById('support-resolve-summary');
    if (summaryEl) {
      summaryEl.textContent = `${ticket.created_by_name || '—'} · ${ticket.subject || '—'} · ${ticket.priority || '—'}`;
    }
    const noteEl = document.getElementById('support-resolve-note');
    if (noteEl) noteEl.value = '';
    renderSupportThread(ticket.replies, document.getElementById('support-resolve-history'));

    document.getElementById('support-resolve-overlay')?.classList.add('open');
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast(err.errors ? err.errors[0] : 'Could not open ticket');
    }
  }
}

function closeSupportResolveModal(e) {
  if (e && e.target !== document.getElementById('support-resolve-overlay')) return;
  document.getElementById('support-resolve-overlay')?.classList.remove('open');
  activeSupportResolveTicketId = null;
}

async function confirmSupportResolution() {
  if (!activeSupportResolveTicketId) return;
  const ticketId = activeSupportResolveTicketId;
  const note = document.getElementById('support-resolve-note')?.value.trim() || '';

  try {
    await VF.apiFetch(`/support/tickets/${ticketId}/resolve`, {
      method: 'PATCH',
      body: { note: note || undefined },
    });
    closeSupportResolveModal();
    loadSupportTickets();
    loadDashboardOverview();
    if (typeof showToast === 'function') {
      showToast(`Ticket #${ticketId} resolved`);
    }
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast(err.errors ? err.errors[0] : 'Could not resolve ticket');
    }
  }
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function updateNavBadges() {
  const refBadge = document.getElementById('nav-referrals-badge');
  const claimsBadge = document.getElementById('nav-claims-badge');
  const flaggedBadge = document.getElementById('nav-flagged-badge');
  const msgBadge = document.querySelector('#nav-messages-admin .nav-badge');

  const pendingClaims = adminClaimsCache.filter((c) => c.status === 'pending_coordinator').length;
  const flagged = Object.keys(FLAGGED_SESSIONS).length;

  if (claimsBadge) {
    claimsBadge.textContent = pendingClaims ? String(pendingClaims) : '';
    claimsBadge.style.display = pendingClaims ? '' : 'none';
  }
  if (flaggedBadge) {
    flaggedBadge.textContent = flagged ? String(flagged) : '';
    flaggedBadge.style.display = flagged ? '' : 'none';
  }
  if (typeof refreshUnreadBadge === 'function') refreshUnreadBadge();
}

async function hydrateAdminHero() {
  try {
    const user = await VF.fetchCurrentUser();
    const hero = document.querySelector('#page-dashboard .hero h1');
    const sub = document.querySelector('#page-dashboard .hero p');
    const name = `${user.first_names || ''} ${user.surname || ''}`.trim();
    const parts = name.split(/\s+/).filter(Boolean);
    if (hero) {
      const em = parts.length > 1 ? parts[parts.length - 1] : name;
      hero.innerHTML = `${parts[0] || 'Admin'} <em>${em}</em>`;
    }
    const period = new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
    if (sub) {
      sub.textContent = `Coordinator · Student Employment Office · ${period}`;
    }
    const hubName = document.getElementById('ad-hub-name');
    if (hubName) hubName.textContent = 'VeriFlow Coordinator';
    const av = document.getElementById('ad-hub-avatar');
    if (av) {
      av.textContent = 'VF';
    }
    const hubSub = document.getElementById('ad-hub-sub');
    if (hubSub) {
      const shortPeriod = new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
      hubSub.textContent = `Coordinator · ${shortPeriod}`;
    }
  } catch (_) { /* optional */ }
}

function updateAdminMobileHub(counts) {
  const c = counts || {};
  const apps = Number(c.openApps) || 0;
  const claims = Number(c.pendingClaims) || 0;
  const refs = Number(c.pendingReferrals) || 0;
  const flagged = Number(c.flagged) || 0;
  const support = Number(c.openSupport) || 0;
  const postings = Number(c.openPostings) || 0;
  const total = apps + claims + refs + flagged;

  const setBadge = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (value > 0) {
      el.textContent = String(value);
      el.hidden = false;
      el.removeAttribute('hidden');
      el.style.display = '';
    } else {
      el.textContent = '';
      el.hidden = true;
      el.setAttribute('hidden', '');
    }
  };
  setBadge('ad-hub-apps-badge', apps);
  setBadge('ad-hub-claims-badge', claims);
  setBadge('ad-hub-refs-badge', refs);
  setBadge('ad-hub-flagged-badge', flagged);
  setBadge('ad-hub-support-badge', support);
  setBadge('ad-hub-postings-badge', postings);
  setBadge('bnav-apps-badge', apps);
  setBadge('bnav-claims-badge', claims);

  const titleEl = document.getElementById('ad-hub-next-title');
  const metaEl = document.getElementById('ad-hub-next-meta');
  const heroBtn = document.getElementById('ad-hub-hero');
  if (!titleEl || !metaEl) return;

  let target = 'applications';
  let title = 'Queues are clear';
  let meta = 'Check messages or support if needed.';

  if (flagged > 0) {
    target = 'flagged';
    title = `${flagged} flagged session${flagged === 1 ? '' : 's'}`;
    meta = 'Needs dispute resolution';
  } else if (claims > 0) {
    target = 'claims';
    title = `${claims} claim${claims === 1 ? '' : 's'} to approve`;
    meta = 'Before finance handoff';
  } else if (refs > 0) {
    target = 'referrals';
    title = `${refs} referral${refs === 1 ? '' : 's'} pending`;
    meta = 'Awaiting countersign';
  } else if (apps > 0) {
    target = 'applications';
    title = `${apps} application${apps === 1 ? '' : 's'} open`;
    meta = 'Awaiting review';
  } else if (support > 0) {
    target = 'support';
    title = `${support} support ticket${support === 1 ? '' : 's'}`;
    meta = 'Needs a response';
  } else if (postings > 0) {
    target = 'postings';
    title = `${postings} open posting${postings === 1 ? '' : 's'}`;
    meta = 'Active tutor positions';
  } else if (total === 0) {
    title = 'Queues are clear';
    meta = 'Check messages or support if needed.';
  }

  titleEl.textContent = title;
  metaEl.textContent = meta;
  if (heroBtn) {
    heroBtn.onclick = () => {
      const nav = document.getElementById(`nav-${target}`)
        || document.getElementById(`nav-${target === 'messages' ? 'messages-admin' : target}`);
      if (typeof showPage === 'function') showPage(target, nav);
    };
  }
}

window.updateAdminMobileHub = updateAdminMobileHub;

// ── User Management (lecturers & tutors) ─────────────────────
window.LECTURERS = window.LECTURERS || {};
window.TUTORS = window.TUTORS || {};
let activeConfirmAction = null;
let activeEditLecturerId = null;

function adToast(msg, isError) {
  if (typeof showToast === 'function') showToast(msg);
  else if (typeof VF !== 'undefined' && VF.toast) VF.toast(msg, isError ? 'err' : 'ok');
}

function getManagedUser(role, id) {
  const n = Number(id);
  const store = role === 'lecturer' ? window.LECTURERS : window.TUTORS;
  return store[n] || store[id] || null;
}

async function loadLecturers() {
  const body = document.getElementById('lecturers-body');
  const cards = document.getElementById('lecturers-cards');
  if (body && VF.skeleton) body.innerHTML = VF.skeleton.tbody(5, 5);
  if (cards && VF.skeleton) cards.innerHTML = VF.skeleton.cards(4);

  try {
    const lecturers = await VF.apiFetch('/users/lecturers');
    window.LECTURERS = {};
    lecturers.forEach((l) => { window.LECTURERS[l.id] = l; });

    if (body) {
      body.innerHTML = lecturers.length
        ? lecturers.map(renderLecturerRow).join('')
        : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px">No lecturers yet.</td></tr>';
    }
    if (cards) {
      if (!lecturers.length) {
        cards.innerHTML = `<div class="ad-empty-card"><div class="ad-empty-state"><h3>No lecturers yet</h3><p>Add a lecturer to get started.</p></div></div>`;
      } else {
        const n = lecturers.length;
        cards.innerHTML =
          `<div class="ad-list-count">${n} lecturer${n === 1 ? '' : 's'}</div>` +
          lecturers.map(renderLecturerCard).join('');
      }
    }
  } catch (err) {
    adToast(err.errors ? err.errors[0] : 'Could not load lecturers.', true);
  }
}

function userInitials(firstNames, surname) {
  const a = String(firstNames || '').trim().charAt(0);
  const b = String(surname || '').trim().charAt(0);
  return ((a + b) || '?').toUpperCase();
}

function renderLecturerCard(l) {
  const name = `${l.first_names} ${l.surname}`;
  const status = l.temp_password_flag ? 'Temp password' : 'Active';
  const firstMod = ((l.modules || [])[0] && (l.modules || [])[0].code) || '—';
  const initials = userInitials(l.first_names, l.surname);
  const statusClass = l.temp_password_flag ? 'neutral' : 'status';
  return `<button type="button" class="ad-compact-row" onclick="openUserActionSheet('lecturer', ${l.id})">
    <div class="ad-cr-avatar">${adEscapeHtml(initials)}</div>
    <div class="ad-cr-info">
      <div class="ad-cr-name">${adEscapeHtml(name)}</div>
      <div class="ad-cr-email">${adEscapeHtml(l.email)}</div>
      <div class="ad-cr-meta">
        <span class="ad-mini-chip">${adEscapeHtml(firstMod)}</span>
        <span class="ad-mini-chip ${statusClass}">${status}</span>
      </div>
    </div>
    <span class="ad-more-btn" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></span>
  </button>`;
}

function renderLecturerRow(l) {
  const moduleText = (l.modules || []).map((m) => m.code).join(', ') || '—';
  const name = `${l.first_names} ${l.surname}`;
  return `
    <tr data-user-id="${l.id}">
      <td style="font-weight:600;color:var(--text)">${adEscapeHtml(name)}</td>
      <td style="color:var(--muted)">${adEscapeHtml(l.email)}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">${adEscapeHtml(moduleText)}</td>
      <td>${l.temp_password_flag ? '<span class="sc inactive-u">Temp password</span>' : '<span class="sc active-u">Active</span>'}</td>
      <td>
        <button type="button" class="btn-sm" onclick="openUserMessageModal(${l.id}, ${JSON.stringify(name)})">Message</button>
        <button type="button" class="btn-sm" onclick="openEditModulesModal(${l.id})">Edit Modules</button>
        <button type="button" class="btn-sm" onclick="confirmResetPassword('lecturer', ${l.id})">Reset pwd</button>
        <button type="button" class="btn-sm danger" onclick="confirmDeleteUser('lecturer', ${l.id})">Deactivate</button>
      </td>
    </tr>`;
}

async function loadTutors() {
  const body = document.getElementById('tutors-body');
  const cards = document.getElementById('tutors-cards');
  if (body && VF.skeleton) body.innerHTML = VF.skeleton.tbody(6, 5);
  if (cards && VF.skeleton) cards.innerHTML = VF.skeleton.cards(4);

  try {
    const tutors = await VF.apiFetch('/users/tutors');
    window.TUTORS = {};
    tutors.forEach((t) => { window.TUTORS[t.id] = t; });

    if (body) {
      body.innerHTML = tutors.length
        ? tutors.map(renderTutorRow).join('')
        : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">No approved tutors yet.</td></tr>';
    }
    if (cards) {
      if (!tutors.length) {
        cards.innerHTML = `<div class="ad-empty-card"><div class="ad-empty-state"><h3>No tutors yet</h3><p>Approved tutors will appear here.</p></div></div>`;
      } else {
        const n = tutors.length;
        cards.innerHTML =
          `<div class="ad-list-count">${n} tutor${n === 1 ? '' : 's'}</div>` +
          tutors.map(renderTutorCard).join('');
      }
    }
  } catch (err) {
    adToast(err.errors ? err.errors[0] : 'Could not load tutors.', true);
  }
}

function renderTutorCard(t) {
  const name = `${t.first_names} ${t.surname}`;
  const initials = userInitials(t.first_names, t.surname);
  const mod = t.module_code || t.module_name || '—';
  const status = t.temp_password_flag ? 'Temp password' : 'Active';
  const statusClass = t.temp_password_flag ? 'neutral' : 'status';
  return `<button type="button" class="ad-compact-row" onclick="openUserActionSheet('tutor', ${t.id})">
    <div class="ad-cr-avatar">${adEscapeHtml(initials)}</div>
    <div class="ad-cr-info">
      <div class="ad-cr-name">${adEscapeHtml(name)}</div>
      <div class="ad-cr-email">${adEscapeHtml(t.email || t.student_number || '—')}</div>
      <div class="ad-cr-meta">
        <span class="ad-mini-chip">${adEscapeHtml(mod)}</span>
        <span class="ad-mini-chip ${statusClass}">${status}</span>
      </div>
    </div>
    <span class="ad-more-btn" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg></span>
  </button>`;
}

let activeUserSheet = null;

function openUserActionSheet(role, id) {
  const user = getManagedUser(role, id);
  if (!user) {
    adToast('User not found — refresh the page and try again.', true);
    return;
  }
  activeUserSheet = { role, id: Number(id) };
  const name = `${user.first_names} ${user.surname}`;
  document.getElementById('ad-user-sheet-name').textContent = name;
  document.getElementById('ad-user-sheet-avatar').textContent = userInitials(user.first_names, user.surname);
  document.getElementById('ad-user-sheet-role').textContent =
    role.charAt(0).toUpperCase() + role.slice(1);
  const editBtn = document.getElementById('ad-user-sheet-edit-modules');
  if (editBtn) editBtn.hidden = role !== 'lecturer';
  document.getElementById('ad-user-sheet-overlay').classList.add('open');
}

function closeUserActionSheet(e) {
  if (e && e.target !== document.getElementById('ad-user-sheet-overlay')) return;
  document.getElementById('ad-user-sheet-overlay')?.classList.remove('open');
  activeUserSheet = null;
}

function userSheetMessage() {
  if (!activeUserSheet) return;
  const { role, id } = activeUserSheet;
  const user = getManagedUser(role, id);
  const name = user ? `${user.first_names} ${user.surname}` : 'User';
  closeUserActionSheet();
  openUserMessageModal(id, name);
}

function userSheetEditModules() {
  if (!activeUserSheet || activeUserSheet.role !== 'lecturer') return;
  const id = activeUserSheet.id;
  closeUserActionSheet();
  openEditModulesModal(id);
}

function userSheetResetPassword() {
  if (!activeUserSheet) return;
  const { role, id } = activeUserSheet;
  closeUserActionSheet();
  confirmResetPassword(role, id);
}

function userSheetDeactivate() {
  if (!activeUserSheet) return;
  const { role, id } = activeUserSheet;
  closeUserActionSheet();
  confirmDeleteUser(role, id);
}

function renderTutorRow(t) {
  const respLabel = t.responsibility_level
    ? t.responsibility_level.charAt(0).toUpperCase() + t.responsibility_level.slice(1)
    : '—';
  const lecturerName = t.lecturer_first_names
    ? `${t.lecturer_first_names} ${t.lecturer_surname}`
    : '<span style="color:var(--muted)">Not assigned</span>';
  const name = `${t.first_names} ${t.surname}`;
  return `
    <tr data-user-id="${t.id}">
      <td style="font-weight:600;color:var(--text)">${adEscapeHtml(name)}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">${adEscapeHtml(t.student_number || '—')}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">${adEscapeHtml(t.module_name || '—')}</td>
      <td style="color:var(--text)">${lecturerName}</td>
      <td>${adEscapeHtml(respLabel)}</td>
      <td>
        <button type="button" class="btn-sm" onclick="openUserMessageModal(${t.id}, ${JSON.stringify(name)})">Message</button>
        <button type="button" class="btn-sm" onclick="confirmResetPassword('tutor', ${t.id})">Reset pwd</button>
        <button type="button" class="btn-sm danger" onclick="confirmDeleteUser('tutor', ${t.id})">Deactivate</button>
      </td>
    </tr>`;
}

function showCredentialModal(email, tempPassword) {
  document.getElementById('credential-email').textContent = email;
  document.getElementById('credential-password').textContent = tempPassword;
  document.getElementById('credential-overlay').classList.add('open');
}

function handleCredentialResult(result, { successMessage, fallbackMessage } = {}) {
  if (result.emailSent) {
    adToast(successMessage || `Login credentials emailed to ${result.email}`);
    return;
  }
  if (result.tempPassword) {
    showCredentialModal(result.email, result.tempPassword);
    adToast(
      fallbackMessage || 'Email could not be sent — share the password manually.',
      !fallbackMessage
    );
    return;
  }
  if (successMessage) {
    adToast(successMessage);
  }
}

function closeCredentialModal(e) {
  if (e && e.target !== document.getElementById('credential-overlay')) return;
  document.getElementById('credential-overlay')?.classList.remove('open');
}

function openConfirmModal(config) {
  activeConfirmAction = config.action;
  document.getElementById('confirm-eyebrow').textContent = config.eyebrow || 'Confirmation';
  document.getElementById('confirm-title').textContent = config.title;
  document.getElementById('confirm-message').textContent = config.message;
  document.getElementById('confirm-action-btn').textContent = config.buttonLabel || 'Confirm';
  document.getElementById('confirm-overlay').classList.add('open');
}

function closeConfirmModal(e) {
  if (e && e.target !== document.getElementById('confirm-overlay')) return;
  document.getElementById('confirm-overlay')?.classList.remove('open');
  activeConfirmAction = null;
}

function runConfirmAction() {
  if (activeConfirmAction) activeConfirmAction();
  closeConfirmModal();
}

function confirmResetPassword(role, id) {
  const user = getManagedUser(role, id);
  if (!user) {
    adToast('User not found — refresh the page and try again.', true);
    return;
  }
  const name = `${user.first_names} ${user.surname}`;
  openConfirmModal({
    eyebrow: 'Password Reset',
    title: name,
    message: `Generate a new temporary password for ${name}? Their current password will stop working immediately.`,
    buttonLabel: 'Generate',
    action: async () => {
      try {
        const result = await VF.apiFetch(`/users/${role}/${id}/reset-password`, { method: 'PATCH' });
        handleCredentialResult(result, {
          successMessage: `New password emailed to ${result.email}`,
        });
        if (role === 'lecturer') loadLecturers();
        else loadTutors();
      } catch (err) {
        adToast(err.errors ? err.errors[0] : 'Could not reset password.', true);
      }
    },
  });
}

function confirmDeleteUser(role, id) {
  const user = getManagedUser(role, id);
  if (!user) {
    adToast('User not found — refresh the page and try again.', true);
    return;
  }
  const name = `${user.first_names} ${user.surname}`;
  openConfirmModal({
    eyebrow: 'Deactivate User',
    title: name,
    message: `This permanently removes ${name}'s account and all related records. This cannot be undone. Continue?`,
    buttonLabel: 'Deactivate',
    action: async () => {
      try {
        await VF.apiFetch(`/users/${role}/${id}`, { method: 'DELETE' });
        adToast(`${name} removed`);
        if (role === 'lecturer') {
          loadLecturers();
        } else {
          loadTutors();
          if (typeof loadApplications === 'function') loadApplications();
          if (typeof loadReferrals === 'function') loadReferrals();
          if (typeof refreshDashboardPanels === 'function') refreshDashboardPanels();
        }
      } catch (err) {
        adToast(err.errors ? err.errors[0] : 'Could not remove user.', true);
      }
    },
  });
}

function openEditModulesModal(lecturerId) {
  const lecturer = getManagedUser('lecturer', lecturerId);
  if (!lecturer) {
    adToast('Lecturer not found — refresh the page and try again.', true);
    return;
  }
  activeEditLecturerId = Number(lecturerId);
  document.getElementById('edit-modules-lecturer-name').textContent =
    `${lecturer.first_names} ${lecturer.surname}`;
  document.getElementById('new-module-code').value = '';
  document.getElementById('new-module-name').value = '';
  renderCurrentModulesList(lecturer);
  document.getElementById('edit-modules-overlay').classList.add('open');
}

function renderCurrentModulesList(lecturer) {
  const container = document.getElementById('edit-modules-current');
  const modules = lecturer.modules || [];
  container.innerHTML = modules.length
    ? modules.map((m) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;">
          <span style="font-size:12px;color:var(--text);">
            <span style="font-family:'DM Mono',monospace;">${adEscapeHtml(m.code)}</span>
            — ${adEscapeHtml(m.name)}
            <span style="color:var(--muted);font-size:11px;">(${m.course === 'BICT — Bachelor of ICT' ? 'BICT' : 'DICT'})</span>
          </span>
          <button type="button" class="btn-sm danger" data-code="${adEscapeHtml(m.code)}" data-course="${adEscapeHtml(m.course)}" onclick="removeModuleFromLecturer(this)">Remove</button>
        </div>`).join('')
    : '<div style="font-size:12px;color:var(--muted)">No modules assigned yet.</div>';
}

function closeEditModulesModal(e) {
  if (e && e.target !== document.getElementById('edit-modules-overlay')) return;
  document.getElementById('edit-modules-overlay')?.classList.remove('open');
  activeEditLecturerId = null;
}

function populateEditModuleNameDropdown() {
  const course = document.getElementById('new-module-course').value;
  const nameSel = document.getElementById('new-module-name');
  nameSel.innerHTML = '<option value="">Select module…</option>';
  document.getElementById('new-module-code').value = '';
  if (!course) { nameSel.disabled = true; return; }
  if (typeof curriculumModulesForCourse === 'function') {
    curriculumModulesForCourse(course).forEach((m) => {
      nameSel.innerHTML += typeof moduleSelectOptionHtml === 'function'
        ? moduleSelectOptionHtml(m)
        : `<option value="${adEscapeHtml(m.name)}">${adEscapeHtml(m.name)}</option>`;
    });
  }
  nameSel.disabled = false;
}

async function addModuleToLecturer() {
  const course = document.getElementById('new-module-course').value.trim();
  const nameSel = document.getElementById('new-module-name');
  const name = nameSel.value.trim();
  const code = (typeof readModuleCodeFromSelect === 'function'
    ? readModuleCodeFromSelect(nameSel)
    : '') || document.getElementById('new-module-code').value.trim();
  if (!course) { adToast('Select a course', true); return; }
  if (!name) { adToast('Select a module name', true); return; }
  if (!code) { adToast('Enter the module code', true); return; }
  if (!activeEditLecturerId) return;

  try {
    await VF.apiFetch(`/users/lecturer/${activeEditLecturerId}/modules`, {
      method: 'POST',
      body: { course, code, name },
    });
    await loadLecturers();
    const refreshed = window.LECTURERS[activeEditLecturerId];
    renderCurrentModulesList(refreshed);
    document.getElementById('new-module-course').value = '';
    document.getElementById('new-module-name').innerHTML = '<option value="">Select course first…</option>';
    document.getElementById('new-module-name').disabled = true;
    document.getElementById('new-module-code').value = '';
    adToast('Module added');
  } catch (err) {
    adToast(err.errors ? err.errors[0] : 'Could not add module.', true);
  }
}

async function removeModuleFromLecturer(btn) {
  if (!activeEditLecturerId || !btn) return;
  const code = btn.dataset.code;
  const course = btn.dataset.course;
  try {
    await VF.apiFetch(
      `/users/lecturer/${activeEditLecturerId}/modules/${encodeURIComponent(code)}?course=${encodeURIComponent(course)}`,
      { method: 'DELETE' }
    );
    await loadLecturers();
    const refreshed = window.LECTURERS[activeEditLecturerId];
    renderCurrentModulesList(refreshed);
    adToast('Module removed');
  } catch (err) {
    adToast(err.errors ? err.errors[0] : 'Could not remove module.', true);
  }
}

let broadcastRecipients = [];
let acAllRecipients = [];
let userMessageRecipientId = null;
let userMessageRecipientName = '';

function renderBroadcastChips(tutors, lecturers) {
  const wrap = document.getElementById('ma-recipients');
  const hint = document.getElementById('ma-hint');

  broadcastRecipients = [
    ...tutors.map((t) => ({
      id: t.id,
      name: `${t.first_names} ${t.surname}`,
      role: 'tutor',
    })),
    ...lecturers.map((l) => ({
      id: l.id,
      name: `${l.first_names} ${l.surname}`,
      role: 'lecturer',
    })),
  ];

  if (wrap) {
    wrap.innerHTML = broadcastRecipients.map((r) => {
      const inits = VF.initials(
        r.name.split(' ')[0],
        r.name.split(' ').slice(1).join(' ')
      );
      const label = `${inits} · ${r.name}`;
      const style = r.role === 'tutor'
        ? "font-size:11px;font-family:'DM Mono',monospace;background:var(--faint);color:var(--green);padding:3px 10px;border-radius:5px;border:1px solid rgba(92,200,138,.2);"
        : "font-size:11px;font-family:'DM Mono',monospace;background:var(--faint);color:var(--accent);padding:3px 10px;border-radius:5px;border:1px solid var(--border-hi);";
      return `<span style="${style}">${adEscapeHtml(label)}</span>`;
    }).join('');
  }

  const xt = tutors.length;
  const yl = lecturers.length;
  if (hint) {
    if (xt && !yl) {
      hint.textContent = `Sending to ${xt} tutor${xt === 1 ? '' : 's'} via VeriFlow`;
    } else if (yl && !xt) {
      hint.textContent = `Sending to ${yl} lecturer${yl === 1 ? '' : 's'} via VeriFlow`;
    } else {
      hint.textContent = `Sending to ${xt} tutor${xt === 1 ? '' : 's'} and ${yl} lecturer${yl === 1 ? '' : 's'} via VeriFlow`;
    }
  }
}

async function openMsgAll() {
  document.getElementById('ma-subject').value = '';
  document.getElementById('ma-body').value = '';
  broadcastRecipients = [];

  const nameEl = document.querySelector('#ma-modal .modal-name');
  const toEl = document.querySelector('#ma-modal .modal-to');
  if (nameEl) nameEl.textContent = 'All Tutors and Lecturers';
  if (toEl) toEl.textContent = 'Broadcasting to';

  const wrap = document.getElementById('ma-recipients');
  if (wrap) {
    wrap.innerHTML = '<span style="font-size:12px;color:var(--muted)">Loading recipients…</span>';
  }

  document.getElementById('ma-overlay')?.classList.add('open');
  setTimeout(() => document.getElementById('ma-subject')?.focus(), 300);

  try {
    const [tutors, lecturers] = await Promise.all([
      VF.apiFetch('/users/tutors'),
      VF.apiFetch('/users/lecturers'),
    ]);
    renderBroadcastChips(tutors, lecturers);
  } catch (err) {
    showToast('Could not load recipients');
    closeMsgAll();
  }
}

function openAdminGroupBroadcast(group) {
  const role = group === 'lecturer' ? 'lecturer' : 'tutor';
  const contacts = typeof getAdminMessageGroupContacts === 'function'
    ? getAdminMessageGroupContacts(role)
    : [];

  document.getElementById('ma-subject').value = '';
  document.getElementById('ma-body').value = '';

  const nameEl = document.querySelector('#ma-modal .modal-name');
  const toEl = document.querySelector('#ma-modal .modal-to');
  if (nameEl) nameEl.textContent = role === 'tutor' ? 'All Tutors' : 'All Lecturers';
  if (toEl) toEl.textContent = 'Message all';

  const tutors = role === 'tutor'
    ? contacts.map((c) => ({
      id: c.id,
      first_names: (c.name || '').split(/\s+/)[0] || '',
      surname: (c.name || '').split(/\s+/).slice(1).join(' ') || '',
    }))
    : [];
  const lecturers = role === 'lecturer'
    ? contacts.map((c) => ({
      id: c.id,
      first_names: (c.name || '').split(/\s+/)[0] || '',
      surname: (c.name || '').split(/\s+/).slice(1).join(' ') || '',
    }))
    : [];

  renderBroadcastChips(tutors, lecturers);

  if (!broadcastRecipients.length) {
    showToast(role === 'tutor' ? 'No tutors to message' : 'No lecturers to message');
    return;
  }

  document.getElementById('ma-overlay')?.classList.add('open');
  setTimeout(() => document.getElementById('ma-subject')?.focus(), 300);
}

async function sendMsgAll() {
  const subject = document.getElementById('ma-subject').value.trim();
  const body = document.getElementById('ma-body').value.trim();

  if (!body) {
    const field = document.getElementById('ma-body');
    field.style.borderColor = 'var(--red)';
    field.focus();
    setTimeout(() => { field.style.borderColor = ''; }, 1800);
    return;
  }

  if (!broadcastRecipients.length) {
    showToast('No recipients loaded');
    return;
  }

  const btn = document.querySelector('#ma-modal .modal-send');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending…';
  }

  let sent = 0;
  let failed = 0;

  for (const recipient of broadcastRecipients) {
    try {
      await VF.apiFetch('/messages/threads', {
        method: 'POST',
        body: {
          recipientId: recipient.id,
          subject: subject || 'Message from Student Employment Office',
          body,
        },
      });
      sent++;
    } catch (err) {
      failed++;
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Send Message';
  }

  closeMsgAll();

  if (failed === 0) {
    showToast(`Message sent to ${sent} recipient${sent === 1 ? '' : 's'}`);
  } else {
    showToast(`Sent to ${sent} · ${failed} failed`);
  }

  if (typeof loadMessageThreads === 'function') {
    loadMessageThreads();
  }
}

function closeMsgAll() {
  document.getElementById('ma-overlay')?.classList.remove('open');
}

function maCloseOutside(e) {
  if (e.target === document.getElementById('ma-overlay')) closeMsgAll();
}

function openUserMessageModal(userId, userName) {
  userMessageRecipientId = userId;
  userMessageRecipientName = userName;
  document.getElementById('user-message-name').textContent = userName;
  document.getElementById('user-message-subject').value = '';
  document.getElementById('user-message-body').value = '';
  document.getElementById('user-message-overlay').classList.add('open');
}

function closeUserMessageModal(e) {
  if (e && e.target !== document.getElementById('user-message-overlay')) return;
  document.getElementById('user-message-overlay')?.classList.remove('open');
}

async function sendUserMessage() {
  const subject = document.getElementById('user-message-subject').value.trim();
  const body = document.getElementById('user-message-body').value.trim();

  if (!body) {
    document.getElementById('user-message-body').focus();
    return;
  }

  if (!userMessageRecipientId) {
    showToast('No recipient selected');
    return;
  }

  const btn = document.querySelector('#user-message-modal .btn-primary');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending…';
  }

  try {
    await VF.apiFetch('/messages/threads', {
      method: 'POST',
      body: {
        recipientId: userMessageRecipientId,
        subject: subject || 'Message from Student Employment Office',
        body,
      },
    });

    closeUserMessageModal();
    showToast(`Message sent to ${userMessageRecipientName}`);

    if (typeof loadMessageThreads === 'function') {
      loadMessageThreads();
    }
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not send message');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  }
}

async function openAdminCompose() {
  const select = document.getElementById('ac-recipient');
  if (select) select.innerHTML = '<option value="">Loading…</option>';

  document.getElementById('ac-subject').value = '';
  document.getElementById('ac-body').value = '';
  document.getElementById('ac-overlay')?.classList.add('open');

  try {
    const [tutors, lecturers] = await Promise.all([
      VF.apiFetch('/users/tutors'),
      VF.apiFetch('/users/lecturers'),
    ]);

    acAllRecipients = [
      ...tutors.map((t) => ({
        id: t.id,
        name: `${t.first_names} ${t.surname}`,
        role: 'tutor',
      })),
      ...lecturers.map((l) => ({
        id: l.id,
        name: `${l.first_names} ${l.surname}`,
        role: 'lecturer',
      })),
    ];

    if (select) {
      select.innerHTML =
        '<option value="">Select recipient…</option>' +
        acAllRecipients.map((r) =>
          `<option value="${r.id}">${adEscapeHtml(r.name)} (${r.role})</option>`
        ).join('');
    }
  } catch (err) {
    showToast('Could not load recipients');
    closeAdminCompose();
  }
}

function closeAdminCompose() {
  document.getElementById('ac-overlay')?.classList.remove('open');
}

function acCloseOutside(e) {
  if (e.target === document.getElementById('ac-overlay')) closeAdminCompose();
}

async function sendAdminCompose() {
  const recipientId = document.getElementById('ac-recipient').value;
  const subject = document.getElementById('ac-subject').value.trim();
  const body = document.getElementById('ac-body').value.trim();

  if (!recipientId) {
    document.getElementById('ac-recipient').focus();
    return;
  }
  if (!body) {
    document.getElementById('ac-body').focus();
    return;
  }

  const btn = document.querySelector('#ac-modal .btn-primary');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending…';
  }

  try {
    await VF.apiFetch('/messages/threads', {
      method: 'POST',
      body: {
        recipientId: Number(recipientId),
        subject: subject || 'Message from Student Employment Office',
        body,
      },
    });

    const recipient = acAllRecipients.find(
      (r) => r.id === Number(recipientId)
    );
    closeAdminCompose();
    showToast(`Message sent to ${recipient ? recipient.name : 'recipient'}`);

    if (typeof loadMessageThreads === 'function') {
      loadMessageThreads();
    }
  } catch (err) {
    showToast(err.errors ? err.errors[0] : 'Could not send message');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  }
}

async function initAdminApiDashboard() {
  window.MESSAGING_ROLE = 'admin';
  window.currentModuleCode = null;

  try {
    // Hub-only bootstrap. Other pages fetch on first open via showPage().
    await Promise.all([hydrateAdminHero(), loadDashboardOverview()]);
    if (typeof refreshUnreadBadge === 'function') refreshUnreadBadge();
  } catch (err) {
    console.error(err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'Could not load admin dashboard');
    }
  }
}

window.loadClaims = loadClaims;
window.openClaimDetail = openClaimDetail;
window.approveClaim = approveClaim;
window.rejectClaim = rejectClaim;
window.openClaimReturnModal = openClaimReturnModal;
window.closeClaimReturnModal = closeClaimReturnModal;
window.claimReturnCloseOutside = claimReturnCloseOutside;
window.fillClaimReturnReason = fillClaimReturnReason;
window.confirmClaimReturn = confirmClaimReturn;
window.loadFlaggedSessions = loadFlaggedSessions;
window.investigateFlaggedSession = investigateFlaggedSession;
window.resolveFlaggedSession = resolveFlaggedSession;
window.openFlagModal = openFlagModal;
window.openResolveModal = openResolveModal;
window.confirmResolution = confirmResolution;
window.sendFlagMessage = sendFlagMessage;
window.markFlagInvestigating = markFlagInvestigating;
window.loadDashboardOverview = loadDashboardOverview;
window.loadAnalysis = loadAnalysis;
window.loadSupportTickets = loadSupportTickets;
window.openSupportRespondModal = openSupportRespondModal;
window.closeSupportRespondModal = closeSupportRespondModal;
window.sendSupportReply = sendSupportReply;
window.openSupportResolveModal = openSupportResolveModal;
window.closeSupportResolveModal = closeSupportResolveModal;
window.confirmSupportResolution = confirmSupportResolution;
window.updateNavBadges = updateNavBadges;
window.openMsgAll = openMsgAll;
window.openAdminGroupBroadcast = openAdminGroupBroadcast;
window.sendMsgAll = sendMsgAll;
window.closeMsgAll = closeMsgAll;
window.maCloseOutside = maCloseOutside;
window.openUserMessageModal = openUserMessageModal;
window.closeUserMessageModal = closeUserMessageModal;
window.sendUserMessage = sendUserMessage;
window.openAdminCompose = openAdminCompose;
window.closeAdminCompose = closeAdminCompose;
window.acCloseOutside = acCloseOutside;
window.sendAdminCompose = sendAdminCompose;
window.closeFlagModal = closeFlagModal;
window.closeResolveModal = closeResolveModal;
window.closeClaimDetail = closeClaimDetail;
window.cdCloseOutside = cdCloseOutside;
window.openRegister = openRegister;
window.closeRegister = closeRegister;
window.regCloseOutside = regCloseOutside;
window.downloadRegister = downloadRegister;
window.openNotificationTarget = openNotificationTarget;
window.initAdminApiDashboard = initAdminApiDashboard;
window.loadLecturers = loadLecturers;
window.loadTutors = loadTutors;
window.confirmResetPassword = confirmResetPassword;
window.confirmDeleteUser = confirmDeleteUser;
window.openEditModulesModal = openEditModulesModal;
window.closeEditModulesModal = closeEditModulesModal;
window.openUserActionSheet = openUserActionSheet;
window.closeUserActionSheet = closeUserActionSheet;
window.userSheetMessage = userSheetMessage;
window.userSheetEditModules = userSheetEditModules;
window.userSheetResetPassword = userSheetResetPassword;
window.userSheetDeactivate = userSheetDeactivate;
window.populateEditModuleNameDropdown = populateEditModuleNameDropdown;
window.addModuleToLecturer = addModuleToLecturer;
window.removeModuleFromLecturer = removeModuleFromLecturer;
window.showCredentialModal = showCredentialModal;
window.handleCredentialResult = handleCredentialResult;
window.closeCredentialModal = closeCredentialModal;
window.openConfirmModal = openConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.runConfirmAction = runConfirmAction;
