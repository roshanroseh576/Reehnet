// offers.js - offers filtered for the logged-in user (provider + number of completed orders)
import {
  db, doc, getDoc, collection, query, where, getDocs, orderBy, getCountFromServer,
  streamPages, thumb, esc, toDate, sleep, getSession, providerOf,
} from "./firebase-init.js";

const $ = (id) => document.getElementById(id);
const phone = getSession();
if (!phone) location.replace("index.html");

$("back").onclick = () => (history.length > 1 ? history.back() : (location.href = "index.html"));


async function init() {
  loadNav();
  const box = $("list");
  const provider = providerOf(phone);
  let doneOrders = null, shown = 0;
  // number of completed (active) orders: counted on the server, only when an offer needs it
  const completed = async () => {
    if (doneOrders === null) {
      const c = await getCountFromServer(query(collection(db, "orders"), where("phone", "==", phone), where("status", "==", "active")));
      doneOrders = c.data().count;
    }
    return doneOrders;
  };
  try {
    const now = Date.now();
    // offers arrive 3 at a time; each offer that fits this customer appears one by one
    await streamPages(query(collection(db, "offers"), orderBy("sortOrder")), 3, async (page) => {
      for (const o of page) {
        if (o.active === false) continue;
        const st = toDate(o.startDate), en = toDate(o.endDate);
        if ((st && st.getTime() > now) || (en && en.getTime() < now)) continue;
        const p = Array.isArray(o.providers) ? o.providers : [];
        if (p.length && !p.includes("all") && !(provider && p.includes(provider))) continue;
        if (Number(o.minOrders || 0) > 0 && (await completed()) < Number(o.minOrders)) continue;
        if (!shown) box.innerHTML = "";
        box.insertAdjacentHTML("beforeend", `
          <article class="offer">
            ${o.imageUrl ? `<img src="${esc(thumb(o.imageUrl, 900))}" alt="" loading="lazy">` : ""}
            <div class="offer-text"><b>${esc(o.title)}</b>
              ${o.buttonText ? `<a class="btn btn-primary" href="${esc(o.link || "#")}">${esc(o.buttonText)}</a>` : ""}
            </div>
          </article>`);
        shown++;
        await sleep(130);
      }
    });
    if (!shown) box.innerHTML = `<div class="empty">No offers for you right now.</div>`;
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="empty">Could not load offers. Check your connection and try again.</div>`;
  }
}

/* bottom nav (links from Firebase: settings/nav) */
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
    `<a href="${esc(nav[k])}" class="${k === "offers" ? "on" : ""}">${ICONS[k]}<span>${k[0].toUpperCase() + k.slice(1)}</span></a>`).join("");
}

// start the page only after every function and constant above is defined
init();
