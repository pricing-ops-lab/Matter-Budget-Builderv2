/*
 * Visit and download counter for the public site (landing page, demo, 404).
 * Never included in matter-budget-builder.html: the tool itself sends nothing.
 *
 * Uses GoatCounter (https://www.goatcounter.com): no cookies, no personal data,
 * no third-party script. This file builds the count URL itself and sends it as
 * a beacon, so what leaves the browser is exactly what you can read below.
 *
 * Counts:
 *   page views     path, page title, referrer, screen size
 *   qr-scan        visits that arrive through the QR code (?src=qr)
 *   clicks         any element with data-track="name" (title = where it was clicked)
 *   window.mbbTrack(name, title) for events raised from script (the demo player)
 *
 * The dashboard, with dates and times, is at https://CODE.goatcounter.com.
 */
(function () {
  "use strict";
  var CODE = 'matter-budget-builder';            // GoatCounter site code
  var BASE = /^\/Matter-Budget-Builderv2/i;      // trimmed from paths for a cleaner dashboard

  var endpoint = window.__trackEndpoint ||
    (/\.github\.io$/i.test(location.hostname) ? 'https://' + CODE + '.goatcounter.com/count' : null);
  window.mbbTrack = function () {};
  if (!CODE || !endpoint) return;                // local copies and previews count nothing

  var enc = encodeURIComponent;
  var me = document.currentScript;
  var is404 = !!(me && me.hasAttribute('data-404'));
  var page = (location.pathname.replace(BASE, '') || '/').replace(/index\.html$/i, '');

  function send(path, title, isEvent) {
    var url = endpoint +
      '?p=' + enc(path) +
      '&t=' + enc(title || document.title) +
      '&r=' + enc(isEvent ? '' : document.referrer) +
      '&s=' + enc([screen.width, screen.height, window.devicePixelRatio || 1].join(',')) +
      (isEvent ? '&e=true' : '') +
      '&rnd=' + Math.random().toString(36).slice(2);
    try { if (navigator.sendBeacon && navigator.sendBeacon(url)) return; } catch (e) {}
    new Image().src = url;                       // fallback; survives a click that navigates away
  }

  var where = is404 ? '404 page' : page === '/' ? 'home page' : page.replace(/^\//, '').replace(/\.html$/, '') + ' page';
  window.mbbTrack = function (name, title) { send(name, title || where, true); };

  send(is404 ? '404 ' + page : page);
  if (/[?&]src=qr\b/.test(location.search)) send('qr-scan', where, true);

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-track]');
    if (el) send(el.getAttribute('data-track'), where, true);
  }, true);
})();
