import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";

dotenv.config();

const app = express();
app.use(express.json());

// ✅ MongoDB Connection (wrapped in async function)
let isConnected = false;

async function connectDB() {
  if (!isConnected) {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/country_cache");
    isConnected = true;
    console.log("✅ Connected to MongoDB");
  }
}

// 🧱 Schema
const countrySchema = new mongoose.Schema({
  name: String,
  capital: String,
  region: String,
  population: Number,
  flag: String,
  currency_code: String,
  exchange_rate: Number,
  estimated_gdp: Number,
});
const Country = mongoose.model("Country", countrySchema);

const cachePath = path.join(process.cwd(), "summary.png");

// ⚡ Fast Chart Generation (Top 10 GDP)
async function generateSummaryImage() {
  try {
    const countries = await Country.find().sort({ estimated_gdp: -1 }).limit(10);
    if (!countries.length) return null;

    const chart = new ChartJSNodeCanvas({ width: 900, height: 500 });
    const cfg = {
      type: "bar",
      data: {
        labels: countries.map((c) => c.name),
        datasets: [
          {
            label: "Estimated GDP (USD)",
            data: countries.map((c) => c.estimated_gdp),
            backgroundColor: "rgba(59,130,246,0.8)",
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: "#000" } }, y: { ticks: { color: "#000" } } },
      },
    };
    fs.writeFileSync(cachePath, await chart.renderToBuffer(cfg, "image/png"));
    console.log("✅ Summary PNG generated");
  } catch (err) {
    console.error("❌ Chart generation error:", err);
  }
}

// 🟢 POST /countries/refresh — Fixed lowercase and added timeout protection
app.post("/countries/refresh", async (req, res) => {
  console.log("📡 Incoming POST /countries/refresh");
  
  try {
    await connectDB();
    
    console.log("🌍 Fetching countries...");
    const api = "https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies";
    
    // Add timeout to fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(api, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }
    
    const countries = await response.json();

    if (!Array.isArray(countries)) throw new Error("Invalid API response");

    console.log(`📊 Processing ${countries.length} countries...`);

    // Drop + bulk insert
    await Country.deleteMany({});
    const docs = countries.map((c) => {
      const currency_code = c.currencies?.[0]?.code || "USD";
      const exchange_rate = +(Math.random() * 1000 + 1000).toFixed(2);
      const estimated_gdp = Math.round((c.population * exchange_rate) / 1000);
      return {
        name: c.name,
        capital: c.capital,
        region: c.region,
        population: c.population,
        flag: c.flag,
        currency_code,
        exchange_rate,
        estimated_gdp,
      };
    });

    // ⚡ Super-fast insertMany (bulk write)
    await Country.insertMany(docs, { ordered: false });
    console.log("✅ Countries inserted");
    
    // Generate chart in background (don't wait for it)
    generateSummaryImage().catch(err => console.error("Chart error:", err));

    const total = await Country.countDocuments();
    res.json({ 
      message: "Countries refreshed successfully", 
      total,
      note: "Chart generation in progress"
    });
    
  } catch (err) {
    console.error("❌ Refresh error:", err);
    
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: "Request timeout - API took too long to respond" });
    }
    
    res.status(500).json({ 
      error: "Failed to refresh countries",
      details: err.message 
    });
  }
});

// 🟢 GET /countries/image
app.get("/countries/image", (req, res) => {
  if (!fs.existsSync(cachePath)) return res.status(404).json({ error: "Summary image not found" });
  res.setHeader("Content-Type", "image/png");
  res.sendFile(path.resolve(cachePath));
});

// 🟢 GET /countries (filter & sort)
app.get("/countries", async (req, res) => {
  try {
    await connectDB();
    const { region, currency, sort } = req.query;
    const filter = {};
    if (region) filter.region = region;
    if (currency) filter.currency_code = currency;

    let query = Country.find(filter);
    if (sort === "desc") query = query.sort({ estimated_gdp: -1 });

    res.json(await query);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🟢 GET /countries/:name
app.get("/countries/:name", async (req, res) => {
  try {
    await connectDB();
    const country = await Country.findOne({
      name: { $regex: new RegExp(`^${req.params.name}$`, "i") },
    });
    if (!country) return res.status(404).json({ error: "Country not found" });
    res.json(country);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🟢 DELETE /countries/:name
app.delete("/countries/:name", async (req, res) => {
  try {
    await connectDB();
    const result = await Country.deleteOne({
      name: { $regex: new RegExp(`^${req.params.name}$`, "i") },
    });
    if (!result.deletedCount) return res.status(404).json({ error: "Country not found" });
    res.json({ message: "Country deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🟢 GET /status
app.get("/status", async (req, res) => {
  try {
    await connectDB();
    const total = await Country.countDocuments();
    const lastRefreshed = fs.existsSync(cachePath)
      ? fs.statSync(cachePath).mtime.toISOString()
      : "Never";
    res.json({ 
      status: "ok", 
      total_countries: total, 
      last_refreshed_at: lastRefreshed,
      database_connected: isConnected
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🟢 GET / - Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Country API Server",
    status: "running",
    endpoints: {
      refresh: "POST /countries/refresh",
      image: "GET /countries/image",
      list: "GET /countries?region=&currency=&sort=desc",
      detail: "GET /countries/:name",
      delete: "DELETE /countries/:name",
      status: "GET /status"
    }
  });
});

// 🟡 404 fallback
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// 🚀 Server
const PORT = process.env.PORT || 4000;

async function startServer() {
  await connectDB();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});