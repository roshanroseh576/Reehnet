// index.js - Home page: splash -> permissions -> login/sign up/PIN -> home
import {
  db, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, onSnapshot, serverTimestamp, orderBy, limit,
  streamPages, appendOneByOne, thumb, esc, toDate, money, sleep, normPhone, isValidPhone, providerOf,
  getSession, setSession, clearSession, loadBranding, logoHTML,
  toast, confirmBox, hashPass
} from "./firebase-init.js";
// push.js is optional: if it is missing or blocked, the app still starts (only background notifications / sound are skipped)
const push = import("./push.js").catch((e) => { console.warn("push.js not loaded:", e.message); return null; });

const $ = (id) => document.getElementById(id);
const SCREENS = ["splash", "perms", "auth", "home"];
const show = (name) => SCREENS.forEach((s) => ($("screen-" + s).hidden = s !== name));

let brand = {};
let pendingPhone = null; // phone waiting for its PIN
let unsubs = [];
let activityShown = false;
let fyTimer = null;

/* ============ BOOT ============ */

async function boot() {
  const started = Date.now();
  brand = await loadBranding();
  document.title = brand.appName;
  $("splash-logo").innerHTML = logoHTML(brand);
  $("splash-name").textContent = brand.appName;
  await sleep(Math.max(0, 1200 - (Date.now() - started)));

  // First open: ask permissions once (notification, camera). All are optional and can be given later.
  if (!localStorage.getItem("reeh_perms_done")) {
    show("perms");
    await new Promise((resolve) => {
      $("perm-continue").onclick = async () => {
        $("perm-continue").disabled = true;
        await askOptionalPermissions();
        localStorage.setItem("reeh_perms_done", "1");
        resolve();
      };
    });
  }

  const phone = getSession();

  if (phone) {
    const snap = await getDoc(doc(db, "users", phone));
    if (snap.exists() && snap.data().status === "active") return startHome(phone);
    clearSession();
  }
  startAuth();
}

async function askOptionalPermissions() {
  try { if ("Notification" in window) await Notification.requestPermission(); } catch (e) { /* user can allow later */ }
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
    }
  } catch (e) { /* user can allow later */ }
}

/* ============ AUTH ============ */
// Login = phone number -> passcode.  Sign up = name + phone + own 4-digit passcode -> admin PIN verification.
const MAX_TRIES = 5, LOCK_MS = 5 * 60 * 1000;
const lockKey = (p) => "reeh_fail_" + p;
function lockLeft(phone) {
  try { const s = JSON.parse(localStorage.getItem(lockKey(phone)) || "{}"); return Math.max(0, (s.until || 0) - Date.now()); }
  catch { return 0; }
}
function registerFail(phone) {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(lockKey(phone)) || "{}"); } catch { /* ignore */ }
  s.n = (s.n || 0) + 1;
  if (s.n >= MAX_TRIES) { s.until = Date.now() + LOCK_MS; s.n = 0; }
  localStorage.setItem(lockKey(phone), JSON.stringify(s));
}
const clearFails = (phone) => localStorage.removeItem(lockKey(phone));

function setBusy(btn, on) {
  if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true; }
  else { btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.disabled = false; }
}
const isCode = (v) => /^\d{4}$/.test(v);

