// messenger.js (admin) - customer chats: waiting / live / closed, reply, typing dots both ways, sounds from Firebase
import {
  db, $, esc, toDate, fmtDT, toast, askConfirm, skelRows, initPage,
  doc, getDoc, getDocs, updateDoc, addDoc, collection, query, where, orderBy, limit, limitToLast, onSnapshot, serverTimestamp
} from "./admin-common.js";

await initPage("messenger", "Messenger");

/* ---------------- sounds (links in Firebase: settings/app) ---------------- */
let sounds = {};
getDoc(doc(db, "settings", "app")).then((s) => (sounds = s.data() || {})).catch(() => {});
function beep(kind) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    (kind === "send" ? [660] : [880, 1175]).forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.16, ctx.currentTime + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.13);
      o.start(ctx.currentTime + i * 0.15); o.stop(ctx.currentTime + i * 0.15 + 0.14);
    });
  } catch (e) { /* no audio */ }
}
function playSound(kind) {
  const url = kind === "send" ? sounds.messageSendSoundUrl : sounds.messageReceiveSoundUrl;
  if (url) { try { new Audio(url).play().catch(() => beep(kind)); return; } catch (e) { /* fall back */ } }
  beep(kind);
}

/* ---------------- chat list (live) ---------------- */
const FILTERS = [["waiting", "Waiting"], ["live", "Live"], ["closed", "Closed"]];
const L_CHIP = { ta: "தமிழ்", en: "English", si: "සිංහල" };
let filter = "waiting", lim = 10, unsub = null, chats = [], loaded = false;
const revealed = new Set();

$("content").innerHTML = '<div class="chips" id="chips"></div><div id="list" style="display:grid;gap:10px"></div><div id="more"></div>';

function listen() {
  unsub && unsub();
  loaded = false; drawList();
  unsub = onSnapshot(query(collection(db, "chats"), where("status", "==", filter), limit(lim)), (s) => {
    chats = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toDate(b.updatedAt) || 0) - (toDate(a.updatedAt) || 0));
    loaded = true; drawList();
  }, (e) => { console.error(e); $("list").innerHTML = `<div class="empty">Could not load chats (${esc(e.code || e.message)})</div>`; });
}

function drawChips() {
  $("chips").innerHTML = FILTERS.map(([v, l]) => `<button class="fchip ${v === filter ? "on" : ""}" data-f="${v}">${l}</button>`).join("");
  $("chips").querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; lim = 10; drawChips(); listen(); }));
}

function drawList() {
  const box = $("list");
  if (!loaded) { box.innerHTML = skelRows(3); $("more").innerHTML = ""; return; }
  if (!chats.length) { box.innerHTML = `<div class="empty">No ${filter} chats.</div>`; $("more").innerHTML = ""; return; }
  box.innerHTML = chats.map((c) => `<div class="row-card m-card" data-open="${esc(c.id)}">
      <div class="rc-main"><b>${esc(c.customerName || c.id)}</b><span>${esc(c.lastMessage || "")}</span><small>${esc(c.id)} • ${fmtDT(c.updatedAt)}</small></div>
      <div class="rc-side">${c.unreadAdmin ? '<i class="unread-dot"></i>' : ""}${c.language ? `<span class="chip c-blue">${L_CHIP[c.language] || esc(c.language)}</span>` : ""}</div></div>`).join("");
  const key = "list:" + filter;
  if (!revealed.has(key)) {                         // first time: cards appear one by one
    box.querySelectorAll(".row-card").forEach((el, i) => { el.classList.add("rise"); el.style.animationDelay = i * 110 + "ms"; });
    revealed.add(key);
  }
  box.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openChat(chats.find((c) => c.id === b.dataset.open))));
  $("more").innerHTML = chats.length >= lim ? '<button class="btn btn-ghost btn-block" id="more-btn">Load more</button>' : "";
  const mb = $("more-btn"); if (mb) mb.onclick = () => { lim += 10; listen(); };
}

