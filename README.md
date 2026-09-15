# Techloom.ai — Software Engineer Intern Practical Assessment

### 🔗 Project Links & Live Deployments
- **GitHub Repository:** [https://github.com/AfkarFaizal/techloom-assessment](https://github.com/AfkarFaizal/techloom-assessment)
- **Task 01 (POS Order & Inventory System):**
  - **Live Backend (Railway):** `techloom-assessment-production-1ede.up.railway.app`(<https://railway.com/project/34b78014-f978-4cc3-8110-4f6a01171611/service/6e3f7c45-a362-4ab9-85c7-9944b2773430/settings?environmentId=d3280bb4-d617-41ea-b09e-2c89e5f10de5>) *(Replace with your deployed URL)*
  - **Live Frontend (Vercel / Netlify):** (https://vercel.com/mohomadafkar19-1758s-projects/techloom-assessment-f6jc/HNCFYDEhk5ieKtTAjikUn8QYZe93) *(Replace with your deployed URL)*
- 
**Task 02 (E-Commerce Storefront & Checkout System):**

- **Live Backend (Railway):** `techloom-assessment-task-2-2e50.up.railway.app` *(Replace with your deployed URL)*
  - **Live Frontend (Vercel / Netlify):** https://vercel.com/mohomadafkar19-1758s-projects/techloom-assessment-41wn/96SdLmfDwKsGn7eikkFk4MC8LpP8 *(Replace with your deployed URL)*

---

## 🏗️ Repository Structure
```
techloom-assessment/
├── README.md                 # Master documentation with setup & test guides
├── .gitignore                # Git ignore patterns
├── .env.example              # Example environment configurations
├── docker-compose.yml        # Multi-container orchestration for both tasks
├── task-01/
│   ├── README.md             # Task 01 specific architecture & walkthrough
│   ├── backend/
│   │   ├── index.js          # Express server with MongoDB multi-doc transactions
│   │   ├── db.js             # MongoDB Atlas connection & unique indexes
│   │   ├── test-concurrency.js # Concurrency test suite (proves no overselling)
│   │   ├── test-lifecycle.js # Order lifecycle, expiry & payment test suite
│   │   ├── package.json      # Dependencies and test runner scripts
│   │   ├── Dockerfile        # Container specification
│   │   └── .env.example      # Backend environment variables template
│   └── frontend/
│       ├── index.html        # Clean, reactive POS UI (no build step needed)
│       ├── config.js         # API endpoint configuration
│       └── vercel.json       # Static hosting configuration
└── task-02/
    ├── README.md             # Task 02 specific architecture & walkthrough
    ├── backend/
    │   ├── index.js          # Express server with search, filter, refunds & checkout
    │   ├── db.js             # MongoDB Atlas connection & transaction session
    │   ├── test-concurrency.js # E-commerce checkout concurrency test
    │   ├── package.json      # Dependencies and test runner scripts
    │   ├── Dockerfile        # Container specification
    │   └── .env.example      # Backend environment variables template
    └── frontend/
        ├── index.html        # React 18 (via CDN) storefront with search & filters
        ├── config.js         # API endpoint configuration
        └── vercel.json       # Static hosting configuration
```

---

## 💻 Tech Stack
- **Backend:** Node.js, Express.js
- **Database:** MongoDB Atlas (M0 Free Tier Replica Set — required for multi-document ACID transactions)
- **Frontend:**
  - **Task 01:** Pure Modern JavaScript, HTML5, CSS3 (No build step required)
  - **Task 02:** React 18 + `htm` via CDN (Zero-build client-side reactive components)
- **DevOps & Containers:** Docker, Docker Compose, Render, Vercel/Netlify

---

## ⚡ Core Technical Mechanisms & Evaluation Criteria

### 1. Concurrency Handling & Prevention of Overselling
- Every checkout runs within a MongoDB **session transaction** (`session.withTransaction(...)`).
- Stock is reserved with a conditional atomic update:
  ```javascript
  await productsCol.updateOne(
    {
      _id: it.productId,
      $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, it.qty] }
    },
    { $inc: { reserved: it.qty } },
    { session }
  );
  ```
- If stock is insufficient at the exact instant of the write, `matchedCount === 0` triggers an automatic rollback of the entire cart reservation, returning HTTP `409 Conflict`.
- **Zero overselling is mathematically guaranteed** under high concurrency.

### 2. 5-Minute Reservation Hold & Automatic Expiry
- Entering checkout locks the stock under `status: "Reserved"` and records `expiresAt = Date.now() + 5 * 60 * 1000`.
- An automatic background worker sweeps every 5 seconds to identify stale reservations:
  ```javascript
  db.collection('orders').find({ status: 'Reserved', expiresAt: { $lte: Date.now() } })
  ```
- Any unpaid order exceeding 5 minutes is automatically marked `Expired` and its reserved stock is returned to inventory.

### 3. Payment Simulation & Idempotency
- Simulates payment gateway outcomes:
  - **`success`**: Converts order to `Paid` and permanently settles inventory.
  - **`failure`**: Marks order as `Failed` and immediately releases reserved stock.
  - **`timeout`**: Marks order as `Expired` and immediately restores stock.
- A database-level unique index on `idempotencyKey` in the `paymentAttempts` collection guarantees that duplicate submissions (e.g. rapid double-clicking or network retries) return the original transaction result without double-charging.

### 4. Full Order Lifecycle & Cancellation / Refunds
- Orders transition strictly between valid statuses:
  `Pending / Reserved → Paid | Failed | Expired | Cancelled | Refunded`.
- Cancelling a `Reserved` or `Paid` order safely reverses inventory and marks the order as `Cancelled` (or `Cancelled (refunded)`).

---

## 🚀 Step-by-Step Local Setup

### Step 1: Clone the Repository
```bash
git clone https://github.com/AfkarFaizal/techloom-assessment.git
cd techloom-assessment
```

### Step 2: Configure MongoDB Atlas Connection String
1. Sign up for free at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register).
2. Create an **M0 Free Cluster** (Replica Set).
3. Under **Network Access**, allow access from anywhere (`0.0.0.0/0`).
4. Under **Database Access**, create a user (e.g., `admin` with a password).
5. Copy your connection string: `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

### Step 3: Run Task 01 (POS Order & Inventory)
```bash
cd task-01/backend
# Create .env file and set MONGODB_URI
copy .env.example .env
# Edit .env and paste your MONGODB_URI

npm install
npm start
```
- Backend runs at: `http://localhost:4001` (automatically seeds demo products on first launch).
- Open `task-01/frontend/index.html` directly in your browser.

### Step 4: Run Task 02 (E-Commerce Storefront)
```bash
cd task-02/backend
# Create .env file and set MONGODB_URI
copy .env.example .env
# Edit .env and paste your MONGODB_URI

npm install
npm start
```
- Backend runs at: `http://localhost:4002` (automatically seeds categorized demo products).
- Open `task-02/frontend/index.html` directly in your browser.

---

## 🧪 Automated Testing

Both tasks come equipped with automated test suites verifying concurrency safety and lifecycle correctness.

### Run Task 01 Concurrency Test:
```bash
cd task-01/backend
npm test
```
*Creates an item with stock = 2 and launches 10 simultaneous purchases. Confirms exactly 2 succeed and 8 fail with 409 Conflict.*

### Run Task 01 Full Lifecycle Test:
```bash
cd task-01/backend
npm run test:lifecycle
```
*Verifies Product CRUD, Cart checkout, Payment success, Idempotent retry, and Stock restoration on cancellation.*

### Run Task 02 Concurrency Test:
```bash
cd task-02/backend
npm test
```

---

## 🌐 Live Deployment Guide (Render & Vercel)

1. **Deploy Backends on Render:**
   - Create a **Web Service** on Render pointing to your GitHub repo.
   - For Task 01: Set Root Directory to `task-01/backend`, Build Command `npm install`, Start Command `node index.js`.
   - Add Environment Variable: `MONGODB_URI = <your_atlas_connection_string>`.
   - Repeat for Task 02: Root Directory `task-02/backend`.
2. **Deploy Frontends on Vercel / Netlify:**
   - In `task-01/frontend/config.js`, set `window.API_BASE = "https://your-task-01-backend.onrender.com"`.
   - In `task-02/frontend/config.js`, set `window.API_BASE = "https://your-task-02-backend.onrender.com"`.
   - Deploy `task-01/frontend` and `task-02/frontend` to Vercel as static sites.

---

