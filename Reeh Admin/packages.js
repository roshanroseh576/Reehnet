// packages.js (admin) - package groups (Stranger 30, Nonstop, ...) and the picture packages inside them
import {
  db, $, esc, money, bySort, PROVIDERS, toast, askConfirm, choose, skelRows,
  initPage, makePager, appendOneByOne, openForm, crudSheet, prepare,
  doc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, documentId, serverTimestamp
} from "./admin-common.js";

await initPage("packages", "Packages");

let groups = [], token = 0;
const pkgById = {};
const ALL = PROVIDERS.map((p) => p.value);

$("content").innerHTML = '<div id="list" style="display:grid;gap:12px"></div><div id="old"></div>';
$("fab").onclick = () => editGroup();

/* ---------------- groups, one by one; each group's pictures one by one ---------------- */
const secHTML = (g) => `<section class="g-sec rise" data-gid="${esc(g.id)}">
  <div class="g-head"><div><b>${esc(g.title)}</b>${g.active === false ? ' <span class="chip c-gray">Hidden</span>' : ""}</div>
    <div class="g-act"><button class="btn btn-ghost btn-sm" data-eg>Edit</button><button class="btn btn-primary btn-sm" data-ap>+ Package</button></div></div>
  <div class="g-row"><div class="pk sk"></div><div class="pk sk"></div></div></section>`;

const pkHTML = (p) => `<button class="pk ${p.active === false ? "hidden-pk" : ""}" data-pid="${esc(p.id)}">
  ${p.imageUrl ? `<img class="pk-img" src="${esc(p.imageUrl)}" alt="">` : `<span class="pk-img">${esc((p.name || "?").charAt(0))}</span>`}
  <b>${esc(p.name)}</b><small>${money(p.price)}</small></button>`;

async function load() {
  const my = ++token, list = $("list");
  groups = [];
  list.innerHTML = skelRows(2);
  const pager = makePager(query(collection(db, "packageGroups"), orderBy(documentId())), 4);
  let first = true;
  try {
    while (!pager.done) {
      const page = await pager.next();
      if (my !== token) return;
      if (first) { list.innerHTML = ""; first = false; }
      for (const g of page.sort(bySort)) {
        groups.push(g);
        list.insertAdjacentHTML("beforeend", secHTML(g));
        const sec = list.lastElementChild;
        const snap = await getDocs(query(collection(db, "packages"), where("groupId", "==", g.id)));
        if (my !== token) return;
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(bySort);
        items.forEach((p) => (pkgById[p.id] = p));
        g.count = items.length;
        const row = sec.querySelector(".g-row");
        row.innerHTML = items.length ? "" : '<div class="g-empty">No packages yet. Tap + Package.</div>';
        await appendOneByOne(row, items, pkHTML, 90);
      }
    }
    if (first) list.innerHTML = '<div class="empty">No groups yet. Tap + to add a group (for example "Stranger 30").</div>';
  } catch (e) { console.error(e); if (my === token) list.innerHTML = `<div class="empty">Could not load packages (${esc(e.code || e.message)})</div>`; }
  drawOldButton();
}

$("list").onclick = (e) => {
  const sec = e.target.closest(".g-sec");
  const g = sec && groups.find((x) => x.id === sec.dataset.gid);
  if (e.target.closest("[data-eg]")) return editGroup(g);
  if (e.target.closest("[data-ap]")) return editPackage(null, g.id);
  const pk = e.target.closest("[data-pid]");
  if (pk) editPackage(pkgById[pk.dataset.pid]);
};

/* ---------------- group form ---------------- */
function editGroup(g) {
  const buttons = [{ label: g ? "Save" : "Add group", onClick: async (v) => {
    if (!v.title) throw new Error("Enter the group title");
    const data = { title: v.title, sortOrder: v.sortOrder ?? groups.length + 1, active: v.active };
    if (g) await updateDoc(doc(db, "packageGroups", g.id), data);
    else await addDoc(collection(db, "packageGroups"), { ...data, createdAt: serverTimestamp() });
    toast("Group saved"); load();
  } }];
  if (g) buttons.push({ label: "Delete", kind: "danger", onClick: async () => {
    const snap = await getDocs(query(collection(db, "packages"), where("groupId", "==", g.id)));
    let act = "group";
    if (snap.size) {
      act = await choose("Delete group", `"${g.title}" has ${snap.size} package(s).`, [
        { label: "Delete the group and its packages", value: "all", kind: "danger" },
        { label: "Delete the group only (packages become ungrouped)", value: "group", kind: "danger" }
      ]);
      if (!act) return false;
    } else if (!(await askConfirm("Delete group?", "This is removed from Firebase and cannot be undone.", "Delete"))) return false;
    if (act === "all") for (const d of snap.docs) await deleteDoc(d.ref);
    else for (const d of snap.docs) await updateDoc(d.ref, { groupId: "" });
    await deleteDoc(doc(db, "packageGroups", g.id));
    toast("Group deleted"); load();
  } });
  openForm({
    title: g ? "Edit group" : "New group",
    fields: [
      { key: "title", label: "Group title", placeholder: "Stranger 30" },
      { key: "sortOrder", label: "Sort order", type: "number", hint: "Smaller number shows first" },
      { key: "active", label: "Visible to customers", type: "bool" }
    ],
    values: g || { active: true, sortOrder: groups.length + 1 },
    buttons
  });
}

