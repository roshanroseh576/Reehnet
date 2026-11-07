// payment-process.js - bank transfer details, slip upload (Cloudinary), "I'm paid"
import {
  db, doc, getDoc, setDoc, updateDoc, serverTimestamp,
  esc, money, getSession, toast, confirmBox
} from "./firebase-init.js";

const $ = (id) => document.getElementById(id);
const phone = getSession();
const orderId = new URLSearchParams(location.search).get("order");
if (!phone || !orderId) location.replace("index.html");

const goHome = () => (location.href = "index.html");
$("back").onclick = goHome; // order stays under "Recent activity" on Home

let slipFile = null;
const orderRef = doc(db, "orders", orderId || "x");


async function init() {

  const snap = await getDoc(orderRef);
  const o = snap.data();
  if (!snap.exists() || o.phone !== phone || ["cancelled", "active"].includes(o.status)) return goHome();

  let bank = {};
  try {
    const b = await getDoc(doc(db, "settings", "bank"));
    if (b.exists()) bank = b.data();
  } catch (e) { console.error(e); }

  const row = (k, v, copy) =>
    `<div><dt>${k}</dt><dd>${copy ? `<span class="copy">${esc(v)} <button class="btn btn-ghost btn-sm" data-copy="${esc(v)}">Copy</button></span>` : esc(v)}</dd></div>`;

  $("pkg-rows").innerHTML =
    row("Package", o.packageName) + row("Data", o.dataLabel || "-") +
    row("Validity", o.validityDays + " days") + row("Amount", money(o.price));
  $("bank-rows").innerHTML =
    row("Bank", bank.bankName || "-") + row("Branch", bank.branch || "-") +
    row("Account name", bank.accountName || "-") + row("Account number", bank.accountNumber || "-", !!bank.accountNumber);
  $("ref").textContent = o.reference || phone;

  document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  $("copy-ref").onclick = () => copy($("ref").textContent);

  // already paid, waiting for admin
  if (o.status === "payment_pending") {
    $("slip-card").hidden = true;
    $("actions").hidden = true;
    $("notice").hidden = false;
  } else {
    setupSlip();
    $("paid").onclick = submitPaid;
    $("cancel").onclick = cancelOrder;
  }
  $("loading").hidden = true;
  $("body").hidden = false;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { toast("Could not copy"); }
}

/* ---- slip: pick a photo, preview it, upload to Cloudinary when "I'm paid" is pressed ---- */
function setupSlip() {
  $("slip-pick").onclick = () => $("slip").click();
  $("slip").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("Choose a photo of the slip"); return; }
    slipFile = file;
    $("slip-preview").src = URL.createObjectURL(file);
    $("slip-preview").hidden = false;
    $("slip-hint").textContent = "Tap to change the slip";
    $("paid").disabled = false;
  };
}

/* ---- I'm paid ---- */
async function submitPaid() {
  if (!slipFile) return toast("Upload your payment slip first");
  const btn = $("paid"), label = btn.textContent;
  btn.disabled = true;
  try {
    const { uploadFile } = await import("./cloudinary.js");      // photo goes to Cloudinary; only its link is saved in Firebase
    btn.textContent = "Uploading 0%";
    const up = await uploadFile(slipFile, { tag: "slips", maxW: 1600, onProgress: (p) => (btn.textContent = "Uploading " + p + "%") });
    btn.textContent = "Saving…";
    await setDoc(doc(db, "orderSlips", orderId), { orderId, phone, slipUrl: up.url, slipId: up.publicId, createdAt: serverTimestamp() });
    await updateDoc(orderRef, { hasSlip: true, slipUrl: up.url, status: "payment_pending", paidAt: serverTimestamp() });
    await confirmBox({ title: "Payment received", message: "Your details are being verified. We will activate your package soon.", okText: "OK" });
    goHome();
  } catch (e) {
    console.error(e);
    toast(e.message && e.message.length < 90 ? e.message : "Could not submit. Try again.");
    btn.textContent = label;
    btn.disabled = false;
  }
}

async function cancelOrder() {
  const ok = await confirmBox({ title: "Cancel order?", message: "This order will be cancelled.", okText: "OK", cancelText: "Cancel" });
  if (!ok) return;
  try {
    await updateDoc(orderRef, { status: "cancelled", cancelledAt: serverTimestamp() });
    goHome();
  } catch (e) { console.error(e); toast("Could not cancel. Try again."); }
}

// start the page only after every function and constant above is defined
init();
