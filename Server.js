import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import sharp from "sharp";

dotenv.config();

const app = express();
app.use(express.json());

const __dirname = path.resolve();

// 🧩 MySQL connection setup
let db;

async function connectDB() {
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false }, // ✅ Aiven requires SSL
    });
    console.log("✅ Connected to Aiven MySQL database");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1); // Stop app if DB fails
  }
}

// 🗂 Path to cache folder
const cacheDir = path.join(__dirname, "cache");
const cachePath = path.join(cacheDir, "summary.png");

// Ensure cache folder exists
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir);
}

// ✅ Route to refresh and generate summary
app.get("/countries/refresh", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT COUNT(*) as total FROM countries");
    const totalCountries = rows[0]?.total || 0;

    const [top5] = await db.query(
      "SELECT name, gdp FROM countries ORDER BY gdp DESC LIMIT 5"
    );

    const summary = `
Country Cache Summary

Total Countries: ${totalCountries}

Top 5 by GDP:
${top5.map((c) => `${c.name}: ${c.gdp}`).join("\n")}

Last Refresh: ${new Date().toISOString()}
`;

    // Write text summary
    fs.writeFileSync(path.join(cacheDir, "summary.txt"), summary);

    // Generate image from text
    await sharp({
      text: {
        text: summary,
        font: "sans",
        fontSize: 18,
        width: 600,
        align: "left",
      },
    })
      .png()
      .toFile(cachePath);

    res.json({
      message: "Summary refreshed successfully",
      totalCountries,
      top5,
    });
  } catch (err) {
    console.error("❌ Error refreshing summary:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Route to get image summary
app.get("/countries/image", (req, res) => {
  console.log("📸 /countries/image route hit");

  if (!fs.existsSync(cachePath)) {
    return res.status(404).json({ error: "Summary image not found" });
  }

  res.sendFile(path.resolve(cachePath));
});

// ✅ Health check route for Leapcell
app.get("/kaithheathcheck", (req, res) => {
  res.status(200).json({ message: "Service healthy" });
});

// ✅ Test route
app.get("/", (req, res) => {
  res.send("✅ Country Cache API is running...");
});

// ❌ 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// 🖥️ Start server after DB connection
const PORT = process.env.PORT || 4000;

(async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
})();
