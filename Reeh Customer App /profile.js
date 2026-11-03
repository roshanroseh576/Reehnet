// profile.js - Profile page: photo + name + phone (tap -> profile-edit.html), More icon grid, Policy / About rows (all from Firebase)
import {
  db, doc, getDoc, collection, query, onSnapshot,
  streamPages, appendOneByOne, esc, getSession, toast
} from "./firebase-init.js";
import { photoMenu, doLogout } from "./profile-shared.js";

const $ = (id) => document.getElementById(id);
const phone = getSession();
if (!phone) location.replace("index.html");

const userRef = doc(db, "users", phone || "x");
let user = {};

$("back").onclick = () => (history.length > 1 ? history.back() : (location.href = "index.html"));

const icoHTML = (icon) => /^(https?:|data:)/.test(icon || "") ? `<img src="${esc(icon)}" alt="">` : esc(icon || "🔗");
const bySort = (a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999);

/* ---------------- user ---------------- */
function render(snap) {
  if (!snap.exists() || snap.data().status === "blocked") return doLogout();
  user = snap.data();
  $("p-name").textContent = user.name || "-";
  $("p-phone").textContent = phone;
  $("avatar").innerHTML = (user.photoUrl || user.photoBase64)
    ? `<img src="${esc((user.photoUrl || user.photoBase64))}" alt="">`
    : `<span>${esc((user.name || "R").charAt(0).toUpperCase())}</span>`;
}

/* ---------------- lists from Firebase: a few at a time, shown one by one ---------------- */
async function loadFrom(collectionName, box, skeleton, htmlFn, onEmpty) {
  box.innerHTML = skeleton;
  let first = true, n = 0, failed = "";
  const timer = setTimeout(() => { if (first) box.innerHTML = '<p class="muted" style="padding:6px 2px">Taking too long. Check your internet connection.</p>'; }, 10000);
  try {
    await streamPages(query(collection(db, collectionName)), 12, async (page) => {
      if (first) { box.innerHTML = ""; first = false; }
      const items = page.filter((m) => m.active !== false).sort(bySort);
      await appendOneByOne(box, items, htmlFn, 120);
      n += items.length;
    });
  } catch (e) { console.error(collectionName, e); failed = e.code || e.message || "error"; }
  clearTimeout(timer);
  if (failed) { box.innerHTML = `<p class="muted" style="padding:6px 2px">Could not load (${esc(failed)}).</p>`; return; }
  if (!n) { box.innerHTML = ""; onEmpty && onEmpty(); }
}

const tileHTML = (m) => `<a class="m-tile" href="${esc(m.link || "#")}"><span class="m-ico">${icoHTML(m.icon)}</span><b>${esc(m.title)}</b></a>`;
const rowHTML = (m) => `<a class="menu-item" href="${esc(m.link || "#")}"><span class="m-ico">${icoHTML(m.icon)}</span><span class="m-title">${esc(m.title)}</span><span class="chev">›</span></a>`;

/* ---------------- bottom nav (links from Firebase: settings/nav) ---------------- */
const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  package: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
  offers: '<svg viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V3h8l9 9z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>',
  profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>'
};
async function loadNav() {
  let nav = { home: "index.html", package: "package.html", offers: "offers.html", profile: "profile.html" };
  try {
    const n = await getDoc(doc(db, "settings", "nav"));
    if (n.exists()) nav = { ...nav, ...n.data() };
  } catch (e) { console.error(e); }
  $("bottom-nav").innerHTML = Object.keys(ICONS).map((k) =>
    `<a href="${esc(nav[k])}" class="${k === "profile" ? "on" : ""}">${ICONS[k]}<span>${k[0].toUpperCase() + k.slice(1)}</span></a>`).join("");
}

function init() {
  // lists first: they load even if something else on the page fails
  loadNav();
  loadFrom("moreLinks", $("more-grid"), '<div class="skel t"></div><div class="skel t"></div><div class="skel t"></div><div class="skel t"></div>', tileHTML, () => ($("more-sec").hidden = true));
  loadFrom("profileLinks", $("menu"), '<div class="skel"></div><div class="skel"></div>', rowHTML);

  getDoc(userRef).then(render).catch((e) => { console.error(e); toast("Could not load your profile (" + (e.code || e.message) + ")"); });
  onSnapshot(userRef, render, (e) => console.error("profile listener", e));
  $("edit-photo").onclick = () => photoMenu(userRef, user);   // pencil: photo options
}

// start the page only after every function and constant above is defined
init();