/* ---------------- one conversation ---------------- */
function openChat(c0) {
  if (!c0) return;
  const phone = c0.id, ref = doc(db, "chats", phone), msgs = collection(db, "chats", phone, "messages");
  const wrap = document.createElement("div");
  wrap.className = "chat-sheet";
  wrap.innerHTML = `
    <div class="chat-top">
      <button class="icon-btn" data-x aria-label="Back"><svg viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></button>
      <a class="chat-who" id="who" href="users.html?phone=${encodeURIComponent(phone)}"><b>${esc(c0.customerName || phone)}</b><small>${esc(phone)}</small></a>
      <span class="chip c-gray" id="st"></span>
    </div>
    <div class="chat-actions"><button class="btn btn-primary btn-sm" id="take">Take call</button><button class="btn btn-danger btn-sm" id="end">End chat</button></div>
    <div class="chat-msgs" id="cm"><div class="skel-row"></div><div class="skel-row"></div></div>
    <form class="chat-composer" id="form" autocomplete="off">
      <input class="input" id="text" placeholder="Type a reply" maxlength="500" autocomplete="off">
      <button class="send" type="submit" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>
    </form>`;
  document.body.appendChild(wrap);
  const q = (s) => wrap.querySelector(s);

  let cur = c0, list = [], typingOn = false, typingTimer = null, lastMark = 0, lastTyped = 0, firstChat = true, firstMsgs = true;
  const stopA = [];
  const close = () => { stopA.forEach((f) => f()); clearTimeout(typingTimer); wrap.remove(); };
  q("[data-x]").onclick = close;

  // the name as saved on the customer's profile
  getDoc(doc(db, "users", phone)).then((u) => { if (u.exists() && u.data().name) q("#who b").textContent = u.data().name; }).catch(() => {});

  const draw = () => {
    const box = q("#cm");
    box.innerHTML = list.map((m) => {
      const t = toDate(m.createdAt);
      return `<div class="cm ${esc(m.sender)}">${m.sender === "bot" ? '<span class="tag">Assistant</span>' : ""}<div class="bub">${esc(m.text)}</div>
        <small>${t ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</small></div>`;
    }).join("") + (typingOn ? '<div class="cm customer typing"><div class="bub"><i></i><i></i><i></i></div></div>' : "");
    box.scrollTop = box.scrollHeight;
  };
  const showTyping = () => { typingOn = true; draw(); clearTimeout(typingTimer); typingTimer = setTimeout(() => { typingOn = false; draw(); }, 5000); };

  stopA.push(onSnapshot(ref, (s) => {
    cur = { id: phone, ...s.data() };
    const st = cur.status || "closed";
    q("#st").textContent = { waiting: "Waiting", live: "Live", closed: "Closed", language: "Choosing language" }[st] || st;
    q("#take").hidden = st !== "waiting";
    q("#end").hidden = !(st === "waiting" || st === "live");
    const mark = toDate(cur.customerTypingAt)?.getTime() || 0;      // a new value = the customer is typing
    if (mark && mark !== lastMark) { lastMark = mark; if (!firstChat) showTyping(); }
    firstChat = false;
  }));
  stopA.push(onSnapshot(query(msgs, orderBy("createdAt", "asc"), limitToLast(200)), (s) => {
    list = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!firstMsgs) s.docChanges().forEach((ch) => { if (ch.type === "added" && ch.doc.data().sender === "customer") { typingOn = false; playSound("receive"); } });
    firstMsgs = false;
    draw();
  }));
  updateDoc(ref, { unreadAdmin: false }).catch(() => {});

  const takeCall = async () => {
    await updateDoc(ref, { status: "live", adminCall: false, unreadAdmin: false, updatedAt: serverTimestamp() });
    const r = await getDocs(query(collection(db, "adminCalls"), where("phone", "==", phone), where("status", "==", "ringing")));
    await Promise.all(r.docs.map((d) => updateDoc(d.ref, { status: "answered", answeredAt: serverTimestamp() })));
  };
  q("#take").onclick = async (e) => { e.target.disabled = true; try { await takeCall(); } catch (err) { console.error(err); toast("Could not take the call"); } finally { e.target.disabled = false; } };
  q("#end").onclick = async () => {
    if (!(await askConfirm("End this chat?", "The customer can start again by typing Hi.", "End chat"))) return;
    await updateDoc(ref, { status: "closed", endedAt: serverTimestamp(), adminCall: false }); toast("Chat ended");
  };

  // the customer sees "..." while you type
  q("#text").addEventListener("input", () => {
    if (Date.now() - lastTyped < 2500) return;
    lastTyped = Date.now();
    updateDoc(ref, { adminTypingAt: serverTimestamp() }).catch(() => {});
  });
  q("#form").onsubmit = async (e) => {
    e.preventDefault();
    const t = q("#text").value.trim();
    if (!t) return;
    q("#text").value = "";
    playSound("send");
    try {
      await addDoc(msgs, { sender: "admin", text: t, createdAt: serverTimestamp() });
      if ((cur.status || "") !== "live") await takeCall();
      await updateDoc(ref, { lastMessage: t, lastSender: "admin", updatedAt: serverTimestamp(), unreadAdmin: false });
    } catch (err) { console.error(err); toast("Could not send"); }
  };
}

drawChips();
listen();