function startAuth() {
  show("auth");
  $("auth-brand").innerHTML = `${logoHTML(brand)}<b>${esc(brand.appName)}</b>`;
  // links come from Firebase (settings/app): forgotPinLink, privacyLink, termsLink
  const forgot = brand.forgotPinLink || brand.forgotPasscodeLink;
  ["forgot", "forgot-login"].forEach((id) => { if (forgot) { $(id).href = forgot; $(id).hidden = false; } });
  [["link-privacy", brand.privacyLink], ["link-terms", brand.termsLink]].forEach(([id, url]) => { if (url) $(id).href = url; else $(id).removeAttribute("href"); });
  const updateAgree = () => { $("signup-btn").disabled = !($("agree-privacy").checked && $("agree-terms").checked); };
  $("agree-privacy").onchange = updateAgree;
  $("agree-terms").onchange = updateAgree;

  const FORMS = ["login", "signup", "pass", "newpass", "pin"];
  let pendingPhone = null;
  const showForm = (name) => {
    FORMS.forEach((f) => ($("form-" + f).hidden = f !== name));
    $("auth-tabs").hidden = !(name === "login" || name === "signup");
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    const first = $("form-" + name).querySelector("input");
    if (first) first.focus();
  };
  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => showForm(b.dataset.tab)));
  document.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => showForm("login")));

  const loginSuccess = (phone) => { setSession(phone); clearFails(phone); startHome(phone); };

  // ---- Login step 1: phone number ----
  $("form-login").onsubmit = async (e) => {
    e.preventDefault();
    const phone = normPhone($("login-phone").value);
    if (!isValidPhone(phone)) return toast("Enter a valid mobile number");
    const btn = e.submitter; setBusy(btn, true);
    try {
      const snap = await getDoc(doc(db, "users", phone));
      if (!snap.exists()) {
        await confirmBox({ title: "No account found", message: "This number is not registered. Check the number or sign up.", okText: "OK" });
        return;
      }
      const u = snap.data();
      pendingPhone = phone;
      if (u.status === "blocked") return confirmBox({ title: "Account blocked", message: "Please contact support.", okText: "OK" });
      if (u.status !== "active") {
        $("pin-note").textContent = "Your account is waiting for its PIN. Enter the PIN you received.";
        $("pin-code").value = "";
        return showForm("pin");
      }
      if (!u.passcodeHash) {          // older account, or admin reset the passcode
        ["newpass-1", "newpass-2"].forEach((i) => ($(i).value = ""));
        return showForm("newpass");
      }
      $("pass-phone").textContent = phone;
      $("pass-code").value = "";
      showForm("pass");
    } catch (err) {
      console.error(err);
      toast("Could not connect. Try again.");
    } finally { setBusy(btn, false); }
  };

  // ---- Login step 2: passcode ----
  $("form-pass").onsubmit = async (e) => {
    e.preventDefault();
    const code = $("pass-code").value.trim();
    if (!isCode(code)) return toast("Enter your 4-digit passcode");
    const left = lockLeft(pendingPhone);
    if (left > 0) {
      return confirmBox({ title: "Too many attempts", message: `Please try again in ${Math.ceil(left / 60000)} minute(s), or use Forgot passcode.`, okText: "OK" });
    }
    const btn = e.submitter; setBusy(btn, true);
    try {
      const u = (await getDoc(doc(db, "users", pendingPhone))).data() || {};
      if (u.status !== "active") return showForm("login");
      if ((await hashPass(pendingPhone, code)) === u.passcodeHash) return loginSuccess(pendingPhone);
      registerFail(pendingPhone);
      $("pass-code").value = "";
      await confirmBox({ title: "Wrong passcode", message: "The passcode is not correct. Try again.", okText: "OK" });
    } catch (err) {
      console.error(err);
      toast("Could not login. Try again.");
    } finally { setBusy(btn, false); }
  };

  // ---- Create passcode for an existing account (no passcode saved yet) ----
  $("form-newpass").onsubmit = async (e) => {
    e.preventDefault();
    const p1 = $("newpass-1").value.trim(), p2 = $("newpass-2").value.trim();
    if (!isCode(p1)) return toast("Passcode must be 4 digits");
    if (p1 !== p2) return toast("Passcodes do not match");
    const btn = e.submitter; setBusy(btn, true);
    try {
      await updateDoc(doc(db, "users", pendingPhone), { passcodeHash: await hashPass(pendingPhone, p1), passcodeSetAt: serverTimestamp() });
      loginSuccess(pendingPhone);
    } catch (err) {
      console.error(err);
      toast("Could not save. Try again.");
    } finally { setBusy(btn, false); }
  };

  // ---- Sign up ----
  $("form-signup").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("signup-name").value.trim();
    const phone = normPhone($("signup-phone").value);
    const p1 = $("signup-pass").value.trim(), p2 = $("signup-pass2").value.trim();
    if (name.length < 2) return toast("Enter your name");
    if (!isValidPhone(phone)) return toast("Enter a valid mobile number");
    if (!isCode(p1)) return toast("Passcode must be 4 digits");
    if (p1 !== p2) return toast("Passcodes do not match");
    if (!($("agree-privacy").checked && $("agree-terms").checked)) return toast("Please tick Policy and privacy and Terms and conditions");
    const btn = e.submitter; setBusy(btn, true);
    try {
      const ref = doc(db, "users", phone);
      if ((await getDoc(ref)).exists()) {
        const goLogin = await confirmBox({
          title: "Already registered", message: "This number is already registered.",
          okText: "Login now", cancelText: "Cancel"
        });
        if (goLogin) { showForm("login"); $("login-phone").value = phone; }
        return;
      }
      await setDoc(ref, {
        name, phone, provider: providerOf(phone) || "unknown",
        status: "pending", pin: "", passcodeHash: await hashPass(phone, p1),
        createdAt: serverTimestamp(), termsAcceptedAt: serverTimestamp()
      });
      const ok = await confirmBox({
        title: "Verify your number",
        message: "A PIN will be sent to the number you registered. Enter it to continue.",
        okText: "OK", cancelText: "Cancel"
      });
      if (ok) { pendingPhone = phone; $("pin-note").textContent = "Enter the 4-digit PIN you received."; $("pin-code").value = ""; showForm("pin"); }
      else showForm("login");
    } catch (err) {
      console.error(err);
      toast("Could not sign up. Try again.");
    } finally { setBusy(btn, false); updateAgree(); }
  };

  // ---- PIN verify (PIN is set by admin in Firebase: users/{phone}.pin) ----
  $("form-pin").onsubmit = async (e) => {
    e.preventDefault();
    const code = $("pin-code").value.trim();
    if (!isCode(code)) return toast("Enter the 4-digit PIN");
    const btn = e.submitter; setBusy(btn, true);
    try {
      const ref = doc(db, "users", pendingPhone);
      const u = (await getDoc(ref)).data() || {};
      if (!u.pin) return confirmBox({ title: "PIN not issued yet", message: "Your PIN has not been issued yet. Please wait or contact support.", okText: "OK" });
      if (String(u.pin) !== code) return confirmBox({ title: "Wrong PIN", message: "The PIN does not match. Check it and try again.", okText: "OK" });
      await updateDoc(ref, { status: "active", activatedAt: serverTimestamp() });
      if (!u.passcodeHash) { ["newpass-1", "newpass-2"].forEach((i) => ($(i).value = "")); return showForm("newpass"); }
      loginSuccess(pendingPhone);
    } catch (err) {
      console.error(err);
      toast("Could not verify. Try again.");
    } finally { setBusy(btn, false); }
  };

  showForm("login");
}

