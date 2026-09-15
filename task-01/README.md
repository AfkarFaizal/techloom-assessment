# Task 01 — POS Order & Inventory System

Concurrency-safe POS backend (Node.js + Express + MongoDB) with a plain-JS frontend.

## Tech stack
- Backend: Node.js, Express, MongoDB (native `mongodb` driver, multi-document transactions)
- Database: MongoDB Atlas (free tier) — a hosted, always-on replica set, which is required for transactions to work
- Frontend: Plain HTML/CSS/JavaScript (no build step)

## How concurrency safety works
Every checkout, payment, and cancellation runs inside a MongoDB **session transaction**
(`session.withTransaction(...)`). Stock is reserved with a conditional update —
`updateOne({ _id, $expr: { $gte: [stock - reserved, qty] } }, { $inc: { reserved: qty } })`
— which only succeeds if enough stock is still free *at the moment of the write*. If
any item in a cart can't be reserved, the whole transaction aborts and nothing is left
half-reserved. This is what prevents two simultaneous checkouts from overselling the
same item.

MongoDB transactions require a replica set (a single standalone `mongod` does not
support them) — this is why the project uses MongoDB Atlas rather than a local
install: every Atlas cluster, including the free M0 tier, is already a replica set.

## Order lifecycle
`Reserved → Paid` (success) · `Reserved → Failed` (payment failure, stock released)
`Reserved → Expired` (timeout or 5-min reservation expiry, stock released)
`Reserved/Paid → Cancelled` (manual cancel, stock restored)

## Setup

### 1. Get a MongoDB Atlas connection string (free)
1. Sign up at [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register)
2. Create a free **M0** cluster
3. **Database Access** → add a database user (username + password)
4. **Network Access** → add IP address `0.0.0.0/0` (allow access from anywhere — needed
   so Render can connect once deployed; fine for an assessment project)
5. **Database** → **Connect** → **Drivers** → copy the connection string
   (looks like `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/...`)

### 2. Run locally
```bash
cd backend
cp .env.example .env
# paste your connection string into .env as MONGODB_URI=...
npm install
npm start          # runs on http://localhost:4001
```
Then open `frontend/index.html` in a browser. If your backend runs somewhere other
than `http://localhost:4001`, edit `frontend/config.js`.

## Environment variables
| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGODB_URI` | **Yes** | — | Your Atlas (or other MongoDB) connection string |
| `MONGODB_DB_NAME` | No | `pos_inventory` | Database name inside the cluster |
| `PORT` | No | 4001 | Port the backend listens on |

## How to test each feature
1. **Products (CRUD)** — Add a product (small stock, e.g. 2), Edit it, Delete it.
2. **Concurrency / no overselling** — open two browser tabs, checkout the same
   low-stock item in both at nearly the same time; only one (or as many as stock
   allows) succeeds, the other gets "Insufficient stock".
3. **Reservation + 5-min expiry** — checkout an item, watch the countdown. If unpaid
   after 5 minutes it flips to `Expired` and stock becomes available again.
4. **Payments** — on a `Reserved` order, use Pay ✓ / ✗ / ⧗ to simulate each outcome.
5. **Duplicate payment** — click the same pay button twice quickly; the second call
   is rejected by a unique index on `idempotencyKey` and returns the original result.
6. **Cancel** — cancel a `Reserved` or `Paid` order and confirm stock is restored.

## API summary
```
GET    /products
POST   /products              { name, price, stock }
PUT    /products/:id
DELETE /products/:id
POST   /cart/checkout         { items: [{ productId, qty }] }
POST   /orders/:id/pay        { outcome?: success|failure|timeout, idempotencyKey? }
POST   /orders/:id/cancel
GET    /orders
GET    /orders/:id
```
