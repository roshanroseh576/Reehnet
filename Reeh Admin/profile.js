// profile.js - photo (base64), name (7-day limit), extra details, menu links, logout
import {
  db, doc, getDoc, updateDoc, collection, getDocs, onSnapshot, serverTimestamp,
  esc, toDate, sleep, getSession,
  toast, confirmBox, choiceBox, inputBox
} from "./firebase-init.js";

const $ = (id) => document.getElementById(id);
const phone = getSession();
if (!phone) location.replace("index.html");

const userRef = doc(db, "users", phone || "x");
const NAME_LOCK_DAYS = 7;
let user = {};

$("back").onclick = () => (history.length > 1 ? history.back() : (location.href = "index.html"));

init();

async function init() {
  // live profile data
  onSnapshot(userRef, (s) => {
    if (!s.exists() || s.data().status === "blocked") return doLogout();
    user = s.data();
    $("p-name").textContent = user.name || "-";
    $("p-phone").textContent = phone;
    const av = $("avatar");
    av.innerHTML = user.photoBase64
      ? `<img src="${esc(user.photoBase64)}" alt="">`
      : `<span>${esc((user.name || "R").charAt(0).toUpperCase())}</span>`;
    $("extra").textContent = user.extraDetails || "Nothing added yet.";
    $("extra").classList.toggle("filled", !!user.extraDetails);
  });

  $("avatar").onclick = photoMenu;
  $("name-btn").onclick = editName;
  $("extra-edit").onclick = editExtra;
  $("logout").onclick = logout;

  loadNav();
  loadMenu();
  loadMore();
}

/* ============ profile photo ============ */
async function photoMenu() {
  if (!user.photoBase64) return pickSource();
  const act = await choiceBox({
    title: "Profile photo",
    options: [
      { label: "Change profile", value: "change", kind: "primary" },
      { label: "Remove profile", value: "remove", kind: "danger" }
    ]
  });
  if (act === "change") return pickSource();
  if (act === "remove") {
    const yes = await confirmBox({ title: "Remove profile?", message: "Are you sure you want to remove your profile photo?", okText: "Yes", cancelText: "No" });
    if (yes) {
      await updateDoc(userRef, { photoBase64: "" });
      toast("Profile photo removed");
    }
  }
}

async function pickSource() {
  const src = await choiceBox({
    title: "Profile photo",
    options: [
      { label: "Camera", value: "cam", kind: "primary" },
      { label: "Gallery", value: "gal", kind: "ghost" }
    ]
  });
  if (src === "cam" && (await ensureCamera())) $("cam").click();
  if (src === "gal") $("gal").click(); // browsers have no gallery permission: the picker opens directly
}

// Opens straight away if already allowed, otherwise asks first.
async function ensureCamera() {
  if (localStorage.getItem("reeh_cam_ok")) return true;
  try {
    const st = await navigator.permissions.query({ name: "camera" });
    if (st.state === "granted") { localStorage.setItem("reeh_cam_ok", "1"); return true; }
    if (st.state === "denied") {
      await confirmBox({ title: "Camera blocked", message: "Camera access is blocked. Allow it in your browser's site settings.", okText: "OK" });
      return false;
    }
  } catch (e) { /* permission query not supported: ask below */ }
  const ok = await confirmBox({ title: "Allow camera", message: "Reeh Cloud needs camera access to take your photo.", okText: "Allow", cancelText: "Cancel" });
  if (!ok) return false;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
    localStorage.setItem("reeh_cam_ok", "1");
    return true;
  } catch (e) {
    await confirmBox({ title: "Camera not allowed", message: "Camera access was not allowed.", okText: "OK" });
    return false;
  }
}

["cam", "gal"].forEach((id) => ($(id).onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = await squareBase64(file);
    if (await previewBox(data)) {
      const had = !!user.photoBase64;
      await updateDoc(userRef, { photoBase64: data });
      await confirmBox({ title: "Successful", message: had ? "Profile photo changed successfully." : "Profile photo added successfully.", okText: "OK" });
    }
  } catch (err) {
    console.error(err);
    toast("Could not use that photo.");
  }
}));

