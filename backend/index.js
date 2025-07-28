/**************************************************************************
 *  Gamespot Kiosk – Backend API                             rev 2025-07-28
 *  – Fixes duplicate const issues, missing symbols, and merge artefacts
 *  – Keeps your existing database + endpoints
 *  – Maps one real ESP32 (GPIO5 relay) to PS5 #4 at 192.168.1.212
 *  – TEST_MODE = true by default; set TEST_MODE=false to go live
 **************************************************************************/

"use strict";

/* ───────────── Core imports ───────────── */
const express  = require("express");
const cors     = require("cors");
const sqlite3  = require("sqlite3").verbose();
const path     = require("path");
const fs       = require("fs");
const axios    = require("axios");               // ← used when TEST_MODE=false
const { v4: uuidv4 } = require("uuid");

/* ───────────── Configuration ───────────── */
const CONFIG = {
  PORT      : process.env.PORT      || 3000,
  DB_PATH   : process.env.DB_PATH   || path.resolve(__dirname, "gamespot.db"),

  /* Toggle live relay calls */
  TEST_MODE : process.env.TEST_MODE === "false" ? false : true,

  /* One physical controller (PS5 #4) */
  ESP32_STATIC : [
    { console: "PS5 #4", ip: "192.168.1.212", port: 80 }
  ],

  ESP32_TIMEOUT : 3_000
};

/* ───────────── Logger helper ───────────── */
function log (...a) { console.log("[API]", ...a); }

/* ───────────── App & DB setup ───────────── */
const app = express();
let   db;

(function openDatabase () {
  const dbExists = fs.existsSync(CONFIG.DB_PATH);
  log(`Using database: ${CONFIG.DB_PATH} (exists: ${dbExists})`);

  db = new sqlite3.Database(
    CONFIG.DB_PATH,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    err => {
      if (err) { console.error("SQLite error:", err.message); process.exit(1); }
      log("SQLite connected");
      initSchema();
    }
  );
})();

function initSchema () {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS ps5_consoles(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT UNIQUE,
              booked INTEGER DEFAULT 0,
              end_time INTEGER
            )`);
    db.run(`CREATE TABLE IF NOT EXISTS payments(
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              console TEXT,
              minutes INTEGER,
              method TEXT,
              user TEXT DEFAULT 'Azonix07',
              paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              photo_data TEXT
            )`);
    /* Seed default rows */
    ["PS5 #1","PS5 #2","PS5 #3","PS5 #4","Logitech G920"].forEach(n =>
      db.run("INSERT OR IGNORE INTO ps5_consoles (name, booked) VALUES (?,0)", [n])
    );
  });
}

/* ───────────── Express middleware ───────────── */
app.use(cors({
  origin: [
    "http://localhost:3000","http://localhost:8080","http://127.0.0.1:3000",
    "http://127.0.0.1:8080","http://localhost:5500","http://127.0.0.1:5500",
    "http://192.168.1.100:3000","http://192.168.1.100:8080"
  ],
  credentials: true
}));
app.use(express.json({ limit: "20mb" }));

/* ───────────── Utility helpers ───────────── */
const dataUrl = b64 =>
  (b64 && b64.startsWith("data:image")) ? b64 :
  (b64 ? `data:image/jpeg;base64,${b64}` : null);

async function sendEsp32Command (consoleName, action) {
  const esp = CONFIG.ESP32_STATIC.find(c => c.console === consoleName);
  if (!esp) throw new Error(`No ESP32 mapping for ${consoleName}`);
  const url = `http://${esp.ip}:${esp.port}/relay/${action}`;
  const { data } = await axios.get(url, { timeout: CONFIG.ESP32_TIMEOUT });
  return data;
}

/* ───────────── Health check ───────────── */
app.get("/health", (_, res) =>
  res.json({ status:"ok", timestamp:new Date().toISOString(),
             mode: CONFIG.TEST_MODE ? "TEST_MODE" : "LIVE" }));

/* ───────────── Status endpoint ───────────── */
app.get("/api/status", (_, res) => {
  db.all("SELECT name, booked, end_time FROM ps5_consoles", [], (err, rows) => {
    if (err) return res.status(500).json({ error:err.message });
    res.json(rows.map(r => ({
      name:r.name,
      booked:!!r.booked,
      remainingTime: r.booked && r.end_time ? Math.max(0, r.end_time - Date.now()) : null
    })));
  });
});

