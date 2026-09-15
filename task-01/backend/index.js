const express = require('express');
const cors = require('cors');
const { v4: uuid } = require('uuid');
const { connect, client } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const RESERVATION_MS = 5 * 60 * 1000; // 5 minutes
const now = () => Date.now();

let db; // set once at startup, see bottom of file

// ---------- helpers ----------
function withAvailable(p) {
  return { ...p, id: p._id, available: p.stock - p.reserved };
}

function withId(doc) {
  return doc ? { ...doc, id: doc._id } : doc;
}

// Release the stock a reservation is holding and mark the order with newStatus.
// Runs inside a MongoDB session transaction so the per-item stock updates and the
// order status change are all-or-nothing.
async function releaseReservation(orderId, newStatus) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await db.collection('orders').findOne({ _id: orderId }, { session });
      if (!order) throw { code: 404, message: 'Order not found' };
      for (const it of order.items) {
        await db.collection('products').updateOne(
          { _id: it.productId },
          { $inc: { reserved: -it.qty } },
          { session }
        );
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

// Background sweep: expire reservations whose 5-minute window has passed.
setInterval(async () => {
  if (!db) return;
  try {
    const expired = await db.collection('orders')
      .find({ status: 'Reserved', expiresAt: { $lte: now() } })
      .toArray();
    for (const o of expired) {
      await releaseReservation(o._id, 'Expired');
    }
  } catch (err) {
    console.error('Expiry sweep error:', err.message);
  }
}, 5000);

// ---------- Product CRUD ----------
app.get('/products', async (req, res) => {
  const products = await db.collection('products').find().toArray();
  res.json(products.map(withAvailable));
});

app.get('/products/:id', async (req, res) => {
  const p = await db.collection('products').findOne({ _id: req.params.id });
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(withAvailable(p));
});

app.post('/products', async (req, res) => {
  const { name, price, stock } = req.body;
  if (!name || price == null || stock == null) {
    return res.status(400).json({ error: 'name, price and stock are required' });
  }
  const doc = { _id: uuid(), name, price, stock, reserved: 0 };
  await db.collection('products').insertOne(doc);
  res.status(201).json(withAvailable(doc));
});

app.put('/products/:id', async (req, res) => {
  const { name, price, stock } = req.body;
  const update = {};
  if (name !== undefined) update.name = name;
  if (price !== undefined) update.price = price;
  if (stock !== undefined) update.stock = stock;
  const result = await db.collection('products').findOneAndUpdate(
    { _id: req.params.id },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Product not found' });
  res.json(withAvailable(result));
});

app.delete('/products/:id', async (req, res) => {
  await db.collection('products').deleteOne({ _id: req.params.id });
  res.status(204).end();
});

// ---------- Cart -> Checkout (creates order + reserves stock) ----------
// This is the concurrency-critical path. It runs inside a MongoDB multi-document
// transaction (session.withTransaction): first every item's availability is
// checked, then each item's stock is atomically reserved with a conditional
// update (`$expr` guard re-checks availability at write time). If any item can't
// be reserved, the whole transaction aborts and nothing is left half-reserved —
// this is what prevents two simultaneous checkouts from overselling the same item.
app.post('/cart/checkout', async (req, res) => {
  const { items } = req.body; // [{ productId, qty }]
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }
  const session = client.startSession();
  const orderId = uuid();
  try {
    let orderTotal = 0;
    const orderItems = [];
    await session.withTransaction(async () => {
      const productsCol = db.collection('products');
      for (const it of items) {
        const result = await productsCol.updateOne(
          {
            _id: it.productId,
            $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, it.qty] },
          },
          { $inc: { reserved: it.qty } },
          { session }
        );
        if (result.matchedCount === 0) {
          const exists = await productsCol.findOne({ _id: it.productId }, { session });
          if (!exists) throw { code: 404, message: `Product ${it.productId} not found` };
          throw { code: 409, message: `Insufficient stock for product ${it.productId}` };
        }
        const product = await productsCol.findOne({ _id: it.productId }, { session });
        orderItems.push({ productId: it.productId, name: product.name, qty: it.qty, price: product.price });
        orderTotal += product.price * it.qty;
      }
      const ts = now();
      await db.collection('orders').insertOne({
        _id: orderId,
        status: 'Reserved',
        total: orderTotal,
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

// ---------- Mock payment ----------
// outcome: 'success' | 'failure' | 'timeout' (random if omitted)
// idempotencyKey: a unique index on paymentAttempts.idempotencyKey rejects a second
// insert with the same key (duplicate key error 11000), so a repeated payment
// submission for the same attempt returns the original result instead of re-processing.
app.post('/orders/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { idempotencyKey } = req.body;
  let { outcome } = req.body;
  if (!outcome) {
    const r = Math.random();
    outcome = r < 0.7 ? 'success' : r < 0.9 ? 'failure' : 'timeout';
  }

  if (idempotencyKey) {
    try {
      await db.collection('paymentAttempts').insertOne({ idempotencyKey, orderId: id, outcome, createdAt: now() });
    } catch (err) {
      if (err.code === 11000) {
        const prior = await db.collection('paymentAttempts').findOne({ idempotencyKey });
        const order = await db.collection('orders').findOne({ _id: prior.orderId });
        return res.json({ duplicate: true, order, result: prior.outcome });
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
          await db.collection('products').updateOne(
            { _id: it.productId },
            { $inc: { stock: -it.qty, reserved: -it.qty } },
            { session }
          );
        }
        await db.collection('orders').updateOne(
          { _id: id },
          { $set: { status: 'Paid', updatedAt: now() }, $unset: { expiresAt: '' } },
          { session }
        );
      } else {
        for (const it of order.items) {
          await db.collection('products').updateOne(
            { _id: it.productId },
            { $inc: { reserved: -it.qty } },
            { session }
          );
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

// ---------- Cancel ----------
app.post('/orders/:id/cancel', async (req, res) => {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await db.collection('orders').findOne({ _id: req.params.id }, { session });
      if (!order) throw { code: 404, message: 'Order not found' };
      if (!['Reserved', 'Paid'].includes(order.status)) {
        throw { code: 409, message: `Order in status '${order.status}' cannot be cancelled` };
      }
      if (order.status === 'Paid') {
        // stock was already deducted permanently on payment -> restore it fully
        for (const it of order.items) {
          await db.collection('products').updateOne({ _id: it.productId }, { $inc: { stock: it.qty } }, { session });
        }
      } else {
        // still just a reservation -> release the hold
        for (const it of order.items) {
          await db.collection('products').updateOne({ _id: it.productId }, { $inc: { reserved: -it.qty } }, { session });
        }
      }
      await db.collection('orders').updateOne(
        { _id: req.params.id },
        { $set: { status: 'Cancelled', updatedAt: now() }, $unset: { expiresAt: '' } },
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

// ---------- Order read ----------
app.get('/orders', async (req, res) => {
  const orders = await db.collection('orders').find().sort({ createdAt: -1 }).toArray();
  res.json(orders.map(withId));
});

app.get('/orders/:id', async (req, res) => {
  const order = await db.collection('orders').findOne({ _id: req.params.id });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(withId(order));
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'pos-inventory-backend' }));

const PORT = process.env.PORT || 4001;

async function seedInitialProducts(database) {
  const count = await database.collection('products').countDocuments();
  if (count === 0) {
    const initialProducts = [
      { _id: uuid(), name: 'Wireless Barcode Scanner', price: 89.99, stock: 15, reserved: 0 },
      { _id: uuid(), name: 'Thermal Receipt Printer', price: 149.50, stock: 10, reserved: 0 },
      { _id: uuid(), name: 'POS Touchscreen Terminal', price: 499.00, stock: 5, reserved: 0 },
      { _id: uuid(), name: 'Electronic Cash Drawer', price: 75.00, stock: 8, reserved: 0 },
      { _id: uuid(), name: 'Magnetic Card Reader', price: 35.25, stock: 20, reserved: 0 },
      { _id: uuid(), name: 'Limited Edition Demo Item', price: 19.99, stock: 2, reserved: 0 } // For concurrency testing
    ];
    await database.collection('products').insertMany(initialProducts);
    console.log(`Seeded ${initialProducts.length} initial products.`);
  }
}

connect()
  .then(async database => {
    db = database;
    await seedInitialProducts(db);
    app.listen(PORT, () => console.log(`POS backend running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
