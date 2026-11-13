/*
 * Morning Stall — shared data for everyone who logs in.
 *
 *   POST /api/login   {u, p}          -> {token, user, name}
 *   GET  /api/stall?rev=N             -> {rev, db}   (or {rev, same:true} if nothing changed since N)
 *   POST /api/ops     {ops:[[name, args], ...]}  -> {rev}
 *
 * The numbers live in Netlify Blobs (store "stall", key "data"), so John and
 * Dhivagar always see the same sheet on any phone or laptop.
 *
 * Passwords: set PASSWORD_JOHN and PASSWORD_DHIVAGAR in Netlify
 * (Site configuration -> Environment variables). Until you do, the old
 * passwords from the first version of the app still work.
 */
import { getStore } from "@netlify/blobs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/* ---------- stall setup (keep in step with index.html) ---------- */
const ITEMS = ["oats", "sand"];
const DEF_PRICES = { oats: { price: 50 }, sand: { price: 50 } };
/* Day 1–5: recorded as profit only, before item counts were kept */
const HISTORY = { "2026-11-03": 540, "2026-11-04": -500, "2026-11-05": 650, "2026-11-06": 650, "2026-11-07": 350 };

const USERS = {
  john: { name: "John", env: "PASSWORD_JOHN", fallback: "d60dfd6cedb3ae384f4b2be38cbedb264a3ab3511084eace29ff2bce3135bdad" },
  dhivagar: { name: "Dhivagar", env: "PASSWORD_DHIVAGAR", fallback: "b3740f38c0d774a224e56a68ae0cf35f612967d676f3316151ccecabbb315f01" },
};
const TOKEN_DAYS = 60;
const KEY = "data";

/* ---------- helpers ---------- */
const env = (k) => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k]) || "";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const pwHash = (u, p) => sha(`morningstall|${u}|${p}`);
const userHash = (u) => { const x = USERS[u], p = env(x.env); return p ? pwHash(u, p) : x.fallback; };
/* changing a password (or STALL_SECRET) signs everyone out */
const secret = () => env("STALL_SECRET") || sha("morningstall-session|" + Object.keys(USERS).map(userHash).join("|"));
const sameHex = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (body) => createHmac("sha256", secret()).update(body).digest("base64url");

function makeToken(u) {
  const body = b64(JSON.stringify({ u, exp: Date.now() + TOKEN_DAYS * 864e5 }));
  return `${body}.${sign(body)}`;
}
function readToken(req) {
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)$/.exec(req.headers.get("authorization") || "");
  if (!m || !sameHex(sign(m[1]), m[2])) return null;
  try {
    const t = JSON.parse(Buffer.from(m[1], "base64url").toString());
    return USERS[t.u] && t.exp > Date.now() ? t.u : null;
  } catch { return null; }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => getStore({ name: "stall", consistency: "strong" });

/* ---------- data ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const newDay = (prices) => ({ ...Object.fromEntries(ITEMS.map((k) => [k, { made: 0, sold: 0 }])), prices: clone(prices) });
function initial() {
  const days = {};
  for (const [d, v] of Object.entries(HISTORY)) { days[d] = newDay(DEF_PRICES); days[d].profit = v; }
  return { prices: clone(DEF_PRICES), days, expenses: [] };
}

/* Same small operations as the page uses; every one is safe to send twice. */
const OPS = {
  setCell(db, d, k, f, v) { (db.days[d] || (db.days[d] = newDay(db.prices)))[k][f] = v; },
  setProfit(db, d, v) { const x = db.days[d] || (db.days[d] = newDay(db.prices)); if (v == null) delete x.profit; else x.profit = v; },
  setCost(db, d, v) { const x = db.days[d] || (db.days[d] = newDay(db.prices)); if (v == null) delete x.cost; else x.cost = v; },
  delDay(db, d) { delete db.days[d]; },
  /* stall closed that day — nobody available to run it */
  setLeave(db, d, on) { if (on) (db.days[d] || (db.days[d] = newDay(db.prices))).leave = true; else if (db.days[d]) delete db.days[d].leave; },
  putDay(db, d, day) { db.days[d] = day; },
  setPrice(db, k, f, v, today) { db.prices[k][f] = v; const t = db.days[today]; if (t) (t.prices ||= clone(db.prices))[k][f] = v; },
  addCost(db, e) { if (!db.expenses.some((x) => x.id === e.id)) db.expenses.push(e); },
  delCost(db, id) { db.expenses = db.expenses.filter((e) => e.id !== id); },
  /* cash actually counted on a day: money in pocket starts from it */
  setPocketFix(db, f) { db.pocketFix = f; },
};

/* ---------- checking what the page sends ---------- */
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isItem = (k) => ITEMS.includes(k);
const MAXQ = 9999, MAXRS = 999999;

function cleanDay(day) {
  if (!day || typeof day !== "object") return null;
  const out = newDay(DEF_PRICES);
  for (const k of ITEMS) {
    const x = day[k] || {};
    out[k] = { made: isInt(x.made, 0, MAXQ) ? x.made : 0, sold: isInt(x.sold, 0, MAXQ) ? x.sold : 0 };
    const p = day.prices?.[k]?.price;
    out.prices[k] = { price: isInt(p, 0, MAXQ) ? p : DEF_PRICES[k].price };
  }
  if (isInt(day.profit, -MAXRS, MAXRS)) out.profit = day.profit;
  if (isInt(day.cost, 0, MAXRS)) out.cost = day.cost;
  if (day.leave === true) out.leave = true;
  return out;
}

