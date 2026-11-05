// notify.js - send a notification to: all customers, one provider, customers with many orders, or specific phone numbers
import {
  db, $, esc, providerOf, normPhone, fmtDT, PROVIDERS, toast, askConfirm, skelRows,
  initPage, makePager, appendOneByOne,
  doc, getDoc, addDoc, collection, query, where, orderBy, documentId, serverTimestamp, writeBatch
} from "./admin-common.js";

await initPage("notify", "Send notification");

const provOptions = (any) => (any ? '<option value="">Any provider</option>' : "") + PROVIDERS.map((p) => `<option value="${p.value}">${p.label}</option>`).join("");

$("content").innerHTML = `
  <div class="panel">
    <h2>1. Who should get it?</h2>
    <label class="field"><span>Send to</span>
      <select class="input" id="aud">
        <option value="all">All customers</option>
        <option value="provider">One provider (e.g. Dialog)</option>
        <option value="orders">Customers with many orders</option>
        <option value="phones">Specific phone number(s)</option>
      </select></label>
    <div id="aud-extra"></div>
    <button class="btn btn-ghost btn-block" id="check">Check how many will get it</button>
    <div class="result" id="result" style="margin-top:10px"></div>
  </div>

  <div class="panel">
    <h2>2. Message</h2>
    <label class="field"><span>Title</span><input class="input" id="n-title" maxlength="80" placeholder="Bonus data this week"></label>
    <label class="field"><span>Message</span><textarea class="input" id="n-body" rows="3" maxlength="300" placeholder="Get 10 GB extra when you renew today."></textarea></label>
    <label class="field"><span>Icon (optional)</span><input class="input" id="n-icon" placeholder="Emoji (e.g. 🎁) or image URL"></label>
    <label class="field"><span>Page link (optional)</span><input class="input" id="n-link" placeholder="package.html"></label>
    <label class="field"><span>Sound file link (optional)</span><input class="input" id="n-sound" placeholder="sounds/offer.mp3"></label>
  </div>

  <div class="progress-line" id="progress"></div>
  <button class="btn btn-primary btn-block" id="send">Send notification</button>

  <div class="panel">
    <h2>Recently sent</h2>
    <div id="hist" style="display:grid;gap:10px"></div><div id="hist-more"></div>
  </div>`;

/* ---- audience fields ---- */
function drawExtra() {
  const a = $("aud").value, box = $("aud-extra");
  box.innerHTML = a === "provider" ? `<label class="field"><span>Provider</span><select class="input" id="prov">${provOptions(false)}</select></label>`
    : a === "orders" ? `<label class="field"><span>Minimum completed orders</span><input class="input" id="minorders" type="number" inputmode="numeric" value="50" min="1">
        <small class="hint">Counts the customer's orders that you set to Active.</small></label>
        <label class="field"><span>Provider</span><select class="input" id="prov2">${provOptions(true)}</select></label>`
    : a === "phones" ? `<label class="field"><span>Phone number(s)</span><textarea class="input" id="phones" rows="3" placeholder="0771234567&#10;0712345678"></textarea>
        <small class="hint">One per line, or separated by commas.</small></label>` : "";
  $("result").className = "result";
}
$("aud").onchange = drawExtra;
drawExtra();

/* ---- find the customers ---- */
async function resolveRecipients(progress) {
  const aud = $("aud").value;

  if (aud === "phones") {
    const list = [...new Set($("phones").value.split(/[\s,;]+/).map(normPhone).filter(Boolean))];
    if (!list.length) throw new Error("Enter at least one phone number");
    const bad = list.filter((p) => !/^07\d{8}$/.test(p));
    if (bad.length) throw new Error("Not a valid number: " + bad.join(", "));
    if (list.length > 100) throw new Error("Maximum 100 numbers at a time");
    const missing = [];
    for (const p of list) { progress("Checking " + p + "…"); if (!(await getDoc(doc(db, "users", p))).exists()) missing.push(p); }
    if (missing.length) throw new Error("Not registered: " + missing.join(", "));
    return list;
  }

  const pf = aud === "provider" ? $("prov").value : aud === "orders" ? $("prov2").value : "";

  if (aud === "orders") {
    const min = Number($("minorders").value);
    if (!(min >= 1)) throw new Error("Enter the minimum number of orders");
    const counts = {};
    const pager = makePager(query(collection(db, "orders"), where("status", "==", "active"), orderBy(documentId())), 300);
    let seen = 0;
    while (!pager.done) {
      const page = await pager.next();
      page.forEach((o) => { if (o.phone) counts[o.phone] = (counts[o.phone] || 0) + 1; });
      seen += page.length; progress("Counting orders… " + seen);
    }
    return Object.keys(counts).filter((p) => counts[p] >= min && (!pf || providerOf(p) === pf));
  }

  // all customers / one provider: active customers only
  const phones = [];
  const pager = makePager(query(collection(db, "users"), where("status", "==", "active"), orderBy(documentId())), 100);
  while (!pager.done) {
    (await pager.next()).forEach((u) => { if (!pf || (u.provider || providerOf(u.id)) === pf) phones.push(u.id); });
    progress("Reading customers… " + phones.length);
  }
  return phones;
}

