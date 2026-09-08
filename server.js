/* ============================================================
   Trainingslog Server (Railway)
   ------------------------------------------------------------
   Liefert die App (index.html) aus und synchronisiert die
   Trainingsdaten auf einem persistenten Volume.

   Alles ist mit HTTP Basic Auth geschuetzt:
     AUTH_USER / AUTH_PASS  (Umgebungsvariablen)

   Daten liegen als JSON-Datei:
     DATA_FILE  (Standard: /data/Training.json)

   Die App ruft nur zwei Dinge auf:
     GET  /api/data  ->  aktueller Trainingslog (oder null)
     PUT  /api/data  ->  speichert und fuehrt beide Geraete zusammen
   ============================================================ */

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const AUTH_USER = process.env.AUTH_USER || "";
const AUTH_PASS = process.env.AUTH_PASS || "";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "Training.json");
const SEED_FILE = path.join(__dirname, "Training.json");
const COOKIE = "tl_auth";
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; /* ~400 Tage, Browser-Maximum */

app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function cookieValue(req) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map(function (p) { return p.trim(); });
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].indexOf(COOKIE + "=") === 0)
      return parts[i].slice(COOKIE.length + 1);
  }
  return "";
}

function validCookie(token) {
  const bits = String(token || "").split(".");
  if (bits.length !== 2) return false;
  const payload = bits[0];
  const sig = bits[1];
  const expected = crypto.createHmac("sha256", AUTH_PASS).update(payload).digest("base64url");
  if (!timingSafeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data && data.u === AUTH_USER && Number(data.e) > Date.now();
  } catch (e) {
    return false;
  }
}

function setLoginCookie(req, res) {
  const exp = Date.now() + COOKIE_MAX_AGE * 1000;
  const payload = Buffer.from(JSON.stringify({ u: AUTH_USER, e: exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_PASS).update(payload).digest("base64url");
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  const parts = [
    COOKIE + "=" + payload + "." + sig,
    "Path=/",
    "Max-Age=" + COOKIE_MAX_AGE,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

/* Einmal Basic Auth, danach langlebiges Cookie — kein erneutes Passwortfenster. */
app.use(function (req, res, next) {
  if (!AUTH_USER || !AUTH_PASS) {
    return res
      .status(500)
      .send("Server nicht konfiguriert: AUTH_USER / AUTH_PASS fehlen.");
  }
  if (validCookie(cookieValue(req))) {
    setLoginCookie(req, res);
    return next();
  }
  const header = req.headers.authorization || "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (match) {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    if (timingSafeEqual(user, AUTH_USER) && timingSafeEqual(pass, AUTH_PASS)) {
      setLoginCookie(req, res);
      return next();
    }
  }
  res.set("WWW-Authenticate", 'Basic realm="Trainingslog", charset="UTF-8"');
  return res.status(401).send("Anmeldung erforderlich.");
});

/* ---------- Datei-Helfer ---------- */
function ensureDataFile() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      /* Seeding: bisherigen Verlauf einmalig uebernehmen */
      if (fs.existsSync(SEED_FILE)) {
        fs.copyFileSync(SEED_FILE, DATA_FILE);
        console.log("Seed: " + SEED_FILE + " -> " + DATA_FILE);
      } else {
        fs.writeFileSync(
          DATA_FILE,
          JSON.stringify({ startDate: null, sessions: [] }, null, 1)
        );
      }
    }
  } catch (e) {
    console.error("ensureDataFile:", e.message);
  }
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("readData:", e.message);
    return null;
  }
}

function writeData(obj) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, DATA_FILE);
}

