/**
 * site.js — CR880x landing page behaviour (FlowOS style)
 *
 * Plain hand-written vanilla JS, no framework. Jobs:
 *   1. Lenis smooth scrolling (optional, graceful fallback)
 *   2. Full-page deck (hero / 01 / 02): the three pages are stacked in
 *      one sticky viewport. Turning a page takes only TRAVEL_RATIO of
 *      a screen of scrolling (0.6), so a short swipe flips a page; the
 *      snap is also biased in the direction of travel, so letting go
 *      after roughly a third of that short travel already completes
 *      the turn. Scroll progress drives a crossfade between
 *      neighbouring pages — but ONLY when their backgrounds differ
 *      (data-bg); pages sharing a background switch outright with no
 *      fade. When scrolling stops anywhere in the deck zone (including
 *      the exit into the smooth section), the position snaps to the
 *      nearest whole-page boundary, so a page can never come to rest
 *      half-turned.
 *   3. Scroll-following motion (FlowOS style, no staged entrances):
 *      the rAF loop writes a continuous --rv progress (0..1) onto every
 *      .reveal element from its live viewport position, and CSS turns
 *      it into a gentle rise + blur-to-sharp. [data-words] elements are
 *      split into word/character spans first, so the same --rv makes
 *      the text rise word by word. Scrolling back reverses everything.
 *   4. Anchor clicks and deck dots go through the same page-accurate
 *      scrolling, so nav jumps also land on whole pages.
 *
 * Defensive throughout: missing elements / missing APIs must never
 * throw or block the rest. CSS defaults keep the first deck page and
 * all smooth content fully visible if this file fails to load.
 */

