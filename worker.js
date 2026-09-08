/* ============================================================
   Trainingslog Sync-Server (Cloudflare Worker)
   ------------------------------------------------------------
   Dieser kleine Server steht zwischen der App und GitHub.
   Das GitHub-Token liegt als Secret (GITHUB_TOKEN) sicher hier
   und ist NIEMALS im Browser oder im Link sichtbar.

   Die App ruft nur zwei Dinge auf:
     GET  ->  gibt den aktuellen Trainingslog zurueck (oder null)
     PUT  ->  speichert den Trainingslog (fuehrt beide Geraete zusammen)

   Einrichtung: siehe Anleitung im Chat.
   Konto und Repository ggf. unten anpassen.
   ============================================================ */

const OWNER  = "Chris1576";
const REPO   = "Training";
const PATH   = "Training.json";
const BRANCH = "main";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS),
  });
}

function ghHeaders(env) {
  return {
    "Authorization": "Bearer " + env.GITHUB_TOKEN,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "trainingslog-sync",
  };
}

function contentsUrl() {
  return "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" +
    PATH.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
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
    if (!alt) { map[k] = s; return; }
    const newer = (s.savedAt || 0) >= (alt.savedAt || 0) ? s : alt;
    const sets = {};
    const keys = {};
    Object.keys(s.sets || {}).forEach(function (ex) { keys[ex] = 1; });
    Object.keys(alt.sets || {}).forEach(function (ex) { keys[ex] = 1; });
    Object.keys(keys).forEach(function (ex) {
      sets[ex] = mergeSetArrays((s.sets || {})[ex], (alt.sets || {})[ex], s.savedAt, alt.savedAt);
    });
    map[k] = {
      id: newer.id, date: newer.date, unit: newer.unit, week: newer.week,
      stufe: newer.stufe, sets: sets, savedAt: Math.max(s.savedAt || 0, alt.savedAt || 0),
    };
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (x, y) { return x.date < y.date ? -1 : 1; });
}

function earliest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a < b ? a : b;
}

async function readFile(env) {
  const r = await fetch(
    contentsUrl() + "?ref=" + encodeURIComponent(BRANCH) + "&t=" + Date.now(),
    { headers: ghHeaders(env), cf: { cacheTtl: 0 } }
  );
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error("GitHub GET " + r.status);
  const j = await r.json();
  return { data: JSON.parse(decodeBase64(j.content)), sha: j.sha };
}

async function writeFile(env, obj, sha) {
  const body = {
    message: "Trainingslog " + new Date().toISOString().slice(0, 10),
    content: encodeBase64(JSON.stringify(obj, null, 1)),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  return fetch(contentsUrl(), {
    method: "PUT",
    headers: ghHeaders(env),
    body: JSON.stringify(body),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (!env.GITHUB_TOKEN) {
      return json({ error: "GITHUB_TOKEN Secret fehlt im Worker" }, 500);
    }

    try {
      if (request.method === "GET") {
        const cur = await readFile(env);
        return json(cur.data, 200);
      }

      if (request.method === "PUT" || request.method === "POST") {
        const incoming = await request.json();

        async function mergeAndWrite() {
          const cur = await readFile(env);
          let merged = incoming;
          if (cur.data && Array.isArray(cur.data.sessions)) {
            merged = {
              startDate: earliest(cur.data.startDate, incoming.startDate),
              sessions: mergeSessions(cur.data.sessions, incoming.sessions),
            };
          }
          return { r: await writeFile(env, merged, cur.sha), merged: merged };
        }

        let out = await mergeAndWrite();
        /* Bei gleichzeitigem Schreiben (409) einmal neu zusammenfuehren */
        if (out.r.status === 409) out = await mergeAndWrite();

        if (!out.r.ok) {
          const detail = await out.r.text();
          return json({ error: "GitHub PUT " + out.r.status, detail: detail }, 502);
        }
        return json({ ok: true, sessions: out.merged.sessions.length, data: out.merged }, 200);
      }

      return json({ error: "Method not allowed" }, 405);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};
