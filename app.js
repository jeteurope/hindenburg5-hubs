/* =========================================================================
   Hubwünsche – App-Logik
   - Reine statische Seite (GitHub Pages tauglich).
   - Speicher: Google-Sheets Web-App (siehe CONFIG.WEB_APP_URL & apps-script.gs).
   - Solange keine URL eingetragen ist, läuft alles lokal im "Demo-Modus"
     (localStorage), damit du die Seite sofort testen kannst.
   ========================================================================= */

const CONFIG = {
  // 👉 Hier die Web-App-URL aus Google Apps Script eintragen (siehe README.md).
  //    Leer lassen = Demo-Modus (nur dieser Browser, kein echtes Multiplayer).
  WEB_APP_URL: "https://script.google.com/macros/s/AKfycbzSamJifHyhToiEP0DcEjmaZd6O-CqXkJo8_HLIhI5aNI9eBZ_QRdhu4T808EdDv6CD/exec",

  MAX_WISHES: 10,
};

/* ---------- Hilfen ---------- */
const $ = (sel) => document.querySelector(sel);
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const points = (priorityIndex) => CONFIG.MAX_WISHES - priorityIndex; // index 0 -> 10 Punkte
let regionNames = null;
try { regionNames = new Intl.DisplayNames(["de"], { type: "region" }); } catch (e) { /* alt. */ }
const countryName = (iso) => {
  if (!iso) return "";
  try { return (regionNames && regionNames.of(iso)) || iso; } catch (e) { return iso; }
};
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Flughafen-Index ---------- */
// window.AIRPORTS: [IATA, Name, Stadt, ISO, lat, lon]
const A_IATA = 0, A_NAME = 1, A_CITY = 2, A_ISO = 3, A_LAT = 4, A_LON = 5;
const byIata = new Map();
const searchIndex = [];
(function buildIndex() {
  (window.AIRPORTS || []).forEach((a, i) => {
    byIata.set(a[A_IATA], a);
    searchIndex.push({ a, rank: i, hay: norm(a[A_IATA] + " " + a[A_NAME] + " " + a[A_CITY]) });
  });
})();
const apName = (iata) => { const a = byIata.get(iata); return a ? a[A_NAME] : iata; };
const apCity = (iata) => { const a = byIata.get(iata); return a ? a[A_CITY] : ""; };
const apLatLon = (iata) => { const a = byIata.get(iata); return a ? [a[A_LAT], a[A_LON]] : null; };

/* =========================================================================
   ZUSTAND
   ========================================================================= */
let myWishes = [];            // Array von IATA-Codes (Reihenfolge = Priorität)
let lastAggregate = { hubs: [], totalPlayers: 0 };
let jsonpId = 0;

const LS_NAME = "hub_player_name";
const LS_WISHES = "hub_my_wishes";
const LS_DEMO = "hub_demo_votes";   // nur Demo-Modus

const isDemo = () => !CONFIG.WEB_APP_URL;

/* =========================================================================
   KARTE
   ========================================================================= */
const map = L.map("map", { worldCopyJump: true, minZoom: 2, zoomControl: true })
  .setView([25, 10], 2);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '© OpenStreetMap, © CARTO',
  subdomains: "abcd", maxZoom: 19,
}).addTo(map);

const aggLayer = L.layerGroup().addTo(map);
const myLayer = L.layerGroup().addTo(map);

const HEAT = ["#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c"];
function heatColor(ratio) { return HEAT[Math.min(HEAT.length - 1, Math.floor(ratio * HEAT.length))]; }

function renderAggMarkers(hubs) {
  aggLayer.clearLayers();
  const maxScore = hubs.reduce((m, h) => Math.max(m, h.score), 0);
  hubs.forEach((h) => {
    const ll = apLatLon(h.iata);
    if (!ll) return;
    const ratio = maxScore ? h.score / maxScore : 0;
    const radius = 8 + 22 * Math.sqrt(ratio || 0.0001);
    const m = L.circleMarker(ll, {
      radius, color: "#fff", weight: 1.5,
      fillColor: heatColor(ratio), fillOpacity: 0.82,
    });
    m.bindPopup(buildPopup(h), { maxWidth: 260 });
    m.addTo(aggLayer);
  });
}

