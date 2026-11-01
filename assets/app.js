/* ==========================================================================
   impyre — proposal page behaviour
   Language toggle (persisted) · scroll progress · sticky topbar · reveals
   ========================================================================== */

(function () {
  "use strict";

  var html = document.documentElement;
  var STORE_KEY = "impyre.proposal.lang";

  /* Reassigned once the observer exists; called after a language switch so the
     block that just became visible is not left faded out. */
  var sweepReveals = function () {};

  /* ---------------------------------------------------------------- language */

  var btnEn = document.getElementById("lang-en");
  var btnAr = document.getElementById("lang-ar");
  var main = document.getElementById("doc");

  function readStoredLang() {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch (e) {
      return null;
    }
  }

  function storeLang(lang) {
    try {
      localStorage.setItem(STORE_KEY, lang);
    } catch (e) {
      /* private mode or blocked storage — the page still works */
    }
  }

  function setLang(lang, animate) {
    var isAr = lang === "ar";

    html.setAttribute("lang", isAr ? "ar" : "en");
    html.setAttribute("dir", isAr ? "rtl" : "ltr");

    if (btnEn) btnEn.setAttribute("aria-pressed", String(!isAr));
    if (btnAr) btnAr.setAttribute("aria-pressed", String(isAr));

    document.title = isAr
      ? "منصة التغذية والعافية المجتمعية — impyre"
      : "Nutrition & Wellness Community Platform — impyre";

    if (animate && main) {
      main.classList.remove("lang-fade");
      /* force reflow so the animation restarts */
      void main.offsetWidth;
      main.classList.add("lang-fade");
    }

    storeLang(lang);
    sweepReveals();
    requestAnimationFrame(syncProgress);
  }

  if (btnEn) btnEn.addEventListener("click", function () { setLang("en", true); });
  if (btnAr) btnAr.addEventListener("click", function () { setLang("ar", true); });

  /* Restore a previous choice, otherwise follow the browser's preference.
     Arabic-first market: an ar-* browser gets Arabic on first visit. */
  var stored = readStoredLang();
  if (stored === "ar" || stored === "en") {
    setLang(stored, false);
  } else {
    var nav = (navigator.language || "en").toLowerCase();
    setLang(nav.indexOf("ar") === 0 ? "ar" : "en", false);
  }

  /* ----------------------------------------------------------------- print */

  var printBtn = document.getElementById("print-btn");
  if (printBtn) {
    printBtn.addEventListener("click", function () {
      window.print();
    });
  }

  /* -------------------------------------------------- progress + sticky bar */

  var topbar = document.getElementById("topbar");
  var fill = document.getElementById("progress-fill");
  var ticking = false;

  function syncProgress() {
    var doc = document.documentElement;
    var scrollable = doc.scrollHeight - window.innerHeight;
    var pct = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;

    try {
      if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + "%";
      if (topbar) topbar.classList.toggle("is-stuck", window.scrollY > 8);
    } finally {
      /* Always clear the latch. If this threw while ticking stayed true, every
         later scroll would be ignored and the page would freeze mid-document. */
      ticking = false;
    }
  }

  window.addEventListener(
    "scroll",
    function () {
      /* Revealing runs on the scroll event itself, not inside the rAF tick:
         a background or hidden tab pauses rAF entirely, and content that only
         becomes visible via rAF would stay blank. The progress bar is purely
         decorative, so that one can wait for a frame. */
      sweepReveals();

      if (!ticking) {
        ticking = true;
        requestAnimationFrame(syncProgress);
      }
    },
    { passive: true }
  );

  window.addEventListener("resize", syncProgress, { passive: true });
  syncProgress();

  /* ---------------------------------------------------------------- reveals */

  /* A scroll-driven sweep rather than an IntersectionObserver, deliberately.
     This is a client-facing document: content must never be left invisible.
     An observer misses elements that a jump-scroll (anchor link, Page Down,
     restored scroll position) carries past before it can fire, and it has to
     be re-primed when the hidden language block becomes visible. A sweep that
     reveals anything at or above the fold cannot leave anything behind, and
     72 getBoundingClientRect calls inside an rAF tick are free at this size. */
  sweepReveals = function () {
    var pending = document.querySelectorAll(".reveal:not(.is-in)");
    if (!pending.length) return;

    var fold = window.innerHeight * 0.94;

    for (var i = 0; i < pending.length; i++) {
      var el = pending[i];
      var r = el.getBoundingClientRect();

      /* Zero-sized means it sits in the inactive language block — skip it, and
         it gets picked up by the sweep that runs after a language switch. */
      if (r.height === 0 && r.width === 0) continue;

      /* r.top < fold covers both "scrolled into view" and "already passed". */
      if (r.top < fold) el.classList.add("is-in");
    }
  };

  window.addEventListener("load", sweepReveals);
  sweepReveals();

  /* Last resort. If after three seconds nothing has revealed at all, something
     has gone wrong that none of the above anticipated — drop the whole reveal
     mechanism rather than leave a client looking at an empty proposal. */
  setTimeout(function () {
    if (!document.querySelector(".reveal.is-in")) {
      html.classList.remove("js-reveal");
    }
  }, 3000);
})();
