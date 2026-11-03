// firebase-init.js  (shared by every page)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, collection,
  query, where, getDocs, onSnapshot, serverTimestamp, orderBy, limitToLast, limit, startAfter, getCountFromServer, deleteDoc, arrayUnion, writeBatch
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

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export {
  doc, getDoc, setDoc, addDoc, updateDoc, collection,
  query, where, getDocs, onSnapshot, serverTimestamp, orderBy, limitToLast, limit, startAfter, getCountFromServer, deleteDoc, arrayUnion, writeBatch
};

/* ---------- small utilities ---------- */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const toDate = (v) => (!v ? null : v.toDate ? v.toDate() : new Date(v));
export const money = (n) => "LKR " + Number(n || 0).toLocaleString("en-LK");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- phone + provider ---------- */
// Accepts 0771234567, 771234567, +94771234567  ->  0771234567
export function normPhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("94") && d.length === 11) d = "0" + d.slice(2);
  if (d.length === 9) d = "0" + d;
  return d;
}
export const isValidPhone = (d) => /^07\d{8}$/.test(d);

const PROVIDER_PREFIX = {
  dialog: ["77", "76"],
  airtel: ["75"],
  hutch: ["78", "72"],
  mobitel: ["71", "70"]
};
export const PROVIDER_LABEL = { dialog: "Dialog", airtel: "Airtel", hutch: "Hutch", mobitel: "Mobitel" };
export function providerOf(phone) {
  const p = String(phone).slice(1, 3);
  for (const [name, list] of Object.entries(PROVIDER_PREFIX)) if (list.includes(p)) return name;
  return null;
}

/* ---------- session (phone number kept on this device) ---------- */
export const getSession = () => localStorage.getItem("reeh_phone");
export const setSession = (phone) => localStorage.setItem("reeh_phone", phone);
export const clearSession = () => localStorage.removeItem("reeh_phone");

/* ---------- branding (logo + app name from Firebase) ---------- */
export async function loadBranding() {
  const fallback = { appName: "Reeh Cloud", logoUrl: "", notificationLink: "#" };
  try {
    const snap = await getDoc(doc(db, "settings", "app"));
    return snap.exists() ? { ...fallback, ...snap.data() } : fallback;
  } catch (e) {
    console.error(e);
    return fallback;
  }
}
export function logoHTML(brand, cls = "logo") {
  return brand.logoUrl
    ? `<img class="${cls}" src="${esc(brand.logoUrl)}" alt="">`
    : `<span class="${cls} logo-fallback">${esc((brand.appName || "R").charAt(0))}</span>`;
}

/* ---------- toast + modal ---------- */
export function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2400);
}

// Message box. Resolves true (OK) or false (Cancel). Pass cancelText = null for a single OK button.
export function confirmBox({ title, message, okText = "OK", cancelText = null }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div class="modal-actions">
          ${cancelText ? `<button class="btn btn-ghost" data-r="0">${esc(cancelText)}</button>` : ""}
          <button class="btn btn-primary" data-r="1">${esc(okText)}</button>
        </div>
      </div>`;
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-r]");
      if (!b) return;
      wrap.remove();
      resolve(b.dataset.r === "1");
    });
    document.body.appendChild(wrap);
    wrap.querySelector("[data-r='1']").focus();
  });
}

/* ---------- selection box + text box (used by Profile) ---------- */
// options: [{label, value, kind: "primary" | "ghost" | "danger"}]  -> resolves the chosen value, or null on cancel
export function choiceBox({ title, message = "", options, cancelText = "Cancel" }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ""}
        <div class="stack">
          ${options.map((o, i) => `<button class="btn btn-${o.kind || "ghost"}" data-i="${i}">${esc(o.label)}</button>`).join("")}
          <button class="btn btn-plain" data-i="-1">${esc(cancelText)}</button>
        </div>
      </div>`;
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (!b) return;
      wrap.remove();
      const i = Number(b.dataset.i);
      resolve(i < 0 ? null : options[i].value);
    });
    document.body.appendChild(wrap);
  });
}

// Resolves the trimmed text, or null on cancel.
export function inputBox({ title, message = "", value = "", placeholder = "", okText = "Save", cancelText = "Cancel", multiline = false, maxLength = 60 }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ""}
        ${multiline
          ? `<textarea class="input" rows="4" maxlength="${maxLength}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
          : `<input class="input" type="text" maxlength="${maxLength}" placeholder="${esc(placeholder)}" value="${esc(value)}">`}
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn btn-ghost" data-r="0">${esc(cancelText)}</button>
          <button class="btn btn-primary" data-r="1">${esc(okText)}</button>
        </div>
      </div>`;
    const field = wrap.querySelector(".input");
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-r]");
      if (!b) return;
      const v = field.value.trim();
      wrap.remove();
      resolve(b.dataset.r === "1" ? v : null);
    });
    document.body.appendChild(wrap);
    field.focus();
  });
}

/* ---------- passcode hashing (the raw passcode is never stored) ---------- */
export async function hashPass(phone, code) {
  const data = new TextEncoder().encode(`reeh:${phone}:${code}`);
  const buf = await crypto.subtle.digest("SHA-256", data); // needs HTTPS
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}


/* ---------- progressive loading: one small page at a time, shown one by one ---------- */
export function makePager(baseQuery, size = 3) {
  let last = null, done = false;
  return {
    get done() { return done; },
    async next() {
      if (done) return [];
      const s = await getDocs(last ? query(baseQuery, startAfter(last), limit(size)) : query(baseQuery, limit(size)));
      if (s.docs.length < size) done = true;
      if (s.docs.length) last = s.docs[s.docs.length - 1];
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  };
}
// fetches page 1, shows it, then fetches page 2, and so on (never everything in one request)
export async function streamPages(baseQuery, size, onPage) {
  const p = makePager(baseQuery, size);
  while (!p.done) {
    const page = await p.next();
    if (!page.length) break;
    if ((await onPage(page)) === false) break;
  }
}
export async function appendOneByOne(box, items, htmlFn, delay = 110) {
  for (const it of items) {
    box.insertAdjacentHTML("beforeend", htmlFn(it));
    box.lastElementChild.classList.add("reveal");
    await sleep(delay);
  }
}


// Cloudinary pictures: ask for a smaller, optimised copy (other links are returned unchanged)
export function thumb(url, w = 480) {
  const u = String(url || "");
  return u.includes("res.cloudinary.com") && u.includes("/upload/") && !/\/upload\/[a-z]_/.test(u)
    ? u.replace("/upload/", `/upload/f_auto,q_auto,w_${w}/`) : u;
}
