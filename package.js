// package.js - packages grouped by title (Stranger 30, Nonstop, ...). Tap a picture -> details -> Activate -> payment
import {
  db, doc, getDoc, addDoc, collection, query, where, getDocs, serverTimestamp,
  streamPages, appendOneByOne, esc, money, getSession, providerOf, thumb,
  loadBranding, toast, confirmBox
} from "./firebase-init.js";

const $ = (id) => document.getElementById(id);
const phone = getSession();
if (!phone) location.replace("index.html");

$("back").onclick = () => (history.length > 1 ? history.back() : (location.href = "index.html"));

const bySort = (a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
const GRADS = [["#FF8A3D", "#FF5A5F"], ["#22B8CF", "#5C6FFF"], ["#8B5CF6", "#5C6FFF"], ["#0FC16E", "#22B8CF"]];

const tileHTML = (p, i) => {
  const [a, b] = GRADS[i % GRADS.length];
  return `<button class="tile" data-id="${esc(p.id)}" style="background:linear-gradient(135deg,${a},${b})" aria-label="${esc(p.name)}">
    ${p.imageUrl ? `<img src="${esc(thumb(p.imageUrl, 400))}" alt="${esc(p.name)}" loading="lazy">` : `<span class="t-name">${esc(p.name)}</span>`}</button>`;
};

/* ---------------- list: group by group, picture by picture ---------------- */
async function init() {
  const brand = await loadBranding();
  $("title").textContent = brand.packageTitle || "Packages";

  const provider = providerOf(phone);
  const list = $("list");
  if (!provider) { list.innerHTML = `<div class="empty">Packages are not available for this number (${esc(phone)}).</div>`; return; }

  list.innerHTML = '<div class="skel g-sk"></div><div class="row"><div class="tile sk"></div><div class="tile sk"></div><div class="tile sk"></div></div>';
  const byId = {};
  let shown = 0, first = true;
  list.onclick = (e) => { const t = e.target.closest(".tile[data-id]"); if (t && byId[t.dataset.id]) openSheet(byId[t.dataset.id], provider); };

  try {
    // groups arrive 4 at a time; for each group its pictures are fetched and shown one by one
    await streamPages(query(collection(db, "packageGroups")), 4, async (page) => {
      for (const g of page.filter((x) => x.active !== false).sort(bySort)) {
        if (first) { list.innerHTML = ""; first = false; }
        const sec = document.createElement("section");
        sec.className = "grp reveal";
        sec.innerHTML = `<h2>${esc(g.title)}</h2><div class="row"><div class="tile sk"></div><div class="tile sk"></div></div>`;
        list.appendChild(sec);

        const snap = await getDocs(query(collection(db, "packages"), where("groupId", "==", g.id)));
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.active !== false && (!Array.isArray(p.providers) || !p.providers.length || p.providers.includes(provider)))
          .sort(bySort);
        if (!items.length) { sec.remove(); continue; }
        items.forEach((p) => (byId[p.id] = p));
        const row = sec.querySelector(".row");
        row.innerHTML = "";
        let i = 0;
        await appendOneByOne(row, items, (p) => tileHTML(p, i++), 110);
        shown += items.length;
      }
    });
    if (first || !shown) list.innerHTML = `<div class="empty">No packages available for you right now.</div>`;
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div class="empty">Could not load packages (${esc(e.code || e.message)}).</div>`;
  }
}

/* ---------------- details sheet: Cancel / Activate ---------------- */
function detailRows(p) {
  const rows = [["Price", money(p.price)],
    ["Data", p.unlimited ? "Unlimited" : p.dataLabel || (p.dataGB ? p.dataGB + " GB" : "-")]];
  if (p.validityDays) rows.push(["Validity", p.validityDays + " days"]);
  rows.push(["Nonstop", p.nonstop ? "Yes" : "No"], ["Unlimited", p.unlimited ? "Yes" : "No"]);
  String(p.extraDetails || "").split("\n").map((l) => l.trim()).filter(Boolean).forEach((line) => {
    const i = line.indexOf(":");
    rows.push(i > 0 && i < 40 ? [line.slice(0, i).trim(), line.slice(i + 1).trim()] : [null, line]);
  });
  return rows;
}

function openSheet(p, provider) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-bg";
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-head">${p.imageUrl ? `<img src="${esc(thumb(p.imageUrl, 160))}" alt="">` : ""}<h3>${esc(p.name)}</h3></div>
    <div class="sheet-rows">${detailRows(p).map(([k, v]) => k === null ? `<div class="drow note">${esc(v)}</div>` : `<div class="drow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>
    <div class="sheet-foot"><button class="btn btn-cancel" data-c>Cancel</button><button class="btn btn-activate" data-a>Activate</button></div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-c]")) close(); });
  wrap.querySelector("[data-a]").onclick = (e) => activate(p, provider, e.currentTarget);
}

async function activate(p, provider, btn) {
  btn.disabled = true;
  try {
    // One open order at a time: reuse it instead of creating duplicates.
    const open = await getDocs(query(collection(db, "orders"), where("phone", "==", phone)));
    const pending = open.docs.find((d) => ["unpaid", "payment_pending"].includes(d.data().status));
    if (pending) {
      const o = pending.data();
      if (o.status === "payment_pending") {
        await confirmBox({ title: "Order in progress", message: "Your payment is being verified. You can order again once it is confirmed.", okText: "OK" });
      } else {
        const go = await confirmBox({
          title: "You have an unpaid order",
          message: `${o.packageName} is waiting for payment. Continue to payment?`,
          okText: "Payment now", cancelText: "Cancel"
        });
        if (go) location.href = "payment-process.html?order=" + encodeURIComponent(pending.id);
      }
      return;
    }

    const user = (await getDoc(doc(db, "users", phone))).data() || {};
    const ref = await addDoc(collection(db, "orders"), {
      phone,
      userName: user.name || "",
      provider,
      packageId: p.id,
      packageName: p.name,
      dataLabel: p.unlimited ? "Unlimited" : p.dataLabel || (p.dataGB ? p.dataGB + " GB" : ""),
      dataTotalGB: p.unlimited ? 0 : Number(p.dataGB || 0),
      dataUsedGB: 0,
      validityDays: Number(p.validityDays || 0),
      price: Number(p.price || 0),
      reference: phone,          // bank transfer reference = login phone number
      status: "unpaid",          // unpaid -> payment_pending -> active  (or cancelled)
      createdAt: serverTimestamp()
    });
    location.href = "payment-process.html?order=" + encodeURIComponent(ref.id);
  } catch (e) {
    console.error(e);
    toast("Could not start the order. Try again.");
  } finally { btn.disabled = false; }
}

// start the page only after every function and constant above is defined
init();
