// settings.js - customer app settings: header logo + name, bottom nav links, Quick links, Profile page links
import {
  db, $, esc, bySort, skelRows, iconPreview, toast, sleep,
  initPage, makePager, appendOneByOne, openForm, crudSheet,
  doc, getDoc, setDoc, deleteField, collection, query, orderBy, documentId
} from "./admin-common.js";

await initPage("settings", "Settings");

$("content").innerHTML = `
  <div class="sec-head"><h2>App header</h2><button class="btn btn-ghost btn-sm" id="edit-app">Edit</button></div>
  <div id="app-card">${skelRows(1)}</div>
  <div class="sec-head"><h2>Bottom navigation links</h2><button class="btn btn-ghost btn-sm" id="edit-nav">Edit</button></div>
  <div id="nav-card">${skelRows(1)}</div>
  <div class="sec-head"><h2>Quick links</h2><button class="btn btn-primary btn-sm" id="add-quick">+ Add</button></div>
  <div id="quick" style="display:grid;gap:10px"></div><div id="quick-more"></div>
  <div class="sec-head"><h2>Profile page links (Policy, Terms, About us)</h2><button class="btn btn-primary btn-sm" id="add-more">+ Add</button></div>
  <div id="more" style="display:grid;gap:10px"></div><div id="more-more"></div>`;

/* ---------- App header (settings/app) ---------- */
let appData = {}, navData = {};
const appRef = doc(db, "settings", "app"), navRef = doc(db, "settings", "nav");
const NAV_FIELDS = [["home", "Home", "index.html"], ["package", "Package", "package.html"], ["offers", "Offers", "offers.html"], ["profile", "Profile", "profile.html"]];

async function loadApp() {
  try { appData = (await getDoc(appRef)).data() || {}; } catch (e) { console.error(e); toast("Could not load app settings"); }
  $("app-card").innerHTML = `<div class="row-card" id="app-row"><span class="icon-prev">${appData.logoUrl ? `<img src="${esc(appData.logoUrl)}" alt="">` : "R"}</span>
    <div class="rc-main" style="flex:1"><b>${esc(appData.appName || "Reeh Cloud")}</b><span>Logo and name shown in the customer app header</span></div></div>`;
  $("app-row").classList.add("rise");
}
async function loadNav() {
  try { navData = (await getDoc(navRef)).data() || {}; } catch (e) { console.error(e); toast("Could not load nav links"); }
  const box = $("nav-card");
  box.innerHTML = '<div class="kv" id="nav-kv"></div>';
  for (const [k, label, def] of NAV_FIELDS) {
    $("nav-kv").insertAdjacentHTML("beforeend", `<div class="rise"><span>${label}</span><b>${esc(navData[k] || def)}</b></div>`);
    await sleep(90);
  }
}

$("edit-app").onclick = () => openForm({
  title: "App header",
  fields: [
    { key: "logoUrl", label: "Logo image", type: "image", maxW: 256, mime: "image/png", hint: "Small square logo. Uploaded images are shrunk to 256px." },
    { key: "appName", label: "App name" },
    { key: "bannerTitle", label: "Home banner section title", placeholder: "For You" },
    { key: "forgotPinLink", label: "Forgot PIN page link", placeholder: "https://wa.me/94771234567 or forgot-pin.html" },
    { key: "privacyLink", label: "Policy and privacy page link", placeholder: "policy-and-privacy.html" },
    { key: "termsLink", label: "Terms and conditions page link", placeholder: "terms-and-conditions.html" }
  ],
  values: { logoUrl: appData.logoUrl || "", appName: appData.appName || "", bannerTitle: appData.bannerTitle || "", forgotPinLink: appData.forgotPinLink || appData.forgotPasscodeLink || "", privacyLink: appData.privacyLink || "", termsLink: appData.termsLink || "" },
  buttons: [{ label: "Save", onClick: async (v) => {
    if (!v.appName) throw new Error("Enter the app name");
    await setDoc(appRef, { appName: v.appName, logoUrl: v.logoUrl || deleteField(), bannerTitle: v.bannerTitle || deleteField(), forgotPinLink: v.forgotPinLink || deleteField(), privacyLink: v.privacyLink || deleteField(), termsLink: v.termsLink || deleteField() }, { merge: true });
    toast("Saved"); loadApp();
  } }]
});

