// Reeh Cloud Admin - orders, users, packages, offers, banners
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, deleteField, collection,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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

/* ================= helpers ================= */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toDate = (v) => (!v ? null : v.toDate ? v.toDate() : new Date(v));
const ymd = (d) => d.toLocaleDateString("en-CA");
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const money = (n) => "LKR " + Number(n || 0).toLocaleString("en-LK");
const fmtDT = (v) => { const d = toDate(v); return d ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""; };
const PROVIDERS = [{ value: "dialog", label: "Dialog" }, { value: "airtel", label: "Airtel" }, { value: "hutch", label: "Hutch" }, { value: "mobitel", label: "Mobitel" }];
const providerOf = (p) => ({ 77: "dialog", 76: "dialog", 75: "airtel", 78: "hutch", 72: "hutch", 71: "mobitel", 70: "mobitel" }[String(p).slice(1, 3)] || "unknown");
const normPhone = (v) => { let d = String(v || "").replace(/\D/g, ""); if (d.startsWith("94") && d.length === 11) d = "0" + d.slice(2); if (d.length === 9) d = "0" + d; return d; };

function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function askConfirm(title, message, okText = "Yes") {
  return new Promise((resolve) => {
    const w = document.createElement("div");
    w.className = "confirm";
    w.innerHTML = `<div class="box"><h3>${esc(title)}</h3><p>${esc(message)}</p>
      <div class="acts"><button class="btn btn-ghost" data-r="0">No</button><button class="btn btn-danger" data-r="1">${esc(okText)}</button></div></div>`;
    w.onclick = (e) => { const b = e.target.closest("[data-r]"); if (b) { w.remove(); resolve(b.dataset.r === "1"); } };
    document.body.appendChild(w);
  });
}

/* ---- image -> small JPEG data URL (stored in the document) ---- */
function imageToDataUrl(file, maxW = 900) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = 0.75, out = c.toDataURL("image/jpeg", q);
      while (out.length > 450000 && q > 0.35) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
      out.length > 700000 ? reject(new Error("Image too large. Use a smaller image.")) : resolve(out);
    };
    img.onerror = () => reject(new Error("Could not read the image."));
    img.src = url;
  });
}

