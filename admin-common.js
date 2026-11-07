// admin-common.js - shared by users / offers / banners / settings pages
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, deleteField, collection,
  query, where, orderBy, limit, startAfter, documentId, serverTimestamp, Timestamp, writeBatch, onSnapshot, limitToLast
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
export const auth = getAuth(app);
export const db = getFirestore(app);
export {
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, deleteField, collection,
  query, where, orderBy, limit, startAfter, documentId, serverTimestamp, Timestamp, writeBatch, onSnapshot, limitToLast
};

/* ================= helpers ================= */
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const toDate = (v) => (!v ? null : v.toDate ? v.toDate() : new Date(v));
export const ymd = (d) => d.toLocaleDateString("en-CA");
export const fmtDT = (v) => { const d = toDate(v); return d ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""; };
export const money = (n) => "LKR " + Number(n || 0).toLocaleString("en-LK");
export const PROVIDERS = [{ value: "dialog", label: "Dialog" }, { value: "airtel", label: "Airtel" }, { value: "hutch", label: "Hutch" }, { value: "mobitel", label: "Mobitel" }];
export const providerOf = (p) => ({ 77: "dialog", 76: "dialog", 75: "airtel", 78: "hutch", 72: "hutch", 71: "mobitel", 70: "mobitel" }[String(p).slice(1, 3)] || "unknown");
export const normPhone = (v) => { let d = String(v || "").replace(/\D/g, ""); if (d.startsWith("94") && d.length === 11) d = "0" + d.slice(2); if (d.length === 9) d = "0" + d; return d; };
export const dateToTs = (s, end) => (s ? Timestamp.fromDate(new Date(s + (end ? "T23:59:00" : "T00:00:00"))) : null);
export const bySort = (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0);
export const skelRows = (n = 4) => Array.from({ length: n }, () => '<div class="skel-row"></div>').join("");
export const iconPreview = (icon) => /^(https?:|data:)/.test(icon || "") ? `<img src="${esc(icon)}" alt="">` : esc(icon || "🔗");

export function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

export function askConfirm(title, message, okText = "Yes") {
  return new Promise((resolve) => {
    const w = document.createElement("div");
    w.className = "confirm";
    w.innerHTML = `<div class="box"><h3>${esc(title)}</h3><p>${esc(message)}</p>
      <div class="acts"><button class="btn btn-ghost" data-r="0">No</button><button class="btn btn-danger" data-r="1">${esc(okText)}</button></div></div>`;
    w.onclick = (e) => { const b = e.target.closest("[data-r]"); if (b) { w.remove(); resolve(b.dataset.r === "1"); } };
    document.body.appendChild(w);
  });
}

// pick one of several actions. options: [{label, value, kind}] -> value or null
export function choose(title, message, options) {
  return new Promise((resolve) => {
    const w = document.createElement("div");
    w.className = "confirm";
    w.innerHTML = `<div class="box"><h3>${esc(title)}</h3><p>${esc(message)}</p>
      <div style="display:grid;gap:10px">${options.map((o, i) => `<button class="btn btn-${o.kind || "ghost"}" data-i="${i}">${esc(o.label)}</button>`).join("")}
      <button class="btn btn-ghost" data-i="-1">Cancel</button></div></div>`;
    w.onclick = (e) => { const b = e.target.closest("[data-i]"); if (b) { w.remove(); const i = Number(b.dataset.i); resolve(i < 0 ? null : options[i].value); } };
    document.body.appendChild(w);
  });
}

/* image -> small data URL stored in the document. mime "image/png" keeps transparency (logos). */
export function imageToDataUrl(file, maxW = 900, mime = "image/jpeg", maxChars = 450000) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = 0.75, out = c.toDataURL(mime, q);
      if (mime === "image/jpeg") while (out.length > maxChars && q > 0.3) { q -= 0.08; out = c.toDataURL(mime, q); }
      out.length > Math.max(maxChars * 1.6, 300000) ? reject(new Error("Image too large. Use a smaller image.")) : resolve(out);
    };
    img.onerror = () => reject(new Error("Could not read the image."));
    img.src = url;
  });
}

/* ================= page start: admin check, header, title from Firebase ================= */
// Pages: users, offers, banners, settings. The header title comes from settings/adminPages (field = page key).
export async function initPage(key, fallbackTitle) {
  $("back").onclick = () => (history.length > 1 ? history.back() : (location.href = "index.html"));
  const user = await new Promise((resolve) => {
    const off = onAuthStateChanged(auth, async (u) => {
      off();
      if (!u) return location.replace("index.html");
      try {
        if (!(await getDoc(doc(db, "admins", u.uid))).exists()) { await signOut(auth); return location.replace("index.html"); }
      } catch (e) {
        console.error(e);
        $("boot").innerHTML = `<p class="muted" style="padding:24px;text-align:center">Could not verify admin access (${esc(e.code || e.message)}).<br><a href="index.html">Back to Home</a></p>`;
        return;
      }
      resolve(u);
    });
  });
  $("boot").hidden = true; $("page").hidden = false;
  $("title").innerHTML = '<span class="title-ph"></span>';
  getDoc(doc(db, "settings", "adminPages"))
    .then((s) => ($("title").textContent = (s.exists() && s.data()[key]) || fallbackTitle))
    .catch(() => ($("title").textContent = fallbackTitle));
  document.title = fallbackTitle;
  return user;
}