/* returns clean args for the op, or null if it doesn't look right */
function check(name, a) {
  if (!Array.isArray(a)) return null;
  switch (name) {
    case "setCell": return isDate(a[0]) && isItem(a[1]) && (a[2] === "made" || a[2] === "sold") && isInt(a[3], 0, MAXQ) ? a.slice(0, 4) : null;
    case "setProfit": return isDate(a[0]) && (a[1] === null || isInt(a[1], -MAXRS, MAXRS)) ? a.slice(0, 2) : null;
    case "setCost": return isDate(a[0]) && (a[1] === null || isInt(a[1], 0, MAXRS)) ? a.slice(0, 2) : null;
    case "delDay": return isDate(a[0]) ? [a[0]] : null;
    case "setLeave": return isDate(a[0]) && typeof a[1] === "boolean" ? a.slice(0, 2) : null;
    case "putDay": { const d = cleanDay(a[1]); return isDate(a[0]) && d ? [a[0], d] : null; }
    case "setPrice": return isItem(a[0]) && a[1] === "price" && isInt(a[2], 0, MAXQ) && isDate(a[3]) ? a.slice(0, 4) : null;
    case "addCost": {
      const e = a[0];
      if (!e || typeof e !== "object") return null;
      const name = typeof e.name === "string" ? e.name.trim().slice(0, 60) : "";
      return typeof e.id === "string" && /^[a-z0-9]{4,40}$/i.test(e.id) && isDate(e.date) && name && isInt(e.amount, 1, MAXRS)
        ? [{ id: e.id, date: e.date, name, amount: e.amount }] : null;
    }
    case "delCost": return typeof a[0] === "string" && a[0].length <= 40 ? [a[0]] : null;
    case "setPocketFix": {
      const f = a[0];
      return f && typeof f === "object" && isInt(f.amount, 0, MAXRS) && isDate(f.date) && isInt(f.base, -1e9, 1e9) && isInt(f.at, 0, 1e14) && Object.values(USERS).some((x) => x.name === f.by)
        ? [{ amount: f.amount, date: f.date, base: f.base, at: f.at, by: f.by }] : null;
    }
    default: return null;
  }
}

/* ---------- routes ---------- */
async function login(req) {
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const u = String(b?.u || "").trim().toLowerCase(), p = String(b?.p || "");
  if (USERS[u] && p && sameHex(pwHash(u, p), userHash(u))) return json({ token: makeToken(u), user: u, name: USERS[u].name });
  await sleep(600); /* slow down guessing */
  return json({ error: "That username or password doesn’t match." }, 401);
}

async function load(req) {
  const since = new URL(req.url).searchParams.get("rev");
  const cur = await store().get(KEY, { type: "json" });
  const rec = cur || { rev: 0, db: initial() };
  if (since !== null && String(rec.rev) === since) return json({ rev: rec.rev, same: true });
  return json({ rev: rec.rev, db: rec.db, at: rec.at || null, by: rec.by || null });
}

async function ops(req, user) {
  let b; try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const list = b?.ops;
  if (!Array.isArray(list) || !list.length || list.length > 500) return json({ error: "No changes sent" }, 400);
  const clean = [];
  for (const o of list) {
    const args = Array.isArray(o) && OPS[o[0]] ? check(o[0], o[1]) : null;
    if (!args) return json({ error: `Change not allowed: ${Array.isArray(o) ? String(o[0]).slice(0, 20) : "?"}` }, 400);
    clean.push([o[0], args]);
  }
  const s = store();
  /* read → change → write only if nobody else wrote in between; otherwise try again */
  for (let i = 0; i < 8; i++) {
    const cur = await s.getWithMetadata(KEY, { type: "json" });
    if (cur && !cur.etag) throw new Error("store gave no ETag; refusing to overwrite blindly");
    const rec = cur?.data || { rev: 0, db: initial() };
    for (const [name, args] of clean) OPS[name](rec.db, ...args);
    rec.rev = (rec.rev || 0) + 1; rec.at = new Date().toISOString(); rec.by = user;
    const w = cur ? await s.setJSON(KEY, rec, { onlyIfMatch: cur.etag }) : await s.setJSON(KEY, rec, { onlyIfNew: true });
    if (w.modified) {
      /* one safety copy per day (India time), kept in the same store */
      const day = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
      try { await s.setJSON(`backup-${day}`, rec, { onlyIfNew: true }); } catch {}
      return json({ rev: rec.rev });
    }
    await sleep(40 * 2 ** i + Math.random() * 60);
  }
  return json({ error: "Busy — try again" }, 409);
}

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  try {
    if (path === "/api/login" && req.method === "POST") return await login(req);
    const user = readToken(req);
    if (path === "/api/stall" || path === "/api/ops") {
      if (!user) return json({ error: "Please sign in again." }, 401);
      if (path === "/api/stall" && req.method === "GET") return await load(req);
      if (path === "/api/ops" && req.method === "POST") return await ops(req, user);
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
};

export const config = { path: ["/api/login", "/api/stall", "/api/ops"] };
