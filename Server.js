import express from "express";
import mongoose from "mongoose";
import fetch from "node-fetch";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();
const app = express();
app.use(express.json());

// MongoDB Connection
await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/country_cache", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
console.log("✅ Connected to MongoDB");

// Schema & Model
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

// File path for cached image
const cachePath = path.join(process.cwd(), "summary.png");

// Generate PNG summary chart
async function generateSummaryImage() {
  try {
    const countries = await Country.find().sort({ estimated_gdp: -1 }).limit(10);
    if (countries.length === 0) return null;

    const chart = new ChartJSNodeCanvas({ width: 1000, height: 600 });
    const config = {
      type: "bar",
      data: {
        labels: countries.map((c) => c.name),
        datasets: [
          {
            label: "Estimated GDP (USD)",
            data: countries.map((c) => c.estimated_gdp),
            backgroundColor: "rgba(37, 99, 235, 0.8)",
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: "Top 10 Countries by Estimated GDP",
            font: { size: 22 },
          },
          legend: { display: false },
        },
        scales: {
          x: { ticks: { color: "#000" } },
          y: { ticks: { color: "#000" } },
        },
      },
    };

    const buffer = await chart.renderToBuffer(config, "image/png");
    fs.writeFileSync(cachePath, buffer);
    console.log("✅ Summary image updated");
    return cachePath;
  } catch (err) {
    console.error("❌ Image generation failed:", err.message);
  }
}

import fetch from "node-fetch";
import AbortController from "abort-controller";

app.post("/countries/refresh", async (req, res) => {
  try {
    // Respond right away
    res.status(200).json({ message: "Refresh started in background" });

    // Run refresh in background
    (async () => {
      console.log("🌍 Starting refresh job...");

      // Timeout controller (to prevent hanging fetch)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      let data = [];
      try {
        const response = await fetch(
          "https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies",
          { signal: controller.signal }
        );
        clearTimeout(timeout);
        data = await response.json();
      } catch (err) {
        console.error("❌ Fetch failed:", err.message);
        return;
      }

      try {
        await Country.deleteMany({});
        const bulkOps = data.map((c) => {
          const currency_code = c.currencies?.[0]?.code || "USD";
          const exchange_rate = Math.random() * (2000 - 1000) + 1000;
          const estimated_gdp = Math.round((c.population * exchange_rate) / 1000);
          return {
            insertOne: {
              document: {
                name: c.name,
                capital: c.capital,
                region: c.region,
                population: c.population,
                flag: c.flag,
                currency_code,
                exchange_rate,
                estimated_gdp,
              },
            },
          };
        });

        await Country.bulkWrite(bulkOps);
        console.log(`✅ Refreshed ${data.length} countries`);
      } catch (err) {
        console.error("❌ Mongo write failed:", err.message);
      }
    })();
  } catch (err) {
    console.error("❌ Unexpected error:", err.message);
    res.status(500).json({ error: "Failed to start refresh" });
  }
});


// GET /countries/image
app.get("/countries/image", (req, res) => {
  if (!fs.existsSync(cachePath)) {
    return res.status(404).json({ error: "Summary image not found" });
  }
  res.setHeader("Content-Type", "image/png");
  res.sendFile(path.resolve(cachePath));
});

// GET /countries (filter & sort)
app.get("/countries", async (req, res) => {
  try {
    const { region, currency, sort } = req.query;
    const filter = {};
    if (region) filter.region = region;
    if (currency) filter.currency_code = currency;

    let query = Country.find(filter);
    if (sort === "desc") query = query.sort({ estimated_gdp: -1 });

    const countries = await query;
    res.json(countries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /countries/:name
app.get("/countries/:name", async (req, res) => {
  try {
    const country = await Country.findOne({
      name: { $regex: new RegExp(`^${req.params.name}$`, "i") },
    });
    if (!country) return res.status(404).json({ error: "Country not found" });
    res.json(country);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /countries/:name
app.delete("/countries/:name", async (req, res) => {
  try {
    const result = await Country.deleteOne({
      name: { $regex: new RegExp(`^${req.params.name}$`, "i") },
    });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "Country not found" });
    res.json({ message: "Country deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /status
app.get("/status", async (req, res) => {
  try {
    const total = await Country.countDocuments();
    res.json({
      status: "ok",
      total_countries: total,
      last_refreshed_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 404 fallback
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