function setHasVal(s) {
  return !!(s && ((s.kg !== "" && s.kg != null) || (s.reps !== "" && s.reps != null)));
}
function setStamp(s, sessionSavedAt) {
  return Number(s && s.savedAt) || Number(sessionSavedAt) || 0;
}
function mergeSetArrays(a, b, savedA, savedB) {
  const aa = a || [];
  const bb = b || [];
  const n = Math.max(aa.length, bb.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const sa = aa[i];
    const sb = bb[i];
    if (sa == null && sb == null) continue;
    if (sa == null) { out.push(sb); continue; }
    if (sb == null) { out.push(sa); continue; }
    const fa = setHasVal(sa);
    const fb = setHasVal(sb);
    if (fa && !fb) { out.push(sa); continue; }
    if (fb && !fa) { out.push(sb); continue; }
    out.push(setStamp(sa, savedA) >= setStamp(sb, savedB) ? sa : sb);
  }
  return out;
}
/* Gleicher Tag + gleiche Einheit = derselbe Eintrag. Pro Satzindex
   gewinnt der juengere savedAt — andere Saetze bleiben erhalten. */
function mergeSessions(a, b) {
  const map = {};
  (a || []).concat(b || []).forEach(function (s) {
    const k = s.date + "|" + s.unit;
    const alt = map[k];
    if (!alt) {
      map[k] = s;
      return;
    }
    const newer = (s.savedAt || 0) >= (alt.savedAt || 0) ? s : alt;
    const sets = {};
    const keys = {};
    Object.keys(s.sets || {}).forEach(function (ex) { keys[ex] = 1; });
    Object.keys(alt.sets || {}).forEach(function (ex) { keys[ex] = 1; });
    Object.keys(keys).forEach(function (ex) {
      sets[ex] = mergeSetArrays((s.sets || {})[ex], (alt.sets || {})[ex], s.savedAt, alt.savedAt);
    });
    map[k] = {
      id: newer.id,
      date: newer.date,
      unit: newer.unit,
      week: newer.week,
      stufe: newer.stufe,
      sets: sets,
      savedAt: Math.max(s.savedAt || 0, alt.savedAt || 0),
    };
  });
  return Object.keys(map)
    .map(function (k) {
      return map[k];
    })
    .sort(function (x, y) {
      return x.date < y.date ? -1 : 1;
    });
}

function dataStamp(d) {
  return {
    startDate: d && d.startDate ? d.startDate : null,
    sessions: d && Array.isArray(d.sessions) ? d.sessions : [],
    updatedAt: Number(d && d.updatedAt) || 0,
    wipedAt: Number(d && d.wipedAt) || 0,
  };
}

function reconcile(a, b) {
  if (!b) return dataStamp(a);
  if (!a) return dataStamp(b);
  var A = dataStamp(a);
  var B = dataStamp(b);
  if (B.wipedAt && B.wipedAt >= A.updatedAt && B.wipedAt >= A.wipedAt) return B;
  if (A.wipedAt && A.wipedAt >= B.updatedAt && A.wipedAt >= B.wipedAt) return A;
  return {
    startDate:
      !A.startDate || (B.startDate && B.startDate < A.startDate)
        ? B.startDate || A.startDate
        : A.startDate,
    sessions: mergeSessions(A.sessions, B.sessions),
    updatedAt: Math.max(A.updatedAt, B.updatedAt),
    wipedAt: Math.max(A.wipedAt, B.wipedAt),
  };
}

function earliest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a < b ? a : b;
}

/* ---------- API ---------- */
app.get("/api/data", function (req, res) {
  res.set("Cache-Control", "no-store");
  res.json(readData());
});

function saveHandler(req, res) {
  try {
    const incoming = req.body || {};
    const cur = readData();
    const merged = reconcile(cur, incoming);
    writeData(merged);
    res.json({ ok: true, sessions: (merged.sessions || []).length, data: merged });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
app.put("/api/data", saveHandler);
app.post("/api/data", saveHandler);

/* ---------- App-Auslieferung ---------- */
app.get("/", function (req, res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.sendFile(path.join(__dirname, "index.html"));
});
app.use(express.static(__dirname, {
  index: false,
  setHeaders: function (res, filePath) {
    if (/\.(html|js)$/i.test(filePath))
      res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  },
}));

ensureDataFile();
app.listen(PORT, function () {
  console.log("Trainingslog laeuft auf Port " + PORT);
  console.log("Datendatei: " + DATA_FILE);
});
