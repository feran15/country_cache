import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fetch from "node-fetch";

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

    console.log("✅ Database connected & table ready");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
  }
}

// 🗂 Cache setup
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

    await db.query("DELETE FROM countries");

    if (countries.length) {
      const values = countries.map((c) => [
        c.name,
        c.capital,
        c.region,
        c.population,
        c.flag,
        c.currencies?.[0]?.code || "N/A",
      ]);
      const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?)").join(",");
      await db.query(
        `INSERT INTO countries (name, capital, region, population, flag, currency) VALUES ${placeholders}`,
        values.flat()
      );
    }

    const [rows] = await db.query("SELECT COUNT(*) AS total FROM countries");
    const total = rows[0]?.total || 0;
    const summary = `Countries refreshed: ${total} at ${new Date().toISOString()}`;
    fs.writeFileSync(path.join(cacheDir, "summary.txt"), summary);

    // Respond immediately for faster user feedback
    res.json({ message: "Countries refreshed", total });

    // ✅ Generate a lightweight PNG placeholder (no canvas)
    try {
      const pngHeader = Buffer.from(
        "89504E470D0A1A0A0000000D49484452000000010000000108020000009077530000000A49444154789C636000000200010005FE02FEA70000000049454E44AE426082",
        "hex"
      );
      const textBuffer = Buffer.from(`\n${summary}\n`, "utf8");
      const buffer = Buffer.concat([pngHeader, textBuffer]);
      fs.writeFileSync(cachePath, buffer);
      console.log("✅ Summary placeholder image created");
    } catch (err) {
      console.error("❌ Failed to create placeholder image:", err.message);
    }
  } catch (err) {
    console.error("❌ Error in /countries/refresh:", err);
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
    res.status(500).json({ error: err.message });
  }
});

// 🟢 GET /status
app.get("/status", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM countries");
    res.json({
      status: "ok",
      countries: rows[0].total,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "DB not reachable" });
  }
});

// 🟢 GET /countries/image (must be before /:name)
app.get("/countries/image", (req, res) => {
  if (!fs.existsSync(cachePath))
    return res.status(404).json({ error: "Summary image not found" });
  res.sendFile(path.resolve(cachePath));
});

// 🟢 GET /countries/:name
app.get("/countries/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const [rows] = await db.query(
      "SELECT * FROM countries WHERE TRIM(LOWER(name)) = TRIM(LOWER(?))",
      [name]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Country not found" });
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

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// 🚀 Start server
const PORT = process.env.PORT || 4000;
(async () => {
  await connectDB();
  app.listen(PORT, () =>
    console.log(`🚀 Server running on port ${PORT}`)
  );
})();
