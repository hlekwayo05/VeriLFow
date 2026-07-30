
const VF = (() => {

  const PRODUCTION_API = "https://veriflow-backend.onrender.com/api";

  const API_BASE = (() => {
    const host = window.location.hostname;

    const isDevelopment =
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host);

    if (isDevelopment) {
      return `${window.location.protocol}//${host}:3000/api`;
    }

    return PRODUCTION_API;
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

  /** App home — login is the single entry screen (index redirects here). */
  function homeUrl() {
    return new URL(loginUrl(), window.location.href).href;
  }

  function loginUrl() {
    if (inPagesDir()) return 'login.html';
    return 'frontend/pages/login.html';
  }

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

    const home = loginUrl();
    document.getElementById('navbar').innerHTML = `
      <div class="navbar-logo" onclick="VF.navigate('${home}')">
        ${logoHtml()}
      </div>
      ${stepsHTML}
      <div class="navbar-spacer"></div>
      ${userHTML}
    `;
  }

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
    // Always replace academic from the server — never keep another session's draft
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
    } else {
      patch.academic = null;
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
    /* Current step starts empty; fill grows as the user completes fields */
    const segHtml = [1, 2, 3].map((n) => {
      let cls = '';
      let width = 0;
      if (currentStep > n) {
        cls = 'done';
        width = 100;
      } else if (currentStep === n) {
        cls = 'active';
        width = 0;
      }
      return `<div class="progress-seg ${cls}" data-step="${n}"><div class="progress-seg-fill" style="width:${width}%"></div></div>`;
    }).join('');
    const labels = [
      'Personal Info',
      'Academic Info',
      'Documents',
    ];
    return `
      <div class="apply-mobile-progress" aria-label="Application progress, step ${currentStep} of 3">
        <div class="wizard-label">Application · Step ${currentStep} of 3 — ${labels[currentStep - 1] || ''}</div>
        <div class="progress-track">${segHtml}</div>
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

  /** Set the active step segment fill (0–1). Previous steps stay full. */
  function setApplyStepProgress(ratio) {
    const fill = document.querySelector('.apply-mobile-progress .progress-seg.active .progress-seg-fill');
    if (!fill) return;
    const pct = Math.max(0, Math.min(100, Math.round(Number(ratio) * 100)));
    fill.style.width = pct + '%';
  }

  function fieldCountsTowardProgress(el) {
    if (!el) return false;
    if (el.type === 'hidden') return false;
    const grp = el.closest('.form-group');
    if (grp) {
      const style = window.getComputedStyle(grp);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  function fieldIsFilled(el) {
    if (!el) return false;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'file') return !!(el.files && el.files.length);
    return String(el.value || '').trim().length > 0;
  }

  /**
   * Grow the current step's progress segment as fields are filled.
   * Returns a sync() function you can call after programmatic fills (uploads, etc.).
   */
  function bindApplyFormProgress(fieldIds) {
    const ids = Array.isArray(fieldIds) ? fieldIds : [];
    const sync = () => {
      const active = ids
        .map((id) => document.getElementById(id))
        .filter(fieldCountsTowardProgress);
      if (!active.length) {
        setApplyStepProgress(0);
        return;
      }
      const filled = active.filter(fieldIsFilled).length;
      setApplyStepProgress(filled / active.length);
    };
    const onEvent = (e) => {
      if (e.target && ids.includes(e.target.id)) sync();
    };
    document.addEventListener('input', onEvent);
    document.addEventListener('change', onEvent);
    requestAnimationFrame(sync);
    return sync;
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

  const skeleton = {
    cards(count = 4) {
      return Array.from({ length: count }, () => `
        <div class="vf-skel-card" aria-hidden="true">
          <div class="vf-skel-row">
            <div class="vf-skel vf-skel-av"></div>
            <div class="vf-skel-lines">
              <div class="vf-skel vf-skel-line mid"></div>
              <div class="vf-skel vf-skel-line short"></div>
            </div>
          </div>
          <div class="vf-skel vf-skel-line short"></div>
          <div class="vf-skel vf-skel-line btn"></div>
        </div>`).join('');
    },

    claimCards(count = 4) {
      return Array.from({ length: count }, () => `
        <div class="vf-skel-card" aria-hidden="true" style="margin-bottom:12px">
          <div class="vf-skel-row">
            <div class="vf-skel vf-skel-av"></div>
            <div class="vf-skel-lines">
              <div class="vf-skel vf-skel-line mid"></div>
              <div class="vf-skel vf-skel-line short"></div>
            </div>
            <div class="vf-skel vf-skel-line chip"></div>
          </div>
          <div class="vf-skel vf-skel-line btn"></div>
        </div>`).join('');
    },

    sessionRows(count = 5) {
      return `<div class="vf-skel-list" aria-hidden="true">${Array.from({ length: count }, () => `
        <div class="vf-skel-list-row">
          <div class="vf-skel vf-skel-line mid"></div>
          <div class="vf-skel vf-skel-line"></div>
          <div class="vf-skel vf-skel-line short"></div>
          <div class="vf-skel vf-skel-line" style="height:28px;border-radius:8px"></div>
        </div>`).join('')}</div>`;
    },

    listRows(count = 4) {
      return `<div class="vf-skel-list" aria-hidden="true">${Array.from({ length: count }, () => `
        <div class="vf-skel-row" style="padding:10px 0">
          <div class="vf-skel vf-skel-av sm"></div>
          <div class="vf-skel-lines">
            <div class="vf-skel vf-skel-line mid"></div>
            <div class="vf-skel vf-skel-line short"></div>
          </div>
          <div class="vf-skel vf-skel-line chip"></div>
        </div>`).join('')}</div>`;
    },

    referralRows(count = 3) {
      return Array.from({ length: count }, () => `
        <div class="lec-ref-row vf-skel-row" aria-hidden="true" style="padding:12px 0;justify-content:space-between">
          <div class="vf-skel-lines" style="flex:1">
            <div class="vf-skel vf-skel-line mid"></div>
            <div class="vf-skel vf-skel-line short"></div>
          </div>
          <div class="vf-skel vf-skel-line" style="width:64px;height:14px;flex-shrink:0"></div>
        </div>`).join('');
    },

    inbox(count = 6) {
      return Array.from({ length: count }, () => `
        <div class="vf-skel-inbox-item" aria-hidden="true">
          <div class="vf-skel vf-skel-av sm"></div>
          <div class="vf-skel-lines">
            <div class="vf-skel vf-skel-line mid"></div>
            <div class="vf-skel vf-skel-line short"></div>
          </div>
        </div>`).join('');
    },

    thread(count = 4) {
      return Array.from({ length: count }, (_, i) => `
        <div class="vf-skel-bubble ${i % 2 ? 'out' : 'in'}" aria-hidden="true">
          <div class="vf-skel vf-skel-line tiny"></div>
          <div class="vf-skel vf-skel-line ${i % 2 ? 'short' : 'mid'}"></div>
        </div>`).join('');
    },

    people(count = 4) {
      return Array.from({ length: count }, () => `
        <div class="vf-skel-row" aria-hidden="true" style="padding:4px 0">
          <div class="vf-skel vf-skel-av sm"></div>
          <div class="vf-skel-lines">
            <div class="vf-skel vf-skel-line mid"></div>
            <div class="vf-skel vf-skel-line tiny"></div>
          </div>
        </div>`).join('');
    },

    panel(count = 3) {
      return `<div class="vf-skel-panel" aria-hidden="true">${Array.from({ length: count }, () => `
        <div class="vf-skel-row">
          <div class="vf-skel vf-skel-av sm"></div>
          <div class="vf-skel-lines">
            <div class="vf-skel vf-skel-line mid"></div>
            <div class="vf-skel vf-skel-line short"></div>
          </div>
        </div>`).join('')}</div>`;
    },

    stats(count = 4) {
      return `<div class="vf-skel-stat-strip" aria-hidden="true">${Array.from({ length: count }, () => `
        <div class="vf-skel-stat">
          <div class="vf-skel vf-skel-line tiny"></div>
          <div class="vf-skel vf-skel-line" style="height:28px;width:48%"></div>
          <div class="vf-skel vf-skel-line short"></div>
        </div>`).join('')}</div>`;
    },

    tableRows(cols = 5, count = 6) {
      const cells = Array.from({ length: cols }, (_, i) =>
        `<div class="vf-skel vf-skel-line ${i === 0 ? 'mid' : i === cols - 1 ? 'short' : ''}"></div>`
      ).join('');
      return Array.from({ length: count }, () =>
        `<div class="vf-skel-tr" style="grid-template-columns:repeat(${cols},minmax(0,1fr))" aria-hidden="true">${cells}</div>`
      ).join('');
    },

    /** For real <tbody> placeholders — uses <tr><td colspan> */
    tbody(cols = 5, count = 6) {
      return Array.from({ length: count }, () => `
        <tr class="vf-skel-tr-native" aria-hidden="true">
          <td colspan="${cols}" style="padding:14px 12px;border-bottom:1px solid var(--border,#e4e8e3)">
            <div class="vf-skel-row">
              <div class="vf-skel vf-skel-line mid"></div>
              <div class="vf-skel vf-skel-line"></div>
              <div class="vf-skel vf-skel-line short"></div>
            </div>
          </td>
        </tr>`).join('');
    },

    block(tall = false) {
      return `<div class="vf-skel vf-skel-block${tall ? ' tall' : ''}" aria-hidden="true"></div>`;
    },

    hero() {
      return `<div class="vf-skel vf-skel-block hero" aria-hidden="true"></div>`;
    },

    fill(el, html) {
      if (el) el.innerHTML = html;
    },
  };

  const PASSWORD_MIN = 8;
  const PASSWORD_MAX = 64;
  const PASSWORD_SPECIAL_RE = /[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>\/?`~]/;
  const PASSWORD_HINT =
    `At least ${PASSWORD_MIN} characters, with uppercase, lowercase, a number, and a special character.`;

  function passwordChecks(password) {
    const value = String(password ?? '');
    return [
      { id: 'length',  label: `${PASSWORD_MIN}+ characters`, ok: value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX },
      { id: 'upper',   label: 'Uppercase letter',            ok: /[A-Z]/.test(value) },
      { id: 'lower',   label: 'Lowercase letter',            ok: /[a-z]/.test(value) },
      { id: 'number',  label: 'Number',                      ok: /[0-9]/.test(value) },
      { id: 'special', label: 'Special character (!@#$%)',   ok: PASSWORD_SPECIAL_RE.test(value) },
    ];
  }

  function isStrongPassword(password) {
    return passwordChecks(password).every((c) => c.ok);
  }

  function passwordErrorMessage(password) {
    const missing = passwordChecks(password).filter((c) => !c.ok).map((c) => c.label.toLowerCase());
    if (!missing.length) return null;
    if (missing.length === 1) return `Password must include ${missing[0]}.`;
    const last = missing.pop();
    return `Password must include ${missing.join(', ')}, and ${last}.`;
  }

  /** Live checklist under a password field. Call once after the input exists. */
  function bindPasswordChecklist(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;

    function render() {
      const checks = passwordChecks(input.value);
      list.innerHTML = checks.map((c) =>
        `<li class="pwd-check${c.ok ? ' ok' : ''}" data-check="${c.id}">
          <i class="ti ${c.ok ? 'ti-circle-check' : 'ti-circle'}" aria-hidden="true"></i>
          <span>${c.label}</span>
        </li>`
      ).join('');
    }

    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    render();
  }

  return {
    getState, setState, clearState, navigate,
    getToken, setToken, clearToken, isAuthenticated, apiFetch,
    roleFromToken, requireRole, fetchCurrentUser,
    API_BASE, uploadsUrl, fetchUploadObjectUrl, fetchUploadDownloadUrl, openUploadDocument,
    logoSrc, logoHtml,
    requireAuth, renderNavbar, renderApplyProgress, mountApplyProgress,
    setApplyStepProgress, bindApplyFormProgress,
    bindResponsiveBtnLabel, toast, skeleton,
    validateForm, initials, logout,
    syncApplicationState, routeTutor, routeTutorAsync, resumeTutorApplication,
    resolveTutorRoute, fetchTutorRouteState, tutorStateFromToken, onboardingCompleteFromApp, rejectionDetailFromApp,
    runEligibilityCheck, pageIn, gateApplicationWindow, homeUrl,
    PASSWORD_HINT, isStrongPassword, passwordErrorMessage, passwordChecks, bindPasswordChecklist,
  };
})();

// Inline onclick handlers (e.g. Log out in sidebars) resolve VF on window.
if (typeof window !== 'undefined') {
  window.VF = VF;
}
