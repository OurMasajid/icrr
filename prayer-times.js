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
    } catch (e) {
      if (window.console) console.warn('Prayer times: live fetch failed, using fallback.', e);
    }
  }

  if (document.readyState !== 'loading') load();
  else document.addEventListener('DOMContentLoaded', load);
})();