function buildPopup(h) {
  const el = document.createElement("div");
  const players = h.players.slice().sort((a, b) => a.priority - b.priority);
  el.innerHTML =
    `<div style="font-weight:800;font-size:1.05rem;letter-spacing:.03em">${escapeHTML(h.iata)}</div>` +
    `<div style="font-size:.85rem;color:#475569;margin:2px 0 6px">${escapeHTML(apName(h.iata))}` +
    `${apCity(h.iata) ? ", " + escapeHTML(apCity(h.iata)) : ""}</div>` +
    `<div style="font-size:.82rem;margin-bottom:6px"><b>${h.score}</b> Punkte · ` +
    `<b>${h.voters}</b> Spieler</div>` +
    `<div style="font-size:.78rem;color:#475569;line-height:1.5">` +
    players.map((p) => `<span>${escapeHTML(p.name)} <span style="color:#94a3b8">(Prio ${p.priority})</span></span>`).join("<br>") +
    `</div>`;
  const already = myWishes.includes(h.iata);
  const full = myWishes.length >= CONFIG.MAX_WISHES;
  if (!already) {
    const btn = document.createElement("button");
    btn.textContent = full ? "Liste voll (max. 10)" : "+ Zu meinen Wünschen";
    btn.disabled = full;
    btn.style.cssText =
      "margin-top:9px;width:100%;border:none;border-radius:8px;padding:8px;font:inherit;font-weight:700;" +
      "font-size:.82rem;cursor:pointer;color:#fff;background:" + (full ? "#cbd5e1" : "#0ea5e9");
    if (!full) btn.onclick = () => { addWish(h.iata); map.closePopup(); };
    el.appendChild(btn);
  } else {
    const tag = document.createElement("div");
    tag.textContent = "✓ Bereits in deiner Liste";
    tag.style.cssText = "margin-top:9px;font-size:.8rem;color:#16a34a;font-weight:700;text-align:center";
    el.appendChild(tag);
  }
  return el;
}

function renderMyMarkers() {
  myLayer.clearLayers();
  myWishes.forEach((iata, i) => {
    const ll = apLatLon(iata);
    if (!ll) return;
    const icon = L.divIcon({
      className: "",
      html: `<div style="width:24px;height:24px;border-radius:50%;background:#0ea5e9;color:#fff;` +
            `border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;` +
            `justify-content:center;font:700 12px sans-serif">${i + 1}</div>`,
      iconSize: [24, 24], iconAnchor: [12, 12],
    });
    L.marker(ll, { icon, zIndexOffset: 1000, title: iata + " – " + apName(iata) }).addTo(myLayer);
  });
}

/* =========================================================================
   SUCHE
   ========================================================================= */
const searchEl = $("#search");
const resultsEl = $("#results");
let activeIdx = -1;
let currentResults = [];

function runSearch(qRaw) {
  const q = norm(qRaw.trim());
  if (!q) { closeResults(); return; }
  const scored = [];
  for (const item of searchIndex) {
    const code = item.a[A_IATA].toLowerCase();
    let s;
    if (code === q) s = 0;
    else if (code.startsWith(q)) s = 1;
    else if (item.hay.startsWith(q)) s = 2;
    else if (item.hay.includes(q)) s = 3;
    else continue;
    scored.push({ item, s });
    if (scored.length > 400) break; // genug Kandidaten gesammelt
  }
  scored.sort((x, y) => (x.s - y.s) || (x.item.rank - y.item.rank));
  currentResults = scored.slice(0, 30).map((x) => x.item.a);
  activeIdx = currentResults.length ? 0 : -1;
  renderResults();
}

function renderResults() {
  if (!currentResults.length) {
    resultsEl.innerHTML = `<div class="no-res">Kein Flughafen gefunden.</div>`;
    resultsEl.classList.add("open");
    searchEl.setAttribute("aria-expanded", "true");
    return;
  }
  resultsEl.innerHTML = currentResults.map((a, i) => {
    const chosen = myWishes.includes(a[A_IATA]);
    const cn = countryName(a[A_ISO]);
    return `<div class="result ${i === activeIdx ? "active" : ""} ${chosen ? "disabled" : ""}" data-iata="${a[A_IATA]}" role="option">
      <span class="code">${escapeHTML(a[A_IATA])}</span>
      <span class="meta">
        <span class="nm">${escapeHTML(a[A_NAME])}</span>
        <span class="ct">${escapeHTML([a[A_CITY], cn].filter(Boolean).join(", "))}</span>
      </span>
      <span class="add">${chosen ? "✓" : "+"}</span>
    </div>`;
  }).join("");
  resultsEl.classList.add("open");
  searchEl.setAttribute("aria-expanded", "true");
}

