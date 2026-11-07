// banners.js - add / edit / delete the banners shown on the customer Home page
import {
  db, $, esc, bySort, skelRows,
  initPage, makePager, appendOneByOne, crudSheet, collection, query, orderBy, documentId
} from "./admin-common.js";

await initPage("banners", "Banners");

let items = [], pager = null, token = 0;
$("content").innerHTML = '<div id="list"></div><div id="more"></div>';
$("fab").onclick = () => edit();

const card = (b) => `<div class="row-card" data-open="${esc(b.id)}">
  <span class="icon-prev" style="width:72px;height:54px">${b.imageUrl ? `<img src="${esc(b.imageUrl)}" alt="">` : "🖼️"}</span>
  <div class="rc-main" style="flex:1"><b>${esc(b.title)}</b><span>${esc(b.subtitle || "")}</span></div>
  <div class="rc-side"><span class="chip ${b.active === false ? "c-gray" : "c-green"}">${b.active === false ? "Hidden" : "Live"}</span></div></div>`;

async function load(reset) {
  const my = ++token, list = $("list");
  if (reset) { items = []; pager = makePager(query(collection(db, "banners"), orderBy(documentId())), 10); list.innerHTML = skelRows(3); $("more").innerHTML = ""; }
  else $("more").innerHTML = '<div class="progress">Loading…</div>';
  let page;
  try { page = await pager.next(); }
  catch (e) { console.error(e); if (my === token) list.innerHTML = `<div class="empty">Could not load banners (${esc(e.code || e.message)})</div>`; return; }
  if (my !== token) return;
  if (reset) list.innerHTML = "";
  if (reset && !page.length) list.innerHTML = '<div class="empty">No banners yet. Tap + to add one.</div>';
  page.sort(bySort); items.push(...page);
  await appendOneByOne(list, page, card);
  if (my !== token) return;
  $("more").innerHTML = pager.done ? "" : '<button class="btn btn-ghost btn-block" id="more-btn">Load more</button>';
  const mb = $("more-btn"); if (mb) mb.onclick = () => load(false);
}
$("list").onclick = (e) => { const c = e.target.closest("[data-open]"); if (c) edit(items.find((b) => b.id === c.dataset.open)); };

function edit(b) {
  crudSheet({
    col: "banners", item: b, noun: "Banner", onChange: () => load(true),
    values: b || { active: true, sortOrder: items.length + 1 },
    fields: [
      { key: "imageUrl", label: "Banner image", type: "image" },
      { key: "title", label: "Title" },
      { key: "subtitle", label: "Sub paragraph", type: "textarea" },
      { key: "buttonText", label: "Button text" },
      { key: "link", label: "Button link", placeholder: "package.html" },
      { key: "active", label: "Visible to customers", type: "bool" },
      { key: "sortOrder", label: "Sort order", type: "number", hint: "Smaller number shows first" }
    ],
    validate: (v) => { if (!v.title) throw new Error("Enter a title"); return v; }
  });
}
load(true);
