// notifications.js - customer notification list: loads one by one, press and hold -> select / delete, copy
import {
  db, doc, getDocs, updateDoc, deleteDoc, collection, query, orderBy, writeBatch, limit,
  makePager, appendOneByOne, esc, toDate, getSession, loadBranding, toast, confirmBox, choiceBox
} from "./firebase-init.js";
const push = import("./push.js").catch(() => null);   // optional: the page works without it

const $ = (id) => document.getElementById(id);
const phone = getSession();
if (!phone) location.replace("index.html");

const col = collection(db, "users", phone || "x", "notifications");
const list = $("list");
const items = new Map();          // id -> data of every notification shown so far
const selected = new Set();
let selecting = false, allSelected = false, pager = null, loading = false, brand = {};

$("back").onclick = () => (history.length > 1 ? history.back() : (location.href = "index.html"));

/* ---------------- one notification ---------------- */
function ago(v) {
  const d = toDate(v);
  if (!d) return "";
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return m + " min ago";
  if (m < 1440) return Math.floor(m / 60) + " h ago";
  if (m < 10080) return Math.floor(m / 1440) + " d ago";
  return d.toLocaleDateString("en-GB");
}
const iconHTML = (n) => /^(https?:|data:)/.test(n.icon || "") ? `<img src="${esc(n.icon)}" alt="">` : esc(n.icon || "🔔");
const cardHTML = (n) => `
  <div class="nt ${n.read === false ? "unread" : ""}" data-id="${esc(n.id)}">
    <span class="nt-ico">${iconHTML(n)}</span>
    <div class="nt-text"><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ""}<small>${ago(n.createdAt)}</small></div>
    <span class="nt-check"></span>
  </div>`;

/* ---------------- loading: a few at a time, shown one by one ---------------- */
async function loadNext() {
  if (loading || !pager || pager.done) return;
  loading = true;
  const first = !items.size;
  if (first) list.innerHTML = '<div class="skel" style="height:78px"></div><div class="skel" style="height:78px"></div><div class="skel" style="height:78px"></div>';
  try {
    const page = await pager.next();
    if (first) list.innerHTML = "";
    page.forEach((n) => items.set(n.id, n));
    await appendOneByOne(list, page, cardHTML, 120);
    markRead(page);
    if (!items.size) showEmpty();
  } catch (e) {
    console.error(e);
    if (first) list.innerHTML = `<div class="empty">Could not load notifications (${esc(e.code || e.message)}).</div>`;
  }
  $("hint").hidden = !items.size;
  loading = false;
  if (!pager.done && $("sentinel").getBoundingClientRect().top < innerHeight + 300) setTimeout(loadNext, 0);
}

// they stay highlighted on screen for now; the bell on Home stops counting them
function markRead(page) {
  page.filter((n) => n.read === false).forEach((n) => updateDoc(doc(db, "users", phone, "notifications", n.id), { read: true }).catch(console.error));
}
function showEmpty() { list.innerHTML = '<div class="empty">No notifications yet.</div>'; $("hint").hidden = true; }

// keep loading while the end of the list is on screen
new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadNext(); }, { rootMargin: "300px" }).observe($("sentinel"));

/* ---------------- press and hold -> menu ---------------- */
let holdTimer = null, holdFired = false, sx = 0, sy = 0;
list.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".nt");
  if (!el || selecting) return;
  sx = e.clientX; sy = e.clientY; holdFired = false;
  holdTimer = setTimeout(() => { holdFired = true; openMenu(el.dataset.id); }, 550);
});
list.addEventListener("pointermove", (e) => { if (holdTimer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(holdTimer); holdTimer = null; } });
["pointerup", "pointercancel", "pointerleave"].forEach((ev) => list.addEventListener(ev, () => { clearTimeout(holdTimer); holdTimer = null; }));
list.addEventListener("contextmenu", (e) => { if (e.target.closest(".nt")) e.preventDefault(); });

list.addEventListener("click", (e) => {
  const el = e.target.closest(".nt");
  if (!el) return;
  if (holdFired) { holdFired = false; return; }
  if (selecting) return toggle(el.dataset.id);
  const link = items.get(el.dataset.id)?.link;
  if (link) location.href = link;
});

