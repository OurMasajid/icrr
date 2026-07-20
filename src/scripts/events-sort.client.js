// Sorts dated event cards soonest-first and moves anything whose date has
// passed into the Previous Events section. Cards with no date attribute
// (recurring weekly programs) are left in place, untouched.
(function () {
  function parseISO(s) { return new Date(s + 'T00:00:00'); }

  function lastDate(card) {
    if (card.dataset.eventUntil) return parseISO(card.dataset.eventUntil);
    if (card.dataset.eventDate) {
      var dates = card.dataset.eventDate.split(',');
      return parseISO(dates[dates.length - 1]);
    }
    return null;
  }

  var gallery = document.getElementById('eventGallery');
  var pastSection = document.getElementById('pastEventsSection');
  var pastGallery = document.getElementById('pastEventsGallery');
  if (!gallery) return;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var cards = Array.prototype.slice.call(gallery.querySelectorAll('.event-flyer-card'));
  var dated = cards.filter(function (c) { return lastDate(c); });
  var undated = cards.filter(function (c) { return !lastDate(c); });

  var upcoming = dated
    .filter(function (c) { return lastDate(c) >= today; })
    .sort(function (a, b) { return lastDate(a) - lastDate(b); });
  var past = dated
    .filter(function (c) { return lastDate(c) < today; })
    .sort(function (a, b) { return lastDate(b) - lastDate(a); });

  upcoming.concat(undated).forEach(function (c) { gallery.appendChild(c); });

  if (past.length && pastGallery) {
    past.forEach(function (c) { pastGallery.appendChild(c); });
    if (pastSection) pastSection.style.display = '';
  }
})();
