// users.js - customers: pending / active / blocked, add / edit / delete, and each customer's order history
import {
  db, $, esc, sleep, toDate, fmtDT, money, normPhone, providerOf, toast, askConfirm, choose, skelRows,
  initPage, makePager, appendOneByOne, openForm,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, collection, query, where, orderBy, documentId, serverTimestamp
} from "./admin-common.js";

await initPage("users", "Users");

const U_STATUS = { pending: ["Pending", "c-orange"], active: ["Active", "c-green"], blocked: ["Blocked", "c-red"] };
const FILTERS = [["pending", "Pending"], ["active", "Active"], ["blocked", "Blocked"], ["all", "All"]];
const STATUS_OPTS = [{ value: "pending", label: "Pending (waiting for PIN)" }, { value: "active", label: "Active" }, { value: "blocked", label: "Blocked" }];
const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));

let filter = "pending", search = "", items = [], pager = null, token = 0;

$("content").innerHTML = `<div class="chips" id="chips"></div>
  <input class="input u-search" id="search" placeholder="Search name or phone" autocomplete="off">
  <div id="list"></div><div id="more"></div>`;
$("fab").onclick = addUser;

function drawChips() {
  $("chips").innerHTML = FILTERS.map(([v, l]) => `<button class="fchip ${v === filter ? "on" : ""}" data-f="${v}">${l}</button>`).join("");
  $("chips").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; drawChips(); load(true); }));
}

const baseQuery = () => (filter === "all"
  ? query(collection(db, "users"), orderBy(documentId()))
  : query(collection(db, "users"), where("status", "==", filter), orderBy(documentId())));

const matches = (u) => { const q = search.trim().toLowerCase(); return !q || String(u.phone).includes(q) || String(u.name || "").toLowerCase().includes(q); };

const userCard = (u) => {
  const [lbl, cls] = U_STATUS[u.status] || [u.status || "-", "c-gray"];
  return `<div class="row-card" data-open="${esc(u.id)}"><div class="rc-main"><b>${esc(u.name || "-")}</b>
    <span>${esc(u.phone)} • ${esc(u.provider || "")}</span><small>${fmtDT(u.createdAt)}</small></div>
    <div class="rc-side"><span class="chip ${cls}">${lbl}</span>${u.passcodeHash ? "" : '<span class="chip c-gray">No passcode</span>'}</div></div>`;
};

// first page shows placeholders, then users appear one by one; "Load more" fetches the next 10
async function load(reset) {
  const my = ++token;
  const list = $("list");
  if (reset) { items = []; pager = makePager(baseQuery(), 10); list.innerHTML = skelRows(4); $("more").innerHTML = ""; }
  else $("more").innerHTML = '<div class="progress">Loading…</div>';
  let page;
  try { page = await pager.next(); }
  catch (e) { console.error(e); if (my === token) list.innerHTML = `<div class="empty">Could not load users (${esc(e.code || e.message)})</div>`; return; }
  if (my !== token) return;
  if (reset) list.innerHTML = "";
  items.push(...page);
  if (reset && !page.length) list.innerHTML = '<div class="empty">No users here.</div>';
  await appendOneByOne(list, page.filter(matches), userCard);
  if (my !== token) return;
  $("more").innerHTML = pager.done ? "" : '<button class="btn btn-ghost btn-block" id="more-btn">Load more</button>';
  const mb = $("more-btn"); if (mb) mb.onclick = () => load(false);
}

function renderList() {
  const rows = items.filter(matches);
  $("list").innerHTML = rows.length ? rows.map(userCard).join("") : '<div class="empty">No users found.</div>';
}

let st;
$("search").oninput = () => {
  search = $("search").value;
  renderList();
  clearTimeout(st);
  st = setTimeout(async () => {                       // exact phone number: look it up directly
    const p = normPhone(search);
    if (!/^07\d{8}$/.test(p) || items.some((u) => u.id === p)) return;
    const s = await getDoc(doc(db, "users", p));
    if (s.exists()) { items.unshift({ id: s.id, ...s.data() }); renderList(); }
  }, 350);
};
$("list").onclick = (e) => {
  const c = e.target.closest("[data-open]");
  if (c) openProfile(items.find((u) => u.id === c.dataset.open));
};

