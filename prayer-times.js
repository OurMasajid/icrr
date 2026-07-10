/* Live daily prayer times for ICRR — sourced from Masjidal via Netlify function.
   The function scrapes the Masjidal athanplus widget, caches for 30 min,
   and returns clean JSON.  The home page custom card and the prayer-times
   page weekly table both consume this. */
(function () {
  var API = '/.netlify/functions/prayer-times';

  // Map Masjidal names to our data-attribute keys
  var NAME_MAP = { Dhuhr: 'Zuhr' };
  function key(name) { return NAME_MAP[name] || name; }

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
      var k = key(name);
      fill('[data-adhan="' + k + '"]', p[name].starts || '—');
      fill('[data-iqamah="' + k + '"]', p[name].iqamah || '—');
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
        '<td>' + (((p.Dhuhr && p.Dhuhr.iqamah) || (p.Zuhr && p.Zuhr.iqamah)) || '—') + '</td>' +
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

  function highlightUpcomingPrayer(day) {
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var names = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

    names.forEach(function (name) {
      var prayer = day.prayers[name];
      if (!prayer || !prayer.starts) return;
      var adhanMin = parseTime(prayer.starts);
      if (adhanMin === null) return;
      var diff = adhanMin - nowMin;
      if (diff >= 0 && diff <= 15) {
        var k = key(name);
        document.querySelectorAll('.prayer-row').forEach(function (row) {
          var nameEl = row.querySelector('.name');
          if (nameEl && nameEl.textContent.trim() === k) row.classList.add('upcoming');
        });
      }
    });
  }

  function checkTomorrowChanges(days) {
    if (days.length < 2) return;
    var today = days[0].prayers;
    var tomorrow = days[1].prayers;
    var names = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    var changes = [];

    names.forEach(function (name) {
      var t = today[name];
      var m = tomorrow[name];
      if (!t || !m) return;
      if (t.iqamah && m.iqamah && t.iqamah !== m.iqamah) {
        changes.push({ name: (name === 'Dhuhr' ? 'Zuhr' : name), from: t.iqamah, to: m.iqamah });
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
      var r = await fetch(API, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var data = await r.json();
      if (!data.days || !data.days.length) throw new Error('empty');

      applyToday(data.days[0]);
      buildWeekTable(data.days);
      highlightUpcomingPrayer(data.days[0]);
      checkTomorrowChanges(data.days);
    } catch (e) {
      if (window.console) console.warn('Prayer times: live fetch failed, using fallback.', e);
    }
  }

  if (document.readyState !== 'loading') load();
  else document.addEventListener('DOMContentLoaded', load);
})();
