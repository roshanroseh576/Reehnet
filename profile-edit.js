// profile-edit.js - photo, name (once every 7 days), phone number (cannot be changed), logout
import { db, doc, getDoc, onSnapshot, esc, getSession, toast } from "./firebase-init.js";
import { photoMenu, editName, logout, doLogout } from "./profile-shared.js";

const $ = (id) => document.getElementById(id);
const phone = getSession();
if (!phone) location.replace("index.html");

const userRef = doc(db, "users", phone || "x");
let user = {};

$("back").onclick = () => (history.length > 1 ? history.back() : (location.href = "profile.html"));

function render(snap) {
  if (!snap.exists() || snap.data().status === "blocked") return doLogout();
  user = snap.data();
  $("e-name").textContent = user.name || "-";
  $("e-phone").textContent = phone;
  $("avatar").innerHTML = (user.photoUrl || user.photoBase64)
    ? `<img src="${esc((user.photoUrl || user.photoBase64))}" alt="">`
    : `<span>${esc((user.name || "R").charAt(0).toUpperCase())}</span>`;
}

function init() {
  getDoc(userRef).then(render).catch((e) => { console.error(e); toast("Could not load your profile (" + (e.code || e.message) + ")"); });
  onSnapshot(userRef, render, (e) => console.error("profile listener", e));

  $("avatar").onclick = () => photoMenu(userRef, user);
  $("edit-photo").onclick = () => photoMenu(userRef, user);
  $("row-name").onclick = () => editName(userRef, user);
  $("row-phone").onclick = () => toast("Your phone number is your login ID and cannot be changed");
  $("logout").onclick = logout;
}

// start the page only after every function and constant above is defined
init();
