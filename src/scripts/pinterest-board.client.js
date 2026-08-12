// Renders the ICRR events Pinterest board into the "From Our Pinterest Board"
// grid on events.html.
//
// The feed is fetched from /api/pinterest-board, which is a Netlify rewrite
// onto the board's RSS (see netlify.toml). Pinterest sends no
// Access-Control-Allow-Origin header, so fetching pinterest.com directly from
// the page would be blocked — the rewrite makes it same-origin instead.
//
// Everything below treats the feed as untrusted third-party input: pins are
// built with createElement/textContent rather than innerHTML, and image URLs
// are accepted only if they're https on Pinterest's own CDN. A pin's title is
// whatever the person who pinned it typed, so it must never reach the DOM as
// markup.
(function () {
  var FEED_URL = '/api/pinterest-board';
  var BOARD_URL = 'https://www.pinterest.com/akaban01/icrr-events/';

  var section = document.getElementById('pinterestBoardSection');
  var grid = document.getElementById('pinterestBoardGrid');
  var status = document.getElementById('pinterestBoardStatus');
  if (!section || !grid) return;

  // Pinterest's CDN serves the same image at several widths under a size
  // segment (/236x/, /564x/, /736x/, /originals/). The feed hands us the
  // 236px thumbnail, which looks soft in a card this size, so ask for 736px.
  function upgradeSize(url) {
    return url.replace(/\/(236x|474x|564x)\//, '/736x/');
  }

  function isPinterestImage(url) {
    try {
      var u = new URL(url);
      return u.protocol === 'https:' && /(^|\.)pinimg\.com$/.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function isPinLink(url) {
    try {
      var u = new URL(url);
      return u.protocol === 'https:' && /(^|\.)pinterest\.com$/.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  // Each RSS item's <description> is an escaped <a><img></a> blob. Parsing it
  // as XML already unescapes the entities, so pull the src straight out.
  function imageFrom(description) {
    if (!description) return null;
    var match = description.match(/src="([^"]+)"/);
    if (!match || !match[1]) return null;
    return isPinterestImage(match[1]) ? upgradeSize(match[1]) : null;
  }

  function buildCard(pin) {
    var card = document.createElement('div');
    card.className = 'event-flyer-card';

    var link = document.createElement('a');
    link.className = 'event-flyer-img-wrap';
    link.href = pin.link;
    link.target = '_blank';
    // Pinterest is a third-party destination — don't leak the opener.
    link.rel = 'noopener noreferrer';

    var img = document.createElement('img');
    img.src = pin.image;
    img.alt = pin.title || 'Event flyer from the ICRR Pinterest board';
    img.loading = 'lazy';
    // A pin deleted on Pinterest keeps its feed entry for a while but 404s the
    // image; drop the whole card rather than leaving a broken frame.
    img.addEventListener('error', function () {
      if (card.parentNode) card.parentNode.removeChild(card);
      if (!grid.children.length) section.setAttribute('hidden', '');
    });

    link.appendChild(img);
    card.appendChild(link);

    if (pin.title) {
      var info = document.createElement('div');
      info.className = 'event-flyer-info';
      var heading = document.createElement('h3');
      heading.className = 'font-display text-lg';
      heading.textContent = pin.title;
      info.appendChild(heading);
      card.appendChild(info);
    }

    return card;
  }

  function parsePins(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) return [];

    var pins = [];
    var items = doc.querySelectorAll('item');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var description = item.querySelector('description');
      var image = imageFrom(description && description.textContent);
      // Pins that are still processing (or are video) come through with an
      // empty <img src="">. There's nothing to show, so skip them.
      if (!image) continue;

      var linkEl = item.querySelector('link');
      var link = linkEl ? linkEl.textContent.trim() : '';
      var titleEl = item.querySelector('title');
      // Feed titles are often a single space rather than genuinely empty.
      var title = titleEl ? titleEl.textContent.trim() : '';

      pins.push({
        image: image,
        link: isPinLink(link) ? link : BOARD_URL,
        title: title,
      });
    }
    return pins;
  }

  function fail() {
    // The board is a nice-to-have next to the CMS-managed cards above it, so
    // a Pinterest outage should leave no trace on the page.
    section.setAttribute('hidden', '');
  }

  fetch(FEED_URL, { headers: { Accept: 'application/rss+xml, text/xml' } })
    .then(function (res) {
      if (!res.ok) throw new Error('feed responded ' + res.status);
      return res.text();
    })
    .then(function (xmlText) {
      var pins = parsePins(xmlText);
      if (!pins.length) return fail();

      var fragment = document.createDocumentFragment();
      pins.forEach(function (pin) {
        fragment.appendChild(buildCard(pin));
      });

      if (status && status.parentNode) status.parentNode.removeChild(status);
      grid.appendChild(fragment);
      section.removeAttribute('hidden');
    })
    .catch(fail);
})();