// centre-crop to a 400x400 JPEG so it stays small in Firestore
function squareBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = 400;
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 400, 400);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => reject(new Error("bad_image"));
    img.src = url;
  });
}

function previewBox(src) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<div class="modal"><h3>Save this photo?</h3>
      <img class="preview-img" src="${src}" alt="">
      <div class="modal-actions"><button class="btn btn-ghost" data-r="0">Cancel</button><button class="btn btn-primary" data-r="1">Save</button></div></div>`;
    wrap.onclick = (e) => {
      const b = e.target.closest("button[data-r]");
      if (!b) return;
      wrap.remove();
      resolve(b.dataset.r === "1");
    };
    document.body.appendChild(wrap);
  });
}

/* ============ name (once every 7 days) ============ */
async function editName() {
  const last = toDate(user.nameChangedAt);
  if (last) {
    const left = NAME_LOCK_DAYS - (Date.now() - last.getTime()) / 86400000;
    if (left > 0) {
      const d = Math.ceil(left);
      return confirmBox({
        title: "Name locked",
        message: `You can change your name only once every ${NAME_LOCK_DAYS} days. Try again in ${d} day${d > 1 ? "s" : ""}.`,
        okText: "OK"
      });
    }
  }
  const name = await inputBox({ title: "Edit name", message: `You can change your name once every ${NAME_LOCK_DAYS} days.`, value: user.name || "", placeholder: "Your name", okText: "Change", maxLength: 40 });
  if (name === null) return;                 // Cancel: nothing changes
  if (name.length < 2) return toast("Enter a valid name");
  if (name === user.name) return;
  try {
    await updateDoc(userRef, { name, nameChangedAt: serverTimestamp() });
    await confirmBox({ title: "Successful", message: `Your name was changed successfully. You can change it again only after ${NAME_LOCK_DAYS} days.`, okText: "OK" });
  } catch (e) { console.error(e); toast("Could not change the name."); }
}

/* ============ extra details (change any time) ============ */
async function editExtra() {
  const text = await inputBox({ title: "Extra details", message: "Add anything you want us to know.", value: user.extraDetails || "", placeholder: "e.g. email, address", multiline: true, maxLength: 300, okText: "Save" });
  if (text === null) return;
  try {
    await updateDoc(userRef, { extraDetails: text });
    toast("Saved");
  } catch (e) { console.error(e); toast("Could not save."); }
}

/* ============ menu links (loaded one by one) ============ */
async function loadList(collectionName, box, placeholders = false) {
  try {
    const snap = await getDocs(collection(db, collectionName));
    const items = snap.docs.map((d) => d.data()).filter((m) => m.active !== false)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    if (placeholders) box.innerHTML = ""; // remove grey placeholders
    if (!items.length && placeholders) box.closest("section").hidden = true;
    for (const m of items) {
      const ico = /^(https?:|data:)/.test(m.icon || "") ? `<img src="${esc(m.icon)}" alt="">` : esc(m.icon || "🔗");
      box.insertAdjacentHTML("beforeend",
        `<a class="menu-item" href="${esc(m.link || "#")}"><span class="m-ico">${ico}</span><span class="m-title">${esc(m.title)}</span><span class="chev">›</span></a>`);
      await sleep(130);
    }
  } catch (e) {
    console.error(e);
    if (placeholders) box.closest("section").hidden = true;
  }
}
const loadMenu = () => loadList("profileLinks", $("menu"));
const loadMore = () => loadList("moreLinks", $("more-list"), true);

/* ============ bottom nav (links from Firebase: settings/nav) ============ */
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

/* ============ logout ============ */
async function logout() {
  const yes = await confirmBox({ title: "Log out?", message: "Are you sure you want to log out?", okText: "Yes", cancelText: "No" });
  if (yes) doLogout();
}
function doLogout() {
  // clears the session and the saved permission steps, so the app starts again from the beginning
  localStorage.clear();
  sessionStorage.clear();
  location.replace("index.html");
}
