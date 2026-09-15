require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Auto-expire reservations background job (every 30 seconds)
setInterval(async () => {
  try {
    const result = await pool.query(
      `SELECT id FROM orders WHERE status = 'Reserved' AND updated_at < NOW() - INTERVAL '5 minutes'`
    );

    for (let row of result.rows) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const items = await client.query("SELECT product_id, quantity FROM order_items WHERE order_id = $1", [row.id]);
        for (let item of items.rows) {
          await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [item.quantity, item.product_id]);
        }
        await client.query("UPDATE orders SET status = 'Expired', updated_at = NOW() WHERE id = $1", [row.id]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  } catch (err) {}
}, 30000);

// Product Categories (Mock)
app.get("/products/categories", async (req, res) => {
  res.json(["Electronics", "Accessories", "Peripherals"]);
});

// Product Listing with search and filters
app.get("/products", async (req, res) => {
  try {
    const { search, minPrice, maxPrice, inStock, category } = req.query;
    let query = "SELECT * FROM products WHERE 1=1";
    let params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND name ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (minPrice) {
      query += ` AND price >= $${paramIndex}`;
      params.push(minPrice);
      paramIndex++;
    }
    if (maxPrice) {
      query += ` AND price <= $${paramIndex}`;
      params.push(maxPrice);
      paramIndex++;
    }
    if (inStock === 'true') {
      query += ` AND stock > 0`;
    }

    query += " ORDER BY id";
    const result = await pool.query(query, params);
    
    // Map stock to available and add mock category/description for HTML template compatibility
    const products = result.rows.map(p => ({
      ...p,
      available: p.stock,
      category: "Electronics",
      description: "A great product."
    }));
    
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Product Details
app.get("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM products WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Product not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/products", async (req, res) => {
  try {
    const { name, price, stock } = req.body;
    const result = await pool.query(
      "INSERT INTO products (name, price, stock) VALUES ($1, $2, $3) RETURNING *",
      [name, price, stock]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checkout
app.post(["/checkout", "/cart/checkout"], async (req, res) => {
  const cart = req.body.cart || req.body.items || []; 
  if (!cart || cart.length === 0) return res.status(400).json({ error: "Cart is empty" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let totalAmount = 0;
    
    for (let item of cart) {
      const productId = item.productId || item.product_id;
      const quantity = item.quantity || item.qty;
      const productRes = await client.query(
        "SELECT id, price, stock FROM products WHERE id = $1 FOR UPDATE",
        [productId]
      );
      if (productRes.rows.length === 0) throw new Error(`Product ${productId} not found`);
      const product = productRes.rows[0];
      if (product.stock < quantity) throw new Error(`Not enough stock for product ${productId}`);
      totalAmount += product.price * quantity;
    }
    
    const orderRes = await client.query(
      "INSERT INTO orders (status, total_amount) VALUES ('Pending', $1) RETURNING *",
      [totalAmount]
    );
    const orderId = orderRes.rows[0].id;
    
    for (let item of cart) {
      const productId = item.productId || item.product_id;
      const quantity = item.quantity || item.qty;
      const productRes = await client.query("SELECT price FROM products WHERE id = $1", [productId]);
      await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [quantity, productId]);
      await client.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)",
        [orderId, productId, quantity, productRes.rows[0].price]
      );
    }
    
    await client.query("UPDATE orders SET status = 'Reserved', updated_at = NOW() WHERE id = $1", [orderId]);
    await client.query("COMMIT");
    res.json({ orderId, status: "Reserved", totalAmount });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Payment
app.post(["/payment", "/orders/:id/pay"], async (req, res) => {
  const orderId = req.body.orderId || req.params.id;
  const idempotencyKey = req.body.idempotencyKey || req.body.idempotencyKey;
  const outcome = req.body.outcome;
  
  if (!orderId || !idempotencyKey || !outcome) return res.status(400).json({ error: "Missing required fields" });
  
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingPayment = await client.query("SELECT * FROM payments WHERE idempotency_key = $1", [idempotencyKey]);
    if (existingPayment.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.json({ message: "Duplicate payment attempt", payment: existingPayment.rows[0] });
    }
    
    const orderRes = await client.query("SELECT status, total_amount FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (orderRes.rows.length === 0) throw new Error("Order not found");
    const order = orderRes.rows[0];
    if (order.status !== "Reserved") throw new Error(`Order cannot be paid. Current status: ${order.status}`);
    
    let paymentStatus, newOrderStatus;

    if (outcome === "success") {
      paymentStatus = "Success";
      newOrderStatus = "Paid";
    } else if (outcome === "failure") {
      paymentStatus = "Failed";
      newOrderStatus = "Failed";
    } else if (outcome === "timeout") {
      paymentStatus = "Timeout";
      newOrderStatus = "Expired"; // Expire reservation on timeout
    } else {
      throw new Error("Invalid outcome");
    }
    
    const paymentRecord = await client.query(
      "INSERT INTO payments (order_id, idempotency_key, status, amount) VALUES ($1, $2, $3, $4) RETURNING *",
      [orderId, idempotencyKey, paymentStatus, order.total_amount]
    );
    
    await client.query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", [newOrderStatus, orderId]);
    
    // If failed or timeout, release the stock
    if (newOrderStatus === "Failed" || newOrderStatus === "Expired") {
      const items = await client.query("SELECT product_id, quantity FROM order_items WHERE order_id = $1", [orderId]);
      for (let item of items.rows) {
        await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [item.quantity, item.product_id]);
      }
    }
    await client.query("COMMIT");
    res.json({ message: `Payment ${paymentStatus}`, payment: paymentRecord.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Order History
app.get("/orders", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
    const orders = result.rows;
      
    // Fetch items for each order
    for (let order of orders) {
      const itemsRes = await pool.query(
        "SELECT oi.product_id, oi.quantity as qty, p.name as product_name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = $1",
        [order.id]
      );
      order.items = itemsRes.rows;
      order.total = parseFloat(order.total_amount); // for frontend compatibility
      
      // Calculate expiresAt for Reserved orders
      if (order.status === 'Reserved') {
        order.expiresAt = new Date(order.updated_at).getTime() + (5 * 60 * 1000);
      }
    }
    
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel Order
app.post("/orders/:id/cancel", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderRes = await client.query("SELECT status FROM orders WHERE id = $1 FOR UPDATE", [id]);
    if (orderRes.rows.length === 0) throw new Error("Order not found");
    
    const status = orderRes.rows[0].status;
    if (status !== "Reserved") throw new Error(`Cannot cancel order in ${status} status`);
    
    await client.query("UPDATE orders SET status = 'Cancelled', updated_at = NOW() WHERE id = $1", [id]);
    
    const items = await client.query("SELECT product_id, quantity FROM order_items WHERE order_id = $1", [id]);
    for (let item of items.rows) {
      await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [item.quantity, item.product_id]);
    }
    
    await client.query("COMMIT");
    res.json({ message: "Order cancelled" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Refund Order
app.post("/orders/:id/refund", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderRes = await client.query("SELECT status FROM orders WHERE id = $1 FOR UPDATE", [id]);
    if (orderRes.rows.length === 0) throw new Error("Order not found");
    
    const status = orderRes.rows[0].status;
    if (status !== "Paid") throw new Error(`Cannot refund order in ${status} status`);
    
    await client.query("UPDATE orders SET status = 'Refunded', updated_at = NOW() WHERE id = $1", [id]);
    
    const items = await client.query("SELECT product_id, quantity FROM order_items WHERE order_id = $1", [id]);
    for (let item of items.rows) {
      await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [item.quantity, item.product_id]);
    }
    
    await client.query("COMMIT");
    res.json({ message: "Order refunded" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 5001; // use different port if running both
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
