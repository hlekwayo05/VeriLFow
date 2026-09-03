'use strict';

/** Shared inbox UI for lecturer and tutor dashboards */
let msgThreads = {};
let msgActiveThreadId = null;
let msgActiveThreadKind = 'peer';
let msgActiveThread = null;
let msgPendingStart = null; // { type, id?, name, initials, label }
let msgInboxFilter = 'all';
let msgCurrentUserId = null;
let msgPeers = [];
/** Admin only: which contact group is selected ('tutor' | 'lecturer' | null) */
let msgAdminGroup = null;
let msgAdminContacts = { tutor: [], demonstrator: [], lecturer: [] };

function splitTutorsByPosition(list) {
  const tutors = [];
  const demonstrators = [];
  (Array.isArray(list) ? list : []).forEach((row) => {
    if ((row.position_type || 'tutor') === 'demonstrator') demonstrators.push(row);
    else tutors.push(row);
  });
  return { tutors, demonstrators };
}

function adminGroupHeading(group) {
  if (group === 'tutor') return 'All tutors';
  if (group === 'demonstrator') return 'All demonstrators';
  return 'All lecturers';
}

function adminGroupEmptyLabel(group) {
  if (group === 'tutor') return 'tutors';
  if (group === 'demonstrator') return 'demonstrators';
  return 'lecturers';
}

function adminGroupBroadcastLabel(group) {
  if (group === 'tutor') return 'Message all tutors';
  if (group === 'demonstrator') return 'Message all demonstrators';
  return 'Message all lecturers';
}

function findAdminContactByPeerId(peerId) {
  for (const group of ['tutor', 'demonstrator', 'lecturer']) {
    const hit = (msgAdminContacts[group] || []).find((p) => Number(p.id) === Number(peerId));
    if (hit) return hit;
  }
  return null;
}

function msgInitials(first, surname) {
  const a = String(first || '').trim().charAt(0);
  const b = String(surname || '').trim().charAt(0);
  return ((a + b) || '?').toUpperCase();
}