function closeResults() {
  resultsEl.classList.remove("open");
  searchEl.setAttribute("aria-expanded", "false");
  activeIdx = -1;
}

function chooseResult(iata) {
  if (!iata) return;
  if (!myWishes.includes(iata)) addWish(iata);
  searchEl.value = "";
  closeResults();
  searchEl.focus();
}

searchEl.addEventListener("input", () => runSearch(searchEl.value));
searchEl.addEventListener("focus", () => { if (searchEl.value.trim()) runSearch(searchEl.value); });
searchEl.addEventListener("keydown", (e) => {
  if (!resultsEl.classList.contains("open")) return;
  if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(currentResults.length - 1, activeIdx + 1); renderResults(); scrollActive(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); renderResults(); scrollActive(); }
  else if (e.key === "Enter") { e.preventDefault(); const a = currentResults[activeIdx]; if (a) chooseResult(a[A_IATA]); }
  else if (e.key === "Escape") { closeResults(); }
});
function scrollActive() {
  const el = resultsEl.querySelector(".result.active");
  if (el) el.scrollIntoView({ block: "nearest" });
}
resultsEl.addEventListener("mousedown", (e) => {
  // mousedown statt click, damit der Klick nicht durch blur verloren geht
  const row = e.target.closest(".result");
  if (!row) return;
  e.preventDefault();
  if (row.classList.contains("disabled")) return;
  chooseResult(row.dataset.iata);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) closeResults();
});

/* =========================================================================
   AUSWAHL-LISTE (Wünsche)
   ========================================================================= */
function addWish(iata) {
  if (myWishes.includes(iata)) return;
  if (myWishes.length >= CONFIG.MAX_WISHES) { flash("Maximal 10 Hubs – entferne erst einen.", "err"); return; }
  myWishes.push(iata);
  persistWishes();
  renderWishes(); renderMyMarkers(); updateMapSub();
  const ll = apLatLon(iata);
  if (ll) map.flyTo(ll, Math.max(map.getZoom(), 4), { duration: 0.6 });
}
function removeWish(iata) {
  myWishes = myWishes.filter((w) => w !== iata);
  persistWishes();
  renderWishes(); renderMyMarkers(); updateMapSub();
}
function moveWish(from, to) {
  if (to < 0 || to >= myWishes.length) return;
  const [it] = myWishes.splice(from, 1);
  myWishes.splice(to, 0, it);
  persistWishes();
  renderWishes(); renderMyMarkers();
}

const wishesEl = $("#wishes");
let dragFrom = -1;
function renderWishes() {
  wishesEl.innerHTML = myWishes.map((iata, i) => {
    const cn = countryName((byIata.get(iata) || [])[A_ISO]);
    const sub = [apCity(iata), cn].filter(Boolean).join(", ");
    return `<li class="wish" draggable="true" data-iata="${iata}" data-idx="${i}">
      <span class="grip" title="Ziehen zum Sortieren">⋮⋮</span>
      <span class="rank">${i + 1}</span>
      <span class="code">${escapeHTML(iata)}</span>
      <span class="nm">${escapeHTML(apName(iata))}${sub ? " · " + escapeHTML(sub) : ""}</span>
      <span class="ctrls">
        <button class="iconbtn up" title="Höher priorisieren" ${i === 0 ? "disabled" : ""}>▲</button>
        <button class="iconbtn down" title="Niedriger priorisieren" ${i === myWishes.length - 1 ? "disabled" : ""}>▼</button>
        <button class="iconbtn del" title="Entfernen">✕</button>
      </span>
    </li>`;
  }).join("");
  $("#wishCount").textContent = myWishes.length;
  updateSubmitState();
}
wishesEl.addEventListener("click", (e) => {
  const li = e.target.closest(".wish"); if (!li) return;
  const idx = Number(li.dataset.idx);
  if (e.target.closest(".up")) moveWish(idx, idx - 1);
  else if (e.target.closest(".down")) moveWish(idx, idx + 1);
  else if (e.target.closest(".del")) removeWish(li.dataset.iata);
});
// Drag & Drop sortieren
wishesEl.addEventListener("dragstart", (e) => {
  const li = e.target.closest(".wish"); if (!li) return;
  dragFrom = Number(li.dataset.idx); li.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
});
wishesEl.addEventListener("dragend", (e) => {
  const li = e.target.closest(".wish"); if (li) li.classList.remove("dragging");
  dragFrom = -1;
});
wishesEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  const li = e.target.closest(".wish"); if (!li || dragFrom < 0) return;
  const to = Number(li.dataset.idx);
  if (to !== dragFrom) { moveWish(dragFrom, to); dragFrom = to; }
});