function audienceText() {
  const a = $("aud").value, name = (v) => (PROVIDERS.find((p) => p.value === v) || {}).label || "any provider";
  return a === "all" ? "All customers" : a === "provider" ? "Provider: " + name($("prov").value)
    : a === "orders" ? `${$("minorders").value}+ orders (${name($("prov2").value)})` : "Phone number(s)";
}

const setProgress = (t) => ($("progress").textContent = t);
function showResult(text, err) { const r = $("result"); r.className = "result show" + (err ? " err" : ""); r.textContent = text; }

$("check").onclick = async () => {
  const b = $("check"); b.disabled = true; showResult("Checking…");
  try {
    const list = await resolveRecipients((t) => showResult(t));
    showResult(list.length ? `${list.length} customer(s) will receive it. ${list.slice(0, 5).join(", ")}${list.length > 5 ? " …" : ""}` : "No customers match this selection.", !list.length);
  } catch (e) { showResult(e.message || "Could not check", true); }
  finally { b.disabled = false; }
};

/* ---- send ---- */
$("send").onclick = async () => {
  const title = $("n-title").value.trim();
  if (!title) return toast("Enter a title");
  const b = $("send"); b.disabled = true;
  try {
    const phones = await resolveRecipients(setProgress);
    if (!phones.length) { setProgress(""); return toast("No customers match this selection"); }
    if (!(await askConfirm("Send notification?", `"${title}" will be sent to ${phones.length} customer(s).`, "Send"))) { setProgress(""); return; }

    const data = { title, read: false, type: "admin" };
    for (const [k, id] of [["body", "n-body"], ["icon", "n-icon"], ["link", "n-link"], ["soundUrl", "n-sound"]]) { const v = $(id).value.trim(); if (v) data[k] = v; }

    for (let i = 0; i < phones.length; i += 400) {
      const batch = writeBatch(db);
      phones.slice(i, i + 400).forEach((p) => batch.set(doc(collection(db, "users", p, "notifications")), { ...data, createdAt: serverTimestamp() }));
      await batch.commit();
      setProgress(`Sent ${Math.min(i + 400, phones.length)} / ${phones.length}`);
    }
    await addDoc(collection(db, "notificationLog"), { title, body: data.body || "", audience: audienceText(), count: phones.length, createdAt: serverTimestamp() });
    toast("Sent to " + phones.length + " customer(s)");
    ["n-title", "n-body", "n-icon", "n-link", "n-sound"].forEach((id) => ($(id).value = ""));
    setProgress("Done: " + phones.length + " sent");
    loadHistory(true);
  } catch (e) { console.error(e); setProgress(""); toast(e.message || "Could not send"); }
  finally { b.disabled = false; }
};

/* ---- history (a few at a time) ---- */
let hp = null, hToken = 0;
const hCard = (h) => `<div class="row-card h-row"><div class="rc-main"><b>${esc(h.title)}</b><span>${esc(h.audience || "")} • ${h.count || 0} customer(s)</span><small>${fmtDT(h.createdAt)}</small></div></div>`;
async function loadHistory(reset) {
  const my = ++hToken, box = $("hist");
  if (reset) { hp = makePager(query(collection(db, "notificationLog"), orderBy("createdAt", "desc")), 5); box.innerHTML = skelRows(2); $("hist-more").innerHTML = ""; }
  let page;
  try { page = await hp.next(); }
  catch (e) { console.error(e); if (my === hToken) box.innerHTML = `<div class="empty">Could not load history (${esc(e.code || e.message)})</div>`; return; }
  if (my !== hToken) return;
  if (reset) box.innerHTML = "";
  if (reset && !page.length) box.innerHTML = '<div class="empty">Nothing sent yet.</div>';
  await appendOneByOne(box, page, hCard);
  $("hist-more").innerHTML = hp.done ? "" : '<button class="btn btn-ghost btn-block" id="hist-btn">Load more</button>';
  const hb = $("hist-btn"); if (hb) hb.onclick = () => loadHistory(false);
}
loadHistory(true);
