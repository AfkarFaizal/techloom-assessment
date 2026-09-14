-- init.sql
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  stock INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  status VARCHAR(50) NOT NULL, -- Pending, Reserved, Paid, Cancelled, Expired, Failed, Refunded
  total_amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  product_id INT REFERENCES products(id),
  quantity INT NOT NULL,
  price DECIMAL(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
