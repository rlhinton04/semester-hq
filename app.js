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
  const EMPTY = { semester: null, courses: [], assignments: [], sample: false };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(EMPTY);
      const data = JSON.parse(raw);
      return {
        semester: data.semester || null,
        courses: Array.isArray(data.courses) ? data.courses : [],
        assignments: Array.isArray(data.assignments) ? data.assignments : [],
        sample: !!data.sample
      };
    } catch (e) {
      return structuredClone(EMPTY);
    }
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  let state = load();

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
  const VIEWS = ['week', 'upcoming', 'courses', 'about'];
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
  }

  function chipHtml(course) {
    if (!course) return '';
    return '<span class="course-chip"><span class="dot" style="--dot-color: var(--c-' + course.color + ')"></span>' + esc(course.code) + '</span>';
  }

  function itemRowHtml(a, opts) {
    const course = courseById(a.courseId);
    const done = a.status === 'done';
    const overdue = !done && a.dueDate < todayISO();
    const showDate = opts && opts.showDate;
    return (
      '<li class="item-row' + (done ? ' done-item' : '') + '" data-id="' + a.id + '">' +
        '<input type="checkbox" class="item-check" ' + (done ? 'checked ' : '') +
          'aria-label="Mark &quot;' + esc(a.title) + '&quot; ' + (done ? 'not done' : 'done') + '">' +
        '<div class="item-main">' +
          '<div class="item-title">' + esc(a.title) + '</div>' +
          '<div class="item-meta">' +
            chipHtml(course) +
            '<span class="type-tag type-' + a.type + '">' + TYPES[a.type] + '</span>' +
            (showDate
              ? '<span class="due-note' + (overdue ? ' overdue-note' : '') + '">' +
                  (overdue ? 'was due ' : 'due ') + fLong(a.dueDate) + '</span>'
              : (overdue ? '<span class="due-note overdue-note">was due ' + fLong(a.dueDate) + '</span>' : '')) +
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

    let heroSub;
    if (notStarted) {
      heroSub = 'Starts ' + fFull(sem.startDate) + ' — ' + daysBetween(today, sem.startDate) + ' days away';
    } else if (ended) {
      heroSub = 'Ended ' + fFull(sem.endDate) + ' — that’s a wrap 🎉';
    } else {
      heroSub = 'Week ' + week + ' of ' + totalW;
    }
    const pct = notStarted ? 0 : ended ? 100 : Math.round(((week - 0.5) / totalW) * 100);

    let html = '';
    if (state.sample) {
      html +=
        '<div class="sample-banner"><span><strong>Sample data.</strong> Poke around — nothing here is saved as yours.</span>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-action="clear-sample">Clear sample &amp; start fresh</button></div>';
    }

    html +=
      '<div class="week-hero">' +
        '<div class="week-hero-name"><h2>' + esc(sem.name) + '</h2>' +
          '<button class="btn-icon" type="button" data-action="edit-semester" aria-label="Edit semester name and dates">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.5 7.5 3 3"/></svg>' +
          '</button></div>' +
        '<span class="week-sub">' + heroSub + '</span>' +
      '</div>' +
      '<div class="semester-progress">' +
        '<div class="track" role="img" aria-label="Semester progress: ' + pct + ' percent">' +
          '<div class="fill" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="caption"><span>' + fMonthDay(sem.startDate) + '</span><span>' + fMonthDay(sem.endDate) + '</span></div>' +
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

    // Overdue: anything unfinished with a due date before today
    const overdue = state.assignments
      .filter((a) => a.status !== 'done' && a.dueDate < today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // This calendar week's items, grouped by day (todo from today on, plus anything done this week)
    const sunday = addDays(monday, 6);
    const thisWeek = state.assignments.filter((a) => a.dueDate >= monday && a.dueDate <= sunday);
    const dayGroups = [];
    for (let i = 0; i < 7; i++) {
      const dayISO = addDays(monday, i);
      const items = thisWeek
        .filter((a) => a.dueDate === dayISO && (a.status === 'done' || a.dueDate >= today))
        .sort((a, b) => (a.status === 'done') - (b.status === 'done'));
      if (items.length) dayGroups.push({ dayISO, items });
    }

    let listHtml = '';
    if (overdue.length) {
      listHtml +=
        '<div class="day-group">' +
          '<h3 class="day-head overdue-head">Overdue · ' + overdue.length + '</h3>' +
          '<ul class="item-list">' + overdue.map((a) => itemRowHtml(a)).join('') + '</ul>' +
        '</div>';
    }
    dayGroups.forEach((g) => {
      const isToday = g.dayISO === today;
      listHtml +=
        '<div class="day-group">' +
          '<h3 class="day-head">' + fmtDayName.format(parseDate(g.dayISO)) + ' ' + fMonthDay(g.dayISO) +
            (isToday ? ' <span class="today-tag">Today</span>' : '') + '</h3>' +
          '<ul class="item-list">' + g.items.map((a) => itemRowHtml(a)).join('') + '</ul>' +
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
        '<p><button class="btn btn-ghost btn-sm" type="button" data-action="add-assignment">+ Add an assignment</button></p>';
    }

    // Workload chart: due items per day this week (single series, direct hover labels)
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
    const bars = dayNames.map((name, i) => {
      const dayISO = addDays(monday, i);
      const h = counts[i] === 0 ? 3 : Math.round((counts[i] / max) * 78) + 8;
      return (
        '<div class="bar-col' + (dayISO === today ? ' is-today' : '') + '" title="' + counts[i] + ' due ' + name + '">' +
          '<span class="bar-value">' + (counts[i] || '') + '</span>' +
          '<div class="bar' + (counts[i] === 0 ? ' bar-zero' : '') + '" style="height:' + h + 'px"></div>' +
          '<span class="bar-label">' + name + '</span>' +
        '</div>'
      );
    }).join('');

    html +=
      '<div class="week-grid">' +
        '<div class="week-list">' + listHtml + '</div>' +
        '<div class="card chart-card">' +
          '<h2>This week’s load</h2>' +
          '<p class="chart-caption">' + (total === 0 ? 'Nothing due — clear runway.' : total + ' item' + (total === 1 ? '' : 's') + ' due this week') + '</p>' +
          '<div class="workload" role="img" aria-label="Due items by day. ' + esc(chartSummary) + '">' + bars + '</div>' +
        '</div>' +
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

    const today = todayISO();
    const thisMon = startOfWeek(today);
    const groups = new Map(); // label -> items
    items.forEach((a) => {
      let label;
      if (a.status !== 'done' && a.dueDate < today) {
        label = 'Overdue';
      } else {
        const diff = Math.round(daysBetween(thisMon, startOfWeek(a.dueDate)) / 7);
        if (diff < 0) label = 'Earlier';
        else if (diff === 0) label = 'This week';
        else if (diff === 1) label = 'Next week';
        else label = 'Week of ' + fMonthDay(startOfWeek(a.dueDate));
      }
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(a);
    });

    // Overdue first, Earlier last-but-orderly, rest in due order (map preserves insertion of sorted items, but Overdue may appear late)
    const ordered = [];
    if (groups.has('Overdue')) ordered.push(['Overdue', groups.get('Overdue')]);
    if (groups.has('Earlier')) ordered.push(['Earlier', groups.get('Earlier')]);
    groups.forEach((v, k) => { if (k !== 'Overdue' && k !== 'Earlier') ordered.push([k, v]); });

    el.innerHTML = ordered.map(([label, arr]) =>
      '<h2 class="week-section-head' + (label === 'Overdue' ? ' overdue-head' : '') + '">' + label + ' · ' + arr.length + '</h2>' +
      '<ul class="item-list">' + arr.map((a) => itemRowHtml(a, { showDate: true })).join('') + '</ul>'
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
    setFieldError($('#course-code'), $('#course-code-error'), null);
    setFieldError($('#course-name'), $('#course-name-error'), null);
    openDialog(dlg, $('#course-code'));
  }

  $('#form-course').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#course-code').value.trim();
    const name = $('#course-name').value.trim();
    let ok = true;
    setFieldError($('#course-code'), $('#course-code-error'), code ? null : 'Required.');
    setFieldError($('#course-name'), $('#course-name-error'), name ? null : 'Give the course a name.');
    if (!code || !name) return;
    const color = ($('input[name="course-color"]:checked') || {}).value || COLORS[0].key;
    if (editingCourseId) {
      const c = courseById(editingCourseId);
      if (c) { c.code = code; c.name = name; c.color = color; }
      announce(code + ' updated.');
    } else {
      state.courses.push({ id: uid(), code, name, color });
      announce(code + ' added.' + (state.assignments.length === 0 ? ' Next: add an assignment.' : ''));
    }
    save();
    $('#dlg-course').close();
    render();
  });

  // ---- assignment ----
  let editingAssignmentId = null;
  function openAssignmentDialog(id) {
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
    $('#assignment-due').value = a ? a.dueDate : '';
    $('#assignment-notes').value = a ? (a.notes || '') : '';
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
    const data = {
      title,
      courseId: $('#assignment-course').value,
      type: $('#assignment-type').value,
      dueDate: due,
      notes: $('#assignment-notes').value.trim()
    };
    if (editingAssignmentId) {
      const a = state.assignments.find((x) => x.id === editingAssignmentId);
      if (a) Object.assign(a, data);
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
    state = {
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
    };
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
      app: 'semester-hq', version: 1,
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
    announce('Backup downloaded.');
  }

  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
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
        code: c.code.slice(0, 12),
        name: c.name.slice(0, 60),
        color: colorKeys.includes(c.color) ? c.color : 'green'
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
        notes: typeof a.notes === 'string' ? a.notes.slice(0, 280) : ''
      });
    }
    return out;
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
      const ok = await confirmAsk('Importing replaces everything currently here with the backup. Continue?', 'Replace & import');
      if (!ok) return;
    }
    state = cleaned;
    save();
    render();
    announce('Backup imported.');
  }

  async function clearAll(skipConfirm) {
    if (!skipConfirm) {
      const ok = await confirmAsk('This deletes your semester, courses, and assignments from this browser. Export a backup first if you might want them back.', 'Delete everything');
      if (!ok) return;
    }
    state = structuredClone(EMPTY);
    localStorage.removeItem(KEY);
    location.hash = '#week';
    render();
    announce('All data cleared.');
  }

  // ============================================================
  // Theme
  // ============================================================
  function applyThemeLabel() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
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
    }
  });

  $('#btn-export').addEventListener('click', exportData);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
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
    t('backup validation drops orphans', (() => {
      const v = validateBackup({ data: { semester: null, courses: [{ code: 'A', name: 'B', color: 'green', id: 'c1' }], assignments: [{ title: 'x', dueDate: '2026-09-01', courseId: 'nope' }] } });
      return v && v.assignments.length === 0 && v.courses.length === 1;
    })());
    t('backup validation rejects bad dates', validateBackup({ data: { semester: { name: 'S', startDate: 'sep 1', endDate: '2026-12-18' }, courses: [], assignments: [] } }) === null);
    console.log('Self-tests complete.');
  }

  // ============================================================
  // Init
  // ============================================================
  applyThemeLabel();
  showView();
  if (location.search.indexOf('selftest') !== -1) runSelfTests();
})();
