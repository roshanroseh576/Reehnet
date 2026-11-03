/* net-guard.js - shows a friendly "Refresh" box when there is no internet, the connection is very slow,
   or the app is stuck loading. Plain script (no Firebase), so it still works when everything else fails. */
(function () {
  if (window.__reehGuard) return;
  window.__reehGuard = true;

  var SLOW_MS = 12000;       // still showing loading placeholders after this long -> "taking too long"
  var PING_EVERY = 12000;    // how often the real internet connection is checked
  var PING_TIMEOUT = 6000;

  var TEXT = {
    offline: { title: "No internet connection", body: "We cannot reach the internet right now. Check your mobile data or Wi-Fi, turn off any VPN, then tap Refresh to restart the app." },
    slow: { title: "Taking longer than usual", body: "The connection is slow or the server is not answering. Please wait a moment or tap Refresh to try again." },
    back: { title: "You are back online", body: "The connection is working again. Tap Refresh to continue." }
  };
  var ICON = {
    offline: '<svg viewBox="0 0 24 24"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16.2a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/><path d="M3 3l18 18"/></svg>',
    slow: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };

  var css = [
    '.rg-back{position:fixed;inset:0;z-index:2147483000;background:rgba(18,27,46,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:"Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.rg-card{background:#fff;border-radius:28px;width:100%;max-width:340px;padding:26px 22px 22px;text-align:center;box-shadow:0 24px 60px -20px rgba(18,27,46,.55);animation:rgPop .25s ease}',
    '@keyframes rgPop{from{transform:scale(.94);opacity:0}to{transform:none;opacity:1}}',
    '.rg-ico{width:68px;height:68px;border-radius:50%;margin:0 auto 14px;display:grid;place-items:center}',
    '.rg-ico svg{width:32px;height:32px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}',
    '.rg-offline{background:#FDECEC;color:#E5484D}.rg-slow{background:#FFF3E6;color:#FF8A3D}.rg-back-ico{background:#E6F8EF;color:#0FC16E}',
    '.rg-title{font-size:20px;color:#121B2E;margin:0 0 12px;letter-spacing:-.3px}',
    '.rg-text{background:#F5F7FB;border:1px solid #E6EAF2;border-radius:16px;padding:13px 14px;margin-bottom:18px;text-align:left}',
    '.rg-text p{margin:0;font-size:14.5px;line-height:1.5;color:#5B6B8A}',
    '.rg-detail{display:block;margin-top:8px;font-size:11.5px;color:#8B95AF;word-break:break-word}',
    '.rg-btn{width:100%;border:0;border-radius:15px;padding:15px;background:#5C6FFF;color:#fff;font:600 16px inherit;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:10px;cursor:pointer}',
    '.rg-btn svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}',
    '.rg-btn.go svg{animation:rgSpin .7s linear infinite}@keyframes rgSpin{to{transform:rotate(360deg)}}'
  ].join("");
  var st = document.createElement("style");
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var box = null, mode = "";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function draw(kind, detail) {
    var t = TEXT[kind];
    box.innerHTML =
      '<div class="rg-card">' +
        '<div class="rg-ico ' + (kind === "back" ? "rg-back-ico" : "rg-" + kind) + '">' + ICON[kind] + '</div>' +
        '<h3 class="rg-title">' + t.title + '</h3>' +
        '<div class="rg-text"><p>' + t.body + '</p>' + (detail ? '<small class="rg-detail">' + esc(detail) + '</small>' : '') + '</div>' +
        '<button class="rg-btn" type="button"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg><span>Refresh</span></button>' +
      '</div>';
    var b = box.querySelector(".rg-btn");
    b.onclick = function () { b.className = "rg-btn go"; setTimeout(function () { location.reload(); }, 250); };
  }

  function show(kind, detail) {
    if (mode === "offline" && kind === "slow") return;   // already telling about the bigger problem
    mode = kind;
    if (!box) {
      box = document.createElement("div");
      box.className = "rg-back";
      box.setAttribute("role", "alertdialog");
      box.setAttribute("aria-modal", "true");
      (document.body || document.documentElement).appendChild(box);
    }
    draw(kind, detail);
  }

  /* ---- real internet check (works even when the phone says "connected" but has no data) ---- */
  function ping() {
    return new Promise(function (resolve) {
      var done = false, ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (!done) { done = true; if (ctl) ctl.abort(); resolve(false); } }, PING_TIMEOUT);
      try {
        fetch("https://www.gstatic.com/generate_204?t=" + Date.now(), { mode: "no-cors", cache: "no-store", signal: ctl ? ctl.signal : undefined })
          .then(function () { if (!done) { done = true; clearTimeout(timer); resolve(true); } })
          .catch(function () { if (!done) { done = true; clearTimeout(timer); resolve(false); } });
      } catch (e) { clearTimeout(timer); resolve(false); }
    });
  }

  var fails = 0;
  function check() {
    if (document.visibilityState === "hidden") return;
    ping().then(function (ok) {
      if (ok) {
        fails = 0;
        if (box && mode === "offline") show("back");     // internet returned: the button restarts the app
      } else if (++fails >= 2 || navigator.onLine === false) {
        show("offline");
      }
    });
  }

  window.addEventListener("offline", function () { show("offline"); });
  window.addEventListener("online", function () { fails = 0; check(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") check(); });
  setInterval(check, PING_EVERY);
  if (navigator.onLine === false) show("offline");

  // a failed request only matters if the internet is really gone
  function onProblem(msg) {
    if (/failed to fetch|networkerror|load failed|network request failed|unavailable/i.test(String(msg || ""))) {
      ping().then(function (ok) { if (!ok) show("offline", String(msg)); });
    }
  }
  window.addEventListener("unhandledrejection", function (e) { onProblem(e.reason && (e.reason.code || e.reason.message) || e.reason); });
  window.addEventListener("error", function (e) { onProblem(e.message); });

  /* ---- stuck on loading placeholders / splash for too long ---- */
  var stuck = 0;
  function visible(el) { return el.offsetParent !== null || (window.getComputedStyle && getComputedStyle(el).position === "fixed"); }
  setInterval(function () {
    if (box || document.visibilityState === "hidden") return;
    var loading = false, els = document.querySelectorAll(".skel, .sk, .spinner, #screen-splash");
    for (var i = 0; i < els.length; i++) {
      if (els[i].id === "screen-splash" && els[i].hidden) continue;
      if (visible(els[i])) { loading = true; break; }
    }
    stuck = loading ? stuck + 1000 : 0;
    if (stuck >= SLOW_MS) { stuck = 0; show("slow"); }
  }, 1000);
})();
