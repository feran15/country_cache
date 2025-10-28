import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fetch from "node-fetch";
import { createCanvas } from "canvas";

dotenv.config();

const app = express();
app.use(express.json());

const __dirname = path.resolve();

// 🧩 MySQL connection
let db;
async function connectDB() {
  try {
    const baseConnection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      ssl: { rejectUnauthorized: false },
    });

    // Ensure DB exists
    await baseConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\`;`
    );
    await baseConnection.end();

    db = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false },
    });

    // Create countries table with case-insensitive name
    await db.query(`
      CREATE TABLE IF NOT EXISTS countries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) COLLATE utf8_general_ci,
        capital VARCHAR(255),
        region VARCHAR(255),
        population BIGINT,
        flag TEXT,
        currency VARCHAR(10)
      )
    `);

    console.log("✅ DB connected & table ensured");
  } catch (err) {
    console.error("❌ DB connection failed:", err.message);
  }
}

// 🗂 Cache folder
const cacheDir = path.join(__dirname, "cache");
const cachePath = path.join(cacheDir, "summary.png");
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

// 🟢 POST /countries/refresh
app.post("/countries/refresh", async (req, res) => {
  try {
    const response = await fetch(
      "https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies"
    );
    const countries = await response.json();

    // Clear table
    await db.query("DELETE FROM countries");

    // Bulk insert
    if (countries.length) {
      const values = countries.map(c => [
        c.name,
        c.capital,
        c.region,
        c.population,
        c.flag,
        c.currencies?.[0]?.code || "N/A",
      ]);
      const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?)").join(",");
      const flatValues = values.flat();
      await db.query(
        `INSERT INTO countries (name, capital, region, population, flag, currency) VALUES ${placeholders}`,
        flatValues
      );
    }

    // Count total
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM countries");
    const total = rows[0]?.total || 0;
    const summary = `Countries refreshed: ${total} at ${new Date().toISOString()}`;
    fs.writeFileSync(path.join(cacheDir, "summary.txt"), summary);

    // Respond first
    res.json({ message: "Countries refreshed", total });

    // Generate summary image asynchronously
    try {
      const canvas = createCanvas(600, 50);
      const ctx = canvas.getContext("2d");
      ctx.font = "18px sans-serif";
      ctx.fillStyle = "#000";
      ctx.fillText(summary, 10, 30);
      const buffer = canvas.toBuffer("image/png");
      fs.writeFileSync(cachePath, buffer);
      console.log("✅ Summary image created");
    } catch (err) {
      console.error("❌ Failed to generate image:", err);
    }
  } catch (err) {
    console.error("❌ Error in refresh:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🟢 GET /countries
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

// 🟢 GET /countries/:name (case-insensitive, trimmed)
app.get("/countries/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const [rows] = await db.query(
      "SELECT * FROM countries WHERE TRIM(LOWER(name)) = TRIM(LOWER(?))",
      [name]
    );
    if (!rows.length) return res.status(404).json({ error: "Country not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🟢 DELETE /countries/:name
app.delete("/countries/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const [result] = await db.query(
      "DELETE FROM countries WHERE TRIM(LOWER(name)) = TRIM(LOWER(?))",
      [name]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Country not found" });
    res.json({ message: "Country deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🟢 GET /status
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

// 🟢 GET /countries/image
app.get("/countries/image", (req, res) => {
  if (!fs.existsSync(cachePath))
    return res.status(404).json({ error: "Summary image not found" });
  res.sendFile(path.resolve(cachePath));
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// 🚀 Start server
const PORT = process.env.PORT || 4000;
(async () => {
  await connectDB();
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
})();
