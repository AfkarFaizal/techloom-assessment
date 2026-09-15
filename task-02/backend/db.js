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

async function connect() {
  if (dbInstance) return dbInstance;
  await client.connect();
  dbInstance = client.db(process.env.MONGODB_DB_NAME || 'ecommerce_shop');
  await dbInstance.collection('paymentAttempts').createIndex({ idempotencyKey: 1 }, { unique: true });

  // Seed a handful of demo products on first run so the storefront isn't empty.
  const count = await dbInstance.collection('products').countDocuments();
  if (count === 0) {
    const { v4: uuid } = require('uuid');
    await dbInstance.collection('products').insertMany([
      { _id: uuid(), name: 'Wireless Mouse', description: 'Ergonomic 2.4GHz wireless mouse', category: 'electronics', price: 19.99, stock: 25, reserved: 0 },
      { _id: uuid(), name: 'Mechanical Keyboard', description: 'RGB backlit mechanical keyboard', category: 'electronics', price: 59.99, stock: 12, reserved: 0 },
      { _id: uuid(), name: 'Cotton T-Shirt', description: 'Plain cotton crew-neck t-shirt', category: 'clothing', price: 12.5, stock: 40, reserved: 0 },
      { _id: uuid(), name: 'Running Shoes', description: 'Lightweight breathable running shoes', category: 'clothing', price: 45.0, stock: 8, reserved: 0 },
      { _id: uuid(), name: 'Coffee Beans 1kg', description: 'Single-origin medium roast', category: 'grocery', price: 14.75, stock: 30, reserved: 0 },
      { _id: uuid(), name: 'Green Tea Pack', description: 'Organic green tea, 50 bags', category: 'grocery', price: 6.99, stock: 0, reserved: 0 },
    ]);
    console.log('Seeded demo products');
  }

  console.log('Connected to MongoDB');
  return dbInstance;
}

module.exports = { connect, client };
