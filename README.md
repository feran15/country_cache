🗺️ Country Currency & Exchange API

A RESTful API that fetches country data from the REST Countries API, merges it with exchange rates from Open Exchange Rate API, caches the data in a MySQL database, and provides full CRUD + image summary endpoints.

🚀 Features

Fetches all countries and currency data from
https://restcountries.com/v2/all

Fetches exchange rates from
https://open.er-api.com/v6/latest/USD

Computes estimated_gdp = population × random(1000–2000) ÷ exchange_rate

Caches country data in MySQL

Supports filtering, sorting, and lookup by name

Generates and serves a summary image of top countries by GDP

Provides consistent JSON responses and error handling

🛠️ Tech Stack

Node.js + Express

MySQL (mysql2/promise)

dotenv for environment variables

node-canvas for image generation

nodemon for development

📁 Project Structure
country_cache/
├── cache/
│   ├── summary.png       # Generated GDP summary image
│   └── summary.txt       # Cache info
├── node_modules/
├── .env
├── db.js                 # MySQL connection setup
├── server.js             # Main API logic
├── package.json
└── README.md

⚙️ Setup Instructions
1️⃣ Clone the repo
git clone https://github.com/<your-username>/country_cache.git
cd country_cache

2️⃣ Install dependencies
npm install

3️⃣ Configure environment variables

Create a file named .env in the project root:

PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=country_cache_db

4️⃣ Create MySQL Database

Open MySQL shell:

mysql -u root -p


Then run:

CREATE DATABASE country_cache_db;

5️⃣ Start the server
npm run dev


Server should start at:

http://localhost:5000

🔌 API Endpoints
Method	Endpoint	Description
POST	/countries/refresh	Fetch and cache countries + exchange rates
GET	/countries	Get all countries (supports filters: ?region=Africa, ?currency=NGN, ?sort=gdp_desc)
GET	/countries/:name	Get a specific country by name
DELETE	/countries/:name	Delete a country
GET	/status	Get total countries + last refresh timestamp
GET	/countries/image	Serve the generated summary image
📊 Sample Responses
GET /status
{
  "total_countries": 250,
  "last_refreshed_at": "2025-10-22T18:00:00Z"
}

GET /countries?region=Africa
[
  {
    "id": 1,
    "name": "Nigeria",
    "capital": "Abuja",
    "region": "Africa",
    "population": 206139589,
    "currency_code": "NGN",
    "exchange_rate": 1600.23,
    "estimated_gdp": 25767448125.2,
    "flag_url": "https://flagcdn.com/ng.svg",
    "last_refreshed_at": "2025-10-22T18:00:00Z"
  }
]

GET /countries/image

Returns summary.png (top 5 GDP countries and timestamp).

⚠️ Error Responses
Code	Example
400	{ "error": "Validation failed" }
404	{ "error": "Country not found" }
503	{ "error": "External data source unavailable" }
500	{ "error": "Internal server error" }
🧠 Notes

The database updates only when /countries/refresh is called.

Random GDP multiplier (1000–2000) regenerates on every refresh.

Countries with missing currency or rate still get stored (GDP = 0).

The summary image is saved at /cache/summary.png.
