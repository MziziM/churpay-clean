import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
}

// Save inside the frontend package: ./frontend/data/payments.json
// When you run from the frontend folder, CWD is already .../frontend
const outputFile = path.join(process.cwd(), 'data', 'payments.json');
const publicOutputFile = path.join(process.cwd(), 'public', 'data', 'payments.json');

const baseURL = process.env.NODE_ENV === 'production' ? 'https://api.churpay.com' : 'http://localhost:5000';
const API_URL = baseURL + '/api/payments';

async function exportPayments() {
  try {
    console.log(`[Export] Using API URL: ${API_URL}`);
    console.log('[Export] Fetching payments from API...');
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);

    const data = await res.json();

    // Ensure directory exists (it does for payments.json in CWD, but keep defensive code for future changes)
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });

    fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
    console.log(`[Export] Saved ${Array.isArray(data) ? data.length : 0} records to ${outputFile} (NODE_ENV=${process.env.NODE_ENV})`);

    fs.mkdirSync(path.dirname(publicOutputFile), { recursive: true });
    fs.copyFileSync(outputFile, publicOutputFile);
    console.log(`[Export] Also copied payments.json to ${publicOutputFile}`);
  } catch (err) {
    console.error('[Export] Error:', err.message);
    process.exit(1);
  }
}

exportPayments();