/* ============ HOME ============ */
const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  package: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
  offers: '<svg viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V3h8l9 9z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>',
  profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>'
};
const DEFAULT_NAV = { home: "index.html", package: "package.html", offers: "offers.html", profile: "profile.html" };

async function startHome(phone) {
  show("home");
  unsubs.forEach((u) => u());
  unsubs = [];

  // header (logo, app name, notification link)
  $("home-logo").innerHTML = logoHTML(brand);
  $("home-name").textContent = brand.appName;
  $("bell").href = brand.notificationLink || "notifications.html";

  // unread count on the bell; a sound + message when a new notification arrives while the app is open
  let firstN = true;
  unsubs.push(onSnapshot(query(collection(db, "users", phone, "notifications"), where("read", "==", false), limit(100)), (s) => {
    const b = $("bell-badge");
    b.hidden = !s.size; b.textContent = s.size > 99 ? "99+" : s.size;
    if (!firstN) s.docChanges().forEach((c) => {
      if (c.type !== "added") return;
      toast(c.doc.data().title || "New notification");
      push.then((m) => m && m.playNotifySound(c.doc.data().soundUrl || brand.notificationSoundUrl));
    });
    firstN = false;
  }, (e) => console.error("notifications", e)));
  push.then((m) => m && m.registerPush(phone, brand));   // background (notification bar) notifications
  $("p-phone").textContent = phone;

  // links for the bottom nav come from Firebase: settings/nav
  let nav = DEFAULT_NAV;
  try {
    const n = await getDoc(doc(db, "settings", "nav"));
    if (n.exists()) nav = { ...DEFAULT_NAV, ...n.data() };
  } catch (e) { console.error(e); }
  $("bottom-nav").innerHTML = ["home", "package", "offers", "profile"].map((k) =>
    `<a href="${esc(nav[k])}" class="${k === "home" ? "on" : ""}">${ICONS[k]}<span>${k[0].toUpperCase() + k.slice(1)}</span></a>`
  ).join("");
  const packageLink = nav.package;

  // profile (live)
  unsubs.push(onSnapshot(doc(db, "users", phone), (s) => {
    const u = s.data();
    if (!u || u.status === "blocked") { clearSession(); location.reload(); return; }
    $("p-name").textContent = u.name || "-";
    $("avatar").innerHTML = (u.photoUrl || u.photoBase64)
      ? `<img src="${esc((u.photoUrl || u.photoBase64))}" alt="">`
      : esc((u.name || "R").charAt(0).toUpperCase());
  }));

  // orders (live) - only what Home needs, three small queries instead of the whole history
  $("pkg-card").innerHTML = '<div class="skel" style="height:230px;border-radius:26px"></div>';
  $("activity").innerHTML = '<div class="skel"></div>';
  activityShown = false;
  const live = { active: [], unpaid: [], payment_pending: [] }, got = {};
  const byNew = (x, y) => (toDate(y.createdAt)?.getTime() || 0) - (toDate(x.createdAt)?.getTime() || 0);
  const refresh = () => {
    if (got.active) renderPackage([...live.active].sort(byNew)[0], packageLink);
    if (got.unpaid && got.payment_pending) renderActivity([...live.unpaid, ...live.payment_pending].sort(byNew));
  };
  for (const st of ["active", "unpaid", "payment_pending"]) {
    unsubs.push(onSnapshot(query(collection(db, "orders"), where("phone", "==", phone), where("status", "==", st), limit(5)), (snap) => {
      live[st] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      got[st] = true; refresh();
    }, (e) => { console.error(e); got[st] = true; refresh(); }));
  }

  loadBanners();
  loadQuickLinks();
}