/* ───────────── Book console ───────────── */
app.post("/api/book", (req, res) => {
  const { console:con, minutes } = req.body;
  const m = parseInt(minutes,10);
  if (!con || !m || m<=0) return res.status(400).json({ error:"console & minutes required" });
  const end = Date.now()+m*60*1000;
  db.run("UPDATE ps5_consoles SET booked=1,end_time=? WHERE name=? AND booked=0",
         [end, con], function (err) {
    if (err) return res.status(500).json({ error:err.message });
    if (!this.changes) return res.status(400).json({ error:"Already booked" });
    res.json({ success:true, console:con, endTime:end });
  });
});

/* ───────────── Payment endpoint ───────────── */
app.post("/api/pay", (req, res) => {
  const { console:con, minutes, method, photoData } = req.body;
  const m = parseInt(minutes,10);
  if (!con || !m || m<=0 || !method)
    return res.status(400).json({ error:"console, minutes, method required" });

  db.run("INSERT INTO payments (console,minutes,method,user,photo_data) VALUES (?,?,?,?,?)",
         [con, m, method, "Azonix07", dataUrl(photoData)], function (err) {
    if (err) return res.status(500).json({ error:err.message });

    const end = Date.now()+m*60*1000;
    db.run("UPDATE ps5_consoles SET booked=1,end_time=? WHERE name=?", [end, con]);

    res.json({ success:true, paymentId:this.lastID, endTime:end });
  });
});

/* ───────────── Power control ───────────── */
app.post("/api/power-control", async (req, res) => {
  const { console:con, action } = req.body;
  if (!con || !["on","off"].includes(action))
    return res.status(400).json({ error:"console & action (on/off) required" });

  const live = !CONFIG.TEST_MODE && CONFIG.ESP32_STATIC.some(c=>c.console===con);
  try {
    const result = live ? await sendEsp32Command(con, action)
                        : { simulated:true };
    res.json({ success:true, console:con, action, ...result, testMode:!live });
  } catch(err) {
    res.status(500).json({ error:err.message });
  }
});

/* ───────────── Payments history ───────────── */
app.get("/api/payments", (_, res) => {
  db.all("SELECT * FROM payments ORDER BY paid_at DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error:err.message });
    res.json(rows.map(r => ({ ...r, photoUrl:dataUrl(r.photo_data) })));
  });
});

/* ───────────── Reset all / single console ───────────── */
app.post("/api/reset", (_, res) => {
  db.run("UPDATE ps5_consoles SET booked=0,end_time=NULL", [], err => {
    if (err) return res.status(500).json({ error:err.message });
    res.json({ success:true, testMode:CONFIG.TEST_MODE });
  });
});

app.post("/api/reset-single", (req, res) => {
  const { console:con } = req.body;
  if (!con) return res.status(400).json({ error:"console required" });
  db.run("UPDATE ps5_consoles SET booked=0,end_time=NULL WHERE name=?", [con], function (err) {
    if (err)   return res.status(500).json({ error:err.message });
    if (!this.changes) return res.status(404).json({ error:"Console not found" });
    res.json({ success:true, testMode:CONFIG.TEST_MODE });
  });
});

/* ───────────── ESP32 status mock ───────────── */
app.get("/api/esp32-status", (_, res) => {
  const list = CONFIG.ESP32_STATIC.length
    ? CONFIG.ESP32_STATIC.map(c => ({ ...c, status: CONFIG.TEST_MODE ? "offline":"online" }))
    : [];
  res.json({ timestamp:new Date().toISOString(), controllers:list,
             testMode:CONFIG.TEST_MODE });
});

/* ───────────── Debug schema ───────────── */
app.get("/api/debug/tables", (_, res) => {
  db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
    if (err) return res.status(500).json({ error:err.message });
    const out = {};
    let done = 0;
    tables.forEach(t => {
      db.all(`PRAGMA table_info(${t.name})`, [], (err, cols) => {
        out[t.name] = err ? { error:err.message } : cols;
        if (++done === tables.length) res.json(out);
      });
    });
  });
});

/* ───────────── Start server ───────────── */
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  log(`🚀 API on http://localhost:${CONFIG.PORT}`);
  log(`TEST_MODE: ${CONFIG.TEST_MODE ? "ON (simulated)" : "OFF (live)"}`);
});
