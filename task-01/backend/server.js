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
    // Find reserved orders older than 5 minutes
    const result = await pool.query(
      `SELECT id FROM orders WHERE status = 'Reserved' AND updated_at < NOW() - INTERVAL '5 minutes'`
    );

    for (let row of result.rows) {
      // Begin transaction to revert stock and cancel order
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        
        const items = await client.query(
          "SELECT product_id, quantity FROM order_items WHERE order_id = $1",
          [row.id]
        );
        
        for (let item of items.rows) {
          await client.query(
            "UPDATE products SET stock = stock + $1 WHERE id = $2",
            [item.quantity, item.product_id]
          );
        }
        
        await client.query(
          "UPDATE orders SET status = 'Expired', updated_at = NOW() WHERE id = $1",
          [row.id]
        );
        
        await client.query("COMMIT");
        console.log(`Order ${row.id} expired and stock released.`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("Error expiring order:", err);
      } finally {
        client.release();
      }
    }
  } catch (err) {
    console.error("Error in background job:", err);
  }
}, 30000);

// Product CRUD
app.get("/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id");
    res.json(result.rows);
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

app.put("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, stock } = req.body;
    const result = await pool.query(
      "UPDATE products SET name = $1, price = $2, stock = $3 WHERE id = $4 RETURNING *",
      [name, price, stock, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM products WHERE id = $1", [id]);
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checkout and Reserve Stock
app.post("/checkout", async (req, res) => {
  const { cart } = req.body; // array of { productId, quantity }
  if (!cart || cart.length === 0) return res.status(400).json({ error: "Cart is empty" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    let totalAmount = 0;
    
    // Check stock for all items
    for (let item of cart) {
      // Concurrency safe: SELECT ... FOR UPDATE
      const productRes = await client.query(
        "SELECT id, price, stock FROM products WHERE id = $1 FOR UPDATE",
        [item.productId]
      );
      
      if (productRes.rows.length === 0) {
        throw new Error(`Product ${item.productId} not found`);
      }
      
      const product = productRes.rows[0];
      if (product.stock < item.quantity) {
        throw new Error(`Not enough stock for product ${item.productId}`);
      }
      
      totalAmount += product.price * item.quantity;
    }
    
    // Create order as Pending initially to satisfy lifecycle requirement
    const orderRes = await client.query(
      "INSERT INTO orders (status, total_amount) VALUES ('Pending', $1) RETURNING *",
      [totalAmount]
    );
    const orderId = orderRes.rows[0].id;
    
    // Deduct stock and insert order items
    for (let item of cart) {
      const productRes = await client.query(
        "SELECT price FROM products WHERE id = $1",
        [item.productId]
      );
      
      await client.query(
        "UPDATE products SET stock = stock - $1 WHERE id = $2",
        [item.quantity, item.productId]
      );
      
      await client.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)",
        [orderId, item.productId, item.quantity, productRes.rows[0].price]
      );
    }
    
    // Once stock is successfully deducted, move to Reserved
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

// Payment Processing (Mock)
app.post("/payment", async (req, res) => {
  const { orderId, idempotencyKey, outcome } = req.body;
  
  if (!orderId || !idempotencyKey || !outcome) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Check idempotency
    const existingPayment = await client.query(
      "SELECT * FROM payments WHERE idempotency_key = $1",
      [idempotencyKey]
    );
    
    if (existingPayment.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.json({ message: "Duplicate payment attempt", payment: existingPayment.rows[0] });
    }
    
    // Lock the order
    const orderRes = await client.query(
      "SELECT status, total_amount FROM orders WHERE id = $1 FOR UPDATE",
      [orderId]
    );
    
    if (orderRes.rows.length === 0) {
      throw new Error("Order not found");
    }
    
    const order = orderRes.rows[0];
    if (order.status !== "Reserved") {
      throw new Error(`Order cannot be paid. Current status: ${order.status}`);
    }
    
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
    
    // Record payment
    const paymentRecord = await client.query(
      "INSERT INTO payments (order_id, idempotency_key, status, amount) VALUES ($1, $2, $3, $4) RETURNING *",
      [orderId, idempotencyKey, paymentStatus, order.total_amount]
    );
    
    // Update order status
    await client.query(
      "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2",
      [newOrderStatus, orderId]
    );
    
    // If failed or timeout, release the stock
    if (newOrderStatus === "Failed" || newOrderStatus === "Expired") {
      const items = await client.query("SELECT product_id, quantity FROM order_items WHERE order_id = $1", [orderId]);
      for (let item of items.rows) {
        await client.query(
          "UPDATE products SET stock = stock + $1 WHERE id = $2",
          [item.quantity, item.product_id]
        );
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

// Order Cancellation
app.post("/orders/:id/cancel", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderRes = await client.query("SELECT status FROM orders WHERE id = $1 FOR UPDATE", [id]);
    if (orderRes.rows.length === 0) throw new Error("Order not found");
    
    const status = orderRes.rows[0].status;
    if (status !== "Reserved") throw new Error(`Cannot cancel order in ${status} status`);
    
    // Release stock
    const items = await client.query("SELECT product_id, quantity FROM order_items WHERE order_id = $1", [id]);
    for (let item of items.rows) {
      await client.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [item.quantity, item.product_id]);
    }
    
    // Update status to Cancelled
    await client.query("UPDATE orders SET status = 'Cancelled', updated_at = NOW() WHERE id = $1", [id]);
    
    await client.query("COMMIT");
    res.json({ message: "Order cancelled and stock restored" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/orders", async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
