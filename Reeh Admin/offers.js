// offers.js - add / edit / delete offers (what customers see on their Offers page)
import {
  db, $, esc, ymd, toDate, bySort, dateToTs, PROVIDERS, skelRows, iconPreview,
  initPage, makePager, appendOneByOne, crudSheet, collection, query, orderBy, documentId
} from "./admin-common.js";

await initPage("offers", "Offers");

let items = [], pager = null, token = 0;
$("content").innerHTML = '<div id="list"></div><div id="more"></div>';
$("fab").onclick = () => edit();

const card = (o) => `<div class="row-card" data-open="${esc(o.id)}">
  <span class="icon-prev" style="width:54px;height:54px">${o.imageUrl ? `<img src="${esc(o.imageUrl)}" alt="">` : "🏷️"}</span>
  <div class="rc-main" style="flex:1"><b>${esc(o.title)}</b>
    <span>${esc((o.providers || ["all"]).join(", "))}${o.minOrders ? " • " + o.minOrders + "+ orders" : ""}</span></div>
  <div class="rc-side"><span class="chip ${o.active === false ? "c-gray" : "c-green"}">${o.active === false ? "Hidden" : "Live"}</span></div></div>`;

async function load(reset) {
  const my = ++token, list = $("list");
  if (reset) { items = []; pager = makePager(query(collection(db, "offers"), orderBy(documentId())), 10); list.innerHTML = skelRows(3); $("more").innerHTML = ""; }
  else $("more").innerHTML = '<div class="progress">Loading…</div>';
  let page;
  try { page = await pager.next(); }
  catch (e) { console.error(e); if (my === token) list.innerHTML = `<div class="empty">Could not load offers (${esc(e.code || e.message)})</div>`; return; }
  if (my !== token) return;
  if (reset) list.innerHTML = "";
  if (reset && !page.length) list.innerHTML = '<div class="empty">No offers yet. Tap + to add one.</div>';
  page.sort(bySort); items.push(...page);
  await appendOneByOne(list, page, card);
  if (my !== token) return;
  $("more").innerHTML = pager.done ? "" : '<button class="btn btn-ghost btn-block" id="more-btn">Load more</button>';
  const mb = $("more-btn"); if (mb) mb.onclick = () => load(false);
}
$("list").onclick = (e) => { const c = e.target.closest("[data-open]"); if (c) edit(items.find((o) => o.id === c.dataset.open)); };

function edit(o) {
  const values = o ? { ...o, startDate: o.startDate ? ymd(toDate(o.startDate)) : "", endDate: o.endDate ? ymd(toDate(o.endDate)) : "" }
    : { active: true, providers: ["all"], minOrders: 0, sortOrder: items.length + 1 };
  crudSheet({
    col: "offers", item: o, noun: "Offer", values, onChange: () => load(true),
    fields: [
      { key: "imageUrl", label: "Offer image", type: "image" },
      { key: "title", label: "Title" },
      { key: "buttonText", label: "Button text", placeholder: "Get offer" },
      { key: "link", label: "Button link", placeholder: "package.html" },
      { key: "providers", label: "Show to", type: "multi", options: [{ value: "all", label: "Everyone" }, ...PROVIDERS], hint: "Tick Everyone, or only the providers that should see it." },
      { key: "minOrders", label: "Minimum completed orders", type: "number", hint: "0 = no minimum (e.g. 20 = only customers with 20+ active orders)" },
      { key: "startDate", label: "Start date (optional)", type: "date" },
      { key: "endDate", label: "End date (optional)", type: "date" },
      { key: "active", label: "Visible to customers", type: "bool" },
      { key: "sortOrder", label: "Sort order", type: "number", hint: "Smaller number shows first" }
    ],
    validate: (v) => {
      if (!v.title) throw new Error("Enter a title");
      if (!v.providers.length) v.providers = ["all"];
      v.minOrders = v.minOrders || 0;
      v.startDate = dateToTs(v.startDate, false); v.endDate = dateToTs(v.endDate, true);
      return v;
    }
  });
}
load(true);
