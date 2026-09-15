const express = require('express');
const cors = require('cors');
const { v4: uuid } = require('uuid');
const { connect, client } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const RESERVATION_MS = 5 * 60 * 1000;
const now = () => Date.now();

let db;

function withAvailable(p) {
  return { ...p, id: p._id, available: p.stock - p.reserved };
}
function withId(doc) {
  return doc ? { ...doc, id: doc._id } : doc;
}

async function releaseReservation(orderId, newStatus) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await db.collection('orders').findOne({ _id: orderId }, { session });
      if (!order) throw { code: 404, message: 'Order not found' };
      for (const it of order.items) {
        await db.collection('products').updateOne({ _id: it.productId }, { $inc: { reserved: -it.qty } }, { session });
      }
      await db.collection('orders').updateOne(
        { _id: orderId },
        { $set: { status: newStatus, updatedAt: now() }, $unset: { expiresAt: '' } },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }
}

setInterval(async () => {
  if (!db) return;
  try {
    const expired = await db.collection('orders').find({ status: 'Reserved', expiresAt: { $lte: now() } }).toArray();
    for (const o of expired) await releaseReservation(o._id, 'Expired');
  } catch (err) {
    console.error('Expiry sweep error:', err.message);
  }
}, 5000);

// ---------- Product discovery: search + filter ----------
app.get('/products', async (req, res) => {
  const { search, category, minPrice, maxPrice, inStock } = req.query;
  const filter = {};
  if (search) filter.$or = [{ name: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
  if (category) filter.category = category;
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = parseFloat(minPrice);
    if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
  }
  let products = (await db.collection('products').find(filter).toArray()).map(withAvailable);
  if (inStock === 'true') products = products.filter(p => p.available > 0);
  res.json(products);
});

app.get('/products/categories', async (req, res) => {
  const cats = await db.collection('products').distinct('category');
  res.json(cats);
});

app.get('/products/:id', async (req, res) => {
  const p = await db.collection('products').findOne({ _id: req.params.id });
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(withAvailable(p));
});

app.post('/products', async (req, res) => {
  const { name, description, category, price, stock } = req.body;
  if (!name || price == null || stock == null) return res.status(400).json({ error: 'name, price, stock required' });
  const doc = { _id: uuid(), name, description: description || '', category: category || 'general', price, stock, reserved: 0 };
  await db.collection('products').insertOne(doc);
  res.status(201).json(withAvailable(doc));
});

// ---------- Checkout: reserve stock for entire cart (transactional, see task-01 for detail) ----------
app.post('/cart/checkout', async (req, res) => {
  const { userId, items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items array required' });
  const session = client.startSession();
  const orderId = uuid();
  try {
    let total = 0;
    const orderItems = [];
    await session.withTransaction(async () => {
      const productsCol = db.collection('products');
      for (const it of items) {
        const result = await productsCol.updateOne(
          { _id: it.productId, $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, it.qty] } },
          { $inc: { reserved: it.qty } },
          { session }
        );
        if (result.matchedCount === 0) {
          const exists = await productsCol.findOne({ _id: it.productId }, { session });
          if (!exists) throw { code: 404, message: `Product ${it.productId} not found` };
          throw { code: 409, message: `Insufficient stock for product ${it.productId}` };
        }
        const product = await productsCol.findOne({ _id: it.productId }, { session });
        orderItems.push({ productId: it.productId, productName: product.name, qty: it.qty, price: product.price });
        total += product.price * it.qty;
      }
      const ts = now();
      await db.collection('orders').insertOne({
        _id: orderId,
        userId: userId || 'guest',
        status: 'Reserved',
        refunded: false,
        total,
        items: orderItems,
        createdAt: ts,
        updatedAt: ts,
        expiresAt: ts + RESERVATION_MS,
      }, { session });
    });
    const order = await db.collection('orders').findOne({ _id: orderId });
    res.status(201).json(withId(order));
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message || 'Checkout failed' });
  } finally {
    await session.endSession();
  }
});

