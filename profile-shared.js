// profile-shared.js - photo menu (Cloudinary), name change (once every 7 days) and logout, used by profile.html and profile-edit.html
import { updateDoc, serverTimestamp, toDate, toast, confirmBox, choiceBox, inputBox } from "./firebase-init.js";

export const NAME_LOCK_DAYS = 7;

/* ---------------- photo: Camera / Gallery, Change / Remove ---------------- */
export async function photoMenu(userRef, user) {
  if (!(user.photoUrl || user.photoBase64)) return pickSource(userRef, user);
  const act = await choiceBox({
    title: "Profile photo",
    options: [
      { label: "Change profile", value: "change", kind: "primary" },
      { label: "Remove profile", value: "remove", kind: "danger" }
    ]
  });
  if (act === "change") return pickSource(userRef, user);
  if (act === "remove") {
    const yes = await confirmBox({ title: "Remove profile?", message: "Are you sure you want to remove your profile photo?", okText: "Yes", cancelText: "No" });
    if (yes) { await updateDoc(userRef, { photoUrl: "", photoBase64: "" }); toast("Profile photo removed"); }
  }
}

async function pickSource(userRef, user) {
  const src = await choiceBox({
    title: "Profile photo",
    options: [{ label: "Camera", value: "cam", kind: "primary" }, { label: "Gallery", value: "gal", kind: "ghost" }]
  });
  if (!src) return;
  if (src === "cam" && !(await ensureCamera())) return;
  const file = await pickFile(src === "cam");       // browsers have no gallery permission: the picker opens directly
  if (!file) return;
  try {
    const { dataUrl, blob } = await squareImage(file);
    if (await previewBox(dataUrl)) {
      const had = !!(user.photoUrl || user.photoBase64);
      toast("Uploading photo…");
      const { uploadFile } = await import("./cloudinary.js");     // the photo goes to Cloudinary; Firebase keeps only its link
      const up = await uploadFile(new File([blob], "avatar.jpg", { type: "image/jpeg" }), { tag: "avatars", maxW: 400 });
      await updateDoc(userRef, { photoUrl: up.url, photoBase64: "" });
      await confirmBox({ title: "Successful", message: had ? "Profile photo changed successfully." : "Profile photo added successfully.", okText: "OK" });
    }
  } catch (err) { console.error(err); toast(err.message && err.message.length < 90 ? err.message : "Could not use that photo."); }
}

function pickFile(camera) {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    if (camera) inp.setAttribute("capture", "user");
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
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

// centre-crop to a 400x400 JPEG (preview + small upload)
function squareImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = 400;
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 400, 400);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => (blob ? resolve({ dataUrl: c.toDataURL("image/jpeg", 0.85), blob }) : reject(new Error("bad_image"))), "image/jpeg", 0.85);
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
      <img class="preview-img" src="${src}" alt="" style="width:100%;max-height:260px;object-fit:cover;border-radius:14px;margin-bottom:16px">
      <div class="modal-actions"><button class="btn btn-ghost" data-r="0">Cancel</button><button class="btn btn-primary" data-r="1">Save</button></div></div>`;
    wrap.onclick = (e) => { const b = e.target.closest("button[data-r]"); if (b) { wrap.remove(); resolve(b.dataset.r === "1"); } };
    document.body.appendChild(wrap);
  });
}

/* ---------------- name: once every 7 days ---------------- */
export async function editName(userRef, user) {
  const last = toDate(user.nameChangedAt);
  if (last) {
    const left = NAME_LOCK_DAYS - (Date.now() - last.getTime()) / 86400000;
    if (left > 0) {
      const d = Math.ceil(left);
      return confirmBox({ title: "Name locked", message: `You can change your name only once every ${NAME_LOCK_DAYS} days. Try again in ${d} day${d > 1 ? "s" : ""}.`, okText: "OK" });
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

/* ---------------- logout: clears everything, the app starts again from Login ---------------- */
export function doLogout() {
  localStorage.clear();
  sessionStorage.clear();
  location.replace("index.html");
}
export async function logout() {
  const yes = await confirmBox({ title: "Log out?", message: "Are you sure you want to log out?", okText: "Yes", cancelText: "No" });
  if (yes) doLogout();
}
