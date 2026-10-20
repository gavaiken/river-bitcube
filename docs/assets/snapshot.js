/* Newest gallery-cam still from the `snapshot` branch (pushed every minute by tools/snapshot.ps1).
 * raw.githubusercontent.com caches each path for 5 minutes and ignores query strings, so gallery.jpg can be
 * up to 5 minutes stale. Every minute also has its own file, m/<UTC yyyyMMdd-HHmm>.jpg (the last 15), and a
 * new path is never cached: try the newest minute that should exist, step back a minute at a time, and fall
 * back to gallery.jpg (outside 08:00-02:00, or if the clocks disagree). No API calls, so no rate limit. */
(function () {
  var BASE = 'https://raw.githubusercontent.com/gavaiken/river-bitcube/snapshot/';
  var LAG_MS = 75000;      // a still is pushed ~10-20 s after its minute starts; ask for one safely there
  var TRIES = 15;          // minutes kept on the branch

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function minuteName(d) {
    return 'm/' + d.getUTCFullYear() + two(d.getUTCMonth() + 1) + two(d.getUTCDate()) + '-' +
      two(d.getUTCHours()) + two(d.getUTCMinutes()) + '.jpg';
  }

  // done(url, takenDate or null) on success, fail() if nothing loads.
  function newest(done, fail) {
    var start = Date.now() - LAG_MS, i = 0;
    function attempt() {
      if (i >= TRIES) { return fallback(); }
      var d = new Date(start - i * 60000);
      d.setUTCSeconds(0, 0);
      var url = BASE + minuteName(d), probe = new Image();
      probe.onload = function () { done(url, d); };
      probe.onerror = function () { i++; attempt(); };
      probe.src = url;
    }
    function fallback() {
      var url = BASE + 'gallery.jpg', probe = new Image();
      probe.onload = function () { done(url, null); };
      probe.onerror = fail;
      probe.src = url;
    }
    attempt();
  }

  function ago(d) {
    var m = Math.round((Date.now() - d.getTime()) / 60000);
    return m <= 0 ? 'just now' : m === 1 ? '1 minute ago' : m < 120 ? m + ' minutes ago' : Math.round(m / 60) + ' hours ago';
  }

  /* riverSnapshot({img, time, note, every}): load the newest still into img; write when it was taken into
   * time; every = seconds between refreshes (0 = once). If nothing loads, img keeps its src. */
  window.riverSnapshot = function (o) {
    var taken = null;
    function show() {
      if (!o.time) { return; }
      o.time.textContent = taken ? 'Taken ' + taken.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        ' (' + ago(taken) + ').' : '';
    }
    function refresh() {
      newest(function (url, d) {
        o.img.src = url;
        taken = d;
        if (!d && o.time) {   // gallery.jpg: ask the commit time once (60 requests/hour limit, so not every minute)
          fetch('https://api.github.com/repos/gavaiken/river-bitcube/commits/snapshot')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (c) { if (c) { taken = new Date(c.commit.committer.date); show(); } })
            .catch(function () {});
        }
        show();
      }, function () { if (o.note) { o.note.textContent = o.failText || 'The camera snapshot is unavailable right now.'; } });
    }
    refresh();
    if (o.every) { setInterval(refresh, o.every * 1000); setInterval(show, 15000); }
  };
})();