// ---------- Mock payment (idempotent via idempotencyKey, see task-01 for detail) ----------
app.post('/orders/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { idempotencyKey } = req.body;
  let { outcome } = req.body;
  if (!outcome) { const r = Math.random(); outcome = r < 0.7 ? 'success' : r < 0.9 ? 'failure' : 'timeout'; }

  if (idempotencyKey) {
    try {
      await db.collection('paymentAttempts').insertOne({ idempotencyKey, orderId: id, outcome, createdAt: now() });
    } catch (err) {
      if (err.code === 11000) {
        const prior = await db.collection('paymentAttempts').findOne({ idempotencyKey });
        const order = await db.collection('orders').findOne({ _id: prior.orderId });
        return res.json({ duplicate: true, order: withId(order), result: prior.outcome });
      }
      throw err;
    }
  }

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await db.collection('orders').findOne({ _id: id }, { session });
      if (!order) throw { code: 404, message: 'Order not found' };
      if (order.status !== 'Reserved') throw { code: 409, message: `Order is '${order.status}', cannot pay again` };

      if (outcome === 'success') {
        for (const it of order.items) {
          await db.collection('products').updateOne({ _id: it.productId }, { $inc: { stock: -it.qty, reserved: -it.qty } }, { session });
        }
        await db.collection('orders').updateOne(
          { _id: id },
          { $set: { status: 'Paid', updatedAt: now() }, $unset: { expiresAt: '' } },
          { session }
        );
      } else {
        for (const it of order.items) {
          await db.collection('products').updateOne({ _id: it.productId }, { $inc: { reserved: -it.qty } }, { session });
        }
        await db.collection('orders').updateOne(
          { _id: id },
          { $set: { status: outcome === 'failure' ? 'Failed' : 'Expired', updatedAt: now() }, $unset: { expiresAt: '' } },
          { session }
        );
      }
    });
    const order = await db.collection('orders').findOne({ _id: id });
    res.json({ outcome, order: withId(order) });
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message || 'Payment failed' });
  } finally {
    await session.endSession();
  }
});

// ---------- Cancel + refund simulation ----------
app.post('/orders/:id/cancel', async (req, res) => {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await db.collection('orders').findOne({ _id: req.params.id }, { session });
      if (!order) throw { code: 404, message: 'Order not found' };
      if (!['Reserved', 'Paid'].includes(order.status)) {
        throw { code: 409, message: `Order in status '${order.status}' cannot be cancelled` };
      }
      let refunded = false;
      if (order.status === 'Paid') {
        for (const it of order.items) {
          await db.collection('products').updateOne({ _id: it.productId }, { $inc: { stock: it.qty } }, { session });
        }
        refunded = true; // simulate refund issued back to the customer
      } else {
        for (const it of order.items) {
          await db.collection('products').updateOne({ _id: it.productId }, { $inc: { reserved: -it.qty } }, { session });
        }
      }
      await db.collection('orders').updateOne(
        { _id: req.params.id },
        { $set: { status: 'Cancelled', refunded, updatedAt: now() }, $unset: { expiresAt: '' } },
        { session }
      );
    });
    const order = await db.collection('orders').findOne({ _id: req.params.id });
    res.json(withId(order));
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message || 'Cancel failed' });
  } finally {
    await session.endSession();
  }
});

// ---------- Order history ----------
app.get('/orders', async (req, res) => {
  const { userId } = req.query;
  const filter = userId ? { userId } : {};
  const orders = await db.collection('orders').find(filter).sort({ createdAt: -1 }).toArray();
  res.json(orders.map(withId));
});

app.get('/orders/:id', async (req, res) => {
  const order = await db.collection('orders').findOne({ _id: req.params.id });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(withId(order));
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'ecommerce-checkout-backend' }));

const PORT = process.env.PORT || 4002;

async function seedStorefrontProducts(database) {
  const count = await database.collection('products').countDocuments();
  if (count === 0) {
    const demoProducts = [
      { _id: uuid(), name: 'Noise-Cancelling Headphones', description: 'Premium active noise cancellation with 30h battery life.', category: 'Audio', price: 199.99, stock: 12, reserved: 0 },
      { _id: uuid(), name: 'Mechanical Gaming Keyboard', description: 'Tactile switches with customizable RGB backlighting.', category: 'Electronics', price: 129.50, stock: 8, reserved: 0 },
      { _id: uuid(), name: 'Ultra-Wide Curved Monitor 34"', description: 'WQHD 144Hz high refresh rate display for productivity and gaming.', category: 'Electronics', price: 449.00, stock: 4, reserved: 0 },
      { _id: uuid(), name: 'Ergonomic Desk Chair', description: 'Adjustable lumbar support and breathable mesh design.', category: 'Office', price: 249.00, stock: 6, reserved: 0 },
      { _id: uuid(), name: 'Bluetooth Conference Speaker', description: '360-degree omnidirectional microphone with clear voice pickup.', category: 'Audio', price: 79.99, stock: 15, reserved: 0 },
      { _id: uuid(), name: 'Flash Sale Item (Limited)', description: 'Limited stock flash deal item to test concurrent checkouts.', category: 'Electronics', price: 29.99, stock: 2, reserved: 0 }
    ];
    await database.collection('products').insertMany(demoProducts);
    console.log(`Seeded ${demoProducts.length} demo storefront products.`);
  }
}

connect()
  .then(async database => {
    db = database;
    await seedStorefrontProducts(db);
    app.listen(PORT, () => console.log(`E-commerce backend running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
