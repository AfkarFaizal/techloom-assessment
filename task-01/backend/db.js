const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error(
    'Missing MONGODB_URI environment variable.\n' +
    'Copy .env.example to .env and paste in your MongoDB Atlas connection string.'
  );
  process.exit(1);
}

const client = new MongoClient(uri);
let dbInstance = null;

// Call this once at startup (and anywhere you need the db handle). Safe to call
// multiple times — it reuses the same connection after the first call.
async function connect() {
  if (dbInstance) return dbInstance;
  await client.connect();
  dbInstance = client.db(process.env.MONGODB_DB_NAME || 'pos_inventory');
  // Enforce one-attempt-per-idempotency-key at the database level.
  await dbInstance.collection('paymentAttempts').createIndex({ idempotencyKey: 1 }, { unique: true });
  console.log('Connected to MongoDB');
  return dbInstance;
}

module.exports = { connect, client };