/* ---------------- add user ---------------- */
function addUser() {
  openForm({
    title: "Add user",
    fields: [
      { key: "name", label: "Name" },
      { key: "phone", label: "Phone number", type: "tel", placeholder: "0771234567" },
      { key: "status", label: "Status", type: "select", options: STATUS_OPTS },
      { key: "pin", label: "Verification PIN (4 digits)", hint: "Only needed for Pending users." },
      { key: "extraDetails", label: "Extra details", type: "textarea" }
    ],
    values: { status: "active" },
    buttons: [{ label: "Add user", onClick: async (v) => {
      const phone = normPhone(v.phone);
      if (v.name.length < 2) throw new Error("Enter a name");
      if (!/^07\d{8}$/.test(phone)) throw new Error("Enter a valid mobile number");
      if (v.pin && !/^\d{4}$/.test(v.pin)) throw new Error("PIN must be 4 digits");
      const ref = doc(db, "users", phone);
      if ((await getDoc(ref)).exists()) throw new Error("This number is already registered");
      await setDoc(ref, { name: v.name, phone, provider: providerOf(phone), status: v.status, pin: v.pin, extraDetails: v.extraDetails,
        createdAt: serverTimestamp(), addedByAdmin: true, ...(v.status === "active" ? { activatedAt: serverTimestamp() } : {}) });
      toast("User added (they create their passcode at first login)");
      load(true);
    } }]
  });
}

/* ---------------- user profile + order history ---------------- */
const kindOf = (o) => {
  if (o.status === "cancelled") return "cancelled";
  if (o.status === "unpaid" || o.status === "payment_pending") return "pending";
  if (o.status === "active") { const e = toDate(o.expiryDate); return e && e.getTime() < Date.now() ? "old" : "active"; }
  return "old";
};
const KIND_UI = { active: ["Active", "c-green"], pending: ["Pending", "c-orange"], cancelled: ["Cancelled", "c-gray"], old: ["Old (expired)", "c-violet"] };
const O_FILTERS = [["all", "All"], ["active", "Active"], ["pending", "Pending"], ["cancelled", "Cancelled"], ["old", "Old"]];