/* =========================================================================
   SPEICHER-ABSTRAKTION (Remote = Sheets, sonst lokal)
   ========================================================================= */
function computeAggregate(votes) {
  // votes: [{name, wishes:[iata,...]}]
  const hubs = new Map();
  const playerSet = new Set();
  votes.forEach((v) => {
    const name = (v.name || "").trim();
    if (!name) return;
    playerSet.add(name.toLowerCase());
    (v.wishes || []).slice(0, CONFIG.MAX_WISHES).forEach((iata, i) => {
      if (!iata) return;
      let h = hubs.get(iata);
      if (!h) { h = { iata, score: 0, voters: 0, players: [] }; hubs.set(iata, h); }
      h.score += points(i);
      h.players.push({ name, priority: i + 1 });
    });
  });
  const list = [...hubs.values()].map((h) => ({ ...h, voters: new Set(h.players.map((p) => p.name.toLowerCase())).size }));
  list.sort((a, b) => (b.score - a.score) || (b.voters - a.voters) || a.iata.localeCompare(b.iata));
  return { hubs: list, totalPlayers: playerSet.size };
}

/* ---- Demo (localStorage) ---- */
function demoVotes() { try { return JSON.parse(localStorage.getItem(LS_DEMO) || "[]"); } catch (e) { return []; } }
function demoSubmit(name, wishes) {
  const votes = demoVotes().filter((v) => (v.name || "").trim().toLowerCase() !== name.trim().toLowerCase());
  votes.push({ name: name.trim(), wishes });
  localStorage.setItem(LS_DEMO, JSON.stringify(votes));
}

/* ---- Remote (Google Sheets via Apps Script) ---- */
function jsonp(params) {
  return new Promise((resolve, reject) => {
    const cb = "__hub_cb_" + (jsonpId++);
    const s = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject(new Error("Zeitüberschreitung")); }, 12000);
    function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
    window[cb] = (data) => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error("Netzwerkfehler")); };
    const qs = new URLSearchParams({ ...params, callback: cb, _: String(jsonpId) });
    s.src = CONFIG.WEB_APP_URL + "?" + qs.toString();
    document.body.appendChild(s);
  });
}
async function remoteAggregate() {
  const data = await jsonp({ action: "aggregate" });
  return { hubs: data.hubs || [], totalPlayers: data.totalPlayers || 0 };
}
async function remoteSubmit(name, wishes) {
  // no-cors: Antwort ist "opaque" und nicht lesbar – das ist ok,
  // der Schreibvorgang erreicht das Sheet trotzdem. Danach neu laden.
  await fetch(CONFIG.WEB_APP_URL, {
    method: "POST", mode: "no-cors",
    body: JSON.stringify({ action: "submit", player: name, wishes }),
  });
}

/* ---- gemeinsame Lade-/Speicher-Funktionen ---- */
async function loadAggregate() {
  try {
    const agg = isDemo() ? computeAggregate(demoVotes()) : await remoteAggregate();
    lastAggregate = agg;
    renderAggMarkers(agg.hubs);
    renderBoard(agg);
    updateMapSub();
    setStatus(isDemo() ? "demo" : "live");
  } catch (e) {
    console.error(e);
    setStatus("error", e.message);
  }
}

/* =========================================================================
   RANGLISTE (Top 10 Tabelle)
   ========================================================================= */
