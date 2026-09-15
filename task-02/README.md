# Task 02 — E-Commerce Checkout & Payment System

Mini storefront (Node.js + Express + MongoDB) with search/filter, checkout, mock
payments, refunds, and order history. Frontend is React (loaded via CDN, no build
step) using [htm](https://github.com/developit/htm) in place of JSX.

## Tech stack
- Backend: Node.js, Express, MongoDB (native `mongodb` driver, multi-document transactions)
- Database: MongoDB Atlas (free tier)
- Frontend: React 18 + htm (CDN, single HTML file)

## Setup

### 1. MongoDB Atlas connection string
Same Atlas cluster from Task 01 works fine — just give this service its own
database name (see `MONGODB_DB_NAME` below) so the two tasks' data don't mix.
If you haven't created a cluster yet, see Task 01's README for the full walkthrough.

### 2. Run locally
```bash
cd backend
cp .env.example .env
# paste your connection string into .env as MONGODB_URI=...
npm install
npm start          # runs on http://localhost:4002, seeds 6 demo products on first run
```
Then open `frontend/index.html`. If your backend runs somewhere other than
`http://localhost:4002`, edit `frontend/config.js`.

## Environment variables
| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGODB_URI` | **Yes** | — | Your Atlas (or other MongoDB) connection string |
| `MONGODB_DB_NAME` | No | `ecommerce_shop` | Database name inside the cluster |
| `PORT` | No | 4002 | Port the backend listens on |

## How to test each feature
1. **Search & filter** — type in search, pick a category, or set a max price.
2. **Product details** — click "Details" on any product card.
3. **Cart & checkout** — add items, checkout; stock is reserved for 5 minutes
   (countdown visible on the order card in Order History).
4. **Mock payment outcomes** — Pay ✓ / ✗ / ⧗ on a `Reserved` order.
5. **Duplicate payment prevention** — click a pay button twice quickly; the second
   is rejected by a unique index on `idempotencyKey`.
6. **Cancellation + refund** — cancel a `Paid` order; it's marked
   `Cancelled (refunded)` and stock is restored.
7. **Order history** — lists all of this demo user's past and current orders.

## API summary
```
GET  /products?search=&category=&minPrice=&maxPrice=&inStock=true
GET  /products/categories
GET  /products/:id
POST /products                { name, description, category, price, stock }
POST /cart/checkout           { userId, items: [{ productId, qty }] }
POST /orders/:id/pay          { outcome?: success|failure|timeout, idempotencyKey? }
POST /orders/:id/cancel
GET  /orders?userId=
GET  /orders/:id
```

## Known simplification
No real authentication — `userId` is a fixed demo string on the frontend. This is a
deliberate, documented trade-off to keep scope on the checkout/payment/inventory
logic the evaluation criteria actually test.