function openProfile(u0) {
  if (!u0) return;
  let u = { ...u0 }, orders = [], okey = "all", alive = true;
  const wrap = document.createElement("div");
  wrap.className = "profile-sheet";
  wrap.innerHTML = `<header class="topbar"><button class="icon-btn" data-x aria-label="Back"><svg viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></button><h1>User profile</h1></header>
    <div class="inner"><div id="head"></div><div id="stats"></div><div id="olist" style="display:grid;gap:10px"></div><div id="oprog" class="progress"></div></div>`;
  document.body.appendChild(wrap);
  const q = (s) => wrap.querySelector(s);
  const close = () => { alive = false; wrap.remove(); };
  q("[data-x]").onclick = close;
  const ref = doc(db, "users", u.id);

  function drawHead() {
    const [lbl, cls] = U_STATUS[u.status] || [u.status || "-", "c-gray"];
    q("#head").innerHTML = `<div class="hero"><div class="avatar">${(u.photoUrl || u.photoBase64) ? `<img src="${esc(u.photoUrl || u.photoBase64)}" alt="">` : esc((u.name || "?").charAt(0).toUpperCase())}</div>
        <h2>${esc(u.name || "-")}</h2><span class="muted">${esc(u.phone)}</span><span class="chip ${cls}">${lbl}</span></div>
      <div class="btn-row" style="margin:12px 0"><button class="btn btn-primary" id="p-edit">Edit user</button><button class="btn btn-danger" id="p-del">Delete user</button></div>
      <div class="kv"><div><span>Provider</span><b>${esc(u.provider || "-")}</b></div><div><span>Registered</span><b>${fmtDT(u.createdAt) || "-"}</b></div>
        <div><span>Passcode</span><b>${u.passcodeHash ? "Set" : "Not set"}</b></div><div><span>Verification PIN</span><b>${esc(u.pin || "-")}</b></div>
        <div><span>Extra details</span><b>${esc(u.extraDetails || "-")}</b></div></div>`;
    q("#p-edit").onclick = editUser;
    q("#p-del").onclick = deleteUser;
  }

  const count = (k) => orders.filter((o) => kindOf(o) === k).length;
  function drawStats() {
    q("#stats").innerHTML = `<div class="stats">
      <div class="stat"><b>${orders.length}</b><small>Total</small></div><div class="stat"><b>${count("active")}</b><small>Active</small></div>
      <div class="stat"><b>${count("pending")}</b><small>Pending</small></div><div class="stat"><b>${count("cancelled")}</b><small>Cancelled</small></div>
      <div class="stat"><b>${count("old")}</b><small>Old</small></div></div>
      <div class="chips" style="margin-top:10px">${O_FILTERS.map(([v, l]) => `<button class="fchip ${v === okey ? "on" : ""}" data-k="${v}">${l}</button>`).join("")}</div>`;
    q("#stats").querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => { okey = b.dataset.k; drawStats(); drawOrders(); }));
  }

  const orderCard = (o) => {
    const [lbl, cls] = KIND_UI[kindOf(o)];
    const exp = toDate(o.expiryDate);
    return `<div class="row-card order-row" data-oid="${esc(o.id)}"><div class="rc-main"><b>${esc(o.packageName || "-")}</b>
      <span>${money(o.price)} • ${fmtDT(o.createdAt)}</span><small>${exp ? "Expiry " + exp.toLocaleDateString("en-CA") : esc(o.status || "")}</small></div>
      <div class="rc-side"><span class="chip ${cls}">${lbl}</span></div></div>`;
  };
  const inFilter = (o) => okey === "all" || kindOf(o) === okey;
  function drawOrders() {
    const rows = orders.filter(inFilter);
    q("#olist").innerHTML = rows.length ? rows.map(orderCard).join("") : '<div class="empty">No orders here.</div>';
  }
  q("#olist").onclick = (e) => {
    const c = e.target.closest("[data-oid]");
    if (c) openOrder(orders.find((o) => o.id === c.dataset.oid));
  };

  function openOrder(o) {
    if (!o) return;
    const [lbl] = KIND_UI[kindOf(o)];
    openForm({
      title: o.packageName || "Order",
      intro: `<dl class="info"><div><dt>Status</dt><dd>${lbl} (${esc(o.status)})</dd></div><div><dt>Amount</dt><dd>${money(o.price)}</dd></div>
        <div><dt>Data</dt><dd>${esc(o.dataLabel || "-")}</dd></div><div><dt>Ordered</dt><dd>${fmtDT(o.createdAt)}</dd></div>
        <div><dt>Activated</dt><dd>${fmtDT(o.activatedAt) || "-"}</dd></div><div><dt>Expiry</dt><dd>${toDate(o.expiryDate) ? toDate(o.expiryDate).toLocaleDateString("en-CA") : "-"}</dd></div></dl>`,
      buttons: [
        { label: "Delete order", kind: "danger", onClick: async () => {
          if (!(await askConfirm("Delete this order?", "It is removed from Firebase (with its payment slip) and cannot be undone.", "Delete"))) return false;
          await deleteDoc(doc(db, "orders", o.id));
          await deleteDoc(doc(db, "orderSlips", o.id)).catch(() => {});
          orders = orders.filter((x) => x.id !== o.id);
          drawStats(); drawOrders(); toast("Order deleted");
        } },
        { label: "Close", kind: "ghost", onClick: () => {} }
      ]
    });
  }

  function editUser() {
    openForm({
      title: "Edit user",
      intro: `<dl class="info"><div><dt>Phone (login ID)</dt><dd>${esc(u.phone)}</dd></div></dl>`,
      fields: [
        { key: "name", label: "Name" },
        { key: "status", label: "Status", type: "select", options: STATUS_OPTS },
        { key: "pin", label: "Verification PIN (4 digits)", placeholder: "e.g. 4821" },
        { key: "extraDetails", label: "Extra details", type: "textarea" }
      ],
      values: { name: u.name, status: u.status || "pending", pin: u.pin || "", extraDetails: u.extraDetails || "" },
      buttons: [
        { label: "Save", onClick: async (v) => {
          if (v.name.length < 2) throw new Error("Enter a name");
          if (v.pin && !/^\d{4}$/.test(v.pin)) throw new Error("PIN must be 4 digits");
          const data = { name: v.name, status: v.status, pin: v.pin, extraDetails: v.extraDetails };
          if (v.status === "active" && !u.activatedAt) data.activatedAt = serverTimestamp();
          await updateDoc(ref, data);
          u = { id: u.id, ...(await getDoc(ref)).data() };
          items = items.map((x) => (x.id === u.id ? u : x));
          drawHead(); renderList(); toast("Saved");
        } },
        { label: "New PIN", kind: "ghost", onClick: (v, ctx) => { ctx.set("pin", randomPin()); return false; } },
        { label: "Reset passcode", kind: "danger", onClick: async () => {
          if (!(await askConfirm("Reset passcode?", "The customer will create a new passcode at next login.", "Reset"))) return false;
          await updateDoc(ref, { passcodeHash: deleteField() });
          u = { id: u.id, ...(await getDoc(ref)).data() }; drawHead(); toast("Passcode reset");
        } }
      ]
    });
  }

  async function deleteUser() {
    const act = await choose("Delete user", `${u.name || u.phone} (${u.phone})`, [
      { label: "Delete user only", value: "user", kind: "danger" },
      { label: "Delete user and all their orders", value: "all", kind: "danger" }
    ]);
    if (!act) return;
    if (!(await askConfirm("Are you sure?", "This is removed from Firebase and cannot be undone.", "Delete"))) return;
    try {
      if (act === "all") {
        const s = await getDocs(query(collection(db, "orders"), where("phone", "==", u.id)));
        for (const d of s.docs) { await deleteDoc(d.ref); await deleteDoc(doc(db, "orderSlips", d.id)).catch(() => {}); }
      }
      await deleteDoc(ref);
      items = items.filter((x) => x.id !== u.id);
      renderList(); close(); toast("User deleted");
    } catch (e) { console.error(e); toast("Could not delete: " + (e.code || e.message)); }
  }

  // order history arrives 10 at a time and is shown one by one
  async function loadOrders() {
    q("#olist").innerHTML = skelRows(3);
    q("#oprog").textContent = "Loading orders…";
    const op = makePager(query(collection(db, "orders"), where("phone", "==", u.id), orderBy(documentId())), 10);
    let first = true;
    try {
      while (alive && !op.done) {
        const page = await op.next();
        if (!alive) return;
        if (first) { q("#olist").innerHTML = ""; first = false; }
        orders.push(...page);
        drawStats();
        await appendOneByOne(q("#olist"), page.filter(inFilter), orderCard, 80);
      }
    } catch (e) { console.error(e); if (alive) q("#oprog").textContent = "Could not load orders (" + (e.code || e.message) + ")"; return; }
    if (!alive) return;
    q("#oprog").textContent = "";
    orders.sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    drawOrders();
  }

  drawHead(); drawStats(); loadOrders();
}

drawChips();
load(true);

// opened from the Messenger: users.html?phone=0771234567 shows that customer's profile straight away
const wanted = normPhone(new URLSearchParams(location.search).get("phone") || "");
if (wanted) {
  getDoc(doc(db, "users", wanted)).then((s) => (s.exists() ? openProfile({ id: s.id, ...s.data() }) : toast("User not found"))).catch((e) => toast("Could not open the profile (" + (e.code || e.message) + ")"));
}
