/* Live daily prayer times for ICRR — fetched directly from Masjidal's public
   API (masjidal.com/api/v1/time/range) in the browser. The home page custom
   card and the prayer-times page weekly table both consume this. */
(function () {
  var MASJID_ID = 'E5AvRnAX';
  var TIMEZONE = 'America/Chicago';
  var RANGE_DAYS = 7;
  var CACHE_KEY = 'icrr-prayer-times';
  var CACHE_TTL_MS = 20 * 60 * 1000;

  function trim(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function formatTime(t) {
    return trim(t).replace(/(\d)(AM|PM)/i, '$1 $2');
  }

  function localDateStr(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(date);
  }

  function buildHijri(hijriDate, hijriMonth) {
    if (!hijriDate || !hijriMonth) return null;
    var parts = hijriDate.split(',').map(function (s) { return s.trim(); });
    var day = parts[0];
    var year = parts[1];
    if (!day || !year) return null;
    return day + ' ' + hijriMonth + ', ' + year;
  }

  function prayer(starts, iqamah) {
    var result = { starts: formatTime(starts) };
    if (iqamah) result.iqamah = formatTime(iqamah);
    return result;
  }

  function buildDay(salah, iqamah) {
    var prayers = {
      Fajr: prayer(salah.fajr, iqamah && iqamah.fajr),
      Sunrise: prayer(salah.sunrise, null),
      Zuhr: prayer(salah.zuhr, iqamah && iqamah.zuhr),
      Asr: prayer(salah.asr, iqamah && iqamah.asr),
      Maghrib: prayer(salah.maghrib, iqamah && iqamah.maghrib),
      Isha: prayer(salah.isha, iqamah && iqamah.isha)
    };

    var jumuah = [];
    if (iqamah && iqamah.jummah1) jumuah.push({ time: formatTime(iqamah.jummah1) });
    if (iqamah && iqamah.jummah2) jumuah.push({ time: formatTime(iqamah.jummah2) });

    return {
      date: salah.date,
      hijri: buildHijri(salah.hijri_date, salah.hijri_month),
      prayers: prayers,
      jumuah: jumuah.length ? jumuah : undefined
    };
  }

  // Session-scoped cache so a visitor browsing multiple pages in one visit
  // (home, prayer-times, ...) doesn't refetch from Masjidal on every page load.
  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (!cached || !cached.days || !cached.fetchedAt) return null;
      if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
      return cached.days;
    } catch (e) {
      return null;
    }
  }

  function writeCache(days) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ days: days, fetchedAt: Date.now() }));
    } catch (e) {
      // sessionStorage unavailable (private browsing, quota, etc.) — skip caching
    }
  }

  async function fetchDaysFromNetwork() {
    var today = new Date();
    var from = localDateStr(today);
    var to = localDateStr(new Date(today.getTime() + (RANGE_DAYS - 1) * 86400000));
    var url = 'https://masjidal.com/api/v1/time/range?masjid_id=' + MASJID_ID +
      '&from_date=' + from + '&to_date=' + to;

    var r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var json = await r.json();
    if (json.status !== 'success' || !json.data || !json.data.salah || !json.data.salah.length) {
      throw new Error('empty');
    }

    var iqamahByDate = {};
    (json.data.iqamah || []).forEach(function (i) { iqamahByDate[i.date] = i; });

    return json.data.salah.map(function (s) { return buildDay(s, iqamahByDate[s.date]); });
  }

  async function fetchDays() {
    var cached = readCache();
    if (cached) return cached;

    var days = await fetchDaysFromNetwork();
    writeCache(days);
    return days;
  }

  function fill(sel, val) {
    document.querySelectorAll(sel).forEach(function (el) { el.textContent = val; });
  }

  function setDateLabel(dateStr) {
    if (dateStr) {
      fill('[data-today-label]', 'Today · ' + dateStr);
    } else {
      var s = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
      fill('[data-today-label]', 'Today · ' + s);
    }
  }

  function rollDates() {
    var cells = document.querySelectorAll('[data-roll-date]');
    if (!cells.length) return;
    var base = new Date();
    cells.forEach(function (c, i) {
      var d = new Date(base);
      d.setDate(base.getDate() + i);
      c.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
  }

  function applyToday(day) {
    setDateLabel(day.date);

    var p = day.prayers;
    Object.keys(p).forEach(function (name) {
      fill('[data-adhan="' + name + '"]', p[name].starts || '—');
      fill('[data-iqamah="' + name + '"]', p[name].iqamah || '—');
    });

    if (day.hijri) {
      fill('[data-hijri-full]', day.hijri);
      var parts = day.hijri.split(/[, ]+/);
      if (parts.length >= 2) fill('[data-hijri-day]', parts[0] + ' ' + parts[1]);
      if (parts.length >= 3) fill('[data-hijri-year]', parts[2] + ' H');
    }

    if (day.jumuah && day.jumuah.length) {
      fill('[data-jumuah]', day.jumuah.map(function (j) { return j.time; }).join(' · '));
    }

    if (window.positionJummahBanner) window.positionJummahBanner();
  }

  function buildWeekTable(days) {
    var tbody = document.querySelector('[data-iqamah-week]');
    if (!tbody || !days.length) return;

    tbody.innerHTML = days.map(function (d) {
      var p = d.prayers;
      var label = d.date
        ? d.date.replace(/^[A-Za-z]+,\s*/, '')
        : '';
      return '<tr>' +
        '<td class="py-2.5 pr-3 font-semibold">' + label + '</td>' +
        '<td>' + ((p.Fajr && p.Fajr.iqamah) || '—') + '</td>' +
        '<td>' + ((p.Zuhr && p.Zuhr.iqamah) || '—') + '</td>' +
        '<td>' + ((p.Asr && p.Asr.iqamah) || '—') + '</td>' +
        '<td>' + ((p.Maghrib && p.Maghrib.iqamah) || '—') + '</td>' +
        '<td>' + ((p.Isha && p.Isha.iqamah) || '—') + '</td>' +
        '</tr>';
    }).join('');
  }

  function parseTime(str) {
    var m = (str || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    var ap = m[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  // Reads the times already rendered in the DOM (live or static fallback)
  // so the next-prayer highlight is correct even if the live fetch fails.
  function highlightNextPrayer() {
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();

    var rows = document.querySelectorAll('.prayer-row');
    rows.forEach(function (row) { row.classList.remove('highlight', 'upcoming'); });

    var best = null;
    rows.forEach(function (row) {
      var timeEl = row.querySelector('.time[data-adhan]');
      if (!timeEl) return;
      var adhanMin = parseTime(timeEl.textContent);
      if (adhanMin === null) return;
      var diff = adhanMin - nowMin;
      if (diff >= 0 && (!best || diff < best.diff)) best = { row: row, diff: diff };
    });

    if (!best) return;
    best.row.classList.add('highlight');
    if (best.diff <= 15) best.row.classList.add('upcoming');
  }

  function checkTomorrowChanges(days) {
    if (days.length < 2) return;
    var today = days[0].prayers;
    var tomorrow = days[1].prayers;
    var names = ['Fajr', 'Zuhr', 'Asr', 'Isha'];
    var changes = [];

    names.forEach(function (name) {
      var t = today[name];
      var m = tomorrow[name];
      if (!t || !m) return;
      if (t.iqamah && m.iqamah && t.iqamah !== m.iqamah) {
        changes.push({ name: name, from: t.iqamah, to: m.iqamah });
      }
    });

    if (!changes.length) return;

    var html = '<div class="iqamah-change-alert">' +
      '<div class="iqamah-change-alert-inner">' +
      '<p class="iqamah-change-title">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      'Iqamah times changing tomorrow</p>' +
      '<div class="iqamah-change-list">' +
      changes.map(function (c) {
        return '<span class="iqamah-change-item"><strong>' + c.name + '</strong> ' +
          c.from + ' <span class="iqamah-change-arrow">→</span> ' + c.to + '</span>';
      }).join('') +
      '</div></div></div>';

    var nav = document.querySelector('.site-nav');
    if (nav) nav.insertAdjacentHTML('afterend', html);
  }

  async function load() {
    setDateLabel();
    rollDates();
    try {
      var days = await fetchDays();

      applyToday(days[0]);
      buildWeekTable(days);
      checkTomorrowChanges(days);
    } catch (e) {
      if (window.console) console.warn('Prayer times: live fetch failed, using fallback.', e);
    } finally {
      highlightNextPrayer();
    }
  }

  if (document.readyState !== 'loading') load();
  else document.addEventListener('DOMContentLoaded', load);
})();