/* ---------------- package form ---------------- */
function editPackage(p, gid) {
  if (!groups.length) return toast("Add a group first");
  crudSheet({
    col: "packages", item: p, noun: "Package", onChange: load,
    values: p || { groupId: gid || groups[0].id, active: true, providers: [...ALL], validityDays: 30, nonstop: false, unlimited: false, sortOrder: (groups.find((x) => x.id === gid)?.count || 0) + 1 },
    fields: [
      { key: "groupId", label: "Group", type: "select", options: groups.map((x) => ({ value: x.id, label: x.title })) },
      { key: "name", label: "Package name", placeholder: "Stranger 30 - 50 GB" },
      { key: "imageUrl", label: "Picture (shown to customers)", type: "image", maxW: 520, maxChars: 150000, hint: "Upload a picture or paste a link. Shrunk automatically." },
      { key: "price", label: "Price (LKR)", type: "number" },
      { key: "dataLabel", label: "Data text", placeholder: "50 GB" },
      { key: "dataGB", label: "Data (GB number)", type: "number", hint: "Used for the usage meter. 0 = unlimited" },
      { key: "validityDays", label: "Validity (days)", type: "number" },
      { key: "nonstop", label: "Nonstop", type: "bool" },
      { key: "unlimited", label: "Unlimited", type: "bool" },
      { key: "extraDetails", label: "More details", type: "textarea", hint: "One per line. Use Label: value for a row, e.g.  Speed: 100 Mbps" },
      { key: "providers", label: "Show to these providers", type: "multi", options: PROVIDERS },
      { key: "active", label: "Visible to customers", type: "bool" },
      { key: "sortOrder", label: "Sort order (inside the group)", type: "number" }
    ],
    validate: (v) => {
      if (!v.groupId) throw new Error("Choose a group");
      if (!v.name) throw new Error("Enter the package name");
      if (v.price === null) throw new Error("Enter the price");
      if (!v.providers.length) throw new Error("Select at least one provider");
      if (v.unlimited) v.dataGB = 0;
      if (!v.dataLabel) v.dataLabel = v.unlimited ? "Unlimited" : v.dataGB ? v.dataGB + " GB" : "";
      if (v.dataGB === null) v.dataGB = 0;
      return v;
    }
  });
}

/* ---------------- old packages that have no group yet (loaded only when asked) ---------------- */
function drawOldButton() {
  $("old").innerHTML = '<button class="btn btn-ghost btn-block" id="old-btn">Show old packages without a group</button>';
  $("old-btn").onclick = async () => {
    $("old").innerHTML = skelRows(2);
    try {
      const s = await getDocs(query(collection(db, "packages"), limit(60)));
      const olds = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => !p.groupId);
      olds.forEach((p) => (pkgById[p.id] = p));
      $("old").innerHTML = olds.length
        ? '<div class="g-empty">Tap one, choose its group and Save.</div><div id="old-list" style="display:grid;gap:10px"></div>'
        : '<div class="g-empty">No old packages. Everything has a group.</div>';
      if (olds.length) {
        const box = $("old-list");
        await appendOneByOne(box, olds, (p) => `<div class="row-card" data-oid="${esc(p.id)}"><div class="rc-main"><b>${esc(p.name)}</b><span>${money(p.price)}</span></div></div>`, 80);
        box.onclick = (e) => { const c = e.target.closest("[data-oid]"); if (c) editPackage(pkgById[c.dataset.oid]); };
      }
    } catch (e) { console.error(e); $("old").innerHTML = `<div class="empty">Could not load (${esc(e.code || e.message)})</div>`; }
  };
}

load();