const boardEl = $("#board");
const boardEmptyEl = $("#boardEmpty");
function renderBoard(agg) {
  const top = agg.hubs.slice(0, 10);
  $("#boardSub").textContent = agg.totalPlayers
    ? `${agg.totalPlayers} Spieler · ${agg.hubs.length} Hubs`
    : "";
  if (!top.length) {
    boardEl.innerHTML = "";
    boardEmptyEl.style.display = "block";
    return;
  }
  boardEmptyEl.style.display = "none";
  const myName = norm($("#playerName").value.trim());
  const maxScore = top[0].score || 1;
  boardEl.innerHTML = top.map((h, i) => {
    const players = h.players.slice().sort((a, b) => a.priority - b.priority);
    const chips = players.map((p) =>
      `<span class="chip ${norm(p.name) === myName && myName ? "me" : ""}" title="Priorität ${p.priority}">${escapeHTML(p.name)}</span>`
    ).join("");
    return `<tr>
      <td class="rankcell ${i < 3 ? "top" : ""}">${i + 1}</td>
      <td>
        <div class="hubcell"><span class="code">${escapeHTML(h.iata)}</span>
          <span class="nm">${escapeHTML(apName(h.iata))}</span></div>
        <div class="bar" style="width:${Math.max(6, (h.score / maxScore) * 100)}%"></div>
      </td>
      <td class="num score">${h.score}</td>
      <td class="num">${h.voters}</td>
      <td><div class="players">${chips}</div></td>
    </tr>`;
  }).join("");
}

/* =========================================================================
   SPEICHERN (Submit)
   ========================================================================= */
const submitBtn = $("#submitBtn");
const nameEl = $("#playerName");

function updateSubmitState() {
  const ok = nameEl.value.trim().length > 0 && myWishes.length > 0;
  submitBtn.disabled = !ok;
  $("#formHint").textContent = !nameEl.value.trim()
    ? "Trag deinen Namen ein und wähle mindestens 1 Hub."
    : !myWishes.length
      ? "Wähle mindestens 1 Hub aus."
      : `Bereit: ${myWishes.length} ${myWishes.length === 1 ? "Hub" : "Hubs"} werden für „${nameEl.value.trim()}“ gespeichert.`;
}

async function doSubmit() {
  const name = nameEl.value.trim();
  if (!name || !myWishes.length) return;
  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = "Speichere…";
  try {
    if (isDemo()) demoSubmit(name, myWishes.slice());
    else await remoteSubmit(name, myWishes.slice());
    localStorage.setItem(LS_NAME, name);
    flash(isDemo()
      ? "Gespeichert (Demo-Modus, nur dieser Browser). ✓"
      : "Gespeichert! Deine Wünsche sind jetzt für alle sichtbar. ✓", "ok");
    // Remote braucht einen Moment, bis das Sheet geschrieben ist.
    await new Promise((r) => setTimeout(r, isDemo() ? 50 : 1200));
    await loadAggregate();
  } catch (e) {
    console.error(e);
    flash("Speichern fehlgeschlagen: " + e.message, "err");
  } finally {
    submitBtn.textContent = original;
    updateSubmitState();
  }
}
submitBtn.addEventListener("click", doSubmit);
nameEl.addEventListener("input", () => { updateSubmitState(); });

/* =========================================================================
   STATUS / TOAST / PERSISTENZ
   ========================================================================= */
function setStatus(kind, detail) {
  const badge = $("#statusBadge"), text = $("#statusText");
  badge.className = "status";
  if (kind === "live") { badge.classList.add("live"); text.textContent = "Live · alle Spieler"; }
  else if (kind === "demo") { badge.classList.add("demo"); text.textContent = "Demo-Modus (nur dieser Browser)"; }
  else if (kind === "error") { text.textContent = "Verbindungsfehler" + (detail ? " – " + detail : ""); }
  else { text.textContent = "Lädt…"; }
}
let toastTimer = null;
function flash(msg, kind) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast " + (kind || "ok");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = "toast"; }, 6000);
}
function persistWishes() { localStorage.setItem(LS_WISHES, JSON.stringify(myWishes)); }
function updateMapSub() {
  const n = lastAggregate.hubs.length;
  $("#mapSub").textContent = `${n} ${n === 1 ? "Hub" : "Hubs"} gewünscht`;
}

/* =========================================================================
   START
   ========================================================================= */
(function init() {
  // gespeicherten Namen + Auswahl wiederherstellen
  nameEl.value = localStorage.getItem(LS_NAME) || "";
  try {
    const saved = JSON.parse(localStorage.getItem(LS_WISHES) || "[]");
    myWishes = saved.filter((i) => byIata.has(i)).slice(0, CONFIG.MAX_WISHES);
  } catch (e) { myWishes = []; }

  renderWishes(); renderMyMarkers(); updateSubmitState();
  setStatus("loading");
  loadAggregate().then(updateMapSub);
})();
