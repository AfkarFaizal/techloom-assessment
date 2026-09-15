CREATE TABLE products (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  stock INT NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id INT IDENTITY(1,1) PRIMARY KEY,
  status VARCHAR(50) NOT NULL, -- Pending, Reserved, Paid, Cancelled, Expired, Failed, Refunded
  total_amount DECIMAL(10, 2) NOT NULL,
  created_at DATETIME2 DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME2 DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id INT IDENTITY(1,1) PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  product_id INT REFERENCES products(id),
  quantity INT NOT NULL,
  price DECIMAL(10, 2) NOT NULL
);

CREATE TABLE payments (
  id INT IDENTITY(1,1) PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  created_at DATETIME2 DEFAULT CURRENT_TIMESTAMP
);