(function () {
  'use strict';

  var root = document.documentElement;

  function snapshot(selector) {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(selector));
    } catch (err) {
      return [];
    }
  }

  function clamp01(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  var reducedMotion = false;
  try {
    reducedMotion = typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    reducedMotion = false;
  }

  /* ------------------------------------------------------------------ */
  /* 1. Lenis smooth scrolling (optional)                                */
  /* ------------------------------------------------------------------ */
  var lenis = null;

  try {
    if (typeof window.Lenis === 'function') {
      lenis = new window.Lenis({
        // Gentle, FlowOS-like feel; keep defaults otherwise.
        lerp: 0.1,
        smoothWheel: true
      });
    }
  } catch (err) {
    // Lenis exists but failed to initialise: fall back to native scroll.
    lenis = null;
  }

  /* ------------------------------------------------------------------ */
  /* 2. The full-page deck                                               */
  /* ------------------------------------------------------------------ */
  var deckEl = null;
  var deckStage = null;
  var deckPages = [];
  var deckDots = [];
  try {
    deckEl = document.getElementById('deck');
    deckStage = deckEl ? deckEl.querySelector('.deck-stage') : null;
    deckPages = snapshot('.deck-page');
    deckDots = snapshot('.deck-dot');
    for (var d = 0; d < deckPages.length; d++) {
      deckPages[d].style.zIndex = String(d + 1);
    }
  } catch (err) {
    deckEl = null;
    deckPages = [];
  }

  function pageHeight() {
    if (deckStage && deckStage.clientHeight) return deckStage.clientHeight;
    return window.innerHeight || 1;
  }

  /* Scroll travel per page turn, as a fraction of the viewport height.
   * Deliberately below 1: a full page turn should not need a full
   * screen of finger travel. The deck element's CSS height must match:
   * 1 viewport of stage + (pages - 1) * TRAVEL_RATIO of travel. */
  var TRAVEL_RATIO = 0.6;

  function travel() {
    return pageHeight() * TRAVEL_RATIO;
  }

  function deckTop() {
    return deckEl ? (deckEl.offsetTop || 0) : 0;
  }

  /* Absolute scroll offset where deck page `idx` sits fully shown. */
  function pageOffset(idx) {
    return deckTop() + idx * travel();
  }

  /* Animated scroll to an absolute document offset. Used for page
   * snaps, dot clicks and deck anchors — always lands exactly on a
   * whole-page boundary. */
  var snapping = false;
  var snapTimer = null;

  function scrollToY(target, duration) {
    if (lenis) {
      try {
        lenis.scrollTo(target, {
          duration: duration,
          easing: function (t) { return 1 - Math.pow(1 - t, 3); }
        });
        return;
      } catch (err) {
        // fall through to native
      }
    }
    try {
      window.scrollTo({
        top: target,
        behavior: reducedMotion ? 'auto' : 'smooth'
      });
    } catch (err) {
      window.scrollTo(0, target);
    }
  }

  function snapToPage(target, duration) {
    snapping = true;
    scrollToY(target, duration);
    if (snapTimer) window.clearTimeout(snapTimer);
    snapTimer = window.setTimeout(function () { snapping = false; }, duration * 1000 + 120);
  }

  /* When scrolling settles inside the deck zone, complete the page
   * turn: snap to a whole-page boundary. The snap points are the deck
   * pages (one TRAVEL apart) plus the top of the smooth section, so
   * the exit (last deck page -> smooth section) also never rests
   * half-way. The choice is biased in the direction of travel:
   * letting go after ~35% of a segment completes the turn in that
   * direction, so the finger never has to drag the full segment. */
  var idleTimer = null;
  var lastY = null;
  var scrollDir = 0; // 1 = moving down (forward), -1 = up, 0 = unknown

  function trySnap() {
    if (!deckEl || !deckPages.length || snapping) return;
    var y = window.scrollY || window.pageYOffset || 0;
    var top = deckTop();
    var zoneEnd = top + (deckEl.offsetHeight || 0); // top of smooth section
    if (y < top - 2 || y > zoneEnd - 2) return;
    var points = [];
    for (var i = 0; i < deckPages.length; i++) points.push(pageOffset(i));
    points.push(zoneEnd);
    var target = points[points.length - 1];
    for (var s = 0; s < points.length - 1; s++) {
      var a = points[s];
      var b = points[s + 1];
      if (y <= b || s === points.length - 2) {
        var frac = b > a ? (y - a) / (b - a) : 0;
        if (scrollDir > 0) target = frac >= 0.35 ? b : a;
        else if (scrollDir < 0) target = frac <= 0.65 ? a : b;
        else target = frac >= 0.5 ? b : a;
        break;
      }
    }
    if (Math.abs(y - target) <= 2) return;
    snapToPage(target, reducedMotion ? 0.01 : 0.55);
  }

  try {
    window.addEventListener('scroll', function () {
      var y = window.scrollY || window.pageYOffset || 0;
      if (lastY !== null && y !== lastY) scrollDir = y > lastY ? 1 : -1;
      lastY = y;
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(trySnap, 150);
    }, { passive: true });
    window.addEventListener('touchend', function () {
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(trySnap, 150);
    }, { passive: true });
  } catch (err) {
    // Without snap the deck still crossfades; nothing else breaks.
  }

  /* Deck dots: jump straight to a whole page. */
  try {
    for (var b = 0; b < deckDots.length; b++) {
      (function (dot) {
        dot.addEventListener('click', function () {
          var idx = parseInt(dot.getAttribute('data-goto'), 10) || 0;
          snapToPage(pageOffset(idx), reducedMotion ? 0.01 : 0.7);
        });
      })(deckDots[b]);
    }
  } catch (err) {
    // Dots are decorative navigation; anchors still work.
  }

  /* Per-frame deck state: progress p is measured in page turns
   * (0 = first page full, 1 = second page full, ...), where one turn
   * is `travel()` of scrolling — less than a full screen, so the
   * crossfade completes within that short travel. Each page above
   * the first fades in across its turn when its background differs
   * from the previous page's; with the same background (or reduced
   * motion) it cuts in at the halfway point instead — no fade where
   * no fade is needed. --enter / --covered keep the covered page
   * dimming and shrinking slightly, as before. */
  function updateDeck() {
    if (!deckEl || !deckPages.length) return;
    var y = window.scrollY || window.pageYOffset || 0;
    var p = (y - deckTop()) / travel();
    var active = Math.max(0, Math.min(deckPages.length - 1, Math.round(p)));

    for (var i = 0; i < deckPages.length; i++) {
      var page = deckPages[i];
      var opacity;
      if (i === 0) {
        opacity = 1;
      } else {
        var fade = !reducedMotion &&
          page.getAttribute('data-bg') !== deckPages[i - 1].getAttribute('data-bg');
        opacity = fade ? clamp01(p - (i - 1)) : (p >= i - 0.5 ? 1 : 0);
      }
      page.style.opacity = String(Math.round(opacity * 1000) / 1000);
      page.style.visibility = opacity > 0.001 ? 'visible' : 'hidden';
      if (i === active) {
        page.classList.add('is-active');
      } else {
        page.classList.remove('is-active');
      }
      var enter = i === 0 ? 1 : clamp01(p - (i - 1));
      var covered = clamp01(p - i);
      page.style.setProperty('--enter', String(Math.round(enter * 1000) / 1000));
      page.style.setProperty('--covered', String(Math.round(covered * 1000) / 1000));
    }

    for (var k = 0; k < deckDots.length; k++) {
      if (k === active) {
        deckDots[k].classList.add('is-active');
      } else {
        deckDots[k].classList.remove('is-active');
      }
    }
  }

  /* Anchor navigation: deck anchors land on their page boundary;
   * other anchors glide through Lenis when it is running. */
  try {
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest
        ? event.target.closest('a[href^="#"]')
        : null;
      if (!link) return;
      var hash = link.getAttribute('href');
      if (!hash || hash.length < 2) return;
      var target = document.querySelector(hash);
      if (!target) return;

      var deckIndex = deckPages.indexOf(target);
      if (deckIndex >= 0) {
        event.preventDefault();
        snapToPage(pageOffset(deckIndex), reducedMotion ? 0.01 : 0.9);
        return;
      }
      if (hash === '#top') {
        event.preventDefault();
        snapToPage(0, reducedMotion ? 0.01 : 0.9);
        return;
      }
      if (!lenis) return;
      event.preventDefault();
      try {
        lenis.scrollTo(target, { offset: 0, duration: 1.4 });
      } catch (err) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  } catch (err) {
    // Native anchors still work without this handler.
  }

  /* ------------------------------------------------------------------ */
  /* 3. rAF loop: scroll position -> CSS variables                       */
  /* ------------------------------------------------------------------ */
  var progressSections = snapshot('[data-progress]');
  var revealElements = snapshot('.reveal');

  function updateScrollVars() {
    var scrollY = window.scrollY || window.pageYOffset || 0;
    root.style.setProperty('--scroll', String(Math.round(scrollY)));

    var viewportHeight = window.innerHeight || 1;

    for (var i = 0; i < progressSections.length; i++) {
      var section = progressSections[i];
      var id = section.getAttribute('id');
      if (!id) continue;
      var rect = section.getBoundingClientRect();
      var travel = viewportHeight + rect.height;
      var raw = travel > 0 ? (viewportHeight - rect.top) / travel : 0;
      root.style.setProperty('--p-' + id, String(clamp01(raw)));
    }

    updateDeck();

    // Continuous reveal progress for the scroll-following motion:
    // 0 when the element's top is at 94% of the viewport height,
    // 1 once it has travelled a further 42% of the viewport.
    // Written only when it actually changes, to keep style churn low.
    for (var m = 0; m < revealElements.length; m++) {
      var el = revealElements[m];
      var r = el.getBoundingClientRect();
      var rv = clamp01((viewportHeight * 0.94 - r.top) / (viewportHeight * 0.42));
      if (Math.abs(rv - (el._rv || 0)) > 0.002 || (rv === 1 && el._rv !== 1)) {
        el._rv = rv;
        el.style.setProperty('--rv', String(Math.round(rv * 1000) / 1000));
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 4. Word splitting for [data-words]                                  */
  /*    Plain-text elements only: Latin/digit runs stay whole words,     */
  /*    every CJK character is its own unit, spaces are preserved.       */
  /*    The spans carry --wi; the container gets --wstep / --wk so the   */
  /*    last word finishes exactly when --rv reaches 1 (see CSS).        */
  /*    --rv itself is written by updateScrollVars above. With reduced   */
  /*    motion the CSS media query pins every word to its final state.   */
  /* ------------------------------------------------------------------ */
  function splitWords(el) {
    var text = el.textContent || '';
    if (!text.trim()) return;
    var tokens = [];
    var word = '';
    function flush() { if (word) { tokens.push(word); word = ''; } }
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (/\s/.test(ch)) {
        flush();
        tokens.push(' ');
      } else if (/[A-Za-z0-9#+.\/_-]/.test(ch)) {
        word += ch;
      } else {
        flush();
        tokens.push(ch);
      }
    }
    flush();
    var units = 0;
    for (var t = 0; t < tokens.length; t++) {
      if (tokens[t] !== ' ') units++;
    }
    if (units < 2) return;
    el.setAttribute('aria-label', text);
    var wrap = document.createElement('span');
    wrap.setAttribute('aria-hidden', 'true');
    var wi = 0;
    for (var j = 0; j < tokens.length; j++) {
      if (tokens[j] === ' ') {
        wrap.appendChild(document.createTextNode(' '));
      } else {
        var span = document.createElement('span');
        span.className = 'w';
        span.style.setProperty('--wi', String(wi));
        span.textContent = tokens[j];
        wrap.appendChild(span);
        wi++;
      }
    }
    var step = 0.45 / (units - 1);
    el.style.setProperty('--wstep', String(step));
    el.style.setProperty('--wk', String(1 / (1 - 0.45)));
    el.textContent = '';
    el.appendChild(wrap);
  }

  try {
    var wordElements = snapshot('[data-words]');
    for (var w = 0; w < wordElements.length; w++) {
      splitWords(wordElements[w]);
    }
  } catch (err) {
    // Splitting is decorative: unsplit text still reads fine.
  }

  /* ------------------------------------------------------------------ */
  /* Main loop: one rAF driving both Lenis and the scroll variables.     */
  /* ------------------------------------------------------------------ */
  function frame(time) {
    if (lenis) {
      try {
        lenis.raf(time);
      } catch (err) {
        lenis = null;
      }
    }
    updateScrollVars();
    window.requestAnimationFrame(frame);
  }

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(frame);
  } else {
    updateScrollVars();
    window.addEventListener('scroll', updateScrollVars, { passive: true });
  }

  window.addEventListener('resize', updateScrollVars, { passive: true });
})();

/* ------------------------------------------------------------------ */
/* Per-device latest release. GitHub has no per-board /releases/latest,
   so a [data-board] click looks up the newest release whose tag starts
   with that board (M79A- / M81-) via the public releases API and jumps
   straight to it. No JS, or the lookup fails/times out: the link's own
   href (the releases list) still works, and modified clicks (new tab)
   are left alone.                                                  */
/* ------------------------------------------------------------------ */
(function () {
  var API = 'https://api.github.com/repos/jerome3389-a11y/cr880x-ipq5000-nss/releases?per_page=10';
  var LIST = 'https://github.com/jerome3389-a11y/cr880x-ipq5000-nss/releases';
  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, ms);
    })]);
  }
  document.addEventListener('click', function (e) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var el = e.target && e.target.closest ? e.target.closest('[data-board]') : null;
    if (!el || typeof fetch !== 'function') return;
    e.preventDefault();
    var board = el.getAttribute('data-board');
    withTimeout(fetch(API).then(function (res) { return res.json(); }), 5000)
      .then(function (rels) {
        var rel = null;
        for (var i = 0; i < rels.length; i++) {
          if (rels[i].tag_name && rels[i].tag_name.indexOf(board + '-') === 0) { rel = rels[i]; break; }
        }
        window.location.href = rel ? rel.html_url : LIST;
      })
      .catch(function () { window.location.href = LIST; });
  });
})();
