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
  const type = raw.type || 'lecturer';
  const first = raw.firstNames || raw.first_names || '';
  const surname = raw.surname || '';
  const full = msgTitleCase(raw.name || `${first} ${surname}`.trim()) ||
    (type === 'admin' ? 'Admin' : type === 'tutor' ? 'Tutor' : 'Lecturer');
  const initials = raw.initials || msgInitials(first, surname) ||
    (type === 'admin' ? 'AD' : type === 'tutor' ? 'T' : 'L');
  const label = type === 'admin'
    ? 'Admin'
    : (full.split(/\s+/)[0] || (type === 'tutor' ? 'Tutor' : 'Lecturer'));
  return {
    type,
    id: raw.id || null,
    name: full,
    initials,
    label,
  };
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
  if (type === 'tutor') return 'Tutor';
  return 'Contact';
}

function renderMessagePeople() {
  const wrap = document.getElementById('tm-msg-people');
  if (!wrap) return;
  const role = window.MESSAGING_ROLE;
  if (role !== 'tutor' && role !== 'lecturer') {
    wrap.innerHTML = '';
    return;
  }

  if (!msgPeers.length) {
    wrap.innerHTML = `<div class="tm-people-empty">
      <strong>No contacts yet</strong>
      <span>Your ${role === 'lecturer' ? 'tutors' : 'lecturer'} will appear here once linked to this module.</span>
    </div>`;
    return;
  }

  const heading = role === 'lecturer' ? 'Message your tutors' : 'Message your lecturer';
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
  msgActiveThreadKind = contact.type === 'admin' ? 'coordinator' : 'peer';
  msgActiveThread = null;

  document.getElementById('thread-empty').style.display = 'none';
  document.getElementById('thread-content').style.display = 'flex';

  const av = document.getElementById('t-av');
  av.textContent = contact.initials;
  av.className = msgAvatarClass(contact.type, 'thread-av');
  document.getElementById('t-name').textContent = contact.name;
  const moduleLabel = typeof currentModuleCode !== 'undefined' && currentModuleCode ? currentModuleCode : '';
  document.getElementById('t-meta').textContent =
    contact.type === 'admin'
      ? 'Student Employment Office'
      : (moduleLabel || (contact.type === 'tutor' ? 'Tutor' : 'Lecturer'));
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
  const contact = msgPeers.find((c) => msgContactKey(c) === key);
  if (!contact) return;

  const existing = findThreadForContact(contact);
  if (existing) {
    msgPendingStart = null;
    await openThread(
      existing.threadKind || (contact.type === 'admin' ? 'coordinator' : 'peer'),
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
  if (peerRole === 'lecturer') return 'lecturer';
  if (peerRole === 'admin') return 'admin';
  return 'lecturer';
}

function msgAvatarClass(peerRole, base) {
  const type = msgPeerFilterType(peerRole);
  if (type === 'admin') return `${base} admin`;
  if (type === 'lecturer') return `${base} lecturer`;
  if (type === 'tutor') return `${base} tutor`;
  return base;
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
    const role = window.MESSAGING_ROLE;
    const emptySub = role === 'lecturer'
      ? 'Choose a tutor above to start chatting.'
      : 'Choose Admin or your lecturer above to start chatting.';
    list.innerHTML = `<div class="tm-recent-empty">
      <div class="tm-recent-empty-icon" aria-hidden="true">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      </div>
      <p class="tm-recent-empty-title">Your inbox is empty</p>
      <p class="tm-recent-empty-sub">${emptySub}</p>
    </div>`;
    return;
  }

  list.innerHTML = items.map((t) => {
    const kind = t.threadKind || 'peer';
    const senderType = msgPeerFilterType(t.peerRole);
    const avClass = msgAvatarClass(t.peerRole, 'ii-av');
    const active = t.id === msgActiveThreadId && kind === msgActiveThreadKind ? ' active' : '';
    const unread = t.unread ? ' unread' : '';
    const preview = (t.preview || '').replace(/</g, '&lt;');
    const name = (t.peerName || '—').replace(/</g, '&lt;');
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
  if (list) {
    list.innerHTML = '<div style="padding:24px 16px;font-size:13px;color:var(--muted);text-align:center">Loading messages…</div>';
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
    const sender = (entry.senderName || '—').replace(/</g, '&lt;');
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
  av.className = msgAvatarClass(summary.peerRole, 'thread-av');
  av.style.color = '';
  av.style.borderColor = '';

  const displayName = msgPeerFilterType(summary.peerRole) === 'admin'
    ? 'Admin'
    : (summary.peerName || '—');
  document.getElementById('t-name').textContent = displayName;
  document.getElementById('t-meta').textContent =
    `${summary.moduleCode || ''} · ${summary.subject || 'Conversation'}`.replace(/^ · /, '');

  document.getElementById('thread-messages').innerHTML =
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
    } else if (pending.type === 'tutor' && pending.id) {
      result = await sendDirectMessage(pending.id, null, text);
    } else if (pending.type === 'lecturer' && pending.id) {
      result = await sendDirectMessage(pending.id, null, text);
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
