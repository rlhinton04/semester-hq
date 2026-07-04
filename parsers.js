/* Semester HQ — pure parsing & planning helpers. No DOM, no app state.
   Exposed on window.SHQ so app.js and the ?selftest suite can call them. */
(function () {
  'use strict';

  const pad2 = (n) => String(n).padStart(2, '0');
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isoAddDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }
  function localTodayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // ============================================================
  // Class-schedule helpers
  // ============================================================
  const DAY_ABBR = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa']; // Date.getDay() order
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];                  // rendered Mon-first

  function formatMeetingDays(days) {
    return DAY_ORDER.filter((d) => days.indexOf(d) !== -1).map((d) => DAY_ABBR[d]).join('');
  }

  function formatTime12(hhmm) {
    const parts = hhmm.split(':').map(Number);
    const h = parts[0], m = parts[1];
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + pad2(m) + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  // "9:30–10:45 AM" (shared period collapses) or "11:30 AM–12:45 PM"
  function formatMeetingTime(m) {
    if (!m.end) return formatTime12(m.start);
    const s = formatTime12(m.start), e = formatTime12(m.end);
    return s.slice(-2) === e.slice(-2) ? s.slice(0, -3) + '–' + e : s + '–' + e;
  }

  // Courses meeting on jsDay (0=Sun…6=Sat), sorted by start time.
  function meetingsToday(courses, jsDay) {
    const out = [];
    courses.forEach((c) => (c.schedule || []).forEach((m) => {
      if (m.days.indexOf(jsDay) !== -1) out.push({ course: c, meeting: m });
    }));
    out.sort((a, b) => a.meeting.start.localeCompare(b.meeting.start));
    return out;
  }

  // ============================================================
  // Assignment-type inference (shared by syllabus + ICS import)
  // Precedence matters: "Final project" is a project, not an exam.
  // ============================================================
  function inferType(title) {
    const t = String(title).toLowerCase();
    if (/\b(paper|essay|project|presentation)\b/.test(t)) return 'project';
    if (/\b(final|midterm|exam|test)\b/.test(t)) return 'exam';
    if (/quiz/.test(t)) return 'quiz';
    if (/\b(read|reading|chapter)\b|\bch\.?\s*\d/.test(t)) return 'reading';
    return 'assignment';
  }

  // ============================================================
  // Syllabus text parsing
  // ============================================================
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i;
  const NUM_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

  function extractDatePieces(m, kind) {
    let month, day, year = null;
    if (kind === 'mon') {
      month = MONTHS[m[1].toLowerCase().slice(0, 3)];
      day = +m[2];
      if (m[3]) year = +m[3];
    } else {
      month = +m[1];
      day = +m[2];
      if (m[3]) { year = +m[3]; if (year < 100) year += 2000; }
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month, day, year };
  }

  // First date token in a line; ranges ("Sept 12–14", "9/12-9/14") resolve
  // to the END date. Returns {month, day, year|null, start, end} or null.
  function findDateToken(line) {
    const mMon = MONTH_RE.exec(line);
    const mNum = NUM_RE.exec(line);
    let m = null, kind = null;
    if (mMon && (!mNum || mMon.index <= mNum.index)) { m = mMon; kind = 'mon'; }
    else if (mNum) { m = mNum; kind = 'num'; }
    if (!m) return null;
    let pieces = extractDatePieces(m, kind);
    if (!pieces) return null;
    let start = m.index, end = m.index + m[0].length;

    const rest = line.slice(end);
    const sep = rest.match(/^\s*[-–—]\s*/);
    if (sep) {
      const after = rest.slice(sep[0].length);
      const rMon = MONTH_RE.exec(after);
      const rNum = NUM_RE.exec(after);
      let rm = null, rkind = null;
      if (rMon && rMon.index === 0) { rm = rMon; rkind = 'mon'; }
      else if (rNum && rNum.index === 0) { rm = rNum; rkind = 'num'; }
      if (rm) {
        const rp = extractDatePieces(rm, rkind);
        if (rp) { pieces = rp; end += sep[0].length + rm[0].length; }
      } else {
        const rDay = after.match(/^(\d{1,2})(?:st|nd|rd|th)?\b/);
        if (rDay && +rDay[1] >= 1 && +rDay[1] <= 31) {
          pieces = { month: pieces.month, day: +rDay[1], year: pieces.year };
          end += sep[0].length + rDay[0].length;
        }
      }
    }
    return { month: pieces.month, day: pieces.day, year: pieces.year, start, end };
  }

  // Pick the year that lands inside the semester (±30 days); with no
  // semester, use the current year, bumping +1 if that puts the date more
  // than ~4 months in the past (typing next term's syllabus in summer).
  function inferYear(month, day, ctx) {
    const c = ctx || {};
    const mk = (y) => y + '-' + pad2(month) + '-' + pad2(day);
    if (ISO_RE.test(c.semesterStart || '') && ISO_RE.test(c.semesterEnd || '')) {
      const lo = isoAddDays(c.semesterStart, -30), hi = isoAddDays(c.semesterEnd, 30);
      const y1 = +c.semesterStart.slice(0, 4), y2 = +c.semesterEnd.slice(0, 4);
      const candidates = y1 === y2 ? [y1] : [y1, y2];
      for (let i = 0; i < candidates.length; i++) {
        if (mk(candidates[i]) >= lo && mk(candidates[i]) <= hi) return candidates[i];
      }
      return y1;
    }
    const t = ISO_RE.test(c.todayISO || '') ? c.todayISO : localTodayISO();
    const y = +t.slice(0, 4);
    return mk(y) < isoAddDays(t, -120) ? y + 1 : y;
  }

  // ctx: { semesterStart, semesterEnd, todayISO } (all optional ISO strings)
  // → [{ dueDate, title, type, confidence: 'normal'|'low', raw }]
  function parseSyllabusText(text, ctx) {
    const out = [];
    const seen = new Set();
    String(text || '').split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      const tok = findDateToken(line);
      if (!tok) return;
      const year = tok.year || inferYear(tok.month, tok.day, ctx);
      const dt = new Date(year, tok.month - 1, tok.day);
      if (dt.getMonth() !== tok.month - 1 || dt.getDate() !== tok.day) return; // e.g. Feb 31
      const dueDate = year + '-' + pad2(tok.month) + '-' + pad2(tok.day);

      const weekOf = /week\s+of\s*$/i.test(line.slice(0, tok.start));
      let title = (line.slice(0, tok.start) + ' ' + line.slice(tok.end))
        .replace(/\bweek\s+of\b/i, ' ')
        .replace(/[\t|]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s\-–—:;•,.·]+|[\s\-–—:;•,.·]+$/g, '')
        .replace(/^due\b[:\s]+/i, '')
        .replace(/\s+due$/i, '')
        .trim();
      if (title.length < 3) return;
      title = title.slice(0, 80);

      const key = dueDate + '|' + title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        dueDate, title,
        type: inferType(title),
        confidence: weekOf ? 'low' : 'normal',
        raw: line
      });
    });
    return out;
  }

  // ============================================================
  // Canvas calendar-feed (.ics) parsing
  // ============================================================
  function unescapeICS(s) {
    return s.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }

  // DTSTART → local "YYYY-MM-DD". Canvas encodes due times in UTC ("...Z"),
  // so those convert through the local timezone to land on the right day;
  // date-only and naive values are taken as-is (no TZ database here — the
  // review step lets the user fix a rare off-by-one).
  function icsDate(value) {
    const v = value.trim();
    let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (!m) return null;
    if (m[7]) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    return m[1] + '-' + m[2] + '-' + m[3];
  }

  // → [{ uid, title, dueDate, kind: 'assignment'|'event', courseTag, type }]
  function parseICS(text) {
    const unfolded = String(text || '')
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .replace(/\n[ \t]/g, ''); // unfold RFC 5545 continuation lines
    const events = [];
    unfolded.split('BEGIN:VEVENT').slice(1).forEach((chunk) => {
      const body = chunk.split('END:VEVENT')[0];
      const props = {};
      body.split('\n').forEach((ln) => {
        const idx = ln.indexOf(':');
        if (idx < 1) return;
        const name = ln.slice(0, idx).split(';')[0].toUpperCase();
        if (!(name in props)) props[name] = ln.slice(idx + 1);
      });
      if (!props.SUMMARY || !props.DTSTART) return;
      const uid = (props.UID || '').trim();
      const summary = unescapeICS(props.SUMMARY.trim());
      const dueDate = icsDate(props.DTSTART);
      if (!dueDate) return;
      const kind = /event-assignment(?:-override)?-\d+/.test(uid) ? 'assignment' : 'event';
      const tagMatch = summary.match(/\s*\[([^\]]+)\]\s*$/);
      const courseTag = tagMatch ? tagMatch[1].trim() : '';
      const title = (tagMatch ? summary.slice(0, tagMatch.index) : summary).trim().slice(0, 80);
      if (!title) return;
      events.push({ uid, title, dueDate, kind, courseTag, type: inferType(title) });
    });
    return events;
  }

  // ============================================================
  // Course matching for imported events
  // ============================================================
  const normCode = (s) => String(s).toUpperCase().replace(/[-\s]+/g, ' ').trim();

  // Canvas tags look like "FA26: INFO-I 300 12345" — an existing course
  // matches when its normalized code appears inside the normalized tag.
  function matchCourse(tag, courses) {
    const t = normCode(tag);
    if (!t) return null;
    for (let i = 0; i < courses.length; i++) {
      if (t.indexOf(normCode(courses[i].code)) !== -1) return courses[i];
    }
    return null;
  }

  // Strip term prefix ("FA26:") and trailing section number for a
  // proposed new-course code.
  function proposeCourseCode(tag) {
    return String(tag).trim()
      .replace(/^[A-Z]{2}\d{2}[:\s-]+/i, '')
      .replace(/\s+\d{4,6}$/, '')
      .trim().slice(0, 16).trim();
  }

  // ============================================================
  // Canvas re-import merge planning
  // ============================================================
  // Never touches status/subtasks/notes/courseId and never deletes:
  // a done assignment stays done through a due-date change, and items
  // that vanish from the feed are left alone locally.
  function planCanvasMerge(events, assignments) {
    const byUid = new Map();
    assignments.forEach((a) => { if (a.canvasUid) byUid.set(a.canvasUid, a); });
    const plan = [];
    let unchanged = 0;
    events.forEach((ev) => {
      const existing = ev.uid ? byUid.get(ev.uid) : null;
      if (!existing) { plan.push({ action: 'create', event: ev }); return; }
      const changes = {};
      if (existing.title !== ev.title) changes.title = ev.title;
      if (existing.dueDate !== ev.dueDate) changes.dueDate = ev.dueDate;
      if (Object.keys(changes).length) plan.push({ action: 'update', id: existing.id, event: ev, changes });
      else unchanged += 1;
    });
    return { plan, unchanged };
  }

  window.SHQ = {
    formatMeetingDays, formatTime12, formatMeetingTime, meetingsToday,
    inferType, inferYear, findDateToken, parseSyllabusText,
    parseICS, icsDate,
    normCode, matchCourse, proposeCourseCode,
    planCanvasMerge
  };
})();