/* ================= generic form sheet ================= */
function fieldHTML(f, v) {
  const id = "f_" + f.key, label = `<span>${esc(f.label)}</span>`, hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : "";
  switch (f.type) {
    case "textarea": return `<label class="field">${label}<textarea class="input" id="${id}" rows="3">${esc(v ?? "")}</textarea>${hint}</label>`;
    case "select": return `<label class="field">${label}<select class="input" id="${id}">${f.options.map((o) =>
      `<option value="${esc(o.value)}" ${String(v) === String(o.value) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>${hint}</label>`;
    case "bool": return `<label class="check"><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${esc(f.label)}</label>`;
    case "multi": return `<div class="field">${label}<div class="multi" id="${id}">${f.options.map((o) =>
      `<label class="check"><input type="checkbox" value="${esc(o.value)}" ${(v || []).includes(o.value) ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}</div>${hint}</div>`;
    case "image": return `<div class="field">${label}<div class="imgfield">
        <img id="${id}_prev" alt="" ${v ? `src="${esc(v)}"` : "hidden"}>
        <input class="input" id="${id}" type="url" placeholder="Paste image URL (https://...)" value="${v && !String(v).startsWith("data:") ? esc(v) : ""}">
        <div class="row"><button type="button" class="btn btn-ghost btn-sm" data-upload="${f.key}">Upload image</button>
        <button type="button" class="btn btn-danger btn-sm" data-clearimg="${f.key}">Remove</button></div></div>${hint}</div>`;
    default: return `<label class="field">${label}<input class="input" id="${id}" type="${f.type || "text"}" ${f.type === "number" ? 'step="any" inputmode="decimal"' : ""} ${f.readonly ? "readonly" : ""} placeholder="${esc(f.placeholder || "")}" value="${esc(v ?? "")}">${hint}</label>`;
  }
}

// buttons: [{label, kind, onClick(values, ctx)}]. onClick may throw Error(message) or return false to keep the sheet open.
function openForm({ title, intro = "", fields = [], values = {}, buttons }) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-backdrop";
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="sheet-body">${intro}${fields.map((f) => fieldHTML(f, values[f.key])).join("")}</div>
    <div class="sheet-foot">${buttons.map((b, i) => `<button class="btn btn-${b.kind || "primary"}" data-b="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
  const imgs = {};
  fields.filter((f) => f.type === "image").forEach((f) => (imgs[f.key] = values[f.key] || ""));
  const close = () => wrap.remove();

  const collect = () => {
    const out = {};
    for (const f of fields) {
      const el = wrap.querySelector("#f_" + f.key);
      if (f.type === "bool") out[f.key] = el.checked;
      else if (f.type === "multi") out[f.key] = [...el.querySelectorAll("input:checked")].map((i) => i.value);
      else if (f.type === "number") out[f.key] = el.value.trim() === "" ? null : Number(el.value);
      else if (f.type === "image") out[f.key] = el.value.trim() || imgs[f.key] || "";
      else out[f.key] = el.value.trim();
    }
    return out;
  };
  const ctx = { set: (k, v) => { const el = wrap.querySelector("#f_" + k); if (el) el.value = v; }, close };

  wrap.addEventListener("click", async (e) => {
    if (e.target === wrap || e.target.closest("[data-close]")) return close();
    const up = e.target.closest("[data-upload]");
    if (up) {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*";
      inp.onchange = async () => {
        if (!inp.files[0]) return;
        try {
          const k = up.dataset.upload, data = await imageToDataUrl(inp.files[0]);
          imgs[k] = data;
          wrap.querySelector("#f_" + k).value = "";
          const pv = wrap.querySelector("#f_" + k + "_prev"); pv.src = data; pv.hidden = false;
        } catch (err) { toast(err.message); }
      };
      return inp.click();
    }
    const clr = e.target.closest("[data-clearimg]");
    if (clr) { const k = clr.dataset.clearimg; imgs[k] = ""; wrap.querySelector("#f_" + k).value = ""; wrap.querySelector("#f_" + k + "_prev").hidden = true; return; }
    const sl = e.target.closest(".slip");
    if (sl) return sl.classList.toggle("big");
    const b = e.target.closest("[data-b]");
    if (!b) return;
    const def = buttons[Number(b.dataset.b)];
    b.disabled = true;
    try {
      const r = await def.onClick(collect(), ctx);
      if (r !== false) close();
    } catch (err) { console.error(err); toast(err.message || "Something went wrong"); }
    finally { b.disabled = false; }
  });
  document.body.appendChild(wrap);
}

// remove nulls/empties for new docs; turn them into deleteField() for updates
function prepare(data, isNew) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    const empty = v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length && k !== "providers");
    if (empty) { if (!isNew) out[k] = deleteField(); } else out[k] = v;
  }
  return out;
}
const dateToTs = (s, end) => (s ? Timestamp.fromDate(new Date(s + (end ? "T23:59:00" : "T00:00:00"))) : null);

/* ================= state + tabs ================= */
const state = { tab: "orders", oFilter: "payment_pending", uFilter: "pending", search: "", packages: [], offers: [], banners: [], orders: [], users: [], loaded: { orders: false, users: false, packages: false, offers: false, banners: false } };
let unsubs = { orders: null, users: null }, baseUnsubs = [];

const TITLES = { orders: "Orders", users: "Users", packages: "Packages", offers: "Offers", banners: "Banners" };
$("nav").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); };
$("fab").onclick = () => ({ users: addUser, packages: () => editPackage(), offers: () => editOffer(), banners: () => editBanner() }[state.tab]?.());

function setTab(t) {
  state.tab = t; state.search = "";
  history.replaceState(null, "", "#" + t);
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  $("title").textContent = TITLES[t];
  $("fab").hidden = t === "orders";
  if (t === "orders") listenOrders();
  if (t === "users") listenUsers();
  render();
}

function render() {
  const c = $("content");
  ({ orders: renderOrders, users: renderUsers, packages: renderPackages, offers: renderOffers, banners: renderBanners }[state.tab])(c);
}

/* ---- one-by-one painting: rows appear one after another, never all at once ---- */
let paintToken = 0;
const painted = new Set();
const skeletons = (n = 4) => Array.from({ length: n }, () => '<div class="skel-row"></div>').join("");
async function fill(box, rows, key) {
  const my = ++paintToken;
  if (painted.has(key) || state.search) { box.innerHTML = rows.join(""); painted.add(key); return; }   // already shown once: no replay
  box.innerHTML = "";
  for (const html of rows) {
    if (my !== paintToken) return;                       // a newer render took over
    box.insertAdjacentHTML("beforeend", html.replace('class="row-card"', 'class="row-card pop"'));
    await new Promise((r) => setTimeout(r, 70));
  }
  if (my === paintToken) painted.add(key);
}

/* ================= ORDERS ================= */
const O_STATUS = { unpaid: ["Unpaid", "c-orange"], payment_pending: ["Payment pending", "c-blue"], active: ["Active", "c-green"], cancelled: ["Cancelled", "c-gray"] };
const O_FILTERS = [["payment_pending", "Payment pending"], ["unpaid", "Unpaid"], ["active", "Active"], ["cancelled", "Cancelled"], ["all", "All"]];

function listenOrders() {
  unsubs.orders && unsubs.orders();
  state.loaded.orders = false;
  const col = collection(db, "orders");
  const q = state.oFilter === "all" ? query(col, orderBy("createdAt", "desc"), limit(100)) : query(col, where("status", "==", state.oFilter), limit(100));
  unsubs.orders = onSnapshot(q, (s) => {
    state.orders = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    state.loaded.orders = true;
    if (state.tab === "orders") render();
  }, (e) => { console.error(e); state.loaded.orders = true; toast("Could not load orders: " + e.code); if (state.tab === "orders") render(); });
}

function chipsHTML(list, current, attr) {
  return `<div class="chips">${list.map(([v, l]) => `<button class="fchip ${v === current ? "on" : ""}" ${attr}="${v}">${l}</button>`).join("")}</div>`;
}

function orderRow(o) {
  const [lbl, cls] = O_STATUS[o.status] || [o.status, "c-gray"];
  return `<div class="row-card" data-open="${esc(o.id)}"><div class="rc-main"><b>${esc(o.packageName)}</b>
    <span>${esc(o.userName || "-")} • ${esc(o.phone)}</span><small>${fmtDT(o.createdAt)}</small></div>
    <div class="rc-side"><b>${money(o.price)}</b><span class="chip ${cls}">${lbl}</span></div></div>`;
}

function renderOrders(c) {
  const q = state.search.trim();
  c.innerHTML = chipsHTML(O_FILTERS, state.oFilter, "data-of") +
    `<input class="input" id="search" placeholder="Search phone or name" value="${esc(state.search)}"><div id="rows" class="rows"></div>`;
  bindSearch(c);
  c.querySelectorAll("[data-of]").forEach((b) => (b.onclick = () => { state.oFilter = b.dataset.of; listenOrders(); render(); }));
  const box = $("rows");
  box.onclick = (e) => { const r = e.target.closest("[data-open]"); if (r) openOrder(state.orders.find((o) => o.id === r.dataset.open)); };
  if (!state.loaded.orders) { box.innerHTML = skeletons(); return; }
  const rows = state.orders.filter((o) => !q || String(o.phone).includes(q) || String(o.userName || "").toLowerCase().includes(q.toLowerCase()));
  fill(box, rows.length ? rows.map(orderRow) : ['<div class="empty">No orders here.</div>'], "orders:" + state.oFilter);
}

function bindSearch(c) {
  const s = c.querySelector("#search");
  if (!s) return;
  s.oninput = () => {
    state.search = s.value;
    const pos = s.selectionStart;
    render();
    const n = $("search"); n.focus(); n.setSelectionRange(pos, pos);
  };
}

async function openOrder(o) {
  if (!o) return;
  let slip = o.slipUrl || o.slipBase64 || "";
  if (!slip && o.hasSlip) {
    try { const sd = (await getDoc(doc(db, "orderSlips", o.id))).data() || {}; slip = sd.slipUrl || sd.slipBase64 || ""; } catch (e) { console.error(e); }
  }
  const [lbl] = O_STATUS[o.status] || [o.status];
  const exp = toDate(o.expiryDate);
  const values = {
    packageType: o.packageType || "GB PACKAGE", serverName: o.serverName || "", protocol: o.protocol || "V2RAY TLS",
    configLink: o.configLink || "", dataTotalGB: o.dataTotalGB ?? 0, validityDays: o.validityDays ?? 30,
    dataUsedGB: o.dataUsedGB ?? 0, expiryDate: ymd(exp || addDays(new Date(), Number(o.validityDays || 30)))
  };
  const intro = `<dl class="info">
      <div><dt>Customer</dt><dd>${esc(o.userName || "-")}</dd></div><div><dt>Phone / reference</dt><dd>${esc(o.phone)}</dd></div>
      <div><dt>Package</dt><dd>${esc(o.packageName)} (${esc(o.dataLabel || "")})</dd></div><div><dt>Amount</dt><dd>${money(o.price)}</dd></div>
      <div><dt>Status</dt><dd>${esc(lbl)}</dd></div><div><dt>Ordered</dt><dd>${fmtDT(o.createdAt)}</dd></div></dl>` +
    (slip ? `<img class="slip" src="${esc(slip)}" alt="Payment slip">` : (o.status === "payment_pending" ? `<p class="muted" style="margin-bottom:14px">No slip image found.</p>` : ""));
  const fields = o.status === "cancelled" ? [] : [
    { key: "packageType", label: "Package type (badge)" }, { key: "serverName", label: "Server", placeholder: "Singapore • SG-03" },
    { key: "protocol", label: "Protocol" }, { key: "configLink", label: "Config link", hint: "https://... page, or vless:// vmess:// trojan:// link" },
    { key: "dataTotalGB", label: "Total data (GB)", type: "number", hint: "0 = Unlimited" },
    { key: "dataUsedGB", label: "Used data (GB)", type: "number" },
    { key: "validityDays", label: "Validity (days)", type: "number" },
    { key: "expiryDate", label: "Expiry date", type: "date" }
  ];
  const detail = (v) => {
    if (!v.expiryDate) throw new Error("Choose an expiry date");
    return {
      packageType: v.packageType || "GB PACKAGE", serverName: v.serverName, protocol: v.protocol || "V2RAY", configLink: v.configLink,
      dataTotalGB: v.dataTotalGB ?? 0, dataUsedGB: v.dataUsedGB ?? 0, validityDays: v.validityDays ?? 0, expiryDate: dateToTs(v.expiryDate, true)
    };
  };
  const ref = doc(db, "orders", o.id);
  const cancel = { label: o.status === "active" ? "Deactivate" : "Cancel order", kind: "danger", onClick: async () => {
    if (!(await askConfirm(o.status === "active" ? "Deactivate package?" : "Cancel this order?", "The customer will see it as cancelled."))) return false;
    await updateDoc(ref, { status: "cancelled", cancelledAt: serverTimestamp() }); toast("Order cancelled");
  } };
  const buttons = o.status === "cancelled" ? [{ label: "Close", kind: "ghost", onClick: () => {} }]
    : o.status === "active" ? [{ label: "Save changes", onClick: async (v) => { await updateDoc(ref, detail(v)); toast("Saved"); } }, cancel]
    : [{ label: "Activate", onClick: async (v) => { await updateDoc(ref, { ...detail(v), status: "active", activatedAt: serverTimestamp() }); toast("Package activated"); } }, cancel];
  openForm({ title: o.packageName, intro, fields, values, buttons });
}

/* ================= USERS ================= */
const U_STATUS = { pending: ["Pending", "c-orange"], active: ["Active", "c-green"], blocked: ["Blocked", "c-red"] };
const U_FILTERS = [["pending", "Pending"], ["active", "Active"], ["blocked", "Blocked"], ["all", "All"]];

function listenUsers() {
  unsubs.users && unsubs.users();
  state.loaded.users = false;
  const col = collection(db, "users");
  const q = state.uFilter === "all" ? query(col, orderBy("createdAt", "desc"), limit(100)) : query(col, where("status", "==", state.uFilter), limit(100));
  unsubs.users = onSnapshot(q, (s) => {
    state.users = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    state.loaded.users = true;
    if (state.tab === "users") render();
  }, (e) => { console.error(e); state.loaded.users = true; toast("Could not load users: " + e.code); if (state.tab === "users") render(); });
}

function userRow(u) {
  const [lbl, cls] = U_STATUS[u.status] || [u.status, "c-gray"];
  return `<div class="row-card" data-open="${esc(u.id)}"><div class="rc-main"><b>${esc(u.name || "-")}</b>
    <span>${esc(u.phone)} • ${esc(u.provider || "")}</span><small>${fmtDT(u.createdAt)}</small></div>
    <div class="rc-side"><span class="chip ${cls}">${lbl}</span>${u.passcodeHash ? "" : '<span class="chip c-gray">No passcode</span>'}</div></div>`;
}

function renderUsers(c) {
  const q = state.search.trim().toLowerCase();
  c.innerHTML = chipsHTML(U_FILTERS, state.uFilter, "data-uf") +
    `<input class="input" id="search" placeholder="Search phone or name" value="${esc(state.search)}"><div id="rows" class="rows"></div>`;
  bindSearch(c);
  c.querySelectorAll("[data-uf]").forEach((b) => (b.onclick = () => { state.uFilter = b.dataset.uf; listenUsers(); render(); }));
  const box = $("rows");
  box.onclick = (e) => { const r = e.target.closest("[data-open]"); if (r) editUser(state.users.find((u) => u.id === r.dataset.open)); };
  if (!state.loaded.users) { box.innerHTML = skeletons(); return; }
  const rows = state.users.filter((u) => !q || String(u.phone).includes(q) || String(u.name || "").toLowerCase().includes(q));
  fill(box, rows.length ? rows.map(userRow) : ['<div class="empty">No users here.</div>'], "users:" + state.uFilter);
}

const USER_STATUS_OPTS = [{ value: "pending", label: "Pending (waiting for PIN)" }, { value: "active", label: "Active" }, { value: "blocked", label: "Blocked" }];
const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));

function editUser(u) {
  if (!u) return;
  const ref = doc(db, "users", u.id);
  openForm({
    title: u.name || u.phone,
    intro: `<dl class="info"><div><dt>Phone (login ID)</dt><dd>${esc(u.phone)}</dd></div><div><dt>Provider</dt><dd>${esc(u.provider || "-")}</dd></div>
      <div><dt>Registered</dt><dd>${fmtDT(u.createdAt)}</dd></div><div><dt>Passcode</dt><dd>${u.passcodeHash ? "Set" : "Not set"}</dd></div></dl>`,
    fields: [
      { key: "name", label: "Name" },
      { key: "status", label: "Status", type: "select", options: USER_STATUS_OPTS, hint: "Pending users become Active when they enter the PIN below, or set Active here." },
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
        await updateDoc(ref, data); toast("Saved");
      } },
      { label: "New PIN", kind: "ghost", onClick: (v, ctx) => { ctx.set("pin", randomPin()); return false; } },
      { label: "Reset passcode", kind: "danger", onClick: async () => {
        if (!(await askConfirm("Reset passcode?", "The customer will create a new passcode at next login.", "Reset"))) return false;
        await updateDoc(ref, { passcodeHash: deleteField() }); toast("Passcode reset");
      } }
    ]
  });
}

function addUser() {
  openForm({
    title: "Add user",
    fields: [
      { key: "name", label: "Name" },
      { key: "phone", label: "Phone number", type: "tel", placeholder: "0771234567" },
      { key: "status", label: "Status", type: "select", options: USER_STATUS_OPTS },
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
    } }]
  });
}

/* ================= PACKAGES / OFFERS / BANNERS ================= */
const bySort = (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0);
function listCard(thumb, title, sub, chips, id) {
  return `<div class="row-card" data-open="${esc(id)}">${thumb ? `<img class="rc-thumb" src="${esc(thumb)}" alt="">` : ""}
    <div class="rc-main" style="flex:1"><b>${esc(title)}</b><span>${esc(sub)}</span></div><div class="rc-side">${chips}</div></div>`;
}
const activeChip = (a) => `<span class="chip ${a === false ? "c-gray" : "c-green"}">${a === false ? "Hidden" : "Live"}</span>`;

function renderPackages(c) {
  c.innerHTML = '<div id="rows" class="rows"></div>';
  const box = $("rows");
  box.onclick = (e) => { const r = e.target.closest("[data-open]"); if (r) editPackage(state.packages.find((p) => p.id === r.dataset.open)); };
  if (!state.loaded.packages) { box.innerHTML = skeletons(); return; }
  const items = [...state.packages].sort(bySort);
  fill(box, items.length ? items.map((p) => listCard(null, p.name, `${p.dataLabel || (p.dataGB ? p.dataGB + " GB" : "")} • ${p.validityDays || 0} days • ${(p.providers || []).join(", ")}`,
    `<b>${money(p.price)}</b>${activeChip(p.active)}`, p.id)) : ['<div class="empty">No packages yet. Tap + to add one.</div>'], "packages");
}
function editPackage(p) {
  const isNew = !p;
  crud("packages", p, "Package", [
    { key: "name", label: "Package name", placeholder: "Stranger 50 GB" },
    { key: "dataLabel", label: "Data label", placeholder: "50 GB (or Unlimited)" },
    { key: "dataGB", label: "Data (GB)", type: "number", hint: "0 = Unlimited" },
    { key: "validityDays", label: "Validity (days)", type: "number" },
    { key: "price", label: "Price (LKR)", type: "number" },
    { key: "description", label: "Description", type: "textarea" },
    { key: "providers", label: "Show to these providers", type: "multi", options: PROVIDERS },
    { key: "popular", label: "Mark as popular", type: "bool" },
    { key: "active", label: "Visible to customers", type: "bool" },
    { key: "sortOrder", label: "Sort order", type: "number", hint: "Smaller number shows first" }
  ], p ? p : { active: true, providers: ["dialog", "airtel", "hutch", "mobitel"], validityDays: 30, sortOrder: state.packages.length + 1 }, (v) => {
    if (!v.name) throw new Error("Enter a package name");
    if (v.price === null) throw new Error("Enter the price");
    if (!v.providers.length) throw new Error("Select at least one provider");
    if (v.dataLabel === "" ) v.dataLabel = v.dataGB ? v.dataGB + " GB" : "Unlimited";
    return v;
  });
}

function renderOffers(c) {
  c.innerHTML = '<div id="rows" class="rows"></div>';
  const box = $("rows");
  box.onclick = (e) => { const r = e.target.closest("[data-open]"); if (r) editOffer(state.offers.find((o) => o.id === r.dataset.open)); };
  if (!state.loaded.offers) { box.innerHTML = skeletons(); return; }
  const items = [...state.offers].sort(bySort);
  fill(box, items.length ? items.map((o) => listCard(o.imageUrl, o.title, `${(o.providers || ["all"]).join(", ")}${o.minOrders ? " • " + o.minOrders + "+ orders" : ""}`,
    activeChip(o.active), o.id)) : ['<div class="empty">No offers yet. Tap + to add one.</div>'], "offers");
}
function editOffer(o) {
  const cur = o ? { ...o, startDate: o.startDate ? ymd(toDate(o.startDate)) : "", endDate: o.endDate ? ymd(toDate(o.endDate)) : "" }
    : { active: true, providers: ["all"], minOrders: 0, sortOrder: state.offers.length + 1 };
  crud("offers", o, "Offer", [
    { key: "imageUrl", label: "Offer image", type: "image" },
    { key: "title", label: "Title" },
    { key: "buttonText", label: "Button text", placeholder: "Get offer" },
    { key: "link", label: "Button link", placeholder: "package.html" },
    { key: "providers", label: "Show to", type: "multi", options: [{ value: "all", label: "Everyone" }, ...PROVIDERS], hint: "Tick Everyone, or only the providers that should see it." },
    { key: "minOrders", label: "Minimum completed orders", type: "number", hint: "0 = no minimum (e.g. 20 = only customers with 20+ active orders)" },
    { key: "startDate", label: "Start date (optional)", type: "date" },
    { key: "endDate", label: "End date (optional)", type: "date" },
    { key: "active", label: "Visible to customers", type: "bool" },
    { key: "sortOrder", label: "Sort order", type: "number" }
  ], cur, (v) => {
    if (!v.title) throw new Error("Enter a title");
    if (!v.providers.length) v.providers = ["all"];
    v.minOrders = v.minOrders || 0;
    v.startDate = dateToTs(v.startDate, false); v.endDate = dateToTs(v.endDate, true);
    return v;
  });
}

function renderBanners(c) {
  c.innerHTML = '<div id="rows" class="rows"></div>';
  const box = $("rows");
  box.onclick = (e) => { const r = e.target.closest("[data-open]"); if (r) editBanner(state.banners.find((x) => x.id === r.dataset.open)); };
  if (!state.loaded.banners) { box.innerHTML = skeletons(); return; }
  const items = [...state.banners].sort(bySort);
  fill(box, items.length ? items.map((b) => listCard(b.imageUrl, b.title, b.subtitle || "", activeChip(b.active), b.id)) : ['<div class="empty">No banners yet. Tap + to add one.</div>'], "banners");
}
function editBanner(b) {
  crud("banners", b, "Banner", [
    { key: "imageUrl", label: "Banner image", type: "image" },
    { key: "title", label: "Title" },
    { key: "subtitle", label: "Sub paragraph", type: "textarea" },
    { key: "buttonText", label: "Button text" },
    { key: "link", label: "Button link", placeholder: "package.html" },
    { key: "active", label: "Visible to customers", type: "bool" },
    { key: "sortOrder", label: "Sort order", type: "number" }
  ], b || { active: true, sortOrder: state.banners.length + 1 }, (v) => {
    if (!v.title) throw new Error("Enter a title");
    return v;
  });
}

// shared add / edit / delete for catalog collections
function crud(col, item, noun, fields, values, validate) {
  const buttons = [{ label: item ? "Save" : "Add " + noun.toLowerCase(), onClick: async (v) => {
    const data = prepare(validate(v), !item);
    if (item) await updateDoc(doc(db, col, item.id), data);
    else await addDoc(collection(db, col), { ...data, createdAt: serverTimestamp() });
    toast(noun + " saved");
  } }];
  if (item) buttons.push({ label: "Delete", kind: "danger", onClick: async () => {
    if (!(await askConfirm("Delete " + noun.toLowerCase() + "?", "This cannot be undone. Hide it instead if you may need it later.", "Delete"))) return false;
    await deleteDoc(doc(db, col, item.id)); toast("Deleted");
  } });
  openForm({ title: item ? "Edit " + noun.toLowerCase() : "New " + noun.toLowerCase(), fields, values, buttons });
}

/* ================= auth + start ================= */
// Login happens on the Home page (index.html). Anyone not signed in as an admin is sent back there.
onAuthStateChanged(auth, async (user) => {
  baseUnsubs.forEach((u) => u()); baseUnsubs = [];
  Object.values(unsubs).forEach((u) => u && u()); unsubs = { orders: null, users: null };
  if (!user) return location.replace("index.html");
  try {
    const adm = await getDoc(doc(db, "admins", user.uid));
    if (!adm.exists()) { await signOut(auth); return location.replace("index.html"); }
  } catch (e) {
    console.error(e);
    $("boot").innerHTML = '<p class="muted" style="padding:24px;text-align:center">Could not verify admin access ('+ esc(e.code || e.message) +').<br><a href="index.html">Back to Home</a></p>';
    return;
  }
  $("boot").hidden = true; $("app").hidden = false;
  startBase();
  const t = location.hash.slice(1);
  setTab(TITLES[t] ? t : "orders");
});

function startBase() {
  const watch = (col, key) => baseUnsubs.push(onSnapshot(collection(db, col), (s) => {
    state[key] = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.loaded[key] = true;
    if (state.tab === key) render();
  }, (e) => { console.error(e); state.loaded[key] = true; toast("Could not load " + col + ": " + e.code); if (state.tab === key) render(); }));
  watch("packages", "packages"); watch("offers", "offers"); watch("banners", "banners");
  const badge = (col, id) => baseUnsubs.push(onSnapshot(query(collection(db, col), where("status", "==", col === "orders" ? "payment_pending" : "pending"), limit(50)), (s) => {
    $(id).hidden = !s.size; $(id).textContent = s.size;
  }));
  badge("orders", "b-orders"); badge("users", "b-users");
}
