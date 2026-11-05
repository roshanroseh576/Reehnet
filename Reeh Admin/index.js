// Reeh Cloud Admin - Home: splash -> permissions -> login -> home (menu + bottom nav from Firebase)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, query, where, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDjgYmpI5ULWsMeLMcFfgJQv0yycKzlxeY",
  authDomain: "reeh-cloud.firebaseapp.com",
  projectId: "reeh-cloud",
  storageBucket: "reeh-cloud.firebasestorage.app",
  messagingSenderId: "612108884872",
  appId: "1:612108884872:web:e366868cab113c4b1ab83d",
  measurementId: "G-XW3Q1B65V0"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sortBy = (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0);

function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

// success / info box with a single OK button
function okBox(title, message) {
  return new Promise((resolve) => {
    const w = document.createElement("div");
    w.className = "modal-backdrop";
    w.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <div class="ok-ico"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3>${esc(title)}</h3><p>${esc(message)}</p>
      <button class="btn btn-primary btn-block">OK</button></div>`;
    w.querySelector("button").onclick = () => { w.remove(); resolve(); };
    document.body.appendChild(w);
    w.querySelector("button").focus();
  });
}

/* ---------- branding: logo + app name from Firebase (settings/app) ---------- */
let brand = { appName: "Reeh Cloud Admin", logoUrl: "" };
async function loadBrand() {
  try {
    const s = await getDoc(doc(db, "settings", "app"));
    if (s.exists()) brand = { ...brand, ...s.data() };
  } catch (e) { console.error(e); }
}
const logoHTML = () => brand.logoUrl
  ? `<img class="logo" src="${esc(brand.logoUrl)}" alt="">`
  : `<span class="logo logo-fallback">${esc((brand.appName || "R").charAt(0))}</span>`;

/* ---------- permissions (first open only) ---------- */
async function askPermissions() {
  try { if ("Notification" in window) await Notification.requestPermission(); } catch (e) { /* can be allowed later */ }
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
    }
  } catch (e) { /* can be allowed later */ }
  // Gallery / files: browsers have no separate permission; the picker opens when you choose an image.
}

/* ---------- boot: splash (logo + name) -> permissions ---------- */
async function boot() {
  const t0 = Date.now();
  await loadBrand();
  document.title = brand.appName;
  $("splash-logo").innerHTML = logoHTML();
  $("splash-name").textContent = brand.appName;
  await sleep(Math.max(0, 1300 - (Date.now() - t0)));

  if (!localStorage.getItem("reeh_admin_perms")) {
    $("splash").hidden = true;
    $("perms").hidden = false;
    await new Promise((resolve) => {
      $("perm-go").onclick = async () => {
        $("perm-go").disabled = true;
        await askPermissions();
        localStorage.setItem("reeh_admin_perms", "1");
        resolve();
      };
    });
    $("perms").hidden = true;
  }
  $("splash").hidden = true;
}
const bootDone = boot();

/* ---------- login ---------- */
let justLoggedIn = false;
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.submitter; const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    justLoggedIn = true;
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (err) {
    justLoggedIn = false;
    console.error(err);
    toast(["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(err.code) ? "Wrong email or password" : "Sign in failed: " + err.code);
  } finally { btn.disabled = false; btn.innerHTML = label; }
};
$("logout").onclick = () => signOut(auth);

let unsubs = [];
onAuthStateChanged(auth, async (user) => {
  await bootDone;
  unsubs.forEach((u) => u()); unsubs = [];
  if (!user) {
    $("home").hidden = true;
    $("login-logo").innerHTML = logoHTML();
    $("login-name").textContent = brand.appName;
    $("login").hidden = false;
    return;
  }
  try {
    const adm = await getDoc(doc(db, "admins", user.uid));       // only listed admins may enter
    if (!adm.exists()) { justLoggedIn = false; await signOut(auth); return toast("This account is not an admin"); }
  } catch (e) {
    console.error(e); justLoggedIn = false; await signOut(auth);
    return toast(e.code === "permission-denied" ? "Blocked by Firestore rules (publish the rules)" : "Could not verify admin access: " + (e.code || e.message));
  }
  $("login").hidden = true;
  if (justLoggedIn) { justLoggedIn = false; await okBox("Login successful", "Welcome back."); }
  startHome();
  // alerts on this phone when a customer waits for an agent (works with the app closed; optional module)
  import("./push.js").then((m) => m.registerAdminPush(user.uid, brand)).catch((e) => console.warn("push.js not loaded:", e.message));
});

/* ---------- home ---------- */
// Menu icons: duotone line icons on a tinted tile (no emoji). In Firebase, `icon` is one of these names, or an image URL.
const ICONS = {
  orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" fill="currentColor" fill-opacity=".16"/><path d="M9 8h6M9 12h6"/>',
  users: '<circle cx="9" cy="8" r="3.5" fill="currentColor" fill-opacity=".16"/><path d="M2.5 20c.8-3.8 3.2-5.5 6.5-5.5s5.7 1.7 6.5 5.5"/><path d="M16.5 4.8a3.4 3.4 0 0 1 0 6.4M18 14.8c2 .6 3.3 2.3 3.8 5.2"/>',
  packages: '<path d="M21 8l-9-5-9 5 9 5 9-5z" fill="currentColor" fill-opacity=".16"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
  offers: '<path d="M20 12l-8 8-9-9V3h8l9 9z" fill="currentColor" fill-opacity=".16"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  banners: '<rect x="3" y="4" width="18" height="16" rx="3" fill="currentColor" fill-opacity=".16"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
  messenger: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="currentColor" fill-opacity=".16"/><path d="M8 10h8M8 13h5"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="currentColor" fill-opacity=".16"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  bank: '<path d="M3 10l9-6 9 6z" fill="currentColor" fill-opacity=".16"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  links: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  reports: '<rect x="4" y="12" width="3.5" height="8" rx="1" fill="currentColor" fill-opacity=".16"/><rect x="10.2" y="7" width="3.5" height="13" rx="1" fill="currentColor" fill-opacity=".16"/><rect x="16.5" y="4" width="3.5" height="16" rx="1" fill="currentColor" fill-opacity=".16"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8z" fill="currentColor" fill-opacity=".16"/><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2" fill="currentColor" fill-opacity=".16"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" fill="currentColor" fill-opacity=".16"/>'
};
const iconHTML = (icon) => /^(https?:|data:)/.test(icon || "")
  ? `<img src="${esc(icon)}" alt="">`
  : `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon] || ICONS.grid}</svg>`;

const MENU_DEFAULT = [
  { icon: "orders", title: "Orders", link: "manage.html#orders" },
  { icon: "users", title: "Users", link: "users.html" },
  { icon: "packages", title: "Packages", link: "packages.html" },
  { icon: "offers", title: "Offers", link: "offers.html" },
  { icon: "banners", title: "Banners", link: "banners.html" },
  { icon: "messenger", title: "Messenger", link: "messenger.html" },
  { icon: "bell", title: "Notifications", link: "notify.html" },
  { icon: "settings", title: "Settings", link: "settings.html" }
];
const NAV_DEFAULT = { home: "index.html", messenger: "messenger.html", profile: "profile.html" };
const NAV_ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  messenger: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8 10h8M8 13h5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'
};

async function startHome() {
  $("home").hidden = false;
  $("home-logo").innerHTML = logoHTML();
  $("home-name").textContent = brand.appName;

  // placeholders first, then data arrives one by one
  $("grid").innerHTML = Array.from({ length: 4 }, () => '<div class="tile sk shimmer"></div>').join("");
  $("nav").innerHTML = Array.from({ length: 3 }, () => '<div class="sk shimmer"></div>').join("");

  const [menu, nav] = await Promise.all([loadMenu(), loadNav()]);
  await showMenu(menu);
  await showNav(nav);
  watchBadges();
}

async function loadMenu() {
  try {
    const s = await getDocs(collection(db, "adminMenu"));
    const items = s.docs.map((d) => d.data()).filter((m) => m.active !== false).sort(sortBy);
    return items.length ? items : MENU_DEFAULT;
  } catch (e) { console.error(e); return MENU_DEFAULT; }   // rules not updated yet: use the built-in menu
}
async function loadNav() {
  try {
    const s = await getDoc(doc(db, "settings", "adminNav"));
    return s.exists() ? { ...NAV_DEFAULT, ...s.data() } : NAV_DEFAULT;
  } catch (e) { console.error(e); return NAV_DEFAULT; }
}

async function showMenu(items) {
  const grid = $("grid");
  grid.innerHTML = "";
  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    const kind = /orders/.test(m.link || "") ? "orders" : /users/.test(m.link || "") ? "users" : /messenger/.test(m.link || "") ? "chats" : "";
    grid.insertAdjacentHTML("beforeend",
      `<a class="tile c${i % 6}" href="${esc(m.link || "#")}"><span class="ti">${iconHTML(m.icon)}</span><b>${esc(m.title)}</b>
        ${kind ? `<span class="badge" data-b="${kind}" hidden>0</span>` : ""}</a>`);
    await sleep(110);
  }
}

async function showNav(links) {
  const nav = $("nav");
  nav.innerHTML = "";
  for (const k of ["home", "messenger", "profile"]) {
    nav.insertAdjacentHTML("beforeend",
      `<a href="${esc(links[k])}" class="${k === "home" ? "on" : ""}"><svg viewBox="0 0 24 24">${NAV_ICONS[k]}</svg><span>${k[0].toUpperCase() + k.slice(1)}</span></a>`);
    await sleep(110);
  }
}

/* ---------- counts on tiles + alerts while the app is open ---------- */
function notify(title, body) {
  toast(title + (body ? ": " + body : ""));
  try { navigator.vibrate?.(200); } catch (e) { /* ignore */ }
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body, icon: brand.logoUrl || undefined }); } catch (e) { /* not supported here */ }
  }
}
function watchBadges() {
  const defs = [
    ["orders", query(collection(db, "orders"), where("status", "==", "payment_pending"), limit(50)), "New payment"],
    ["users", query(collection(db, "users"), where("status", "==", "pending"), limit(50)), "New sign up"],
    ["chats", query(collection(db, "chats"), where("status", "==", "waiting"), limit(50)), "Customer waiting for an agent"]
  ];
  for (const [kind, q, msg] of defs) {
    let first = true;
    unsubs.push(onSnapshot(q, (s) => {
      document.querySelectorAll(`[data-b="${kind}"]`).forEach((b) => { b.hidden = !s.size; b.textContent = s.size; });
      if (!first) s.docChanges().forEach((c) => c.type === "added" && notify(msg, c.doc.data().phone || c.doc.data().customerName || ""));
      first = false;
    }, (e) => console.error(kind, e.code)));
  }
}