/* ================= paging: one page at a time, shown one by one ================= */
// baseQuery must end with orderBy(documentId()) so paging works without extra indexes.
export function makePager(baseQuery, size = 10) {
  let last = null, done = false;
  return {
    get done() { return done; },
    reset() { last = null; done = false; },
    async next() {
      if (done) return [];
      const s = await getDocs(last ? query(baseQuery, startAfter(last), limit(size)) : query(baseQuery, limit(size)));
      if (s.docs.length < size) done = true;
      if (s.docs.length) last = s.docs[s.docs.length - 1];
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  };
}

export async function appendOneByOne(box, items, htmlFn, delay = 90) {
  for (const it of items) {
    box.insertAdjacentHTML("beforeend", htmlFn(it));
    box.lastElementChild.classList.add("rise");
    await sleep(delay);
  }
}

/* ================= form sheet ================= */
function fieldHTML(f, v) {
  const id = "f_" + f.key, label = `<span>${esc(f.label)}</span>`, hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : "";
  switch (f.type) {
    case "textarea": return `<label class="field">${label}<textarea class="input" id="${id}" rows="3">${esc(v ?? "")}</textarea>${hint}</label>`;
    case "select": return `<label class="field">${label}<select class="input" id="${id}">${f.options.map((o) =>
      `<option value="${esc(o.value)}" ${String(v) === String(o.value) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>${hint}</label>`;
    case "bool": return `<label class="check"><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${esc(f.label)}</label>`;
    case "multi": return `<div class="field">${label}<div class="multi" id="${id}">${f.options.map((o) =>
      `<label class="check"><input type="checkbox" value="${esc(o.value)}" ${(v || []).includes(o.value) ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}</div>${hint}</div>`;
    case "image": {
      const isData = String(v || "").startsWith("data:");
      const isImg = isData || /^https?:/.test(v || "");
      return `<div class="field">${label}<div class="imgfield">
        <img id="${id}_prev" alt="" ${isImg ? `src="${esc(v)}"` : "hidden"}>
        <input class="input" id="${id}" type="text" placeholder="${f.emoji ? "Emoji (e.g. 📦) or image URL" : "Paste image URL (https://...)"}" value="${v && !isData ? esc(v) : ""}">
        <div class="row"><button type="button" class="btn btn-ghost btn-sm" data-upload="${f.key}">Upload image</button>
        <button type="button" class="btn btn-danger btn-sm" data-clearimg="${f.key}">Remove</button></div></div>${hint}</div>`;
    }
    default: return `<label class="field">${label}<input class="input" id="${id}" type="${f.type || "text"}" ${f.type === "number" ? 'step="any" inputmode="decimal"' : ""} ${f.readonly ? "readonly" : ""} placeholder="${esc(f.placeholder || "")}" value="${esc(v ?? "")}">${hint}</label>`;
  }
}

// buttons: [{label, kind, onClick(values, ctx)}]. onClick may throw Error(message) or return false to keep the sheet open.
export function openForm({ title, intro = "", fields = [], values = {}, buttons }) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-backdrop";
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="sheet-body">${intro}${fields.map((f) => fieldHTML(f, values[f.key])).join("")}</div>
    <div class="sheet-foot">${buttons.map((b, i) => `<button class="btn btn-${b.kind || "primary"}" data-b="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
  const imgs = {};
  fields.filter((f) => f.type === "image").forEach((f) => (imgs[f.key] = String(values[f.key] || "").startsWith("data:") ? values[f.key] : ""));
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
      const f = fields.find((x) => x.key === up.dataset.upload);
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*";           // phone offers Camera or Gallery
      inp.onchange = async () => {
        if (!inp.files[0]) return;
        const label = up.textContent;
        up.disabled = true;
        try {
          // the picture goes to Cloudinary; Firebase keeps only its link
          const { uploadFile } = await import("./cloudinary.js");
          const r = await uploadFile(inp.files[0], { tag: f.tag || "images", maxW: f.maxW || 1200, mime: f.mime || "image/jpeg", onProgress: (p) => (up.textContent = "Uploading " + p + "%") });
          imgs[f.key] = r.url;
          wrap.querySelector("#f_" + f.key).value = r.url;
          const pv = wrap.querySelector("#f_" + f.key + "_prev"); pv.src = r.url; pv.hidden = false;
          toast("Uploaded");
        } catch (err) { toast(err.message); }
        finally { up.disabled = false; up.textContent = label; }
      };
      return inp.click();
    }
    const clr = e.target.closest("[data-clearimg]");
    if (clr) { const k = clr.dataset.clearimg; imgs[k] = ""; wrap.querySelector("#f_" + k).value = ""; wrap.querySelector("#f_" + k + "_prev").hidden = true; return; }
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

// remove empty values for new docs; turn them into deleteField() for updates
export function prepare(data, isNew) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    const empty = v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length && k !== "providers");
    if (empty) { if (!isNew) out[k] = deleteField(); } else out[k] = v;
  }
  return out;
}

// add / edit / delete for one collection. After any change `onChange()` reloads the list.
export function crudSheet({ col, item, noun, fields, values, validate, onChange }) {
  const buttons = [{ label: item ? "Save" : "Add " + noun.toLowerCase(), onClick: async (v) => {
    const data = prepare(validate(v), !item);
    if (item) await updateDoc(doc(db, col, item.id), data);
    else await addDoc(collection(db, col), { ...data, createdAt: serverTimestamp() });
    toast(noun + " saved"); onChange();
  } }];
  if (item) buttons.push({ label: "Delete", kind: "danger", onClick: async () => {
    if (!(await askConfirm("Delete " + noun.toLowerCase() + "?", "This is removed from Firebase and cannot be undone. Hide it instead if you may need it later.", "Delete"))) return false;
    await deleteDoc(doc(db, col, item.id)); toast("Deleted"); onChange();
  } });
  openForm({ title: item ? "Edit " + noun.toLowerCase() : "New " + noun.toLowerCase(), fields, values, buttons });
}
