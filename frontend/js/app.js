/* ============================================================
   VERIFLOW — APP STATE & UTILITIES
   ============================================================ */

const VF = (() => {

  /* ─── API CONFIG ─── */
  const API_BASE = (() => {
    const host = window.location.hostname;
    const isDev = host === 'localhost' ||
      host === '127.0.0.1' ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host);
    const port = isDev ? ':3000' : '';
    return `${window.location.protocol}//${host}${port}/api`;
  })();
  const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '');
  const TOKEN_KEY  = 'vf_token';

  function fileRequestName(storedPath) {
    if (!storedPath) return '';
    const s = String(storedPath).replace(/\\/g, '/');
    const i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function uploadsUrl(filename) {
    if (!filename) return '';
    return `${API_BASE}/files/${encodeURIComponent(fileRequestName(filename))}`;
  }

  /** Returns a signed URL (or local API URL) safe for iframes/links. */
  async function fetchUploadDownloadUrl(filename) {
    if (!filename) throw new Error('No filename');
    const name = fileRequestName(filename);
    const data = await apiFetch(`/files/${encodeURIComponent(name)}/token`);
    if (!data.url) throw new Error('Could not get document URL.');
    // Relative local fallback — resolve against API origin host
    if (data.url.startsWith('/')) {
      return `${API_ORIGIN}${data.url}`;
    }
    return data.url;
  }

  /** Fetch an upload with Bearer auth and return a blob: URL for iframe/preview. */
  async function fetchUploadObjectUrl(filename) {
    if (!filename) throw new Error('No filename');
    const token = getToken();
    if (!token) throw new Error('Not authenticated');
    const name = fileRequestName(filename);
    const res = await fetch(`${API_BASE}/files/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
    });
    if (!res.ok) {
      let msg = 'Could not load document.';
      try {
        const data = await res.json();
        if (data.errors && data.errors[0]) msg = data.errors[0];
      } catch (_) { /* ignore */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  async function openUploadDocument(filename) {
    try {
      const url = await fetchUploadDownloadUrl(filename);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast(err.message || 'Could not open document.', 'err');
    }
  }

  /* ─── TOKEN (session-based auth) ─── */
  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function isAuthenticated() {
    return !!getToken();
  }

  /**
   * apiFetch — wraps fetch() with the API base URL, JSON headers,
   * and the Authorization header when a token is present.
   * Throws an Error with .errors (array) on failure so callers
   * can show the right message to the user.
   */
  async function apiFetch(path, { method = 'GET', body = null, isFormData = false } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
    });

    let data = {};
    try { data = await res.json(); } catch { /* no JSON body */ }

    if (!res.ok) {
      const err = new Error((data.errors && data.errors[0]) || data.error || 'Request failed.');
      err.errors = data.errors || [data.error || 'Request failed.'];
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ─── STATE ─── */
  const STATE_KEY = 'vf_state';

  function getState() {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY)) || defaultState();
      const payload = tokenPayload();
      if (payload) {
        s.user = {
          ...(s.user || {}),
          email:      payload.email || s.user?.email || '',
          firstNames: payload.first_names || s.user?.firstNames || '',
          surname:    payload.surname || s.user?.surname || '',
        };
      }
      return s;
    } catch { return defaultState(); }
  }

  function setState(patch) {
    const s = { ...getState(), ...patch };
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
    return s;
  }

  function defaultState() {
    return {
      user: null,           // { surname, title, initials, firstNames, email, cell }
      step: 1,              // current application step
      academic: null,       // { faculty, course, module, year }
      docs: { cv: false, academic: false },
      declared: false,
      applicationStatus: null, // null | 'submitted' | 'rejected' | 'under_review' | 'shortlisted' | 'approved'
      rejectionReason: null,
      onboarding: { step1: false, step2: false },
      onboardingDetails: null,
      tutorProfile: null,
    };
  }

  function clearState() {
    localStorage.removeItem(STATE_KEY);
  }

  /* ─── ROUTING ─── */
  function inPagesDir() {
    const href = window.location.href;
    return href.includes('/pages/') || href.includes('\\pages\\');
  }

  function navigate(page) {
    if (!inPagesDir() && !page.includes('/') && !page.includes('\\') && page.endsWith('.html')) {
      window.location.href = `frontend/pages/${page}`;
      return;
    }
    window.location.href = page;
  }

  function logoSrc() {
    const inPages = inPagesDir();
    if (inPages) return '../images/veriflo-brand.png';
    return 'frontend/images/veriflo-brand.png';
  }

  function logoHtml(alt = 'VeriFlow — Accurate. Timely. Transparent.') {
    return `<img src="${logoSrc()}" alt="${alt}" class="brand-logo" width="160" height="48" decoding="async"/>`;
  }

  /** Landing page URL — index.html lives at project root, not under frontend/. */
  function homeUrl() {
    if (inPagesDir()) {
      return new URL('../../index.html', window.location.href).href;
    }
    return new URL('index.html', window.location.href).href;
  }

  function loginUrl() {
    if (inPagesDir()) return 'login.html';
    return 'frontend/pages/login.html';
  }

  /* ─── AUTH GUARD ─── */
  function requireAuth(redirect = 'login.html') {
    if (!isAuthenticated()) {
      navigate(redirect);
      return false;
    }
    return true;
  }

  function roleFromToken() {
    const payload = tokenPayload();
    return payload?.role || null;
  }

  function tokenPayload() {
    const token = getToken();
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return null;
    }
  }

  function requireRole(role, redirect = 'login.html') {
    if (!requireAuth(redirect)) return false;
    const actual = roleFromToken();
    if (actual !== role) {
      if (actual === 'admin') navigate('admin-dashboard.html');
      else if (actual === 'lecturer') navigate('lecturer-dashboard.html');
      else if (actual === 'tutor') routeTutorAsync({});
      else navigate(redirect);
      return false;
    }
    return true;
  }

  async function fetchCurrentUser() {
    const user = await apiFetch('/users/me');
    setState({
      user: {
        ...(getState().user || {}),
        firstNames: user.first_names || '',
        surname:    user.surname || '',
        email:      user.email || '',
        cell:       user.cell || '',
        title:      user.title || '',
        initials:   user.initials || initials(user.first_names, user.surname),
        studentNumber: user.student_number || '',
      },
    });
    return user;
  }

  /* ─── NAVBAR ─── */
  function renderNavbar(opts = {}) {
    const s = getState();
    const { showSteps = false, currentStep = 0 } = opts;

    const steps = [
      { label: 'Personal',  n: 1 },
      { label: 'Academic',  n: 2 },
      { label: 'Documents', n: 3 },
    ];

    const userHTML = s.user ? `
      <div class="navbar-user">
        <div class="nav-avatar">${initials(s.user.firstNames, s.user.surname)}</div>
        <span class="nav-username">${s.user.firstNames.split(' ')[0]}</span>
        <span class="nav-logout" onclick="VF.logout()">Log out</span>
      </div>
    ` : `
      <div class="navbar-user">
        <a href="login.html"><button class="btn btn-ghost btn-sm">Log in</button></a>
      </div>
    `;

    const stepsHTML = showSteps ? `
      <nav class="step-nav">
        ${steps.map((st, i) => {
          const done    = currentStep > st.n;
          const active  = currentStep === st.n;
          const cls     = done ? 'done' : active ? 'active' : '';
          const icon    = done ? '<i class="ti ti-check" style="font-size:11px"></i>' : st.n;
          const sepCls  = done ? 'done' : '';
          return `
            ${i > 0 ? `<div class="step-sep ${sepCls}"></div>` : ''}
            <div class="step-nav-item ${cls}">
              <div class="step-num">${icon}</div>
              <span>${st.label}</span>
            </div>
          `;
        }).join('')}
      </nav>
    ` : '';

    const home = logoSrc().startsWith('../') ? '../index.html' : 'index.html';
    document.getElementById('navbar').innerHTML = `
      <div class="navbar-logo" onclick="VF.navigate('${home}')">
        ${logoHtml()}
      </div>
      ${stepsHTML}
      <div class="navbar-spacer"></div>
      ${userHTML}
    `;
  }

  /* ─── TOAST ─── */
  function toast(msg, type = 'default', duration = 3200) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const icons = { default: 'ti-info-circle', ok: 'ti-circle-check', err: 'ti-alert-circle' };
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i class="ti ${icons[type] || icons.default}"></i> ${msg}`;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  /* ─── VALIDATE ─── */
  function validateForm(fields) {
    let valid = true;
    fields.forEach(({ id, check, msg }) => {
      const group = document.getElementById(id)?.closest('.form-group');
      const el    = document.getElementById(id);
      if (!group || !el) return;
      const errEl = group.querySelector('.form-error');
      const ok    = check(el.value.trim());
      group.classList.toggle('error', !ok);
      if (!ok) { valid = false; if (errEl) errEl.textContent = msg; }
    });
    return valid;
  }

  /* ─── HELPERS ─── */
  function initials(first, last) {
    const f = (first || '').trim().charAt(0).toUpperCase();
    const l = (last  || '').trim().charAt(0).toUpperCase();
    return f + l || '?';
  }

  function logout() {
    clearState();
    clearToken();
    window.location.assign(homeUrl());
  }

  /* ─── APPLICATION HELPERS ─── */
  const QUALIFICATION_LABELS = {
    '3rd_year':         '3rd year student',
    '4th_year_honours': '4th year or Honours student',
    'masters':          'Masters student',
    'masters_holder':   'Masters Holder',
    'phd':              'PhD Candidate or Holder',
  };

  function rejectionDetailFromApp(app) {
    if (!app?.screening_result) return null;
    try {
      const sr = typeof app.screening_result === 'string'
        ? JSON.parse(app.screening_result)
        : app.screening_result;
      return sr.rejectionDetail || sr.detail || null;
    } catch {
      return null;
    }
  }

  function syncApplicationState(app) {
    if (!app) return;
    const patch = {
      applicationStatus: app.status,
      rejectionReason:   app.rejection_reason || null,
      rejectionDetail:   rejectionDetailFromApp(app),
    };
    if (app.faculty || app.course || app.module_name) {
      patch.academic = {
        faculty:             app.faculty || '',
        course:              app.course || '',
        qualificationLevel:  QUALIFICATION_LABELS[app.qualification_level] || app.qualification_level || '',
        year:                app.module_year_level || '',
        module:              app.module_name || '',
        moduleCode:          app.module_code || '',
        gpa:                 app.gpa != null ? app.gpa : '',
      };
    }
    if (app.first_names || app.surname || app.email) {
      patch.user = {
        ...(getState().user || {}),
        firstNames: app.first_names || getState().user?.firstNames || '',
        surname:    app.surname     || getState().user?.surname     || '',
        email:      app.email       || getState().user?.email       || '',
      };
    }
    setState(patch);
  }

  function tutorStateFromToken() {
    const token = getToken();
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return {
        applicationStatus: payload.applicationStatus ?? null,
        onboardingComplete: !!payload.onboardingComplete,
      };
    } catch {
      return null;
    }
  }

  function onboardingFromToken() {
    return !!tutorStateFromToken()?.onboardingComplete;
  }

  function onboardingCompleteFromApp(app) {
    if (!app) return onboardingFromToken();
    if (app.onboarding_complete != null) return !!app.onboarding_complete;
    if (app.onboardingComplete != null) return !!app.onboardingComplete;
    // Fall back to explicit step flags from /applications/me or /users/me/tutor-profile
    if (app.step1_complete != null || app.step2_complete != null) {
      return !!(app.step1_complete && app.step2_complete);
    }
    return onboardingFromToken();
  }

  function resolveTutorRoute(initial = {}) {
    const tokenState = tutorStateFromToken() || {};
    return {
      applicationStatus: initial.applicationStatus ?? tokenState.applicationStatus ?? null,
      onboardingComplete: !!(initial.onboardingComplete ?? tokenState.onboardingComplete),
    };
  }

  function routeTutor({ applicationStatus, onboardingComplete } = {}) {
    if (onboardingComplete) {
      navigate('dashboard.html');
    } else if (applicationStatus === 'approved') {
      navigate('onboarding-step1.html');
    } else if (applicationStatus === 'incomplete') {
      navigate('apply-step2.html');
    } else if (applicationStatus === 'rejected') {
      navigate('rejected.html');
    } else if (applicationStatus) {
      navigate('tracker.html');
    } else {
      navigate('apply-step1.html');
    }
  }

  async function fetchTutorRouteState() {
    const app = await apiFetch('/applications/me');
    syncApplicationState(app);
    return {
      applicationStatus: app.status,
      onboardingComplete: onboardingCompleteFromApp(app),
    };
  }

  async function routeTutorAsync(initial = {}) {
    const route = resolveTutorRoute(initial);
    routeTutor(route);
    try {
      await fetchTutorRouteState();
    } catch (_) { /* already navigated from login/JWT */ }
  }

  async function resumeTutorApplication() {
    const tokenState = tutorStateFromToken();
    if (tokenState?.applicationStatus) {
      routeTutor(tokenState);
      fetchTutorRouteState().catch(() => {});
      return;
    }

    try {
      const state = await fetchTutorRouteState();
      routeTutor(state);
    } catch (err) {
      if (err.status === 404) navigate('apply-step1.html');
      else navigate('apply-step2.html');
    }
  }

  function runEligibilityCheck() {
    // In production this hits an API.
    // For demo: always passes unless the module is COS1512 (demo rejection path).
    const s = getState();
    const mod = s.academic?.module || '';
    if (mod.includes('COS1512')) {
      return {
        pass: false,
        reason: 'You have not passed the required prerequisite module for this tutor position.',
        detail: 'Required pass: COS1511 — Introduction to Programming. Our records show this module has not been completed with a mark of 65% or above.'
      };
    }
    return { pass: true };
  }

  /* ─── PAGE ENTER ANIMATION ─── */
  function pageIn() {
    document.body.style.opacity = '0';
    requestAnimationFrame(() => {
      document.body.style.transition = 'opacity .22s ease';
      document.body.style.opacity = '1';
    });
  }

  function renderApplyProgress(currentStep) {
    const steps = [
      'Personal information',
      'Academic information',
      'Documents & declaration',
    ];
    const stepHtml = steps.map((label, i) => {
      const n = i + 1;
      const cls = currentStep > n ? 'done' : currentStep === n ? 'active' : '';
      return `<div class="ps-step ${cls}"><div class="ps-dot"></div><div class="ps-name">${label}</div></div>`;
    }).join('');
    return `
      <div class="apply-mobile-progress" aria-label="Application progress, step ${currentStep} of 3">
        <div class="progress-sidebar">
          <div class="progress-sidebar-label">Your progress</div>
          ${stepHtml}
        </div>
      </div>
    `;
  }

  function mountApplyProgress(currentStep) {
    const el = document.getElementById('applyProgress');
    if (el) el.innerHTML = renderApplyProgress(currentStep);
  }

  /**
   * Gate apply-step pages on applications_open (matches index.html behaviour).
   * When closed: hide step content and show a standalone closed message.
   * When open: show "Applications open" badge and run onOpen (e.g. mount progress).
   */
  async function gateApplicationWindow(onOpen) {
    let applicationsOpen = false;
    try {
      const settings = await apiFetch('/public/settings');
      applicationsOpen = !!settings.applications_open;
    } catch (e) {
      applicationsOpen = false;
    }

    const badge   = document.getElementById('applicationsOpenBadge');
    const closed  = document.getElementById('applicationsClosed');
    const content = document.getElementById('applyStepContent');
    const sidebar = document.getElementById('applySidebar');

    if (!applicationsOpen) {
      if (badge)   badge.style.display   = 'none';
      if (content) content.style.display = 'none';
      if (sidebar) sidebar.style.display = 'none';
      if (closed)  closed.style.display  = '';
      return false;
    }

    if (closed)  closed.style.display  = 'none';
    if (badge)   badge.style.display   = '';
    if (content) content.style.display = '';
    if (sidebar) sidebar.style.display = '';
    if (onOpen) await onOpen();
    return true;
  }

  function bindResponsiveBtnLabel({ btnId, labelSelector, short, long, breakpoint = 900 }) {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const sync = () => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      const label = btn.querySelector(labelSelector);
      if (!label) return;
      label.textContent = mq.matches ? short : long;
    };
    sync();
    mq.addEventListener('change', sync);
  }

  return {
    getState, setState, clearState, navigate,
    getToken, setToken, clearToken, isAuthenticated, apiFetch,
    roleFromToken, requireRole, fetchCurrentUser,
    API_BASE, uploadsUrl, fetchUploadObjectUrl, fetchUploadDownloadUrl, openUploadDocument,
    logoSrc, logoHtml,
    requireAuth, renderNavbar, renderApplyProgress, mountApplyProgress,
    bindResponsiveBtnLabel, toast,
    validateForm, initials, logout,
    syncApplicationState, routeTutor, routeTutorAsync, resumeTutorApplication,
    resolveTutorRoute, fetchTutorRouteState, tutorStateFromToken, onboardingCompleteFromApp, rejectionDetailFromApp,
    runEligibilityCheck, pageIn, gateApplicationWindow, homeUrl,
  };
})();

// Inline onclick handlers (e.g. Log out in sidebars) resolve VF on window.
if (typeof window !== 'undefined') {
  window.VF = VF;
}