const SVG = {
  bolt: '<svg class="i" viewBox="0 0 24 24" style="stroke:#5C6FFF"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
  server: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/></svg>',
  globe: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/></svg>',
  cal: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  clock: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ok: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bad: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  out: '<svg class="i" viewBox="0 0 24 24"><path d="M7 17L17 7M8 7h9v9"/></svg>'
};
const gb = (n) => `${Number(Number(n || 0).toFixed(1))} GB`;

function renderPackage(o, packageLink) {
  const box = $("pkg-card");
  if (!o) {
    box.innerHTML = `<div class="pkg-empty"><b>No active package</b>
      <span class="muted">Choose a V2RAY package to get connected.</span>
      <a class="btn btn-primary" href="${esc(packageLink)}">View packages</a></div>`;
    return;
  }
  const total = Number(o.dataTotalGB || 0);          // 0 = unlimited
  const used = Number(o.dataUsedGB || 0);
  const left = Math.max(0, total - used);
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const exp = toDate(o.expiryDate);
  const days = exp ? Math.ceil((exp - Date.now()) / 86400000) : null;
  const expired = days !== null && days <= 0;
  const C = 2 * Math.PI * 42;                         // donut circumference (r = 42)
  const link = o.configLink || "";
  const isWeb = /^https?:\/\//i.test(link);

  box.innerHTML = `
    <div class="pkg">
      <div class="pkg-top">
        <div class="pkg-title"><b>${esc(o.packageName)}</b><span class="pkg-badge">${esc(o.packageType || "GB PACKAGE")}</span></div>
        <span class="pkg-bolt">${SVG.bolt}</span>
      </div>
      <div class="pkg-meta">
        ${o.serverName ? `<span>${SVG.server}${esc(o.serverName)}</span>` : ""}
        <span>${SVG.globe}${esc(o.protocol || "V2RAY")}</span>
      </div>

      <div class="pkg-mid">
        <div class="donut">
          <svg viewBox="0 0 100 100">
            <defs><linearGradient id="donutGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5C6FFF"/><stop offset="1" stop-color="#9B6BFF"/></linearGradient></defs>
            <circle class="bg" cx="50" cy="50" r="42"/>
            <circle class="fg" cx="50" cy="50" r="42" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/>
          </svg>
          <div class="donut-text"><b>${total ? pct + "%" : "∞"}</b><small>USED</small></div>
        </div>
        <div class="pkg-right">
          <div class="tiles">
            <div class="tile"><small>TOTAL</small><b>${total ? gb(total) : "Unlimited"}</b></div>
            <div class="tile used"><small>USED</small><b>${gb(used)}</b></div>
            <div class="tile left"><small>LEFT</small><b>${total ? gb(left) : "-"}</b></div>
          </div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>
      </div>

      <div class="pkg-info">
        <div class="info"><span class="ico cal">${SVG.cal}</span><div><small>VALID</small><b>${esc(o.validityDays || "-")} Days</b></div></div>
        <div class="info"><span class="ico ${expired ? "bad" : "clock"}">${SVG.clock}</span><div><small>DAYS LEFT</small><b class="${expired ? "bad" : ""}">${days === null ? "-" : expired ? "Expired" : days + " Days"}</b></div></div>
        <div class="info"><span class="ico ${expired ? "bad" : "ok"}">${expired ? SVG.bad : SVG.ok}</span><div><small>EXPIRY</small><b>${exp ? exp.toLocaleDateString("en-CA") : "-"}</b></div></div>
      </div>

      <div class="pkg-actions">
        ${link ? (isWeb
          ? `<a class="btn btn-dark" href="${esc(link)}" target="_blank" rel="noopener">View V2RAY Config ${SVG.out}</a>`
          : `<button class="btn btn-dark" id="copy-config">View V2RAY Config ${SVG.out}</button>`)
          : `<span></span>`}
        <a class="btn btn-light" href="${esc(packageLink)}">Renew</a>
      </div>
    </div>`;

  // vless:// vmess:// trojan:// links cannot open as a page, so they are copied to the clipboard
  const cp = $("copy-config");
  if (cp) cp.onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast("Config copied"); }
    catch { toast("Could not copy the config"); }
  };
}