async function openMenu(id) {
  const act = await choiceBox({
    title: "Notification",
    options: [
      { label: "Select", value: "select", kind: "primary" },
      { label: "Delete", value: "delete", kind: "danger" }
    ]
  });
  if (act === "delete") return removeIds([id]);
  if (act === "select") { setSelecting(true); toggle(id); }
}

/* ---------------- select mode ---------------- */
function setSelecting(on) {
  selecting = on; allSelected = false; selected.clear();
  $("top-bar").hidden = on; $("sel-bar").hidden = !on;
  list.classList.toggle("selecting", on);
  list.querySelectorAll(".nt").forEach((el) => el.classList.remove("picked"));
  updateCount();
}
function toggle(id) {
  allSelected = false;
  selected.has(id) ? selected.delete(id) : selected.add(id);
  const el = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.toggle("picked", selected.has(id));
  updateCount();
}
function updateCount() { $("sel-count").textContent = (allSelected ? "All" : selected.size) + " selected"; }

$("sel-cancel").onclick = () => setSelecting(false);
$("sel-all").onclick = () => {
  allSelected = true;
  items.forEach((_, id) => selected.add(id));
  list.querySelectorAll(".nt").forEach((el) => el.classList.add("picked"));
  updateCount();
};
$("sel-copy").onclick = async () => {
  const text = [...selected].map((id) => items.get(id)).filter(Boolean).map((n) => n.title + (n.body ? "\n" + n.body : "")).join("\n\n");
  if (!text) return toast("Select a notification first");
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch (e) { toast("Could not copy"); }
};
$("sel-del").onclick = async () => {
  if (!selected.size) return toast("Select a notification first");
  await removeIds([...selected], allSelected);
};

/* ---------------- delete ---------------- */
async function removeIds(ids, everything = false) {
  const text = everything ? "Delete ALL your notifications?" : ids.length === 1 ? "Delete this notification?" : `Delete ${ids.length} notifications?`;
  if (!(await confirmBox({ title: "Delete", message: text + " This cannot be undone.", okText: "Delete", cancelText: "Cancel" }))) return;
  try {
    if (everything) {
      // also removes the ones that are not on screen yet
      const s = await getDocs(query(col, limit(450)));
      let docs = s.docs;
      while (docs.length) {
        const b = writeBatch(db);
        docs.forEach((d) => b.delete(d.ref));
        await b.commit();
        docs = (await getDocs(query(col, limit(450)))).docs;
      }
    } else {
      for (let i = 0; i < ids.length; i += 400) {
        const b = writeBatch(db);
        ids.slice(i, i + 400).forEach((id) => b.delete(doc(db, "users", phone, "notifications", id)));
        await b.commit();
      }
    }
    const gone = everything ? [...items.keys()] : ids;
    gone.forEach((id) => { items.delete(id); const el = list.querySelector(`[data-id="${CSS.escape(id)}"]`); if (el) el.remove(); });
    setSelecting(false);
    if (everything || !items.size) { items.clear(); showEmpty(); }
    toast("Deleted");
  } catch (e) { console.error(e); toast("Could not delete (" + (e.code || e.message) + ")"); }
}

/* ---------------- permission banner ---------------- */
function drawPermBanner() {
  const b = $("perm-banner");
  if (!("Notification" in window) || Notification.permission === "granted") { b.hidden = true; return; }
  b.hidden = false;
  if (Notification.permission === "denied") {
    $("perm-text").textContent = "Notifications are blocked. Allow them in your browser's site settings.";
    $("perm-btn").hidden = true;
  }
}
$("perm-btn").onclick = async () => {
  try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
  drawPermBanner();
  push.then((m) => m && m.registerPush(phone, brand));
};

async function init() {
  drawPermBanner();
  pager = makePager(query(col, orderBy("createdAt", "desc")), 6);
  loadNext();
  brand = await loadBranding();
  push.then((m) => m && m.registerPush(phone, brand));
}

// start the page only after every function and constant above is defined
init();