function msgTitleCase(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function findThreadByPeerRole(peerRole) {
  return Object.values(msgThreads).find((t) => msgPeerFilterType(t.peerRole) === peerRole) || null;
}

function isMobileMsgLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function setMobileChatOpen(open) {
  const page = document.getElementById('page-messages') || document.getElementById('view-messages');
  if (!page) return;
  page.classList.toggle('tm-chat-open', !!open);
}

function closeMobileMessageChat() {
  msgPendingStart = null;
  msgActiveThreadId = null;
  msgActiveThreadKind = 'peer';
  msgActiveThread = null;
  setMobileChatOpen(false);
  const empty = document.getElementById('thread-empty');
  const content = document.getElementById('thread-content');
  if (empty) empty.style.display = '';
  if (content) content.style.display = 'none';
  document.querySelectorAll('.inbox-item').forEach((item) => item.classList.remove('active'));
  renderMessagePeople();
}

function msgContactKey(c) {
  if (!c) return '';
  return c.id ? `${c.type}:${c.id}` : c.type;
}

function normalizePeerContact(raw) {
  let type = raw.type || 'lecturer';
  if (type === 'tutor' && raw.position_type === 'demonstrator') {
    type = 'demonstrator';
  }
  if (type === 'tutor' && raw.positionType === 'demonstrator') {
    type = 'demonstrator';
  }
  const first = raw.firstNames || raw.first_names || '';
  const surname = raw.surname || '';
  const full = msgTitleCase(raw.name || `${first} ${surname}`.trim()) ||
    (type === 'admin' ? 'Admin' : type === 'demonstrator' ? 'Demonstrator' : type === 'tutor' ? 'Tutor' : 'Lecturer');
  const initials = raw.initials || msgInitials(first, surname) ||
    (type === 'admin' ? 'AD' : type === 'demonstrator' ? 'D' : type === 'tutor' ? 'T' : 'L');
  const label = type === 'admin'
    ? 'Admin'
    : (full.split(/\s+/)[0] || (type === 'demonstrator' ? 'Demo' : type === 'tutor' ? 'Tutor' : 'Lecturer'));
  return {
    type,
    id: raw.id || null,
    name: full,
    initials,
    label,
  };
}

function dedupeContactsById(list) {
  const seen = new Set();
  return (list || []).filter((c) => {
    const key = c.id != null ? String(c.id) : msgContactKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findThreadForContact(contact) {
  if (!contact) return null;
  if (contact.type === 'admin') return findThreadByPeerRole('admin');
  if (contact.id) {
    return Object.values(msgThreads).find((t) => Number(t.peerId) === Number(contact.id)) || null;
  }
  return findThreadByPeerRole(contact.type);
}

async function loadMessagePeers() {
  const role = window.MESSAGING_ROLE;

  if (role === 'admin') {
    try {
      const [allTutors, lecturers] = await Promise.all([
        VF.apiFetch('/users/tutors'),
        VF.apiFetch('/users/lecturers'),
      ]);
      const { tutors, demonstrators } = splitTutorsByPosition(allTutors);
      msgAdminContacts = {
        tutor: dedupeContactsById(tutors.map((t) => normalizePeerContact({
          type: 'tutor',
          id: t.id,
          first_names: t.first_names,
          surname: t.surname,
          name: `${t.first_names || ''} ${t.surname || ''}`.trim(),
          position_type: t.position_type,
        }))),
        demonstrator: dedupeContactsById(demonstrators.map((t) => normalizePeerContact({
          type: 'demonstrator',
          id: t.id,
          first_names: t.first_names,
          surname: t.surname,
          name: `${t.first_names || ''} ${t.surname || ''}`.trim(),
          position_type: t.position_type,
        }))),
        lecturer: dedupeContactsById((Array.isArray(lecturers) ? lecturers : []).map((l) => normalizePeerContact({
          type: 'lecturer',
          id: l.id,
          first_names: l.first_names,
          surname: l.surname,
          name: `${l.first_names || ''} ${l.surname || ''}`.trim(),
        }))),
      };
      msgPeers = msgAdminGroup ? (msgAdminContacts[msgAdminGroup] || []) : [];
    } catch (err) {
      console.error('loadMessagePeers (admin):', err);
      msgAdminContacts = { tutor: [], demonstrator: [], lecturer: [] };
      msgPeers = [];
    }
    return msgPeers;
  }

  if (role !== 'tutor' && role !== 'lecturer') {
    msgPeers = [];
    return msgPeers;
  }
  if (!currentModuleCode) {
    msgPeers = [{ type: 'admin', id: null, name: 'Admin', initials: 'AD', label: 'Admin' }];
    return msgPeers;
  }
  try {
    const data = await VF.apiFetch(`/messages/peers${msgModuleQuery()}`);
    const list = Array.isArray(data?.peers) ? data.peers : (Array.isArray(data) ? data : []);
    msgPeers = list.map(normalizePeerContact);
  } catch (err) {
    console.error('loadMessagePeers:', err);
    msgPeers = [{ type: 'admin', id: null, name: 'Admin', initials: 'AD', label: 'Admin' }];
  }
  return msgPeers;
}

function peerRoleLabel(type) {
  if (type === 'admin') return 'Admin';
  if (type === 'lecturer') return 'Lecturer';
  if (type === 'demonstrator') return 'Demo';
  if (type === 'tutor') return 'Tutor';
  return 'Contact';
}

function selectAdminMessageGroup(group) {
  msgAdminGroup = group === 'tutor' || group === 'demonstrator' || group === 'lecturer' ? group : null;
  msgPeers = msgAdminGroup ? (msgAdminContacts[msgAdminGroup] || []) : [];
  renderMessagePeople();
}

function clearAdminMessageGroup() {
  msgAdminGroup = null;
  msgPeers = [];
  renderMessagePeople();
}

function syncAdminMsgChrome() {
  const page = document.getElementById('page-messages');
  const cta = document.getElementById('ad-msg-mobile-cta');
  if (!page || window.MESSAGING_ROLE !== 'admin') return;

  if (!msgAdminGroup) {
    page.classList.remove('ad-msg-in-group');
  } else {
    page.classList.add('ad-msg-in-group');
  }
  if (cta) cta.innerHTML = '';
}

function getAdminMessageGroupContacts(group) {
  return msgAdminContacts[group] || [];
}

function renderMessagePeople() {
  const wrap = document.getElementById('tm-msg-people');
  if (!wrap) return;
  const role = window.MESSAGING_ROLE;

  if (role === 'admin') {
    syncAdminMsgChrome();
    const tutorCount = (msgAdminContacts.tutor || []).length;
    const demoCount = (msgAdminContacts.demonstrator || []).length;
    const lecturerCount = (msgAdminContacts.lecturer || []).length;

    if (!msgAdminGroup) {
      wrap.innerHTML = `
        <div class="tm-people-head">
          <span class="tm-people-head-title">Who do you want to message?</span>
          <span class="tm-people-head-sub">Choose a group</span>
        </div>
        <div class="ad-msg-group-pick">
          <button type="button" class="ad-msg-group-btn" onclick="selectAdminMessageGroup('tutor')">
            <span class="ad-msg-group-ico c-tutor" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <span class="ad-msg-group-text">
              <span class="ad-msg-group-title">Tutors</span>
              <span class="ad-msg-group-sub">${tutorCount} on the system</span>
            </span>
            <svg class="ad-msg-group-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          </button>
          <button type="button" class="ad-msg-group-btn" onclick="selectAdminMessageGroup('demonstrator')">
            <span class="ad-msg-group-ico c-demonstrator" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <span class="ad-msg-group-text">
              <span class="ad-msg-group-title">Demonstrators</span>
              <span class="ad-msg-group-sub">${demoCount} on the system</span>
            </span>
            <svg class="ad-msg-group-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          </button>
          <button type="button" class="ad-msg-group-btn" onclick="selectAdminMessageGroup('lecturer')">
            <span class="ad-msg-group-ico c-lecturer" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            </span>
            <span class="ad-msg-group-text">
              <span class="ad-msg-group-title">Lecturers</span>
              <span class="ad-msg-group-sub">${lecturerCount} on the system</span>
            </span>
            <svg class="ad-msg-group-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        </div>`;
      return;
    }

    const people = msgAdminContacts[msgAdminGroup] || [];
    const heading = adminGroupHeading(msgAdminGroup);
    if (!people.length) {
      wrap.innerHTML = `
        <button type="button" class="ad-msg-group-back" onclick="clearAdminMessageGroup()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          Back
        </button>
        <div class="tm-people-empty">
          <strong>No ${adminGroupEmptyLabel(msgAdminGroup)} yet</strong>
          <span>Accounts will appear here once they are on the system.</span>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <button type="button" class="ad-msg-group-back" onclick="clearAdminMessageGroup()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
        Back
      </button>
      <div class="tm-people-head">
        <span class="tm-people-head-title">${heading}</span>
        <span class="tm-people-head-sub">${people.length} · Tap to chat</span>
      </div>
      <div class="tm-people-row ad-msg-people-list">
        ${people.map((c) => {
          const key = msgContactKey(c);
          const existing = findThreadForContact(c);
          const unread = existing?.unread ? '<span class="tm-person-dot" aria-hidden="true"></span>' : '';
          const active = existing && existing.id === msgActiveThreadId ? ' is-active' : '';
          return `<button type="button" class="tm-person${active}" data-contact="${key}" onclick="openMessageContact('${key}')">
            <span class="tm-person-ring ${c.type}">
              <span class="tm-person-av ${c.type}">${c.initials}${unread}</span>
            </span>
            <span class="tm-person-name">${c.name.replace(/</g, '&lt;')}</span>
            <span class="tm-person-role">${peerRoleLabel(c.type)}</span>
          </button>`;
        }).join('')}
      </div>
      <button type="button" class="ad-btn-primary ad-msg-all-btn" onclick="openAdminGroupBroadcast('${msgAdminGroup}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        ${adminGroupBroadcastLabel(msgAdminGroup)}
      </button>`;
    return;
  }

  const page = document.getElementById('page-messages');
  page?.classList.remove('ad-msg-in-group');
  const cta = document.getElementById('ad-msg-mobile-cta');
  if (cta) cta.innerHTML = '';

  if (role !== 'tutor' && role !== 'lecturer') {
    wrap.innerHTML = '';
    return;
  }

  if (!msgPeers.length) {
    wrap.innerHTML = `<div class="tm-people-empty">
      <strong>No contacts yet</strong>
      <span>Your ${role === 'lecturer' ? 'tutors and demonstrators' : 'lecturer'} will appear here once linked to this module.</span>
    </div>`;
    return;
  }

  const heading = role === 'lecturer' ? 'Message your tutors & demonstrators' : 'Message your lecturer';
  wrap.innerHTML = `
    <div class="tm-people-head">
      <span class="tm-people-head-title">${heading}</span>
      <span class="tm-people-head-sub">Tap to start</span>
    </div>
    <div class="tm-people-row">
      ${msgPeers.map((c) => {
        const key = msgContactKey(c);
        const existing = findThreadForContact(c);
        const unread = existing?.unread ? '<span class="tm-person-dot" aria-hidden="true"></span>' : '';
        const active = existing && existing.id === msgActiveThreadId ? ' is-active' : '';
        return `<button type="button" class="tm-person${active}" data-contact="${key}" onclick="openMessageContact('${key}')">
          <span class="tm-person-ring ${c.type}">
            <span class="tm-person-av ${c.type}">${c.initials}${unread}</span>
          </span>
          <span class="tm-person-name">${c.label.replace(/</g, '&lt;')}</span>
          <span class="tm-person-role">${peerRoleLabel(c.type)}</span>
        </button>`;
      }).join('')}
    </div>`;
}

/** @deprecated use renderMessagePeople */
function renderTutorMessagePeople() {
  return renderMessagePeople();
}

function showPendingChat(contact) {
  msgPendingStart = contact;
  msgActiveThreadId = null;
  msgActiveThreadKind = (contact.type === 'admin' || window.MESSAGING_ROLE === 'admin')
    ? 'coordinator'
    : 'peer';
  msgActiveThread = null;

  document.getElementById('thread-empty').style.display = 'none';
  document.getElementById('thread-content').style.display = 'flex';

  const av = document.getElementById('t-av');
  av.textContent = contact.initials;
  av.className = msgContactAvatarClass(contact.type, 'thread-av');
  document.getElementById('t-name').textContent = contact.name;
  const moduleLabel = typeof currentModuleCode !== 'undefined' && currentModuleCode ? currentModuleCode : '';
  document.getElementById('t-meta').textContent =
    contact.type === 'admin'
      ? 'Student Employment Office'
      : (window.MESSAGING_ROLE === 'admin'
        ? peerRoleLabel(contact.type)
        : (moduleLabel || peerRoleLabel(contact.type)));
  document.getElementById('thread-messages').innerHTML = `
    <div class="tm-chat-empty">
      <div class="tm-chat-empty-icon" aria-hidden="true">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      </div>
      <p class="tm-chat-empty-title">No messages yet</p>
      <p class="tm-chat-empty-sub">Say hello to start the conversation.</p>
    </div>`;

  setMobileChatOpen(true);
  setTimeout(() => document.getElementById('compose-input')?.focus(), 120);
}

async function openMessageContact(key) {
  const contact = msgPeers.find((c) => msgContactKey(c) === key)
    || (msgAdminContacts.tutor || []).find((c) => msgContactKey(c) === key)
    || (msgAdminContacts.demonstrator || []).find((c) => msgContactKey(c) === key)
    || (msgAdminContacts.lecturer || []).find((c) => msgContactKey(c) === key);
  if (!contact) return;

  const existing = findThreadForContact(contact);
  if (existing) {
    msgPendingStart = null;
    await openThread(
      existing.threadKind || (contact.type === 'admin' || window.MESSAGING_ROLE === 'admin' ? 'coordinator' : 'peer'),
      existing.id
    );
    return;
  }
  showPendingChat(contact);
}

/** @deprecated use openMessageContact */
async function openTutorMessageContact(type) {
  return openMessageContact(type);
}

async function sendTutorAdminMessage(subject, body) {
  try {
    const result = await VF.apiFetch('/messages/threads', {
      method: 'POST',
      body: {
        threadKind: 'coordinator',
        toAdmin: true,
        subject: subject || null,
        body,
      },
    });
    await loadMessageThreads(result.threadId, result.threadKind || 'coordinator');
    if (typeof goView === 'function' && window.MESSAGING_ROLE === 'lecturer') {
      goView('messages', document.getElementById('nav-messages'));
    } else if (typeof showPage === 'function') {
      showPage('messages', document.getElementById('nav-messages'));
    }
    return result;
  } catch (err) {
    msgShowToast(err.errors ? err.errors[0] : 'Could not send message');
    return null;
  }
}

function msgThreadKey(id, kind) {
  return `${kind || 'peer'}:${id}`;
}

function msgModuleQuery() {
  const code = typeof currentModuleCode !== 'undefined' ? currentModuleCode : null;
  return code ? `?moduleCode=${encodeURIComponent(code)}` : '';
}

function msgThreadKindQuery(kind) {
  const k = kind || 'peer';
  return k === 'coordinator' ? '?threadKind=coordinator' : '';
}

function msgFormatListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('en-ZA', { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function msgFormatBubbleTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-ZA', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function msgPeerFilterType(peerRole) {
  if (peerRole === 'tutor') return 'tutor';
  if (peerRole === 'demonstrator') return 'demonstrator';
  if (peerRole === 'lecturer') return 'lecturer';
  if (peerRole === 'admin') return 'admin';
  return 'lecturer';
}

function threadSenderFilterType(thread) {
  if (!thread) return 'lecturer';
  if (msgPeerFilterType(thread.peerRole) === 'admin') return 'admin';
  const peer = msgPeers.find((p) => p.id && Number(p.id) === Number(thread.peerId))
    || findAdminContactByPeerId(thread.peerId);
  if (peer?.type === 'demonstrator') return 'demonstrator';
  if (peer?.type === 'tutor') return 'tutor';
  return msgPeerFilterType(thread.peerRole);
}

function msgAvatarClass(peerRole, base) {
  const type = msgPeerFilterType(peerRole);
  if (type === 'admin') return `${base} admin`;
  if (type === 'lecturer') return `${base} lecturer`;
  if (type === 'demonstrator') return `${base} demonstrator`;
  if (type === 'tutor') return `${base} tutor`;
  return base;
}

function msgContactAvatarClass(contactType, base) {
  if (contactType === 'admin') return `${base} admin`;
  if (contactType === 'lecturer') return `${base} lecturer`;
  if (contactType === 'demonstrator') return `${base} demonstrator`;
  if (contactType === 'tutor') return `${base} tutor`;
  return base;
}

function avatarClassForThread(thread, base) {
  const peer = msgPeers.find((p) => p.id && Number(p.id) === Number(thread.peerId))
    || findAdminContactByPeerId(thread.peerId);
  if (peer) return msgContactAvatarClass(peer.type, base);
  return msgAvatarClass(thread.peerRole, base);
}

function msgShowToast(text) {
  if (typeof showToast === 'function') showToast(text);
}

async function msgEnsureCurrentUser() {
  if (msgCurrentUserId) return msgCurrentUserId;
  try {
    const user = await VF.fetchCurrentUser();
    msgCurrentUserId = user.id;
    return msgCurrentUserId;
  } catch (_) {
    return null;
  }
}

function updateUnreadBadge(count) {
  const badges = document.querySelectorAll(
    '#nav-messages .nav-badge, #nav-messages-badge, #nav-messages-admin .nav-badge, #hub-msg-badge, #bnav-msg-badge'
  );
  const n = Number(count) || 0;
  badges.forEach((badge) => {
    if (n > 0) {
      badge.textContent = String(n);
      badge.hidden = false;
      badge.style.display = '';
    } else {
      badge.textContent = '';
      badge.hidden = true;
      badge.style.display = 'none';
    }
  });
  const hubTile = document.getElementById('hub-tile-messages');
  if (hubTile) hubTile.classList.toggle('has-unread', n > 0);
  const hubSub = document.getElementById('hub-messages-sub') || document.getElementById('lec-hub-msg-sub');
  if (hubSub) hubSub.textContent = n > 0 ? `${n} unread` : 'Inbox';
  const hubBadge = document.getElementById('hub-messages-badge');
  if (hubBadge) {
    if (n > 0) {
      hubBadge.textContent = String(n);
      hubBadge.hidden = false;
    } else {
      hubBadge.textContent = '';
      hubBadge.hidden = true;
    }
  }
}

async function refreshUnreadBadge() {
  try {
    const data = await VF.apiFetch(`/messages/unread-count${msgModuleQuery()}`);
    updateUnreadBadge(data.count);
  } catch (_) {
    updateUnreadBadge(0);
  }
}

function renderInboxList() {
  const list = document.getElementById('inbox-list');
  if (!list) return;

  renderMessagePeople();

  const items = Object.values(msgThreads);
  if (!items.length) {
    if (window.MESSAGING_ROLE === 'admin') {
      list.innerHTML = '';
      return;
    }
    const role = window.MESSAGING_ROLE;
    const emptySub = role === 'lecturer'
      ? 'Choose a tutor or demonstrator above to start chatting.'
      : 'Choose Admin or your lecturer above to start chatting.';
    list.innerHTML = `<div class="tm-recent-empty-card">
      <div class="tm-recent-empty">
        <div class="tm-recent-empty-icon" aria-hidden="true">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        </div>
        <p class="tm-recent-empty-title">Your inbox is empty</p>
        <p class="tm-recent-empty-sub">${emptySub}</p>
      </div>
    </div>`;
    return;
  }

  list.innerHTML = items.map((t) => {
    const kind = t.threadKind || 'peer';
    const senderType = threadSenderFilterType(t);
    const avClass = avatarClassForThread(t, 'ii-av');
    const active = t.id === msgActiveThreadId && kind === msgActiveThreadKind ? ' active' : '';
    const unread = t.unread ? ' unread' : '';
    const preview = (t.preview || '').replace(/</g, '&lt;');
    const name = (t.peerName || '-').replace(/</g, '&lt;');
    const displayName = senderType === 'admin' ? 'Admin' : name;
    const badge = t.unreadCount > 0
      ? `<span class="ii-unread-badge">${t.unreadCount > 9 ? '9+' : t.unreadCount}</span>`
      : '';
    return `<div class="inbox-item${active}${unread}" data-sender="${senderType}" data-id="${t.id}" data-kind="${kind}" onclick="openThread('${kind}', ${t.id})">
      <div class="${avClass}">${t.peerInitials || '?'}</div>
      <div class="ii-body">
        <div class="ii-top">
          <span class="ii-name">${displayName}</span>
          <span class="ii-time">${msgFormatListTime(t.lastMessageAt)}</span>
        </div>
        <div class="ii-preview">${preview || 'No messages yet'}</div>
      </div>
      ${badge}
    </div>`;
  }).join('');

  applyInboxFilter();
}

async function loadMessageThreads(selectThreadId, selectThreadKind) {
  const list = document.getElementById('inbox-list');
  const people = document.getElementById('tm-msg-people');
  if (list && VF.skeleton) list.innerHTML = VF.skeleton.inbox(6);
  if (people && VF.skeleton && !people.children.length) {
    people.innerHTML = VF.skeleton.people(4);
  }

  await msgEnsureCurrentUser();

  try {
    const [threads] = await Promise.all([
      VF.apiFetch(`/messages/threads${msgModuleQuery()}`),
      loadMessagePeers(),
    ]);
    msgThreads = {};
    threads.forEach((t) => {
      const key = msgThreadKey(t.id, t.threadKind);
      msgThreads[key] = t;
    });
    renderInboxList();
    await refreshUnreadBadge();

    const kind = selectThreadKind || 'peer';
    const key = selectThreadId ? msgThreadKey(selectThreadId, kind) : null;
    if (key && msgThreads[key]) {
      await openThread(kind, selectThreadId);
    }
  } catch (err) {
    if (list) {
      list.innerHTML = '<div style="padding:24px 16px;font-size:13px;color:var(--muted);text-align:center">Could not load messages.</div>';
    }
    msgShowToast('Could not load messages');
  }
}

function renderThreadMessages(messages) {
  const container = document.getElementById('thread-messages');
  if (!container) return;

  container.innerHTML = (messages || []).map((entry) => {
    const dir = entry.isMine ? 'outgoing' : 'incoming';
    const sender = (entry.senderName || '-').replace(/</g, '&lt;');
    const text = (entry.body || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    const time = msgFormatBubbleTime(entry.createdAt);
    const subjectLine = entry.subject && !entry.isMine
      ? `<div style="font-size:11px;font-weight:700;margin-bottom:6px;color:var(--muted)">${entry.subject.replace(/</g, '&lt;')}</div>`
      : '';
    return `<div class="msg-bubble-wrap ${dir}">
      <div class="bubble-meta">
        <span class="bubble-sender">${sender}</span>
        <span class="bubble-time">${time}</span>
      </div>
      <div class="bubble">${subjectLine}${text}</div>
    </div>`;
  }).join('');

  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 20);
}

async function openThread(kind, id) {
  const threadKind = kind || 'peer';
  const key = msgThreadKey(id, threadKind);
  const summary = msgThreads[key];
  if (!summary) return;

  msgPendingStart = null;
  msgActiveThreadId = id;
  msgActiveThreadKind = threadKind;

  document.querySelectorAll('.inbox-item').forEach((item) => {
    const match = Number(item.dataset.id) === id && item.dataset.kind === threadKind;
    item.classList.toggle('active', match);
    if (match) {
      item.classList.remove('unread');
      const badge = item.querySelector('.ii-unread-badge');
      if (badge) badge.remove();
      const dot = item.querySelector('.unread-dot');
      if (dot) dot.remove();
    }
  });

  if (summary) summary.unread = false;

  document.getElementById('thread-empty').style.display = 'none';
  document.getElementById('thread-content').style.display = 'flex';
  setMobileChatOpen(true);

  const av = document.getElementById('t-av');
  av.textContent = summary.peerInitials || '?';
  av.className = avatarClassForThread(summary, 'thread-av');
  av.style.color = '';
  av.style.borderColor = '';

  const displayName = msgPeerFilterType(summary.peerRole) === 'admin'
    ? 'Admin'
    : (summary.peerName || '-');
  document.getElementById('t-name').textContent = displayName;
  document.getElementById('t-meta').textContent =
    `${summary.moduleCode || ''} · ${summary.subject || 'Conversation'}`.replace(/^ · /, '');

  document.getElementById('thread-messages').innerHTML =
    (VF.skeleton && VF.skeleton.thread(4)) ||
    '<div style="padding:16px;color:var(--muted);font-size:12px">Loading…</div>';

  try {
    const thread = await VF.apiFetch(
      `/messages/threads/${id}${msgThreadKindQuery(threadKind)}`
    );
    msgActiveThread = thread;
    msgThreads[key] = {
      ...msgThreads[key],
      subject: thread.messages.length
        ? (thread.messages[thread.messages.length - 1].subject || msgThreads[key].subject)
        : msgThreads[key].subject,
      preview: thread.messages.length
        ? thread.messages[thread.messages.length - 1].body
        : msgThreads[key].preview,
      unread: false,
      unreadCount: 0,
    };
    renderThreadMessages(thread.messages);
    await refreshUnreadBadge();
    renderMessagePeople();
  } catch (err) {
    document.getElementById('thread-messages').innerHTML =
      '<div style="padding:16px;color:var(--red);font-size:12px">Could not load conversation.</div>';
    msgShowToast('Could not load conversation');
  }
}

function focusCompose() {
  document.getElementById('compose-input')?.focus();
}

function autoResize(el) {
  el.style.height = '20px';
  el.style.height = `${Math.min(el.scrollHeight, 80)}px`;
}

function composeKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendReply();
  }
}

async function sendReply() {
  const input = document.getElementById('compose-input');
  const text = input?.value.trim();
  if (!text) return;

  if (msgPendingStart && !msgActiveThreadId) {
    input.value = '';
    input.style.height = '20px';
    const pending = msgPendingStart;
    let result = null;
    if (pending.type === 'admin') {
      result = await sendTutorAdminMessage(null, text);
    } else if ((pending.type === 'tutor' || pending.type === 'lecturer') && pending.id) {
      if (window.MESSAGING_ROLE === 'admin') {
        result = await sendAdminDirectMessage(pending.id, null, text);
      } else {
        result = await sendDirectMessage(pending.id, null, text);
      }
    } else {
      result = await sendTutorMessage(null, text);
    }
    msgPendingStart = null;
    if (result) setMobileChatOpen(true);
    return;
  }

  if (!msgActiveThreadId) return;

  try {
    const result = await VF.apiFetch(
      `/messages/threads/${msgActiveThreadId}/messages${msgThreadKindQuery(msgActiveThreadKind)}`,
      {
        method: 'POST',
        body: { body: text, threadKind: msgActiveThreadKind },
      }
    );

    const container = document.getElementById('thread-messages');
    const emptyHint = container.querySelector('.tm-chat-empty');
    if (emptyHint) emptyHint.remove();

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble-wrap outgoing';
    bubble.innerHTML = `<div class="bubble-meta"><span class="bubble-sender">You</span><span class="bubble-time">${msgFormatBubbleTime(result.createdAt)}</span></div><div class="bubble">${text.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    input.value = '';
    input.style.height = '20px';

    const key = msgThreadKey(msgActiveThreadId, msgActiveThreadKind);
    if (msgThreads[key]) {
      msgThreads[key].preview = text;
      msgThreads[key].lastMessageAt = result.createdAt;
    }
    renderInboxList();
    document.querySelector(
      `.inbox-item[data-id="${msgActiveThreadId}"][data-kind="${msgActiveThreadKind}"]`
    )?.classList.add('active');
  } catch (err) {
    msgShowToast(err.errors ? err.errors[0] : 'Could not send message');
  }
}

function applyInboxFilter() {
  document.querySelectorAll('.inbox-item').forEach((item) => {
    if (msgInboxFilter === 'all') {
      item.style.display = '';
      return;
    }
    if (msgInboxFilter === 'unread') {
      item.style.display = item.classList.contains('unread') ? '' : 'none';
      return;
    }
    item.style.display = item.dataset.sender === msgInboxFilter ? '' : 'none';
  });
}

function setInboxFilter(type, btn) {
  msgInboxFilter = type;
  document.querySelectorAll('.inbox-filter').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  applyInboxFilter();
}

function filterInbox(value) {
  const query = (value || '').toLowerCase();
  document.querySelectorAll('.inbox-item').forEach((item) => {
    item.style.display = item.innerText.toLowerCase().includes(query) ? '' : 'none';
  });
}

async function sendDirectMessage(recipientId, subject, body) {
  if (!currentModuleCode) {
    msgShowToast('Select a module first');
    return null;
  }
  try {
    const result = await VF.apiFetch('/messages/threads', {
      method: 'POST',
      body: {
        recipientId,
        moduleCode: currentModuleCode,
        subject: subject || null,
        body,
      },
    });
    await loadMessageThreads(result.threadId, result.threadKind || 'peer');
    if (typeof goView === 'function') {
      goView('messages', document.getElementById('nav-messages'));
    } else if (typeof showPage === 'function') {
      showPage('messages', document.getElementById('nav-messages'));
    }
    return result;
  } catch (err) {
    msgShowToast(err.errors ? err.errors[0] : 'Could not send message');
    return null;
  }
}

async function sendAdminDirectMessage(recipientId, subject, body) {
  try {
    const result = await VF.apiFetch('/messages/threads', {
      method: 'POST',
      body: {
        recipientId: Number(recipientId),
        subject: subject || 'Message from Student Employment Office',
        body,
      },
    });
    await loadMessageThreads(result.threadId, result.threadKind || 'coordinator');
    return result;
  } catch (err) {
    msgShowToast(err.errors ? err.errors[0] : 'Could not send message');
    return null;
  }
}

async function sendTutorMessage(subject, body) {
  if (!currentModuleCode) {
    msgShowToast('Select a module first');
    return null;
  }
  try {
    const result = await VF.apiFetch('/messages/threads', {
      method: 'POST',
      body: {
        moduleCode: currentModuleCode,
        subject: subject || null,
        body,
      },
    });
    await loadMessageThreads(result.threadId, result.threadKind || 'peer');
    if (typeof showPage === 'function') {
      showPage('messages', document.getElementById('nav-messages'));
    }
    return result;
  } catch (err) {
    msgShowToast(err.errors ? err.errors[0] : 'Could not send message');
    return null;
  }
}

async function sendBroadcastMessage(subject, body) {
  if (!currentModuleCode) {
    msgShowToast('Select a module first');
    return null;
  }
  try {
    const result = await VF.apiFetch('/messages/broadcast', {
      method: 'POST',
      body: {
        moduleCode: currentModuleCode,
        subject: subject || null,
        body,
      },
    });
    await loadMessageThreads();
    msgShowToast(result.message || 'Broadcast sent');
    return result;
  } catch (err) {
    msgShowToast(err.errors ? err.errors[0] : 'Could not send broadcast');
    return null;
  }
}

window.loadMessageThreads = loadMessageThreads;
window.openThread = openThread;
window.sendReply = sendReply;
window.focusCompose = focusCompose;
window.autoResize = autoResize;
window.composeKey = composeKey;
window.setInboxFilter = setInboxFilter;
window.filterInbox = filterInbox;
window.sendDirectMessage = sendDirectMessage;
window.sendTutorMessage = sendTutorMessage;
window.sendTutorAdminMessage = sendTutorAdminMessage;
window.sendBroadcastMessage = sendBroadcastMessage;
window.refreshUnreadBadge = refreshUnreadBadge;
window.openTutorMessageContact = openTutorMessageContact;
window.openMessageContact = openMessageContact;
window.closeMobileMessageChat = closeMobileMessageChat;
window.renderTutorMessagePeople = renderTutorMessagePeople;
window.renderMessagePeople = renderMessagePeople;
window.loadMessagePeers = loadMessagePeers;
window.selectAdminMessageGroup = selectAdminMessageGroup;
window.clearAdminMessageGroup = clearAdminMessageGroup;
window.getAdminMessageGroupContacts = getAdminMessageGroupContacts;
window.sendAdminDirectMessage = sendAdminDirectMessage;