function renderActivity(list) {
  const box = $("activity");
  if (!list.length) { box.innerHTML = `<div class="card muted">No recent activity.</div>`; return; }
  box.innerHTML = list.map((o) => {
    const unpaid = o.status === "unpaid";
    return `<div class="card act">
      <div class="act-head"><b>${esc(o.packageName)}</b>
        <span class="chip ${unpaid ? "chip-orange" : "chip-blue"}">${unpaid ? "Payment needed" : "Payment confirmation pending"}</span></div>
      <div class="act-row"><span>${esc(o.dataLabel || "")}</span><b>${money(o.price)}</b></div>
      ${unpaid ? `<div class="act-actions">
          <a class="btn btn-primary" href="payment-process.html?order=${encodeURIComponent(o.id)}">Payment now</a>
          <button class="btn btn-danger" data-cancel="${esc(o.id)}">Cancel order</button></div>` : ""}
    </div>`;
  }).join("");
  if (!activityShown) {                // first draw: cards appear one by one
    box.querySelectorAll(".act").forEach((el, i) => { el.classList.add("reveal"); el.style.animationDelay = i * 130 + "ms"; });
    activityShown = true;
  }
  box.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => {
    const ok = await confirmBox({ title: "Cancel order?", message: "This order will be cancelled.", okText: "OK", cancelText: "Cancel" });
    if (ok) await updateDoc(doc(db, "orders", b.dataset.cancel), { status: "cancelled", cancelledAt: serverTimestamp() });
  }));
}

const BANNER_COLORS = [["#FF8A3D", "#FF5A5F"], ["#22B8CF", "#5C6FFF"], ["#8B5CF6", "#5C6FFF"], ["#0FC16E", "#22B8CF"]];
const hex = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "");

