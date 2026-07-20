(function() {
  var now = new Date();
  var day = now.getDay();
  var h = now.getHours();
  if (day === 5 && h >= 5 && h < 18) {
    var el = document.getElementById('jummahBanner');
    if (el) { el.style.display = ''; el.classList.add('jummah-pulse'); }
  }
})();
