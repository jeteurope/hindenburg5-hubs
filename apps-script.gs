/* =========================================================================
   Hubwünsche – Google Apps Script Backend
   -------------------------------------------------------------------------
   Speichert die Stimmen in einem Google Sheet und liefert die aggregierte
   Rangliste als JSON/JSONP zurück. Kostenlos, kein Server nötig.

   EINRICHTUNG (Details in README.md):
   1. Neues Google Sheet anlegen.
   2. Erweiterungen ▸ Apps Script öffnen, diesen Code einfügen, speichern.
   3. Bereitstellen ▸ Neue Bereitstellung ▸ Typ "Web-App"
        - Ausführen als: Ich
        - Zugriff: "Jeder" (anonym)
   4. Web-App-URL kopieren und in app.js bei CONFIG.WEB_APP_URL eintragen.
   ========================================================================= */

var SHEET_NAME = 'Votes';
var MAX_WISHES = 10;
var HEADERS = ['Zeitstempel', 'Spieler', 'IATA', 'Prioritaet'];

/* ---------- Web-App Endpunkte ---------- */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'aggregate';
  var payload;
  try {
    if (action === 'aggregate') payload = aggregate();
    else payload = { ok: false, error: 'unbekannte Aktion' };
  } catch (err) {
    payload = { ok: false, error: String(err) };
  }
  return reply(payload, e);
}

function doPost(e) {
  var payload;
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'submit') payload = submit(body);
    else payload = { ok: false, error: 'unbekannte Aktion' };
  } catch (err) {
    payload = { ok: false, error: String(err) };
  }
  return reply(payload, e);
}

/* ---------- Logik ---------- */

function submit(body) {
  var name = String(body.player || '').trim().slice(0, 60);
  if (!name) return { ok: false, error: 'Spielername fehlt' };

  var wishes = (body.wishes || [])
    .map(function (w) { return String(w || '').trim().toUpperCase(); })
    .filter(function (w) { return /^[A-Z]{3}$/.test(w); });
  // Duplikate entfernen, Reihenfolge (= Priorität) beibehalten, auf 10 begrenzen
  var seen = {};
  wishes = wishes.filter(function (w) { if (seen[w]) return false; seen[w] = true; return true; }).slice(0, MAX_WISHES);
  if (!wishes.length) return { ok: false, error: 'keine gültigen IATA-Codes' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet();
    deletePlayerRows(sheet, name);
    var now = new Date();
    var rows = wishes.map(function (iata, i) { return [now, name, iata, i + 1]; });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function aggregate() {
  var sheet = getSheet();
  var last = sheet.getLastRow();
  var hubs = {};        // iata -> {iata, score, players:[{name,priority}]}
  var players = {};     // lowerName -> true

  if (last > 1) {
    var values = sheet.getRange(2, 1, last - 1, 4).getValues();
    for (var r = 0; r < values.length; r++) {
      var name = String(values[r][1] || '').trim();
      var iata = String(values[r][2] || '').trim().toUpperCase();
      var prio = Number(values[r][3]) || 0;
      if (!name || !/^[A-Z]{3}$/.test(iata) || prio < 1) continue;
      players[name.toLowerCase()] = true;
      var h = hubs[iata];
      if (!h) { h = hubs[iata] = { iata: iata, score: 0, players: [] }; }
      h.score += (MAX_WISHES + 1 - prio);   // Prio 1 -> 10 Punkte ... Prio 10 -> 1
      h.players.push({ name: name, priority: prio });
    }
  }

  var list = Object.keys(hubs).map(function (k) {
    var h = hubs[k];
    var voters = {};
    h.players.forEach(function (p) { voters[p.name.toLowerCase()] = true; });
    h.voters = Object.keys(voters).length;
    return h;
  });
  list.sort(function (a, b) {
    return (b.score - a.score) || (b.voters - a.voters) || (a.iata < b.iata ? -1 : 1);
  });

  return { ok: true, totalPlayers: Object.keys(players).length, hubs: list };
}

/* ---------- Sheet-Helfer ---------- */

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function deletePlayerRows(sheet, name) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var col = sheet.getRange(2, 2, last - 1, 1).getValues(); // Spalte "Spieler"
  var target = name.toLowerCase();
  // von unten nach oben löschen, damit Indizes stabil bleiben
  for (var i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0] || '').trim().toLowerCase() === target) {
      sheet.deleteRow(i + 2);
    }
  }
}

/* ---------- Antwort (JSON oder JSONP) ---------- */

function reply(obj, e) {
  var json = JSON.stringify(obj);
  var cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService
      .createTextOutput(cb + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