$("edit-nav").onclick = () => openForm({
  title: "Bottom navigation links",
  intro: '<p class="muted" style="margin-bottom:12px">Page each button of the customer app opens, e.g. package.html</p>',
  fields: NAV_FIELDS.map(([k, label, def]) => ({ key: k, label, placeholder: def })),
  values: Object.fromEntries(NAV_FIELDS.map(([k, , def]) => [k, navData[k] || def])),
  buttons: [{ label: "Save", onClick: async (v) => {
    for (const [k, label] of NAV_FIELDS) if (!v[k]) throw new Error("Enter the " + label + " link");
    await setDoc(navRef, v, { merge: true });
    toast("Saved"); loadNav();
  } }]
});

/* ---------- link lists: Quick links + More section ---------- */
function linkList({ col, boxId, moreId, addId, noun, emptyText }) {
  let items = [], pager = null, token = 0;
  const box = $(boxId), more = $(moreId);
  const card = (m) => `<div class="row-card" data-open="${esc(m.id)}"><span class="icon-prev">${iconPreview(m.icon)}</span>
    <div class="rc-main" style="flex:1"><b>${esc(m.title)}</b><span>${esc(m.link || "")}</span></div>
    <div class="rc-side"><span class="chip ${m.active === false ? "c-gray" : "c-green"}">${m.active === false ? "Hidden" : "Live"}</span></div></div>`;

  async function load(reset) {
    const my = ++token;
    if (reset) { items = []; pager = makePager(query(collection(db, col), orderBy(documentId())), 10); box.innerHTML = skelRows(2); more.innerHTML = ""; }
    else more.innerHTML = '<div class="progress">Loading…</div>';
    let page;
    try { page = await pager.next(); }
    catch (e) { console.error(e); if (my === token) box.innerHTML = `<div class="empty">Could not load (${esc(e.code || e.message)})</div>`; return; }
    if (my !== token) return;
    if (reset) box.innerHTML = "";
    if (reset && !page.length) box.innerHTML = `<div class="empty">${emptyText}</div>`;
    page.sort(bySort); items.push(...page);
    await appendOneByOne(box, page, card);
    if (my !== token) return;
    more.innerHTML = pager.done ? "" : '<button class="btn btn-ghost btn-block" data-more>Load more</button>';
    const mb = more.querySelector("[data-more]"); if (mb) mb.onclick = () => load(false);
  }
  const edit = (item) => crudSheet({
    col, item, noun, onChange: () => load(true),
    values: item || { active: true, sortOrder: items.length + 1 },
    fields: [
      { key: "icon", label: "Icon", type: "image", emoji: true, maxW: 128, mime: "image/png", hint: "Type an emoji, paste an image URL, or upload a small image." },
      { key: "title", label: "Title" },
      { key: "link", label: "Page link", placeholder: "package.html" },
      { key: "active", label: "Visible to customers", type: "bool" },
      { key: "sortOrder", label: "Sort order", type: "number", hint: "Smaller number shows first" }
    ],
    validate: (v) => { if (!v.title) throw new Error("Enter a title"); if (!v.link) throw new Error("Enter the page link"); return v; }
  });
  box.onclick = (e) => { const c = e.target.closest("[data-open]"); if (c) edit(items.find((x) => x.id === c.dataset.open)); };
  $(addId).onclick = () => edit();
  load(true);
}

loadApp(); loadNav();
linkList({ col: "quickLinks", boxId: "quick", moreId: "quick-more", addId: "add-quick", noun: "Quick link", emptyText: "No quick links yet. Tap + Add." });
linkList({ col: "profileLinks", boxId: "more", moreId: "more-more", addId: "add-more", noun: "Profile link", emptyText: "No profile links yet. Tap + Add (e.g. Policy and privacy)." });
