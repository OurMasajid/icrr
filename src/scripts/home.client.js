(function () {
  var now = new Date();
  var day = now.getDay();
  var h = now.getHours();

  function parseTimeToMinutes(str) {
    var m = (str || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!m) return null;
    var hh = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    var ap = m[3].toUpperCase();
    if (ap === 'PM' && hh !== 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    return hh * 60 + mm;
  }

  function positionJummahBanner() {
    var jummahBanner = document.getElementById('jummahHeroBanner');
    var prayerCard = document.querySelector('.prayer-card');
    if (!jummahBanner || !prayerCard) return;

    var d = new Date();
    var nowMin = d.getHours() * 60 + d.getMinutes();
    var asrEl = document.querySelector('[data-adhan="Asr"]');
    var asrMin = asrEl ? parseTimeToMinutes(asrEl.textContent) : null;
    var beforeAsr = asrMin === null || nowMin < asrMin;

    if (d.getDay() === 5 && beforeAsr) {
      jummahBanner.classList.add('jummah-pulse');
      prayerCard.parentNode.insertBefore(jummahBanner, prayerCard);
    } else {
      jummahBanner.classList.remove('jummah-pulse');
      prayerCard.parentNode.insertBefore(jummahBanner, prayerCard.nextSibling);
    }
  }

  window.positionJummahBanner = positionJummahBanner;
  positionJummahBanner();

  var todayISO = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  document.querySelectorAll('[data-event-date]').forEach(function(card) {
    if (card.dataset.eventDate.split(',').indexOf(todayISO) !== -1)
      card.classList.add('today-event');
  });
  document.querySelectorAll('[data-event-day]').forEach(function(card) {
    if (parseInt(card.dataset.eventDay, 10) === day)
      card.classList.add('today-event');
  });

  // Sort the homepage events preview soonest-first, same convention as
  // events.html. Past dated cards are dropped from this preview (there's no
  // "Previous Events" section here); undated/recurring cards are left after.
  (function sortEventsPreview() {
    function parseISO(s) { return new Date(s + 'T00:00:00'); }
    function lastDate(card) {
      if (card.dataset.eventUntil) return parseISO(card.dataset.eventUntil);
      if (card.dataset.eventDate) {
        var dates = card.dataset.eventDate.split(',');
        return parseISO(dates[dates.length - 1]);
      }
      return null;
    }

    var preview = document.querySelector('.events-preview-scroll');
    if (!preview) return;

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var cards = Array.prototype.slice.call(preview.querySelectorAll('.event-flyer-card'));
    var dated = cards.filter(function (c) { return lastDate(c); });
    var undated = cards.filter(function (c) { return !lastDate(c); });

    var upcoming = dated
      .filter(function (c) { return lastDate(c) >= today; })
      .sort(function (a, b) { return lastDate(a) - lastDate(b); });
    var past = dated.filter(function (c) { return lastDate(c) < today; });

    upcoming.concat(undated).forEach(function (c) { preview.appendChild(c); });
    past.forEach(function (c) { c.remove(); });
  })();
})();
