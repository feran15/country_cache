import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import sharp from "sharp";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(express.json());

const __dirname = path.resolve();

// 🧩 MySQL connection (Aiven ready)
let db;
async function connectDB() {
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
    console.log("✅ Connected to Aiven MySQL");
  } catch (err) {
    console.error("❌ DB connection failed:", err.message);
  }
}

// 🗂 Cache folder setup
const cacheDir = path.join(__dirname, "cache");
const cachePath = path.join(cacheDir, "summary.png");
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

// 🟢 TEST 1 — POST /countries/refresh
app.post("/countries/refresh", async (req, res) => {
  try {
    // Fetch data from REST Countries API
    const response = await fetch(
      "https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies"
    );
    const countries = await response.json();

    // Clear existing data
    await db.query("DELETE FROM countries");

    // Insert new data
    for (const c of countries) {
      const code = c.currencies?.[0]?.code || "N/A";
      await db.query(
        "INSERT INTO countries (name, capital, region, population, flag, currency) VALUES (?, ?, ?, ?, ?, ?)",
        [c.name, c.capital, c.region, c.population, c.flag, code]
      );
    }

    // Generate summary
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM countries");
    const total = rows[0]?.total || 0;

    const summary = `Countries refreshed: ${total} at ${new Date().toISOString()}`;
    fs.writeFileSync(path.join(cacheDir, "summary.txt"), summary);

    await sharp({
      text: { text: summary, font: "sans", fontSize: 18, width: 500 },
    })
      .png()
      .toFile(cachePath);

    res.json({ message: "Countries refreshed", total });
  } catch (err) {
    console.error("❌ Error in refresh:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🟢 TEST 2 — GET /countries (with optional filters/sorting)
app.get("/countries", async (req, res) => {
  try {
    const { region, sort } = req.query;
    let query = "SELECT * FROM countries";
    const params = [];

    if (region) {
      query += " WHERE region = ?";
      params.push(region);
    }

    if (sort === "asc" || sort === "desc") {
      query += ` ORDER BY population ${sort.toUpperCase()}`;
    }

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching countries:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🟢 TEST 3 — GET /countries/:name
app.get("/countries/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const [rows] = await db.query("SELECT * FROM countries WHERE name = ?", [
      name,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Country not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🟢 TEST 4 — DELETE /countries/:name
app.delete("/countries/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const [result] = await db.query("DELETE FROM countries WHERE name = ?", [
      name,
    ]);
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Country not found" });
    res.json({ message: "Country deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🟢 TEST 5 — GET /status
app.get("/status", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT COUNT(*) as total FROM countries");
    res.json({
      status: "ok",
      countries: rows[0].total,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "DB not reachable" });
  }
});

// 🟢 TEST 6 — GET /countries/image
app.get("/countries/image", (req, res) => {
  if (!fs.existsSync(cachePath))
    return res.status(404).json({ error: "Summary image not found" });
  res.sendFile(path.resolve(cachePath));
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// 🚀 Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await connectDB();
});
