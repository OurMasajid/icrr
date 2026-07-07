/* ICRR events module.
   Single source of truth for events. Renders the homepage "Upcoming Event"
   banner, the Events page featured banner, and the Events grid — and
   auto-expires anything whose date has already passed, so a finished event
   (e.g. a past Eid) can never linger as "Upcoming". */
(function () {
  // Keep this list current. Dates are ISO (YYYY-MM-DD), interpreted in local time.
  var ICRR_EVENTS = [
    { date: '2026-07-03', time: '7:30 PM',    tag: 'Friday',    title: 'Community Potluck',
      desc: 'First-Friday gathering after Maghrib. Bring a dish to share. Guest speaker TBA.' },
    { date: '2026-07-10', time: '7:00 PM',    tag: 'Youth',     title: 'Girls Night Out',
      desc: 'Halaqah, games, and dinner. Open to sisters ages 10–18.' },
    { date: '2026-07-17', time: '7:00 PM',    tag: 'Youth',     title: 'Boys Night Out',
      desc: 'Basketball, a short lecture, and dinner. Open to brothers ages 10–18.' },
    { date: '2026-07-25', time: 'After Isha', tag: 'Lecture',   title: 'The Months of Allah',
      desc: 'Special lecture on the sacred months of the Hijri calendar.' },
    { date: '2026-08-01', time: '9:00 AM',    tag: 'Service',   title: 'Free Food Pantry Distribution',
      desc: 'Monthly distribution to families in need. Volunteers welcome.' },
    { date: '2026-08-18', time: '10:00 AM',   tag: 'Education',  title: 'Sunday School — Fall Open House',
      desc: 'Meet the teachers and register your child for the upcoming school year.' }
  ];

  function asDate(iso) { return new Date(iso + 'T00:00:00'); }

  function fmtLong(iso) {
    return asDate(iso).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  }
  function fmtShort(iso) {
    return asDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function featuredHTML(e, chip) {
    return '' +
      '<div class="lg:col-span-7 relative z-10">' +
        '<span class="chip chip-gold">' + esc(chip) + '</span>' +
        '<h2 class="font-display text-3xl md:text-4xl font-bold mt-4">' + esc(e.title) + '</h2>' +
        '<p class="mt-3 text-emerald-50/90 max-w-xl">' + esc(e.desc) + '</p>' +
        '<div class="mt-6 flex flex-wrap gap-3">' +
          '<a href="events.html" class="btn btn-gold">View all events</a>' +
          '<a href="contact.html" class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,.55)">Volunteer</a>' +
        '</div>' +
      '</div>' +
      '<div class="lg:col-span-5 relative z-10">' +
        '<div class="rounded-2xl bg-white/10 border border-white/15 p-6">' +
          '<p class="text-xs uppercase tracking-widest text-emerald-100/80">When</p>' +
          '<p class="font-display text-2xl mt-1">' + fmtLong(e.date) + '</p>' +
          '<p class="text-sm text-emerald-100/80 mt-1">' + esc(e.time) + '</p>' +
        '</div>' +
      '</div>';
  }

  function cardHTML(e) {
    var gold = /youth/i.test(e.tag) ? ' chip-gold' : '';
    return '' +
      '<article class="card">' +
        '<div class="flex items-center justify-between">' +
          '<span class="chip' + gold + '">' + esc(e.tag) + '</span>' +
          '<span class="text-xs text-slate-500">' + fmtShort(e.date) + ' · ' + esc(e.time) + '</span>' +
        '</div>' +
        '<h3 class="font-display text-xl mt-3">' + esc(e.title) + '</h3>' +
        '<p class="mt-2 text-slate-600 text-sm">' + esc(e.desc) + '</p>' +
      '</article>';
  }

  function render() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var upcoming = ICRR_EVENTS
      .filter(function (e) { return asDate(e.date) >= today; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });

    // Homepage banner — soonest upcoming event.
    var home = document.querySelector('[data-events-home]');
    if (home) {
      var homeSection = home.closest('section');
      if (!upcoming.length) {
        if (homeSection) homeSection.style.display = 'none';
      } else {
        home.innerHTML = featuredHTML(upcoming[0], 'Upcoming Event');
      }
    }

    // Events page featured banner.
    var feat = document.querySelector('[data-events-featured]');
    if (feat) {
      if (!upcoming.length) {
        var fs = feat.closest('section');
        if (fs) fs.style.display = 'none';
      } else {
        feat.innerHTML = featuredHTML(upcoming[0], 'Featured');
      }
    }

    // Events page grid — everything after the featured one.
    var grid = document.querySelector('[data-events-grid]');
    if (grid) {
      var rest = feat ? upcoming.slice(1) : upcoming;
      grid.innerHTML = rest.length
        ? rest.map(cardHTML).join('')
        : '<p class="text-slate-600">No additional events scheduled right now — check back soon, inshāʾAllāh.</p>';
    }
  }

  if (document.readyState !== 'loading') render();
  else document.addEventListener('DOMContentLoaded', render);
})();
