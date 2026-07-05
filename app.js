/* Semester HQ — vanilla JS, no dependencies.
   All data stays in localStorage under semesterhq:v1. */
(function () {
  'use strict';

  // ============================================================
  // Helpers
  // ============================================================
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const live = $('#live');
  let liveTimer = null;
  function announce(msg) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { live.textContent = msg; }, 120);
  }

  // ============================================================
  // Date utilities — dates are local-time "YYYY-MM-DD" strings.
  // parseDate builds a LOCAL date (never new Date("YYYY-MM-DD"),
  // which parses as UTC and shifts a day in western timezones).
  // ============================================================
  const DAY_MS = 86400000;

  function parseDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function toISO(date) {
    const p = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
  }
  function todayISO() { return toISO(new Date()); }
  function addDays(iso, n) {
    const d = parseDate(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  // Monday of the week containing iso
  function startOfWeek(iso) {
    const d = parseDate(iso);
    const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
    d.setDate(d.getDate() - shift);
    return toISO(d);
  }
  // Whole days from a to b (b - a); Math.round absorbs DST hour shifts
  function daysBetween(aISO, bISO) {
    return Math.round((parseDate(bISO) - parseDate(aISO)) / DAY_MS);
  }
  // 1-based week of the semester (week 1 = week containing the start date)
  function weekOfSemester(startISO, dateISO) {
    return Math.floor(daysBetween(startOfWeek(startISO), dateISO) / 7) + 1;
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  const fmtLong = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtMonthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const fmtFull = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const fmtDayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
  const fLong = (iso) => fmtLong.format(parseDate(iso));
  const fMonthDay = (iso) => fmtMonthDay.format(parseDate(iso));
  const fFull = (iso) => fmtFull.format(parseDate(iso));

  // ============================================================
  // Store
  // ============================================================
  const KEY = 'semesterhq:v1';
  const THEME_KEY = 'semesterhq:theme';
  const EMPTY = {
    semester: null, courses: [], assignments: [], sample: false,
    meta: { lastBackupAt: null, changesSinceBackup: 0, nudgeSnoozedUntil: null, updatedAt: null }
  };

  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const HHMM_RE = /^\d{2}:\d{2}$/;

  // Defaults + sanitizes any stored/imported state into the current shape.
  // Older data (pre-schedule/subtasks/meta) passes through and gains defaults,
  // so this doubles as the schema migration.
  function normalizeState(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const meta = d.meta && typeof d.meta === 'object' ? d.meta : {};
    const out = {
      semester: d.semester || null,
      courses: Array.isArray(d.courses) ? d.courses : [],
      assignments: Array.isArray(d.assignments) ? d.assignments : [],
      sample: !!d.sample,
      meta: {
        lastBackupAt: typeof meta.lastBackupAt === 'string' ? meta.lastBackupAt : null,
        changesSinceBackup: Number.isInteger(meta.changesSinceBackup) && meta.changesSinceBackup >= 0
          ? meta.changesSinceBackup : 0,
        nudgeSnoozedUntil: ISO_RE.test(meta.nudgeSnoozedUntil || '') ? meta.nudgeSnoozedUntil : null,
        updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : null
      }
    };
    out.courses.forEach((c) => {
      const sched = Array.isArray(c.schedule) ? c.schedule : [];
      c.schedule = sched
        .filter((m) => m && typeof m === 'object')
        .map((m) => ({
          id: typeof m.id === 'string' ? m.id : uid(),
          days: Array.isArray(m.days)
            ? Array.from(new Set(m.days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)))
            : [],
          start: HHMM_RE.test(m.start || '') ? m.start : '',
          end: HHMM_RE.test(m.end || '') ? m.end : '',
          location: typeof m.location === 'string' ? m.location.slice(0, 60) : ''
        }))
        .filter((m) => m.days.length > 0 && m.start);
      c.schedule.forEach((m) => { if (m.end && m.end <= m.start) m.end = ''; });
    });
    out.assignments.forEach((a) => {
      const subs = Array.isArray(a.subtasks) ? a.subtasks : [];
      a.subtasks = subs
        .filter((s) => s && typeof s === 'object' && typeof s.title === 'string' && s.title.trim())
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : uid(),
          title: s.title.slice(0, 80),
          dueDate: ISO_RE.test(s.dueDate || '') ? s.dueDate : null,
          done: !!s.done
        }));
      if (typeof a.canvasUid !== 'string' || !a.canvasUid) delete a.canvasUid;
      else a.canvasUid = a.canvasUid.slice(0, 120);
    });
    return out;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(EMPTY);
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      return structuredClone(EMPTY);
    }
  }
  function save(opts) {
    if (!opts || !opts.silent) {
      state.meta.changesSinceBackup += 1;
      state.meta.updatedAt = new Date().toISOString();
      scheduleSyncPush();
    }
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  let state = load();

  // Gist-sync settings live in their own key so tokens never ride along
  // in backups or in the synced payload itself.
  const SYNC_KEY = 'semesterhq:sync';
  function loadSyncSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SYNC_KEY));
      return s && typeof s === 'object' && typeof s.token === 'string' ? s : null;
    } catch (e) { return null; }
  }
  function saveSyncSettings(s) {
    if (s) localStorage.setItem(SYNC_KEY, JSON.stringify(s));
    else localStorage.removeItem(SYNC_KEY);
  }
  let syncCfg = loadSyncSettings();

  const COLORS = [
    { key: 'green', label: 'Green' },
    { key: 'ochre', label: 'Ochre' },
    { key: 'violet', label: 'Violet' },
    { key: 'cyan', label: 'Cyan' },
    { key: 'rose', label: 'Rose' },
    { key: 'indigo', label: 'Indigo' }
  ];
  const TYPES = { assignment: 'Assignment', quiz: 'Quiz', exam: 'Exam', project: 'Project', reading: 'Reading' };

  const courseById = (id) => state.courses.find((c) => c.id === id) || null;
  const openCount = (courseId) =>
    state.assignments.filter((a) => a.courseId === courseId && a.status !== 'done').length;

  function hasAnyData() {
    return !!state.semester || state.courses.length > 0 || state.assignments.length > 0;
  }

  // ============================================================
  // Routing (hash → view)
  // ============================================================
  const VIEWS = ['week', 'upcoming', 'courses', 'calendar', 'about'];
  function currentView() {
    const h = location.hash.replace('#', '');
    return VIEWS.includes(h) ? h : 'week';
  }
  function showView() {
    const view = currentView();
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== view; });
    $$('.main-nav .nav-link').forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (view !== 'about') render();
  }

  // ============================================================
  // Rendering
  // ============================================================
  function render() {
    renderWeek();
    renderUpcoming();
    renderCourses();
    renderCalendar();
  }

  function chipHtml(course) {
    if (!course) return '';
    return '<span class="course-chip" style="color: var(--c-' + course.color + ')">' + esc(course.code) + '</span>';
  }

  // Assignment ids whose step lists are expanded (survives re-render)
  const expandedSubtasks = new Set();

  // Flattens assignments plus the dated subtasks of open assignments, so
  // Week and Upcoming can place steps on their own due dates. A done
  // parent hides its remaining steps — completing the assignment
  // completes the plan.
  function dueEntries(assignments) {
    const entries = [];
    assignments.forEach((a) => {
      entries.push({ kind: 'assignment', dueDate: a.dueDate, a });
      if (a.status !== 'done') {
        a.subtasks.forEach((s) => {
          if (s.dueDate) entries.push({ kind: 'subtask', dueDate: s.dueDate, a, s });
        });
      }
    });
    return entries;
  }

  function subtaskRowStandalone(e, opts) {
    const a = e.a, s = e.s;
    const course = courseById(a.courseId);
    const spine = course ? ' style="--row-spine: var(--c-' + course.color + ')"' : '';
    const today = todayISO();
    const overdue = !s.done && s.dueDate < today;
    const showDate = opts && opts.showDate;
    let note = '';
    if (showDate) {
      note = '<span class="due-note' + (overdue ? ' overdue-note' : '') + '">' +
        (overdue ? 'was due ' : 'due ') + fLong(s.dueDate) + '</span>';
    } else if (overdue) {
      const late = daysBetween(s.dueDate, today);
      note = '<span class="due-note overdue-note">' + late + ' day' + (late === 1 ? '' : 's') + ' late</span>';
    }
    return (
      '<li class="item-row subtask-row' + (s.done ? ' done-item' : '') + '" data-id="' + a.id + '"' + spine + '>' +
        '<input type="checkbox" class="item-check subtask-check" data-sub-id="' + s.id + '" ' + (s.done ? 'checked ' : '') +
          'aria-label="Mark step &quot;' + esc(s.title) + '&quot; ' + (s.done ? 'not done' : 'done') + '">' +
        '<div class="item-main">' +
          '<div class="item-title"><span class="subtask-arrow" aria-hidden="true">↳</span> ' + esc(s.title) + '</div>' +
          '<div class="item-meta">' +
            chipHtml(course) +
            '<span class="type-tag">step of “' + esc(a.title) + '”</span>' +
            note +
          '</div>' +
        '</div>' +
      '</li>'
    );
  }

  function entryRowHtml(e, opts) {
    return e.kind === 'assignment' ? itemRowHtml(e.a, opts) : subtaskRowStandalone(e, opts);
  }

  function itemRowHtml(a, opts) {
    const course = courseById(a.courseId);
    const done = a.status === 'done';
    const today = todayISO();
    const overdue = !done && a.dueDate < today;
    const showDate = opts && opts.showDate;
    const spine = course ? ' style="--row-spine: var(--c-' + course.color + ')"' : '';
    let dueNote = '';
    if (showDate) {
      dueNote = '<span class="due-note' + (overdue ? ' overdue-note' : '') + '">' +
        (overdue ? 'was due ' : 'due ') + fLong(a.dueDate) + '</span>';
    } else if (overdue) {
      const late = daysBetween(a.dueDate, today);
      dueNote = '<span class="due-note overdue-note">' + late + ' day' + (late === 1 ? '' : 's') + ' late</span>';
    }
    const subs = a.subtasks || [];
    let stepsChip = '', stepsList = '';
    if (subs.length) {
      const doneN = subs.filter((s) => s.done).length;
      const expanded = expandedSubtasks.has(a.id);
      stepsChip =
        '<button class="steps-chip" type="button" data-action="toggle-subtasks" aria-expanded="' + expanded + '" ' +
          'aria-label="' + (expanded ? 'Hide' : 'Show') + ' steps for &quot;' + esc(a.title) + '&quot;">' +
          doneN + '/' + subs.length + ' steps <span class="chev" aria-hidden="true">' + (expanded ? '▴' : '▾') + '</span>' +
        '</button>';
      if (expanded) {
        stepsList =
          '<ul class="subtask-list">' + subs.map((s) =>
            '<li class="subtask-item' + (s.done ? ' done-sub' : '') + '">' +
              '<input type="checkbox" class="item-check subtask-check" data-sub-id="' + s.id + '" ' + (s.done ? 'checked ' : '') +
                'aria-label="Mark step &quot;' + esc(s.title) + '&quot; ' + (s.done ? 'not done' : 'done') + '">' +
              '<span class="subtask-text">' + esc(s.title) + '</span>' +
              (s.dueDate ? '<span class="subtask-due-chip">' + fMonthDay(s.dueDate) + '</span>' : '') +
            '</li>'
          ).join('') + '</ul>';
      }
    }
    return (
      '<li class="item-row' + (done ? ' done-item' : '') + '" data-id="' + a.id + '"' + spine + '>' +
        '<input type="checkbox" class="item-check" ' + (done ? 'checked ' : '') +
          'aria-label="Mark &quot;' + esc(a.title) + '&quot; ' + (done ? 'not done' : 'done') + '">' +
        '<div class="item-main">' +
          '<div class="item-title">' + esc(a.title) + '</div>' +
          '<div class="item-meta">' +
            chipHtml(course) +
            '<span class="type-tag type-' + a.type + '">' + TYPES[a.type] + '</span>' +
            dueNote +
            stepsChip +
            (a.notes ? '<span class="item-notes">' + esc(a.notes) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="item-actions">' +
          '<button class="btn-icon" type="button" data-action="edit-assignment" aria-label="Edit &quot;' + esc(a.title) + '&quot;">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.5 7.5 3 3"/></svg>' +
          '</button>' +
          '<button class="btn-icon danger" type="button" data-action="delete-assignment" aria-label="Delete &quot;' + esc(a.title) + '&quot;">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/></svg>' +
          '</button>' +
        '</div>' +
        stepsList +
      '</li>'
    );
  }

  // ---- This Week ----
  function renderWeek() {
    const el = $('#week-content');

    if (!state.semester) {
      el.innerHTML =
        '<div class="welcome">' +
          '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14"></rect><path d="M18 34l10 10 18-24" fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path></svg>' +
          '<h2>Your semester, at a glance</h2>' +
          '<p>Add your courses and due dates once — then this page answers one question all semester: <strong>what does my week look like?</strong></p>' +
          '<div class="empty-actions">' +
            '<button class="btn btn-primary" type="button" data-action="setup-semester">Set up my semester</button>' +
            '<button class="btn btn-ghost" type="button" data-action="load-sample">Try it with sample data</button>' +
          '</div>' +
          '<p class="privacy-note footer-note">Free, no account — everything stays in your browser.</p>' +
        '</div>';
      return;
    }

    const sem = state.semester;
    const today = todayISO();
    const totalW = weekOfSemester(sem.startDate, sem.endDate);
    const rawW = weekOfSemester(sem.startDate, today);
    const week = clamp(rawW, 1, totalW);
    const monday = startOfWeek(today);
    const notStarted = today < sem.startDate;
    const ended = today > sem.endDate;

    const pad2 = (n) => String(n).padStart(2, '0');
    const weekNum = notStarted ? 0 : week;
    const ahead = state.assignments.filter((a) => a.status !== 'done' && a.dueDate >= today).length;

    let eyebrow;
    if (notStarted) {
      eyebrow = esc(sem.name) + ' · Starts ' + fMonthDay(sem.startDate);
    } else if (ended) {
      eyebrow = esc(sem.name) + ' · Complete 🎉';
    } else {
      eyebrow = esc(sem.name) + (ahead > 0 ? ' · ' + ahead + ' item' + (ahead === 1 ? '' : 's') + ' ahead' : '');
    }

    let ticks = '';
    for (let i = 1; i <= totalW; i++) {
      const cls = (ended || (!notStarted && i < week)) ? ' past'
        : (!notStarted && !ended && i === week) ? ' current' : '';
      ticks += '<span class="tick' + cls + '"></span>';
    }

    let html = '';
    if (state.sample) {
      html +=
        '<div class="sample-banner"><span><strong>Sample data.</strong> Poke around — nothing here is saved as yours.</span>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-action="clear-sample">Clear sample &amp; start fresh</button></div>';
    }

    const meta = state.meta;
    const backupDue = !state.sample && meta.changesSinceBackup > 0 &&
      (!meta.nudgeSnoozedUntil || today > meta.nudgeSnoozedUntil) &&
      (meta.lastBackupAt === null
        ? meta.changesSinceBackup >= 15
        : daysBetween(meta.lastBackupAt.slice(0, 10), today) >= 7);
    if (backupDue) {
      const msg = meta.lastBackupAt === null
        ? 'You’ve added ' + meta.changesSinceBackup + ' changes and never downloaded a backup.'
        : 'It’s been ' + daysBetween(meta.lastBackupAt.slice(0, 10), today) + ' days since your last backup.';
      html +=
        '<div class="backup-banner"><span><strong>Back up your data.</strong> ' + msg + '</span>' +
        '<span class="banner-actions">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-action="export-backup">Back up now</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-backup-nudge">Later</button>' +
        '</span></div>';
    }

    html +=
      '<div class="hero-band">' +
        '<div class="hero-left">' +
          '<div class="hero-eyebrow"><span>' + eyebrow + '</span>' +
            '<button class="btn-icon" type="button" data-action="edit-semester" aria-label="Edit semester name and dates">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.5 7.5 3 3"/></svg>' +
            '</button></div>' +
          '<div class="hero-week">Week ' + pad2(weekNum) + ' <span class="hero-total">/ ' + totalW + '</span></div>' +
        '</div>' +
        '<div class="spine-wrap">' +
          '<div class="spine" role="img" aria-label="Semester progress: week ' + weekNum + ' of ' + totalW + '">' + ticks + '</div>' +
          '<div class="spine-caption">' + fMonthDay(sem.startDate) + ' —— ' + fMonthDay(sem.endDate) + '</div>' +
        '</div>' +
      '</div>';

    if (state.courses.length === 0) {
      html +=
        '<div class="empty">' +
          '<h2>Add your first course</h2>' +
          '<p>Courses give every assignment a home (and a color). Start with the one due soonest.</p>' +
          '<div class="empty-actions"><button class="btn btn-primary" type="button" data-action="add-course">+ Add a course</button></div>' +
        '</div>';
      el.innerHTML = html;
      return;
    }

    if (!notStarted && !ended) {
      const meetings = SHQ.meetingsToday(state.courses, parseDate(today).getDay());
      if (meetings.length) {
        html +=
          '<div class="today-classes">' +
            '<span class="today-classes-label">Today’s classes</span>' +
            meetings.map(({ course, meeting }) =>
              '<span class="class-chip" style="--row-spine: var(--c-' + course.color + ')">' +
                '<span class="class-chip-code" style="color: var(--c-' + course.color + ')">' + esc(course.code) + '</span>' +
                '<span class="class-chip-time">' + SHQ.formatMeetingTime(meeting) +
                  (meeting.location ? ' · ' + esc(meeting.location) : '') + '</span>' +
              '</span>'
            ).join('') +
          '</div>';
      }
    }

    // Assignments plus dated steps, each on its own due date
    const entries = dueEntries(state.assignments);
    const entryDone = (e) => e.kind === 'assignment' ? e.a.status === 'done' : e.s.done;

    // Overdue: anything unfinished with a due date before today
    const overdue = entries
      .filter((e) => !entryDone(e) && e.dueDate < today)
      .sort((x, y) => x.dueDate.localeCompare(y.dueDate));

    // This calendar week's items, grouped by day (todo from today on, plus anything done this week)
    const sunday = addDays(monday, 6);
    const thisWeek = state.assignments.filter((a) => a.dueDate >= monday && a.dueDate <= sunday);
    const weekEntries = entries.filter((e) => e.dueDate >= monday && e.dueDate <= sunday);
    const dayGroups = [];
    for (let i = 0; i < 7; i++) {
      const dayISO = addDays(monday, i);
      const items = weekEntries
        .filter((e) => e.dueDate === dayISO && (entryDone(e) || e.dueDate >= today))
        .sort((x, y) => entryDone(x) - entryDone(y));
      if (items.length) dayGroups.push({ dayISO, items });
    }

    let listHtml = '';
    if (overdue.length) {
      listHtml +=
        '<div class="day-group">' +
          '<h3 class="day-head overdue-head"><span class="overdue-label">Overdue</span>' +
            '<span class="day-rule"></span><span class="overdue-count">' + pad2(overdue.length) + '</span></h3>' +
          '<ul class="item-list">' + overdue.map((e) => entryRowHtml(e)).join('') + '</ul>' +
        '</div>';
    }
    dayGroups.forEach((g) => {
      const isToday = g.dayISO === today;
      listHtml +=
        '<div class="day-group">' +
          '<h3 class="day-head"><span class="day-name">' + fmtDayName.format(parseDate(g.dayISO)) + '</span>' +
            '<span class="day-date">' + fMonthDay(g.dayISO) + '</span>' +
            (isToday ? '<span class="today-tag">Today</span>' : '') +
            '<span class="day-rule"></span></h3>' +
          '<ul class="item-list">' + g.items.map((e) => entryRowHtml(e)).join('') + '</ul>' +
        '</div>';
    });
    if (!overdue.length && !dayGroups.length) {
      listHtml +=
        '<div class="empty">' +
          '<h2>Nothing due this week</h2>' +
          '<p>Enjoy it — or get ahead. Add anything on the horizon so future-you sees it coming.</p>' +
          '<div class="empty-actions"><button class="btn btn-primary" type="button" data-action="add-assignment">+ Add an assignment</button></div>' +
        '</div>';
    } else {
      listHtml +=
        '<p><button class="btn-add-dashed" type="button" data-action="add-assignment">+ Add assignment</button></p>';
    }

    // Load rail: due items per day this week, one horizontal bar per day
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const counts = dayNames.map((_, i) => {
      const dayISO = addDays(monday, i);
      return thisWeek.filter((a) => a.dueDate === dayISO).length;
    });
    const max = Math.max(1, ...counts);
    const total = counts.reduce((s, n) => s + n, 0);
    const chartSummary = total === 0
      ? 'No items due this week.'
      : dayNames.map((n, i) => counts[i] ? counts[i] + ' due ' + n : null).filter(Boolean).join(', ') + '.';
    const railRows = dayNames.map((name, i) => {
      const isT = addDays(monday, i) === today;
      const zero = counts[i] === 0;
      const w = zero ? 0 : Math.round((counts[i] / max) * 100);
      return (
        '<div class="rail-row' + (isT ? ' is-today' : '') + '">' +
          '<span class="rail-day">' + name + '</span>' +
          '<span class="rail-barwrap">' +
            (zero ? '<span class="rail-bar rail-bar-zero"></span>'
                  : '<span class="rail-bar" style="width:' + w + '%"></span>') +
          '</span>' +
          '<span class="rail-count' + (zero ? ' is-zero' : '') + '">' + (zero ? '—' : counts[i]) + '</span>' +
        '</div>'
      );
    }).join('');
    let railFoot = '';
    if (total > 0) {
      const peak = Math.max(...counts);
      const heaviest = dayNames.filter((_, i) => counts[i] === peak).join(', ');
      const clear = dayNames.filter((_, i) => counts[i] === 0).join(', ');
      railFoot = '<div class="rail-foot">Heaviest: ' + heaviest + (clear ? ' / Clear: ' + clear : '') + '</div>';
    }
    const railSub = total + ' due' + (overdue.length ? ' · ' + overdue.length + ' overdue' : '');

    html +=
      '<div class="week-body">' +
        '<div class="week-list">' + listHtml + '</div>' +
        '<aside class="load-rail">' +
          '<h2 class="rail-title">This week’s<br>load</h2>' +
          '<p class="rail-sub">' + railSub + '</p>' +
          '<div class="rail-rows" role="img" aria-label="Due items by day. ' + esc(chartSummary) + '">' + railRows + '</div>' +
          railFoot +
        '</aside>' +
      '</div>';

    el.innerHTML = html;
  }

  // ---- Upcoming ----
  function renderUpcoming() {
    const el = $('#upcoming-content');
    const filters = $('#upcoming-filters');

    if (!state.semester) {
      filters.hidden = true;
      el.innerHTML =
        '<div class="empty">' +
          '<h2>Set up your semester first</h2>' +
          '<p>Once your semester and courses are in, every due date lands here — grouped by week.</p>' +
          '<div class="empty-actions"><button class="btn btn-primary" type="button" data-action="setup-semester">Set up my semester</button></div>' +
        '</div>';
      return;
    }

    // keep course filter options in sync
    const sel = $('#filter-course');
    const chosen = sel.value;
    sel.innerHTML = '<option value="">All courses</option>' +
      state.courses.map((c) => '<option value="' + c.id + '">' + esc(c.code) + '</option>').join('');
    if (state.courses.some((c) => c.id === chosen)) sel.value = chosen;

    const courseF = sel.value;
    const typeF = $('#filter-type').value;
    const showDone = $('#filter-done').checked;

    let items = state.assignments.slice();
    if (courseF) items = items.filter((a) => a.courseId === courseF);
    if (typeF) items = items.filter((a) => a.type === typeF);
    if (!showDone) items = items.filter((a) => a.status !== 'done');
    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));

    filters.hidden = state.assignments.length === 0;

    if (state.assignments.length === 0) {
      el.innerHTML =
        '<div class="empty">' +
          '<h2>No assignments yet</h2>' +
          '<p>' + (state.courses.length === 0
            ? 'Add a course first, then start capturing due dates.'
            : 'Add everything from your syllabi now — future-you will thank you weekly.') + '</p>' +
          '<div class="empty-actions">' +
            (state.courses.length === 0
              ? '<button class="btn btn-primary" type="button" data-action="add-course">+ Add a course</button>'
              : '<button class="btn btn-primary" type="button" data-action="add-assignment">+ Add an assignment</button>') +
          '</div>' +
        '</div>';
      return;
    }

    if (items.length === 0) {
      el.innerHTML =
        '<div class="empty"><h2>Nothing matches</h2><p>No ' + (showDone ? '' : 'open ') + 'items for these filters.</p></div>';
      return;
    }

    // Assignments plus dated steps of open assignments
    const entries = [];
    items.forEach((a) => {
      entries.push({ kind: 'assignment', dueDate: a.dueDate, a });
      if (a.status !== 'done') {
        a.subtasks.forEach((s) => {
          if (s.dueDate && (showDone || !s.done)) entries.push({ kind: 'subtask', dueDate: s.dueDate, a, s });
        });
      }
    });
    entries.sort((x, y) => x.dueDate.localeCompare(y.dueDate) ||
      (x.kind === 'subtask' ? x.s.title : x.a.title).localeCompare(y.kind === 'subtask' ? y.s.title : y.a.title));

    const today = todayISO();
    const thisMon = startOfWeek(today);
    const groups = new Map(); // label -> entries
    entries.forEach((e) => {
      const done = e.kind === 'assignment' ? e.a.status === 'done' : e.s.done;
      let label;
      if (!done && e.dueDate < today) {
        label = 'Overdue';
      } else {
        const diff = Math.round(daysBetween(thisMon, startOfWeek(e.dueDate)) / 7);
        if (diff < 0) label = 'Earlier';
        else if (diff === 0) label = 'This week';
        else if (diff === 1) label = 'Next week';
        else label = 'Week of ' + fMonthDay(startOfWeek(e.dueDate));
      }
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(e);
    });

    // Overdue first, Earlier last-but-orderly, rest in due order (map preserves insertion of sorted items, but Overdue may appear late)
    const ordered = [];
    if (groups.has('Overdue')) ordered.push(['Overdue', groups.get('Overdue')]);
    if (groups.has('Earlier')) ordered.push(['Earlier', groups.get('Earlier')]);
    groups.forEach((v, k) => { if (k !== 'Overdue' && k !== 'Earlier') ordered.push([k, v]); });

    el.innerHTML = ordered.map(([label, arr]) =>
      '<h2 class="week-section-head' + (label === 'Overdue' ? ' overdue-head' : '') + '">' + label + ' · ' + arr.length + '</h2>' +
      '<ul class="item-list">' + arr.map((e) => entryRowHtml(e, { showDate: true })).join('') + '</ul>'
    ).join('');
  }

  // ---- Courses ----
  function renderCourses() {
    const el = $('#courses-content');
    if (state.courses.length === 0) {
      el.innerHTML =
        '<div class="empty">' +
          '<h2>No courses yet</h2>' +
          '<p>' + (state.semester
            ? 'Each course gets a color so you can spot it everywhere at a glance.'
            : 'Set up your semester first, then add courses.') + '</p>' +
          '<div class="empty-actions">' +
            (state.semester
              ? '<button class="btn btn-primary" type="button" data-action="add-course">+ Add a course</button>'
              : '<button class="btn btn-primary" type="button" data-action="setup-semester">Set up my semester</button>') +
          '</div>' +
        '</div>';
      return;
    }
    el.innerHTML =
      '<div class="course-grid">' +
      state.courses.map((c) => {
        const n = openCount(c.id);
        return (
          '<div class="card course-card" data-id="' + c.id + '">' +
            '<div class="course-top"><span class="dot" style="--dot-color: var(--c-' + c.color + ')"></span>' +
              '<span class="course-code">' + esc(c.code) + '</span></div>' +
            '<div class="course-name">' + esc(c.name) + '</div>' +
            (c.schedule.length
              ? '<div class="course-schedule">' + c.schedule.map((m) =>
                  SHQ.formatMeetingDays(m.days) + ' · ' + SHQ.formatMeetingTime(m) +
                  (m.location ? ' · ' + esc(m.location) : '')
                ).join('<br>') + '</div>'
              : '') +
            '<div class="course-count">' + (n === 0 ? 'All caught up' : n + ' open item' + (n === 1 ? '' : 's')) + '</div>' +
            '<div class="item-actions">' +
              '<button class="btn-icon" type="button" data-action="edit-course" aria-label="Edit ' + esc(c.code) + '">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.5 7.5 3 3"/></svg>' +
              '</button>' +
              '<button class="btn-icon danger" type="button" data-action="delete-course" aria-label="Delete ' + esc(c.code) + '">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>'
        );
      }).join('') +
      '</div>';
  }

  // ---- Calendar ----
  // Month being shown, as "YYYY-MM". Session-only on purpose: a reload
  // should always land on the current month.
  let calCursor = null;
  const fmtMonthYear = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  const CAL_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function calMonthLabel(cursor) {
    const [y, m] = cursor.split('-').map(Number);
    return fmtMonthYear.format(new Date(y, m - 1, 1));
  }
  function calShift(cursor, delta) {
    let [y, m] = cursor.split('-').map(Number);
    m += delta;
    if (m < 1) { m += 12; y -= 1; } else if (m > 12) { m -= 12; y += 1; }
    return y + '-' + String(m).padStart(2, '0');
  }

  function calEventHtml(e) {
    const a = e.a;
    const course = courseById(a.courseId);
    const done = e.kind === 'assignment' ? a.status === 'done' : e.s.done;
    const overdue = !done && e.dueDate < todayISO();
    const title = e.kind === 'subtask' ? e.s.title : a.title;
    const spine = course ? ' style="--row-spine: var(--c-' + course.color + ')"' : '';
    return (
      '<button class="cal-event' + (done ? ' done-item' : '') + (overdue ? ' cal-overdue' : '') + '" type="button" ' +
        'data-id="' + a.id + '" data-action="edit-assignment"' + spine +
        ' aria-label="Edit &quot;' + esc(title) + '&quot;">' +
        (e.kind === 'subtask' ? '<span class="subtask-arrow" aria-hidden="true">↳</span> ' : '') +
        '<span class="cal-event-title">' + esc(title) + '</span>' +
      '</button>'
    );
  }

  function renderCalendar() {
    const el = $('#calendar-content');
    if (!state.semester) {
      el.innerHTML =
        '<div class="empty">' +
          '<h2>Set up your semester first</h2>' +
          '<p>The calendar shows every class meeting and due date, one month at a glance.</p>' +
          '<div class="empty-actions"><button class="btn btn-primary" type="button" data-action="setup-semester">Set up my semester</button></div>' +
        '</div>';
      return;
    }

    if (!calCursor) calCursor = todayISO().slice(0, 7);
    const [y, m] = calCursor.split('-').map(Number);
    const weeks = SHQ.monthGrid(y, m - 1);
    const today = todayISO();
    const semStart = state.semester.startDate, semEnd = state.semester.endDate;

    const byDate = new Map();
    dueEntries(state.assignments).forEach((e) => {
      if (!byDate.has(e.dueDate)) byDate.set(e.dueDate, []);
      byDate.get(e.dueDate).push(e);
    });
    // Meeting dots per weekday: index 0=Mon … 6=Sun to match the grid.
    const dotsByCol = CAL_DOW.map((_, i) => {
      const meets = SHQ.meetingsToday(state.courses, (i + 1) % 7);
      const colors = [];
      meets.forEach((x) => { if (colors.indexOf(x.course.color) === -1) colors.push(x.course.color); });
      return colors.map((c) => '<span class="cal-dot" style="background: var(--c-' + c + ')"></span>').join('');
    });

    const cells = weeks.map((week) => week.map((iso, i) => {
      const inMonth = iso.slice(0, 7) === calCursor;
      const inSem = iso >= semStart && iso <= semEnd;
      const cls = 'cal-cell' +
        (inMonth ? '' : ' cal-outside') +
        (inSem ? '' : ' cal-out-sem') +
        (iso === today ? ' is-today' : '');
      const dayEntries = byDate.get(iso) || [];
      const shown = dayEntries.slice(0, 3);
      const moreN = dayEntries.length - shown.length;
      const semTag = iso === semStart ? '<span class="cal-sem-tag">starts</span>'
        : iso === semEnd ? '<span class="cal-sem-tag">ends</span>' : '';
      const dots = inMonth && inSem && dotsByCol[i]
        ? '<span class="cal-dots" aria-hidden="true">' + dotsByCol[i] + '</span>' : '';
      return (
        '<div class="' + cls + '">' +
          '<div class="cal-cell-top">' +
            '<button class="cal-daynum" type="button" data-action="add-assignment-date" data-date="' + iso + '" ' +
              'aria-label="Add assignment due ' + fFull(iso) + '">' + Number(iso.slice(8, 10)) + '</button>' +
            semTag + dots +
          '</div>' +
          shown.map(calEventHtml).join('') +
          (moreN > 0 ? '<span class="cal-more">+' + moreN + ' more</span>' : '') +
        '</div>'
      );
    }).join('')).join('');

    el.innerHTML =
      '<div class="view-header cal-toolbar">' +
        '<h2 class="cal-title">' + calMonthLabel(calCursor) + '</h2>' +
        '<div class="cal-nav">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-action="cal-today">Today</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-action="cal-prev" aria-label="Previous month"><span aria-hidden="true">‹</span></button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-action="cal-next" aria-label="Next month"><span aria-hidden="true">›</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="cal-head" aria-hidden="true">' + CAL_DOW.map((d) => '<span>' + d + '</span>').join('') + '</div>' +
      '<div class="cal-grid">' + cells + '</div>';
  }

  // ============================================================
  // Dialogs
  // ============================================================
  function openDialog(dlg, focusEl) {
    dlg.showModal();
    if (focusEl) focusEl.focus();
  }
  function setFieldError(input, errEl, msg) {
    if (msg) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', errEl.id);
      errEl.textContent = msg;
      errEl.hidden = false;
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      errEl.hidden = true;
    }
  }

  // ---- confirm ----
  let confirmResolve = null;
  function confirmAsk(message, label) {
    const dlg = $('#dlg-confirm');
    $('#dlg-confirm-message').textContent = message;
    $('#confirm-accept').textContent = label || 'Delete';
    openDialog(dlg, $('#confirm-accept'));
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  $('#confirm-accept').addEventListener('click', () => {
    $('#dlg-confirm').close();
    if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
  });
  $('#dlg-confirm').addEventListener('close', () => {
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  });

  // ---- clear-all (typed confirmation) ----
  $('#clear-confirm-input').addEventListener('input', () => {
    $('#clear-accept').disabled = $('#clear-confirm-input').value.trim().toLowerCase() !== 'delete';
  });
  $('#clear-accept').addEventListener('click', () => {
    $('#dlg-clear').close();
    doClearAll();
  });

  // ---- semester ----
  function openSemesterDialog() {
    const dlg = $('#dlg-semester');
    const sem = state.semester;
    $('#dlg-semester-title').textContent = sem ? 'Edit semester' : 'Set up your semester';
    $('#semester-submit').textContent = sem ? 'Save changes' : 'Save semester';
    $('#semester-name').value = sem ? sem.name : '';
    $('#semester-start').value = sem ? sem.startDate : '';
    $('#semester-end').value = sem ? sem.endDate : '';
    setFieldError($('#semester-name'), $('#semester-name-error'), null);
    $('#semester-dates-error').hidden = true;
    openDialog(dlg, $('#semester-name'));
  }

  $('#form-semester').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#semester-name').value.trim();
    const start = $('#semester-start').value;
    const end = $('#semester-end').value;
    let ok = true;
    setFieldError($('#semester-name'), $('#semester-name-error'), name ? null : 'Give your semester a name.');
    if (!name) ok = false;
    const datesErr = $('#semester-dates-error');
    if (!start || !end) {
      datesErr.textContent = 'Pick both a first and a last day.';
      datesErr.hidden = false; ok = false;
    } else if (end <= start) {
      datesErr.textContent = 'The last day needs to come after the first day.';
      datesErr.hidden = false; ok = false;
    } else if (daysBetween(start, end) > 370) {
      datesErr.textContent = 'That’s over a year — double-check those dates.';
      datesErr.hidden = false; ok = false;
    } else {
      datesErr.hidden = true;
    }
    if (!ok) return;
    const isNew = !state.semester;
    state.semester = { name, startDate: start, endDate: end };
    if (state.sample) state.sample = false;
    save();
    $('#dlg-semester').close();
    announce(isNew ? 'Semester saved. Next: add a course.' : 'Semester updated.');
    render();
  });

  // ---- course ----
  let editingCourseId = null;
  function leastUsedColor() {
    const used = state.courses.map((c) => c.color);
    let best = COLORS[0].key, bestN = Infinity;
    COLORS.forEach((c) => {
      const n = used.filter((u) => u === c.key).length;
      if (n < bestN) { bestN = n; best = c.key; }
    });
    return best;
  }
  // Mon-first day toggles; values are Date.getDay() ints
  const MEETING_DAYS = [[1, 'M'], [2, 'Tu'], [3, 'W'], [4, 'Th'], [5, 'F'], [6, 'Sa'], [0, 'Su']];

  function meetingRowHtml(m) {
    const days = m && m.days ? m.days : [];
    return (
      '<div class="meeting-row"' + (m && m.id ? ' data-meeting-id="' + m.id + '"' : '') + '>' +
        '<div class="meeting-days" role="group" aria-label="Meeting days">' +
          MEETING_DAYS.map(([v, label]) =>
            '<label class="day-toggle"><input type="checkbox" class="meeting-day" value="' + v + '"' +
              (days.indexOf(v) !== -1 ? ' checked' : '') + ' aria-label="' + label + '"><span>' + label + '</span></label>'
          ).join('') +
        '</div>' +
        '<div class="meeting-fields">' +
          '<input type="time" class="meeting-start" value="' + (m && m.start ? m.start : '') + '" aria-label="Start time">' +
          '<span class="meeting-dash" aria-hidden="true">–</span>' +
          '<input type="time" class="meeting-end" value="' + (m && m.end ? m.end : '') + '" aria-label="End time">' +
          '<input type="text" class="meeting-location" maxlength="60" placeholder="Location" value="' + esc(m && m.location ? m.location : '') + '" aria-label="Location">' +
          '<button class="btn-icon danger" type="button" data-action="remove-meeting" aria-label="Remove meeting time">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>'
    );
  }

  // Rows with no days or no start time are dropped; an end time that
  // isn't after the start is discarded rather than blocking the save.
  function readScheduleFromForm() {
    return $$('#course-meetings .meeting-row').map((row) => {
      const days = $$('.meeting-day', row).filter((cb) => cb.checked).map((cb) => +cb.value);
      const start = $('.meeting-start', row).value;
      let end = $('.meeting-end', row).value;
      if (end && (!start || end <= start)) end = '';
      return {
        id: row.dataset.meetingId || uid(),
        days, start, end,
        location: $('.meeting-location', row).value.trim().slice(0, 60)
      };
    }).filter((m) => m.days.length > 0 && m.start);
  }

  function openCourseDialog(id) {
    editingCourseId = id || null;
    const course = id ? courseById(id) : null;
    const dlg = $('#dlg-course');
    $('#dlg-course-title').textContent = course ? 'Edit course' : 'Add a course';
    $('#course-submit').textContent = course ? 'Save changes' : 'Save course';
    $('#course-code').value = course ? course.code : '';
    $('#course-name').value = course ? course.name : '';
    const chosen = course ? course.color : leastUsedColor();
    $('#course-swatches').innerHTML = COLORS.map((c) =>
      '<label class="swatch" title="' + c.label + '">' +
        '<input type="radio" name="course-color" value="' + c.key + '"' + (c.key === chosen ? ' checked' : '') +
          ' aria-label="' + c.label + '">' +
        '<span class="swatch-fill" style="--swatch-color: var(--c-' + c.key + ')"></span>' +
      '</label>'
    ).join('');
    $('#course-meetings').innerHTML = (course && course.schedule.length)
      ? course.schedule.map(meetingRowHtml).join('')
      : '';
    setFieldError($('#course-code'), $('#course-code-error'), null);
    setFieldError($('#course-name'), $('#course-name-error'), null);
    openDialog(dlg, $('#course-code'));
  }

  $('#form-course').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#course-code').value.trim();
    const name = $('#course-name').value.trim();
    setFieldError($('#course-code'), $('#course-code-error'), code ? null : 'Required.');
    setFieldError($('#course-name'), $('#course-name-error'), name ? null : 'Give the course a name.');
    if (!code || !name) return;
    const color = ($('input[name="course-color"]:checked') || {}).value || COLORS[0].key;
    const schedule = readScheduleFromForm();
    if (editingCourseId) {
      const c = courseById(editingCourseId);
      if (c) { c.code = code; c.name = name; c.color = color; c.schedule = schedule; }
      announce(code + ' updated.');
    } else {
      state.courses.push({ id: uid(), code, name, color, schedule });
      announce(code + ' added.' + (state.assignments.length === 0 ? ' Next: add an assignment.' : ''));
    }
    save();
    $('#dlg-course').close();
    render();
  });

  // ---- assignment ----
  let editingAssignmentId = null;

  function subtaskFormRowHtml(s) {
    return (
      '<div class="subtask-form-row"' + (s && s.id ? ' data-sub-id="' + s.id + '"' : '') + '>' +
        '<input type="text" class="subtask-title" maxlength="80" placeholder="e.g. Draft outline" value="' + esc(s ? s.title : '') + '" aria-label="Step description">' +
        '<input type="date" class="subtask-due" value="' + (s && s.dueDate ? s.dueDate : '') + '" aria-label="Step due date (optional)">' +
        '<button class="btn-icon danger" type="button" data-action="remove-subtask-row" aria-label="Remove step">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</div>'
    );
  }

  // Existing rows carry data-sub-id so a step keeps its id and done state
  // through an edit; blank-title rows are dropped.
  function readSubtasksFromForm(existing) {
    const prev = new Map((existing || []).map((s) => [s.id, s]));
    return $$('#assignment-subtasks .subtask-form-row').map((row) => {
      const title = $('.subtask-title', row).value.trim().slice(0, 80);
      if (!title) return null;
      const id = row.dataset.subId || uid();
      const old = prev.get(id);
      const due = $('.subtask-due', row).value;
      return { id, title, dueDate: ISO_RE.test(due) ? due : null, done: old ? old.done : false };
    }).filter(Boolean);
  }

  function openAssignmentDialog(id, presetDate) {
    if (state.courses.length === 0) {
      announce('Add a course first — assignments need a home.');
      openCourseDialog();
      return;
    }
    editingAssignmentId = id || null;
    const a = id ? state.assignments.find((x) => x.id === id) : null;
    const dlg = $('#dlg-assignment');
    $('#dlg-assignment-title').textContent = a ? 'Edit assignment' : 'Add an assignment';
    $('#assignment-submit').textContent = a ? 'Save changes' : 'Save assignment';
    $('#assignment-title').value = a ? a.title : '';
    $('#assignment-course').innerHTML = state.courses.map((c) =>
      '<option value="' + c.id + '">' + esc(c.code) + ' — ' + esc(c.name) + '</option>'
    ).join('');
    if (a) $('#assignment-course').value = a.courseId;
    $('#assignment-type').value = a ? a.type : 'assignment';
    $('#assignment-due').value = a ? a.dueDate : (presetDate || '');
    $('#assignment-notes').value = a ? (a.notes || '') : '';
    $('#assignment-subtasks').innerHTML = a ? a.subtasks.map(subtaskFormRowHtml).join('') : '';
    setFieldError($('#assignment-title'), $('#assignment-title-error'), null);
    setFieldError($('#assignment-due'), $('#assignment-due-error'), null);
    openDialog(dlg, $('#assignment-title'));
  }

  $('#form-assignment').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#assignment-title').value.trim();
    const due = $('#assignment-due').value;
    setFieldError($('#assignment-title'), $('#assignment-title-error'), title ? null : 'What’s due?');
    setFieldError($('#assignment-due'), $('#assignment-due-error'), due ? null : 'Pick a due date.');
    if (!title || !due) return;
    const existing = editingAssignmentId ? state.assignments.find((x) => x.id === editingAssignmentId) : null;
    const data = {
      title,
      courseId: $('#assignment-course').value,
      type: $('#assignment-type').value,
      dueDate: due,
      notes: $('#assignment-notes').value.trim(),
      subtasks: readSubtasksFromForm(existing ? existing.subtasks : [])
    };
    if (existing) {
      Object.assign(existing, data);
      announce('“' + title + '” updated.');
    } else {
      state.assignments.push(Object.assign({ id: uid(), status: 'todo' }, data));
      announce('“' + title + '” added, due ' + fLong(due) + '.');
    }
    save();
    $('#dlg-assignment').close();
    render();
  });

  // ============================================================
  // Import — Canvas .ics, syllabus text, or syllabus PDF.
  // Every path feeds the same review table; nothing is written to
  // state until the user confirms there.
  // ============================================================
  let importRows = [];
  let importUnchanged = 0;

  function importCtx() {
    return {
      semesterStart: state.semester ? state.semester.startDate : null,
      semesterEnd: state.semester ? state.semester.endDate : null,
      todayISO: todayISO()
    };
  }

  function setImportError(msg) {
    const el = $('#import-error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function openImportDialog() {
    setImportError(null);
    $('#import-text').value = '';
    $('#import-dropzone').classList.remove('busy');
    openDialog($('#dlg-import'), $('#import-dropzone'));
  }

  function parseImportText() {
    const text = $('#import-text').value;
    if (!text.trim()) { setImportError('Paste the schedule portion of your syllabus first.'); return; }
    const rows = SHQ.parseSyllabusText(text, importCtx());
    if (!rows.length) { setImportError('No dated lines found. Make sure each line has a date, like “Sept 12 — Essay 1”.'); return; }
    buildSyllabusReview(rows);
  }

  function handleImportFile(file) {
    if (!file) return;
    const name = (file.name || '').toLowerCase();
    setImportError(null);
    if (name.endsWith('.ics') || file.type === 'text/calendar') {
      file.text().then((text) => {
        const events = SHQ.parseICS(text);
        if (!events.length) { setImportError('No events found in that calendar file.'); return; }
        buildCanvasReview(events);
      }, () => setImportError('Couldn’t read that file.'));
    } else if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      importPdf(file);
    } else {
      setImportError('That file type isn’t supported — use a Canvas .ics or a PDF, or paste text below.');
    }
  }

  function buildSyllabusReview(parsed) {
    importUnchanged = 0;
    const defaultCourse = state.courses.length === 1 ? state.courses[0].id : '';
    importRows = parsed.map((p) => ({
      include: true, title: p.title, dueDate: p.dueDate, type: p.type,
      courseKey: defaultCourse, badge: p.confidence === 'low' ? 'check date' : null,
      locked: false, action: 'create', uid: null, id: null
    }));
    openReviewDialog(importRows.length + ' dated item' + (importRows.length === 1 ? '' : 's') +
      ' found. Fix anything that looks off and pick a course for each.');
  }

  function buildCanvasReview(events) {
    const result = SHQ.planCanvasMerge(events, state.assignments);
    importUnchanged = result.unchanged;
    importRows = result.plan.map((p) => {
      if (p.action === 'update') {
        const a = state.assignments.find((x) => x.id === p.id);
        return { include: true, title: p.event.title, dueDate: p.event.dueDate, type: a.type,
                 courseKey: a.courseId, badge: 'update', locked: true, action: 'update', id: p.id, uid: p.event.uid };
      }
      const ev = p.event;
      const match = SHQ.matchCourse(ev.courseTag, state.courses);
      const proposed = ev.courseTag ? SHQ.proposeCourseCode(ev.courseTag) : '';
      return { include: ev.kind === 'assignment', title: ev.title, dueDate: ev.dueDate, type: ev.type,
               courseKey: match ? match.id : (proposed ? '__new__:' + proposed : ''),
               badge: ev.kind === 'event' ? 'event' : 'new', locked: false, action: 'create',
               uid: ev.uid || null, id: null };
    });
    if (!importRows.length) {
      setImportError(importUnchanged
        ? 'Everything in that feed is already here and up to date (' + importUnchanged + ' item' + (importUnchanged === 1 ? '' : 's') + ').'
        : 'Nothing importable found in that feed.');
      return;
    }
    let summary = 'From your Canvas calendar. Non-assignment events (lectures, office hours) start unchecked.';
    if (importUnchanged) {
      summary += ' ' + importUnchanged + ' item' + (importUnchanged === 1 ? ' is' : 's are') + ' already up to date and not shown.';
    }
    openReviewDialog(summary);
  }

  function openReviewDialog(summary) {
    if ($('#dlg-import').open) $('#dlg-import').close();
    $('#import-review-summary').textContent = summary;
    renderReviewTable();
    openDialog($('#dlg-import-review'), $('#import-commit'));
  }

  function proposedCodes() {
    const set = new Set();
    importRows.forEach((r) => {
      if (r.courseKey && r.courseKey.indexOf('__new__:') === 0) set.add(r.courseKey.slice(8));
    });
    return Array.from(set);
  }

  function renderReviewTable() {
    const codes = proposedCodes();
    const courseOptions = (sel) =>
      '<option value=""' + (sel === '' ? ' selected' : '') + '>— pick a course —</option>' +
      state.courses.map((c) =>
        '<option value="' + c.id + '"' + (sel === c.id ? ' selected' : '') + '>' + esc(c.code) + '</option>').join('') +
      codes.map((code) => {
        const k = '__new__:' + code;
        return '<option value="' + esc(k) + '"' + (sel === k ? ' selected' : '') + '>Create “' + esc(code) + '”</option>';
      }).join('');
    $('#import-review-table').innerHTML =
      '<table class="review-table"><thead><tr>' +
        '<th class="col-inc"><span class="visually-hidden">Include</span></th>' +
        '<th>What’s due</th><th>Due date</th><th>Type</th><th>Course</th><th></th>' +
      '</tr></thead><tbody>' +
      importRows.map((r, i) =>
        '<tr data-idx="' + i + '"' + (r.include ? '' : ' class="row-excluded"') + '>' +
          '<td class="col-inc"><input type="checkbox" class="review-include"' + (r.include ? ' checked' : '') + ' aria-label="Include this item"></td>' +
          '<td><input type="text" class="review-title" maxlength="80" value="' + esc(r.title) + '" aria-label="Title"></td>' +
          '<td><input type="date" class="review-date" value="' + r.dueDate + '" aria-label="Due date"></td>' +
          '<td><select class="review-type" aria-label="Type"' + (r.locked ? ' disabled' : '') + '>' +
            Object.keys(TYPES).map((t) =>
              '<option value="' + t + '"' + (r.type === t ? ' selected' : '') + '>' + TYPES[t] + '</option>').join('') +
          '</select></td>' +
          '<td>' + (r.locked
            ? '<span class="review-course-locked">' + esc((courseById(r.courseKey) || { code: '—' }).code) + '</span>'
            : '<select class="review-course" aria-label="Course">' + courseOptions(r.courseKey) + '</select>') + '</td>' +
          '<td>' + (r.badge ? '<span class="review-badge badge-' + r.badge.replace(/\s+/g, '-') + '">' + r.badge + '</span>' : '') + '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table>';
    updateCommitButton();
  }

  function importableRows() {
    return importRows.filter((r) => r.include && r.title.trim() && ISO_RE.test(r.dueDate) &&
      (r.action === 'update' || r.courseKey));
  }

  function updateCommitButton() {
    const n = importableRows().length;
    const btn = $('#import-commit');
    btn.textContent = 'Import ' + n + ' item' + (n === 1 ? '' : 's');
    btn.disabled = n === 0;
  }

  function syncReviewFromInput(target) {
    const tr = target.closest('tr[data-idx]');
    if (!tr) return;
    const r = importRows[+tr.dataset.idx];
    if (!r) return;
    if (target.classList.contains('review-include')) {
      r.include = target.checked;
      tr.classList.toggle('row-excluded', !r.include);
    } else if (target.classList.contains('review-title')) r.title = target.value;
    else if (target.classList.contains('review-date')) r.dueDate = target.value;
    else if (target.classList.contains('review-type')) r.type = target.value;
    else if (target.classList.contains('review-course')) r.courseKey = target.value;
    updateCommitButton();
  }

  function commitImport() {
    const rows = importableRows();
    if (!rows.length) return;
    const codeToId = new Map(); // normalized new-course code → created id
    let created = 0, updated = 0, newCourses = 0;
    rows.forEach((r) => {
      if (r.action === 'update') {
        const a = state.assignments.find((x) => x.id === r.id);
        if (a) { a.title = r.title.trim().slice(0, 80); a.dueDate = r.dueDate; updated += 1; }
        return;
      }
      let courseId = r.courseKey;
      if (courseId.indexOf('__new__:') === 0) {
        const code = courseId.slice(8);
        const norm = SHQ.normCode(code);
        if (codeToId.has(norm)) {
          courseId = codeToId.get(norm);
        } else {
          const existing = state.courses.find((c) => SHQ.normCode(c.code) === norm);
          if (existing) {
            courseId = existing.id;
          } else {
            const c = { id: uid(), code: code.slice(0, 16), name: code.slice(0, 60), color: leastUsedColor(), schedule: [] };
            state.courses.push(c);
            courseId = c.id;
            newCourses += 1;
          }
          codeToId.set(norm, courseId);
        }
      }
      const a = {
        id: uid(), courseId,
        title: r.title.trim().slice(0, 80),
        type: TYPES[r.type] ? r.type : 'assignment',
        dueDate: r.dueDate, status: 'todo', notes: '', subtasks: []
      };
      if (r.uid) a.canvasUid = r.uid.slice(0, 120);
      state.assignments.push(a);
      created += 1;
    });
    save();
    $('#dlg-import-review').close();
    const bits = [];
    if (created) bits.push(created + ' added');
    if (updated) bits.push(updated + ' updated');
    if (newCourses) bits.push(newCourses + ' course' + (newCourses === 1 ? '' : 's') + ' created');
    announce('Import complete — ' + bits.join(', ') + '.');
    render();
  }

  // ---- PDF import (pdf.js, lazy-loaded from a pinned CDN build only
  // when a PDF is actually dropped; failure falls back to paste-text) ----
  let pdfJsPromise = null;
  const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/legacy/build/';

  function loadPdfJs() {
    if (!pdfJsPromise) {
      // Importing the worker module onto the main thread makes pdf.js use
      // its in-process "fake worker" — no separate Worker to spawn, one
      // less thing to fail. Fine at this scale (syllabi, ≤30 pages).
      pdfJsPromise = Promise.all([
        import(PDFJS_BASE + 'pdf.min.mjs'),
        import(PDFJS_BASE + 'pdf.worker.min.mjs')
      ]).then(([mod, workerMod]) => {
        globalThis.pdfjsWorker = workerMod;
        return mod && mod.getDocument ? mod : window.pdfjsLib;
      });
      pdfJsPromise.catch(() => { pdfJsPromise = null; }); // allow retry after a failed load
    }
    return pdfJsPromise;
  }

  async function extractPdfText(file) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = Math.min(doc.numPages, 30);
    let text = '';
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let lastY = null;
      content.items.forEach((item) => {
        if (!item.str) return;
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) text += '\n';
        else if (text && !/\s$/.test(text)) text += ' ';
        text += item.str;
        if (y !== null) lastY = y;
      });
      text += '\n';
    }
    return text;
  }

  function importPdf(file) {
    const dz = $('#import-dropzone');
    dz.classList.add('busy');
    extractPdfText(file).then((text) => {
      dz.classList.remove('busy');
      const rows = SHQ.parseSyllabusText(text, importCtx());
      if (!rows.length) {
        setImportError('Couldn’t find dated lines in that PDF — copy and paste the schedule text below instead.');
        $('#import-text').focus();
        return;
      }
      buildSyllabusReview(rows);
    }).catch((err) => {
      console.error('Semester HQ: PDF import failed —', err);
      dz.classList.remove('busy');
      setImportError('Couldn’t read that PDF — copy and paste the syllabus text below instead.');
      $('#import-text').focus();
    });
  }

  // Dropzone wiring (elements exist statically in index.html)
  (function initImportDropzone() {
    const dz = $('#import-dropzone');
    const fileInput = $('#import-file');
    dz.addEventListener('click', () => fileInput.click());
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    ['dragover', 'dragenter'].forEach((t) => dz.addEventListener(t, (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
    }));
    dz.addEventListener('drop', (e) => {
      handleImportFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  })();

  // ============================================================
  // Sample data (relative to today so the dashboard always looks alive)
  // ============================================================
  function loadSample() {
    const today = todayISO();
    const start = addDays(startOfWeek(today), -28); // 5 weeks in
    const end = addDays(start, 16 * 7 - 3);         // 16-week semester
    const C = [
      { id: uid(), code: 'INFO-I 300', name: 'Human-Computer Interaction', color: 'green' },
      { id: uid(), code: 'INFO-I 210', name: 'Information Infrastructure', color: 'ochre' },
      { id: uid(), code: 'CSCI-A 201', name: 'Introduction to Programming', color: 'violet' },
      { id: uid(), code: 'SOC-S 100', name: 'Introduction to Sociology', color: 'cyan' }
    ];
    // Offsets are relative to TODAY so the demo always shows a lively,
    // in-control week: exactly one overdue item, work due today, and a horizon.
    const A = [
      { c: 3, t: 'Reading response: Ch. 4', type: 'reading', d: -6, done: true },
      { c: 0, t: 'Interview 2 classmates about study habits', type: 'assignment', d: -1 },
      { c: 2, t: 'Practice quiz: functions', type: 'quiz', d: -1, done: true },
      { c: 3, t: 'Reading quiz: Ch. 5', type: 'quiz', d: 0 },
      { c: 2, t: 'Lab: loops and lists', type: 'assignment', d: 0, done: true },
      { c: 1, t: 'Problem set 5', type: 'assignment', d: 1 },
      { c: 0, t: 'Wireframes for project 2', type: 'project', d: 2 },
      { c: 0, t: 'Usability test plan', type: 'assignment', d: 4 },
      { c: 1, t: 'Midterm exam', type: 'exam', d: 6 },
      { c: 3, t: 'Essay outline: social institutions', type: 'assignment', d: 8 },
      { c: 2, t: 'Project 1: text adventure game', type: 'project', d: 13 },
      { c: 3, t: 'Midterm exam', type: 'exam', d: 15 },
      { c: 0, t: 'Hi-fi prototype in Figma', type: 'project', d: 19 },
      { c: 1, t: 'Group presentation: net neutrality', type: 'project', d: 20 }
    ];
    state = normalizeState({
      sample: true,
      semester: { name: 'Sample Semester', startDate: start, endDate: end },
      courses: C,
      assignments: A.map((a) => ({
        id: uid(),
        courseId: C[a.c].id,
        title: a.t,
        type: a.type,
        dueDate: addDays(today, a.d),
        status: a.done ? 'done' : 'todo',
        notes: ''
      }))
    });
    save();
    announce('Sample semester loaded. This is demo data — clear it anytime.');
    location.hash = '#week';
    render();
  }

  // ============================================================
  // Export / import / clear
  // ============================================================
  function exportData() {
    const payload = {
      app: 'semester-hq', version: 2,
      exportedAt: new Date().toISOString(),
      data: { semester: state.semester, courses: state.courses, assignments: state.assignments }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'semester-hq-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    state.meta.lastBackupAt = new Date().toISOString();
    state.meta.changesSinceBackup = 0;
    save({ silent: true });
    announce('Backup downloaded.');
    render();
  }

  // Accepts both version-1 (no schedule/subtasks) and version-2 backups;
  // normalizeState supplies defaults and scrubs the new fields.
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const d = obj.data && typeof obj.data === 'object' ? obj.data : obj;
    const out = { semester: null, courses: [], assignments: [], sample: false };
    if (d.semester) {
      const s = d.semester;
      if (typeof s.name !== 'string' || !ISO_RE.test(s.startDate || '') || !ISO_RE.test(s.endDate || '')) return null;
      out.semester = { name: s.name.slice(0, 40), startDate: s.startDate, endDate: s.endDate };
    }
    if (!Array.isArray(d.courses) || !Array.isArray(d.assignments)) return null;
    const colorKeys = COLORS.map((c) => c.key);
    for (const c of d.courses) {
      if (typeof c.code !== 'string' || typeof c.name !== 'string') return null;
      out.courses.push({
        id: typeof c.id === 'string' ? c.id : uid(),
        code: c.code.slice(0, 16),
        name: c.name.slice(0, 60),
        color: colorKeys.includes(c.color) ? c.color : 'green',
        schedule: c.schedule
      });
    }
    const courseIds = new Set(out.courses.map((c) => c.id));
    for (const a of d.assignments) {
      if (typeof a.title !== 'string' || !ISO_RE.test(a.dueDate || '')) return null;
      if (!courseIds.has(a.courseId)) continue; // orphan — drop it
      out.assignments.push({
        id: typeof a.id === 'string' ? a.id : uid(),
        courseId: a.courseId,
        title: a.title.slice(0, 80),
        type: TYPES[a.type] ? a.type : 'assignment',
        dueDate: a.dueDate,
        status: a.status === 'done' ? 'done' : 'todo',
        notes: typeof a.notes === 'string' ? a.notes.slice(0, 280) : '',
        subtasks: a.subtasks,
        canvasUid: a.canvasUid
      });
    }
    return normalizeState(out);
  }

  async function importData(file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (e) {
      announce('That file isn’t valid JSON — export a backup from Semester HQ and try again.');
      return;
    }
    const cleaned = validateBackup(parsed);
    if (!cleaned) {
      announce('That doesn’t look like a Semester HQ backup.');
      return;
    }
    if (hasAnyData() && !state.sample) {
      const ok = await confirmAsk('Restoring replaces everything currently here with the backup. Continue?', 'Replace & restore');
      if (!ok) return;
    }
    state = cleaned;
    save();
    render();
    announce('Backup imported.');
  }

  // ============================================================
  // Gist sync — the state lives in a private gist on the user's own
  // GitHub account; whole-state last-write-wins with a conflict prompt.
  // ============================================================
  const GIST_FILE = 'semester-hq-sync.json';
  const GIST_DESC = 'Semester HQ sync';
  let syncTimer = null;
  let syncBusy = false;
  let pendingRemote = null; // payload held while the conflict dialog is open

  function ghFetch(path, opts) {
    return fetch('https://api.github.com' + path, Object.assign({}, opts, {
      headers: Object.assign({
        'Authorization': 'Bearer ' + syncCfg.token,
        'Accept': 'application/vnd.github+json'
      }, (opts && opts.headers) || {})
    })).then((res) => {
      if (res.status === 401 || res.status === 403) throw new Error('sync-auth');
      if (!res.ok) throw new Error('sync-http-' + res.status);
      return res;
    });
  }

  function buildSyncPayload() {
    return JSON.stringify({
      app: 'semester-hq',
      version: 2,
      updatedAt: state.meta.updatedAt,
      exportedAt: new Date().toISOString(),
      data: { semester: state.semester, courses: state.courses, assignments: state.assignments }
    }, null, 2);
  }

  function recordSyncStamps(localAt, remoteAt) {
    syncCfg.lastLocalUpdatedAt = localAt || null;
    syncCfg.lastRemoteUpdatedAt = remoteAt || null;
    syncCfg.lastSyncAt = new Date().toISOString();
    saveSyncSettings(syncCfg);
  }

  function scheduleSyncPush() {
    if (!syncCfg || !syncCfg.gistId || state.sample) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow(); }, 3000);
  }

  async function syncPush() {
    const content = buildSyncPayload();
    await ghFetch('/gists/' + syncCfg.gistId, {
      method: 'PATCH',
      body: JSON.stringify({ files: { [GIST_FILE]: { content: content } } })
    });
    recordSyncStamps(state.meta.updatedAt, state.meta.updatedAt);
    announce('Synced.');
  }

  function applyRemote(remote) {
    const cleaned = validateBackup(remote);
    if (!cleaned) { announce('Sync: the remote data doesn’t look like Semester HQ data — not applied.'); return; }
    state = cleaned;
    state.meta.updatedAt = typeof remote.updatedAt === 'string' ? remote.updatedAt : null;
    save({ silent: true });
    recordSyncStamps(state.meta.updatedAt, state.meta.updatedAt);
    render();
    announce('Synced from your other device.');
  }

  function sameData(remote) {
    const local = { semester: state.semester, courses: state.courses, assignments: state.assignments };
    return JSON.stringify(local) === JSON.stringify(remote && remote.data);
  }

  async function syncNow() {
    if (!syncCfg || !syncCfg.gistId || state.sample || syncBusy) return;
    syncBusy = true;
    try {
      const gist = await ghFetch('/gists/' + syncCfg.gistId).then((r) => r.json());
      const file = gist.files && gist.files[GIST_FILE];
      let remote = null;
      if (file) {
        let content = file.content;
        if (file.truncated) content = await fetch(file.raw_url).then((r) => r.text());
        try { remote = JSON.parse(content); } catch (e) { remote = null; }
      }
      // Data that predates sync has no stamp yet — give it one so it can win.
      if (hasAnyData() && !state.meta.updatedAt) {
        state.meta.updatedAt = new Date().toISOString();
        save({ silent: true });
      }
      const plan = SHQ.planSync({
        localUpdatedAt: hasAnyData() ? state.meta.updatedAt : null,
        remoteUpdatedAt: remote && typeof remote.updatedAt === 'string' ? remote.updatedAt : null,
        lastLocalUpdatedAt: syncCfg.lastLocalUpdatedAt,
        lastRemoteUpdatedAt: syncCfg.lastRemoteUpdatedAt
      });
      if (plan === 'push') {
        await syncPush();
      } else if (plan === 'pull') {
        applyRemote(remote);
      } else if (plan === 'conflict') {
        if (sameData(remote)) {
          recordSyncStamps(state.meta.updatedAt, remote.updatedAt);
        } else {
          pendingRemote = remote;
          openDialog($('#dlg-sync-conflict'), $('[data-action="sync-keep-local"]'));
        }
      } else {
        recordSyncStamps(syncCfg.lastLocalUpdatedAt, syncCfg.lastRemoteUpdatedAt);
      }
      renderSyncDialog();
    } catch (e) {
      if (e && e.message === 'sync-auth') {
        announce('Sync failed: GitHub rejected the token — it may have expired.');
        renderSyncDialog('GitHub rejected the token — it may have expired or lack the Gists permission.');
      }
      // Network errors stay quiet; sync retries on the next open/change/reconnect.
    } finally {
      syncBusy = false;
    }
  }

  async function syncConnect() {
    const input = $('#sync-token');
    const token = input.value.trim();
    setFieldError(input, $('#sync-token-error'), token ? null : 'Paste a GitHub token to connect.');
    if (!token) return;
    const btn = $('#sync-connect');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    syncCfg = { token: token, gistId: null, lastLocalUpdatedAt: null, lastRemoteUpdatedAt: null, lastSyncAt: null };
    try {
      const gists = await ghFetch('/gists?per_page=100').then((r) => r.json());
      const existing = gists.find((g) => g.files && g.files[GIST_FILE]);
      if (existing) {
        syncCfg.gistId = existing.id;
      } else {
        const created = await ghFetch('/gists', {
          method: 'POST',
          body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: buildSyncPayload() } } })
        }).then((r) => r.json());
        syncCfg.gistId = created.id;
        recordSyncStamps(state.meta.updatedAt, state.meta.updatedAt);
      }
      saveSyncSettings(syncCfg);
      input.value = '';
      await syncNow();
      renderSyncDialog();
      announce('Sync connected.');
    } catch (e) {
      syncCfg = null;
      saveSyncSettings(null);
      setFieldError(input, $('#sync-token-error'),
        e && e.message === 'sync-auth'
          ? 'GitHub rejected that token. Check it has the Gists read/write permission.'
          : 'Couldn’t reach GitHub — check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Connect & sync';
    }
  }

  function syncDisconnect() {
    syncCfg = null;
    saveSyncSettings(null);
    renderSyncDialog();
    announce('Sync disconnected. Your data stays on this device; the gist stays on GitHub.');
  }

  function renderSyncDialog(errorMsg) {
    const connected = !!(syncCfg && syncCfg.gistId);
    $('#sync-setup').hidden = connected;
    $('#sync-connect').hidden = connected;
    $('#sync-now').hidden = !connected;
    $('#sync-disconnect').hidden = !connected;
    let status;
    if (errorMsg) status = errorMsg;
    else if (!connected) status = 'Not connected. Changes stay on this device.';
    else {
      status = 'Connected to a private gist on your GitHub account.';
      if (state.sample) status += ' Sample data is never synced — clear it to start.';
      else if (syncCfg.lastSyncAt) status += ' Last synced ' + new Date(syncCfg.lastSyncAt).toLocaleString() + '.';
    }
    $('#sync-status').textContent = status;
  }

  function openSyncDialog() {
    renderSyncDialog();
    openDialog($('#dlg-sync'), (syncCfg && syncCfg.gistId) ? $('#sync-now') : $('#sync-token'));
  }

  function doClearAll() {
    state = structuredClone(EMPTY);
    localStorage.removeItem(KEY);
    // With sync connected, an intentional wipe is a change like any other —
    // otherwise the next sync would just pull everything back.
    if (syncCfg && syncCfg.gistId) {
      state.meta.updatedAt = new Date().toISOString();
      localStorage.setItem(KEY, JSON.stringify(state));
      scheduleSyncPush();
    }
    location.hash = '#week';
    render();
    announce('All data cleared.');
  }
  function clearAll(skipConfirm) {
    if (skipConfirm) { doClearAll(); return; } // sample data — nothing worth guarding
    const input = $('#clear-confirm-input');
    input.value = '';
    $('#clear-accept').disabled = true;
    openDialog($('#dlg-clear'), input);
  }

  // ============================================================
  // Theme
  // ============================================================
  function applyThemeLabel() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    // Keep the installed-app status bar in step with the in-app toggle.
    $$('meta[name="theme-color"]').forEach((m) => { m.content = dark ? '#12171a' : '#f4f1ea'; });
  }
  $('#theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark'); } catch (e) {}
    applyThemeLabel();
  });

  // ============================================================
  // Event delegation
  // ============================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const rowId = (btn.closest('[data-id]') || {}).dataset ? btn.closest('[data-id]').dataset.id : null;

    switch (action) {
      case 'setup-semester': openSemesterDialog(); break;
      case 'edit-semester': openSemesterDialog(); break;
      case 'add-course': openCourseDialog(); break;
      case 'edit-course': openCourseDialog(rowId); break;
      case 'add-assignment': openAssignmentDialog(); break;
      case 'edit-assignment': openAssignmentDialog(rowId); break;
      case 'load-sample': loadSample(); break;
      case 'clear-sample': clearAll(true); break;
      case 'export-backup': exportData(); break;
      case 'sync-connect': syncConnect(); break;
      case 'sync-now': syncNow(); break;
      case 'sync-disconnect': syncDisconnect(); break;
      case 'sync-keep-local':
        btn.closest('dialog').close();
        pendingRemote = null;
        syncPush().catch(() => announce('Sync will retry when you’re back online.'));
        break;
      case 'sync-keep-remote': {
        btn.closest('dialog').close();
        const remote = pendingRemote;
        pendingRemote = null;
        if (remote) applyRemote(remote);
        break;
      }
      case 'add-meeting':
        $('#course-meetings').insertAdjacentHTML('beforeend', meetingRowHtml(null));
        $('.meeting-row:last-child .meeting-day', $('#course-meetings')).focus();
        break;
      case 'remove-meeting': btn.closest('.meeting-row').remove(); break;
      case 'add-subtask-row': {
        $('#assignment-subtasks').insertAdjacentHTML('beforeend', subtaskFormRowHtml(null));
        $('.subtask-form-row:last-child .subtask-title', $('#assignment-subtasks')).focus();
        break;
      }
      case 'remove-subtask-row': btn.closest('.subtask-form-row').remove(); break;
      case 'add-assignment-date': openAssignmentDialog(null, btn.dataset.date); break;
      case 'cal-prev':
      case 'cal-next':
        calCursor = calShift(calCursor || todayISO().slice(0, 7), action === 'cal-prev' ? -1 : 1);
        renderCalendar();
        announce(calMonthLabel(calCursor));
        break;
      case 'cal-today':
        calCursor = todayISO().slice(0, 7);
        renderCalendar();
        announce(calMonthLabel(calCursor));
        break;
      case 'import-assignments': openImportDialog(); break;
      case 'parse-import-text': parseImportText(); break;
      case 'commit-import': commitImport(); break;
      case 'toggle-subtasks': {
        if (expandedSubtasks.has(rowId)) expandedSubtasks.delete(rowId);
        else expandedSubtasks.add(rowId);
        render();
        break;
      }
      case 'dismiss-backup-nudge':
        state.meta.nudgeSnoozedUntil = addDays(todayISO(), 7);
        save({ silent: true });
        render();
        break;
      case 'close-dialog': btn.closest('dialog').close(); break;
      case 'delete-assignment': {
        const a = state.assignments.find((x) => x.id === rowId);
        if (!a) break;
        confirmAsk('Delete “' + a.title + '”?').then((ok) => {
          if (!ok) return;
          state.assignments = state.assignments.filter((x) => x.id !== rowId);
          save(); render();
          announce('“' + a.title + '” deleted.');
        });
        break;
      }
      case 'delete-course': {
        const c = courseById(rowId);
        if (!c) break;
        const n = state.assignments.filter((a) => a.courseId === rowId).length;
        const msg = n
          ? 'Delete ' + c.code + ' and its ' + n + ' assignment' + (n === 1 ? '' : 's') + '?'
          : 'Delete ' + c.code + '?';
        confirmAsk(msg).then((ok) => {
          if (!ok) return;
          state.courses = state.courses.filter((x) => x.id !== rowId);
          state.assignments = state.assignments.filter((a) => a.courseId !== rowId);
          save(); render();
          announce(c.code + ' deleted.');
        });
        break;
      }
    }
  });

  // check-off (change survives re-render because rows re-render immediately)
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('subtask-check')) {
      const row = e.target.closest('[data-id]');
      const a = row && state.assignments.find((x) => x.id === row.dataset.id);
      if (!a) return;
      const s = a.subtasks.find((x) => x.id === e.target.dataset.subId);
      if (!s) return;
      s.done = e.target.checked;
      save();
      announce('Step “' + s.title + '” marked ' + (s.done ? 'done.' : 'not done.'));
      if (s.done && row.classList.contains('subtask-row')) {
        row.classList.add('just-done');
        setTimeout(render, 300);
      } else {
        render();
      }
      return;
    }
    if (e.target.classList.contains('item-check')) {
      const row = e.target.closest('[data-id]');
      const a = state.assignments.find((x) => x.id === row.dataset.id);
      if (!a) return;
      a.status = e.target.checked ? 'done' : 'todo';
      save();
      announce('“' + a.title + '” marked ' + (a.status === 'done' ? 'done.' : 'not done.'));
      if (a.status === 'done') {
        row.classList.add('just-done');
        setTimeout(render, 300);
      } else {
        render();
      }
      return;
    }
    if (['filter-course', 'filter-type', 'filter-done'].includes(e.target.id)) renderUpcoming();
    if (e.target.id === 'file-import' && e.target.files[0]) {
      importData(e.target.files[0]);
      e.target.value = '';
      return;
    }
    if (e.target.id === 'import-file' && e.target.files[0]) {
      handleImportFile(e.target.files[0]);
      e.target.value = '';
      return;
    }
    if (e.target.closest('#dlg-import-review')) syncReviewFromInput(e.target);
  });

  // Live count updates while typing a title in the review table
  document.addEventListener('input', (e) => {
    if (e.target.classList && e.target.classList.contains('review-title')) syncReviewFromInput(e.target);
  });

  $('#btn-export').addEventListener('click', exportData);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#btn-sync').addEventListener('click', openSyncDialog);
  $('#btn-clear').addEventListener('click', () => clearAll(false));

  window.addEventListener('hashchange', showView);

  // ============================================================
  // Self-tests (open with ?selftest — results in the console)
  // ============================================================
  function runSelfTests() {
    const t = (name, cond) => console[cond ? 'log' : 'error']((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    t('parseDate is local', (() => { const d = parseDate('2026-01-15'); return d.getFullYear() === 2026 && d.getMonth() === 0 && d.getDate() === 15; })());
    t('toISO round-trips', toISO(parseDate('2026-07-03')) === '2026-07-03');
    t('addDays crosses months', addDays('2026-01-31', 1) === '2026-02-01');
    t('daysBetween spans DST spring-forward', daysBetween('2026-03-07', '2026-03-09') === 2);
    t('daysBetween spans DST fall-back', daysBetween('2026-10-31', '2026-11-02') === 2);
    t('startOfWeek of a Sunday is prior Monday', startOfWeek('2026-07-05') === '2026-06-29');
    t('startOfWeek of a Monday is itself', startOfWeek('2026-06-29') === '2026-06-29');
    t('week 1 on start date', weekOfSemester('2026-08-24', '2026-08-24') === 1);
    t('week 1 through first Sunday', weekOfSemester('2026-08-24', '2026-08-30') === 1);
    t('week 2 on second Monday', weekOfSemester('2026-08-24', '2026-08-31') === 2);
    t('midweek start still week 1 that week', weekOfSemester('2026-08-26', '2026-08-24') === 1);
    t('16-week semester totals 16', weekOfSemester('2026-08-24', addDays('2026-08-24', 16 * 7 - 3)) === 16);

    // --- month grid (Calendar view) ---
    t('monthGrid July 2026 spans 5 Mon-first weeks', (() => {
      const w = SHQ.monthGrid(2026, 6);
      return w.length === 5 && w[0][0] === '2026-06-29' && w[4][6] === '2026-08-02';
    })());
    t('monthGrid Feb 2027 is exactly 4 weeks', SHQ.monthGrid(2027, 1).length === 4);
    t('monthGrid Aug 2026 needs 6 weeks', SHQ.monthGrid(2026, 7).length === 6);
    t('monthGrid Mar 2026 contiguous across DST', (() => {
      const flat = [].concat.apply([], SHQ.monthGrid(2026, 2));
      return flat.length % 7 === 0 && flat.every((d, i) => i === 0 || d === addDays(flat[i - 1], 1));
    })());
    t('backup validation drops orphans', (() => {
      const v = validateBackup({ data: { semester: null, courses: [{ code: 'A', name: 'B', color: 'green', id: 'c1' }], assignments: [{ title: 'x', dueDate: '2026-09-01', courseId: 'nope' }] } });
      return v && v.assignments.length === 0 && v.courses.length === 1;
    })());
    t('backup validation rejects bad dates', validateBackup({ data: { semester: { name: 'S', startDate: 'sep 1', endDate: '2026-12-18' }, courses: [], assignments: [] } }) === null);

    // --- migration / normalizeState ---
    t('normalizeState defaults v1 data', (() => {
      const v = normalizeState({ courses: [{ id: 'c1', code: 'A', name: 'B', color: 'green' }], assignments: [{ id: 'a1', courseId: 'c1', title: 'x', type: 'quiz', dueDate: '2026-09-01', status: 'todo', notes: '' }] });
      return v.courses[0].schedule.length === 0 && v.assignments[0].subtasks.length === 0 &&
        v.meta.lastBackupAt === null && v.meta.changesSinceBackup === 0 && v.meta.nudgeSnoozedUntil === null;
    })());
    t('normalizeState drops malformed schedule entries', (() => {
      const v = normalizeState({ courses: [{ id: 'c1', code: 'A', name: 'B', color: 'green', schedule: [
        { days: [9], start: '10:00' }, { days: [1, 3], start: '9:30' },
        { days: [2], start: '09:30', end: '08:00', location: 'Hall' }] }] });
      const s = v.courses[0].schedule;
      return s.length === 1 && s[0].days.join(',') === '2' && s[0].end === '' && s[0].location === 'Hall';
    })());
    t('normalizeState keeps valid subtasks, drops junk', (() => {
      const v = normalizeState({ assignments: [{ id: 'a1', courseId: 'c1', title: 'x', dueDate: '2026-09-01', subtasks: [{ title: 'ok', dueDate: '2026-08-30' }, { title: '  ' }, 'nope'] }] });
      const s = v.assignments[0].subtasks;
      return s.length === 1 && s[0].done === false && s[0].dueDate === '2026-08-30' && typeof s[0].id === 'string';
    })());
    t('v1 backup accepted with defaults', (() => {
      const v = validateBackup({ app: 'semester-hq', version: 1, data: { semester: { name: 'S', startDate: '2026-08-24', endDate: '2026-12-11' }, courses: [{ id: 'c1', code: 'A', name: 'B', color: 'green' }], assignments: [{ id: 'a1', courseId: 'c1', title: 'x', dueDate: '2026-09-01' }] } });
      return !!v && v.assignments[0].subtasks.length === 0 && v.courses[0].schedule.length === 0 && v.meta.changesSinceBackup === 0;
    })());
    t('v2 backup round-trips schedule + canvasUid', (() => {
      const v = validateBackup({ version: 2, data: { semester: null, courses: [{ id: 'c1', code: 'INFO-I 300', name: 'HCI', color: 'green', schedule: [{ id: 'm1', days: [1, 3, 5], start: '09:30', end: '10:45', location: 'Ball 013' }] }], assignments: [{ id: 'a1', courseId: 'c1', title: 'x', dueDate: '2026-09-01', canvasUid: 'event-assignment-1@instructure.com', subtasks: [{ id: 's1', title: 'draft', dueDate: null, done: true }] }] } });
      return !!v && v.courses[0].schedule.length === 1 && v.assignments[0].canvasUid === 'event-assignment-1@instructure.com' && v.assignments[0].subtasks[0].done === true;
    })());

    // --- schedule helpers ---
    t('formatMeetingDays MWF', SHQ.formatMeetingDays([1, 3, 5]) === 'MWF');
    t('formatMeetingDays TuTh', SHQ.formatMeetingDays([4, 2]) === 'TuTh');
    t('formatMeetingDays Sunday last', SHQ.formatMeetingDays([0, 1]) === 'MSu');
    t('formatTime12 morning', SHQ.formatTime12('09:30') === '9:30 AM');
    t('formatTime12 afternoon', SHQ.formatTime12('13:05') === '1:05 PM');
    t('formatTime12 noon and midnight', SHQ.formatTime12('12:00') === '12:00 PM' && SHQ.formatTime12('00:15') === '12:15 AM');
    t('meetingsToday filters and sorts by start', (() => {
      const cs = [
        { code: 'A', schedule: [{ days: [1, 3], start: '13:00' }] },
        { code: 'B', schedule: [{ days: [1], start: '09:00' }] },
        { code: 'C', schedule: [{ days: [2], start: '08:00' }] }
      ];
      const m = SHQ.meetingsToday(cs, 1);
      return m.length === 2 && m[0].course.code === 'B' && m[1].course.code === 'A';
    })());

    // --- type inference ---
    t('inferType: final project is a project', SHQ.inferType('Final project due') === 'project');
    t('inferType: midterm exam', SHQ.inferType('Midterm exam') === 'exam');
    t('inferType: quiz beats reading', SHQ.inferType('Reading quiz: Ch. 5') === 'quiz');
    t('inferType: chapter reading', SHQ.inferType('Ch. 5 response') === 'reading');
    t('inferType: default assignment', SHQ.inferType('Problem set 4') === 'assignment');

    // --- syllabus parsing ---
    const ctxFall = { semesterStart: '2026-08-24', semesterEnd: '2026-12-11', todayISO: '2026-07-04' };
    t('syllabus: month-name date + type', (() => {
      const r = SHQ.parseSyllabusText('Sept 12 — Reading response 2', ctxFall);
      return r.length === 1 && r[0].dueDate === '2026-09-12' && r[0].title === 'Reading response 2' && r[0].type === 'reading';
    })());
    t('syllabus: numeric date', (() => {
      const r = SHQ.parseSyllabusText('9/12 Quiz 3', ctxFall);
      return r.length === 1 && r[0].dueDate === '2026-09-12' && r[0].type === 'quiz';
    })());
    t('syllabus: explicit year kept, trailing “due” stripped', (() => {
      const r = SHQ.parseSyllabusText('September 12, 2027: Essay 1 due', ctxFall);
      return r.length === 1 && r[0].dueDate === '2027-09-12' && r[0].title === 'Essay 1';
    })());
    t('syllabus: range uses end date', (() => {
      const r = SHQ.parseSyllabusText('Sept 12–14 Project presentations', ctxFall);
      return r.length === 1 && r[0].dueDate === '2026-09-14' && r[0].type === 'project';
    })());
    t('syllabus: dateless line skipped', SHQ.parseSyllabusText('Bring your laptop to class', ctxFall).length === 0);
    t('syllabus: impossible date skipped', SHQ.parseSyllabusText('Feb 31 — ghost item', ctxFall).length === 0);
    t('syllabus: “week of” flagged low confidence', (() => {
      const r = SHQ.parseSyllabusText('Week of Oct 5 — peer review workshop', ctxFall);
      return r.length === 1 && r[0].confidence === 'low' && r[0].dueDate === '2026-10-05';
    })());
    t('syllabus: January lands in end-year across new year', (() => {
      const r = SHQ.parseSyllabusText('Jan 20 — winter session paper', { semesterStart: '2026-11-30', semesterEnd: '2027-03-15', todayISO: '2026-11-01' });
      return r.length === 1 && r[0].dueDate === '2027-01-20';
    })());
    t('syllabus: no-semester year bumps forward for fall prep', (() => {
      const r = SHQ.parseSyllabusText('Jan 15 — response paper', { todayISO: '2026-07-04' });
      return r.length === 1 && r[0].dueDate === '2027-01-15';
    })());

    // --- ICS parsing ---
    const icsSample = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-assignment-123@instructure.com\r\nSUMMARY:Essay 1\\, final draft [FA26: ENG-W 131 12345]\r\nDTSTART;VALUE=DATE:20261009\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:event-999@instructure.com\r\nSUMMARY:Office hours [FA26: ENG-W 131 12345]\r\nDTSTART:20261010T170000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    t('ics: parses events with kinds', (() => {
      const ev = SHQ.parseICS(icsSample);
      return ev.length === 2 && ev[0].kind === 'assignment' && ev[1].kind === 'event';
    })());
    t('ics: unescapes commas and strips course tag', (() => {
      const ev = SHQ.parseICS(icsSample)[0];
      return ev.title === 'Essay 1, final draft' && ev.courseTag === 'FA26: ENG-W 131 12345';
    })());
    t('ics: VALUE=DATE stays literal', SHQ.parseICS(icsSample)[0].dueDate === '2026-10-09');
    t('ics: folded SUMMARY unfolds', (() => {
      // RFC 5545 fold = CRLF + one space; the second space below is content
      const folded = 'BEGIN:VEVENT\r\nUID:event-assignment-7\r\nSUMMARY:Long title that\r\n  continues [HIST 101]\r\nDTSTART;VALUE=DATE:20261101\r\nEND:VEVENT';
      const ev = SHQ.parseICS(folded);
      return ev.length === 1 && ev[0].title === 'Long title that continues' && ev[0].courseTag === 'HIST 101';
    })());
    t('ics: Z datetime converts through local zone', (() => {
      const d = new Date(Date.UTC(2026, 9, 10, 4, 59, 59));
      const expect = toISO(d);
      return SHQ.icsDate('20261010T045959Z') === expect;
    })());

    // --- course matching ---
    t('matchCourse finds code inside Canvas tag', (() => {
      const c = SHQ.matchCourse('FA26: INFO-I 300 12345', [{ id: '1', code: 'INFO-I 300' }]);
      return !!c && c.id === '1';
    })());
    t('proposeCourseCode strips term and section', SHQ.proposeCourseCode('FA26: ENG-W 131 12345') === 'ENG-W 131');

    // --- Canvas merge planning ---
    t('merge: re-import updates date, never status, no dupes', (() => {
      const existing = [{ id: 'a1', canvasUid: 'u1', title: 'Essay 1', dueDate: '2026-10-09', status: 'done' }];
      const res = SHQ.planCanvasMerge([{ uid: 'u1', title: 'Essay 1', dueDate: '2026-10-16', kind: 'assignment' }], existing);
      return res.plan.length === 1 && res.plan[0].action === 'update' &&
        res.plan[0].changes.dueDate === '2026-10-16' && !('title' in res.plan[0].changes) &&
        !('status' in res.plan[0].changes);
    })());
    t('merge: identical item counts as unchanged', (() => {
      const res = SHQ.planCanvasMerge([{ uid: 'u1', title: 'Essay 1', dueDate: '2026-10-09', kind: 'assignment' }],
        [{ id: 'a1', canvasUid: 'u1', title: 'Essay 1', dueDate: '2026-10-09', status: 'todo' }]);
      return res.plan.length === 0 && res.unchanged === 1;
    })());
    t('merge: unknown uid creates', (() => {
      const res = SHQ.planCanvasMerge([{ uid: 'u2', title: 'Quiz', dueDate: '2026-10-09', kind: 'assignment' }], []);
      return res.plan.length === 1 && res.plan[0].action === 'create';
    })());

    // --- gist-sync planning ---
    t('planSync: nothing anywhere → none', SHQ.planSync({ localUpdatedAt: null, remoteUpdatedAt: null, lastLocalUpdatedAt: null, lastRemoteUpdatedAt: null }) === 'none');
    t('planSync: first connect, only local data → push', SHQ.planSync({ localUpdatedAt: '2026-07-05T10:00:00Z', remoteUpdatedAt: null, lastLocalUpdatedAt: null, lastRemoteUpdatedAt: null }) === 'push');
    t('planSync: first connect, only remote data → pull', SHQ.planSync({ localUpdatedAt: null, remoteUpdatedAt: '2026-07-05T10:00:00Z', lastLocalUpdatedAt: null, lastRemoteUpdatedAt: null }) === 'pull');
    t('planSync: first connect, both have data → conflict', SHQ.planSync({ localUpdatedAt: '2026-07-05T10:00:00Z', remoteUpdatedAt: '2026-07-05T09:00:00Z', lastLocalUpdatedAt: null, lastRemoteUpdatedAt: null }) === 'conflict');
    t('planSync: local edited since last sync → push', SHQ.planSync({ localUpdatedAt: '2026-07-05T11:00:00Z', remoteUpdatedAt: '2026-07-05T10:00:00Z', lastLocalUpdatedAt: '2026-07-05T10:00:00Z', lastRemoteUpdatedAt: '2026-07-05T10:00:00Z' }) === 'push');
    t('planSync: remote edited since last sync → pull', SHQ.planSync({ localUpdatedAt: '2026-07-05T10:00:00Z', remoteUpdatedAt: '2026-07-05T11:00:00Z', lastLocalUpdatedAt: '2026-07-05T10:00:00Z', lastRemoteUpdatedAt: '2026-07-05T10:00:00Z' }) === 'pull');
    t('planSync: both edited → conflict', SHQ.planSync({ localUpdatedAt: '2026-07-05T11:00:00Z', remoteUpdatedAt: '2026-07-05T11:30:00Z', lastLocalUpdatedAt: '2026-07-05T10:00:00Z', lastRemoteUpdatedAt: '2026-07-05T10:00:00Z' }) === 'conflict');
    t('planSync: in step → none', SHQ.planSync({ localUpdatedAt: '2026-07-05T10:00:00Z', remoteUpdatedAt: '2026-07-05T10:00:00Z', lastLocalUpdatedAt: '2026-07-05T10:00:00Z', lastRemoteUpdatedAt: '2026-07-05T10:00:00Z' }) === 'none');

    // --- due-entry collection ---
    t('dueEntries hides steps of done parents', (() => {
      const es = dueEntries([
        { id: 'a1', dueDate: '2026-09-10', status: 'done', subtasks: [{ id: 's1', title: 'x', dueDate: '2026-09-08', done: false }] },
        { id: 'a2', dueDate: '2026-09-12', status: 'todo', subtasks: [{ id: 's2', title: 'y', dueDate: '2026-09-09', done: false }, { id: 's3', title: 'z', dueDate: null, done: false }] }
      ]);
      return es.length === 3 && es.filter((e) => e.kind === 'subtask').length === 1 &&
        es.find((e) => e.kind === 'subtask').s.id === 's2';
    })());

    console.log('Self-tests complete.');
  }

  // ============================================================
  // Init
  // ============================================================
  applyThemeLabel();
  showView();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (syncCfg && syncCfg.gistId) syncNow();
  window.addEventListener('online', () => syncNow());
  if (location.search.indexOf('selftest') !== -1) runSelfTests();
})();