function slideHTML(b, i) {
  const [a, c] = BANNER_COLORS[i % BANNER_COLORS.length];
  return `<article class="slide ${b.imageUrl ? "has-img" : ""}" style="--a:${hex(b.colorFrom) || a};--b:${hex(b.colorTo) || c}">
    ${b.imageUrl ? `<img class="slide-bg" src="${esc(thumb(b.imageUrl, 900))}" alt="">` : ""}<span class="slide-shade"></span>
    <div class="slide-body">
      ${b.badge ? `<span class="slide-badge">${esc(b.badge)}</span>` : ""}
      <h4>${esc(b.title)}</h4>
      ${b.subtitle ? `<p>${esc(b.subtitle)}</p>` : ""}
      ${b.buttonText ? `<a class="slide-btn" href="${esc(b.link || "#")}">${esc(b.buttonText)}<svg viewBox="0 0 24 24"><path d="M7 17L17 7M8 7h9v9"/></svg></a>` : ""}
    </div></article>`;
}

// banners arrive 3 at a time, slide in one by one, and the carousel scrolls by itself
async function loadBanners() {
  const track = $("carousel"), dots = $("dots");
  $("foryou").hidden = false;
  $("fy-title").textContent = brand.bannerTitle || "For You";
  track.innerHTML = '<div class="slide sk"></div>';
  let idx = 0, n = 0, pauseUntil = 0, first = true;
  const slides = () => [...track.querySelectorAll(".slide:not(.sk)")];
  const drawDots = () => { dots.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<i class="${i === idx ? "on" : ""}"></i>`).join("") : ""; };
  const goTo = (i) => {
    const s = slides();
    if (s.length < 2) return;
    idx = (i + s.length) % s.length;
    track.scrollTo({ left: s[idx].offsetLeft - s[0].offsetLeft, behavior: "smooth" });
    drawDots();
  };
  track.onscroll = () => {
    const s = slides();
    if (s.length < 2) return;
    const i = Math.min(s.length - 1, Math.max(0, Math.round(track.scrollLeft / (s[1].offsetLeft - s[0].offsetLeft))));
    if (i !== idx) { idx = i; drawDots(); }
  };
  ["touchstart", "pointerdown", "wheel"].forEach((ev) => track.addEventListener(ev, () => { pauseUntil = Date.now() + 6000; }, { passive: true }));
  clearInterval(fyTimer);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    fyTimer = setInterval(() => { if (!document.hidden && Date.now() > pauseUntil) goTo(idx + 1); }, 4000);
  }
  try {
    await streamPages(query(collection(db, "banners"), orderBy("sortOrder")), 3, async (page) => {
      if (first) { track.innerHTML = ""; first = false; }
      for (const b of page.filter((x) => x.active !== false)) {
        track.insertAdjacentHTML("beforeend", slideHTML(b, n));
        track.lastElementChild.classList.add("reveal");
        n++; drawDots();
        await sleep(160);
      }
    });
  } catch (e) { console.error(e); }
  if (!n) $("foryou").hidden = true;
}

async function loadQuickLinks() {
  const box = $("quick");
  box.innerHTML = Array.from({ length: 4 }, () => '<div class="skel q-sk"></div>').join("");
  let first = true;
  try {
    await streamPages(query(collection(db, "quickLinks")), 12, async (page) => {
      if (first) { box.innerHTML = ""; first = false; }
      await appendOneByOne(box, page.filter((q) => q.active !== false).sort((x, y) => (x.sortOrder ?? 999) - (y.sortOrder ?? 999)), (q) => {
        const ico = /^(https?:|data:)/.test(q.icon || "") ? `<img src="${esc(q.icon)}" alt="">` : esc(q.icon || "🔗");
        return `<a href="${esc(q.link || "#")}"><span class="q-ico">${ico}</span>${esc(q.title)}</a>`;
      });
    });
  } catch (e) { console.error(e); }
  if (first) box.innerHTML = "";
}

// start the page only after every function and constant above is defined
boot();
