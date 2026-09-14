# Techloom.ai Assessment

This repository contains both Task 01 and Task 02 for the Techloom.ai assessment.

## Projects Overview

*   **Task 01**: POS (Point of Sale) Order & Inventory System
*   **Task 02**: E-Commerce Checkout & Payment System

## Tech Stack
*   **Backend**: Node.js, Express, PostgreSQL (Neon.tech)
*   **Frontend**: React (Vite)
*   **Deployment**: Render (Backend) & Vercel (Frontend)

---

## 🚀 Live URLs

*(Add your live URLs here after deploying)*
*   **Task 01 Backend**: `https://<your-task-1-backend>.onrender.com`
*   **Task 01 Frontend**: `https://<your-task-1-frontend>.vercel.app`
*   **Task 02 Backend**: `https://<your-task-2-backend>.onrender.com`
*   **Task 02 Frontend**: `https://<your-task-2-frontend>.vercel.app`

---

## 🛠 Setup & Run Locally

### 1. Database Setup (Neon)
1. Go to [neon.tech](https://neon.tech/) and create a free PostgreSQL database.
2. Copy your connection string (e.g., `postgresql://user:password@host/dbname?sslmode=require`).
3. Open Neon's SQL Editor and run the SQL schema found in `task-01/backend/init.sql`. (This single database will work for both tasks, or you can create a second database for Task 02).

### 2. Run Backend (Task 01 & Task 02)
1. Open a terminal and navigate to the backend folder:
   ```bash
   cd task-01/backend
   ```
2. Create a `.env` file in `task-01/backend` and add your database URL:
   ```
   DATABASE_URL=postgresql://<your_username>:<your_password>@<your_host>/<your_database>?sslmode=require
   ```
3. Run the server:
   ```bash
   node server.js
   ```
*(Repeat the same steps for `task-02/backend`, but notice that Task 02 uses Port 5001 by default to avoid conflicts).*

### 3. Run Frontend (Task 01 & Task 02)
1. Open a new terminal and navigate to the frontend folder:
   ```bash
   cd task-01/frontend
   ```
2. Create a `.env` file in `task-01/frontend` and link it to the backend:
   ```
   VITE_API_URL=http://localhost:5000
   ```
3. Start the Vite app:
   ```bash
   npm run dev
   ```
*(Repeat the same for `task-02/frontend`, setting `VITE_API_URL=http://localhost:5001`)*

---

## ☁️ Deployment Guide

### Deploying the Backend (Render)
1. Push this repository to your GitHub account.
2. Go to [Render](https://render.com/) and create a new **Web Service**.
3. Connect your GitHub repository.
4. **For Task 01 Backend:**
   - Root Directory: `task-01/backend`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Environment Variable: Add `DATABASE_URL` and paste your Neon database string.
5. **For Task 02 Backend:**
   - Repeat steps above, but set Root Directory to `task-02/backend`.
6. Once deployed, copy the Render URLs.

### Deploying the Frontend (Vercel)
1. Go to [Vercel](https://vercel.com/) and create a new project.
2. Connect your GitHub repository.
3. **For Task 01 Frontend:**
   - Root Directory: `task-01/frontend`
   - Framework Preset: `Vite`
   - Build Command: `npm run build`
   - Environment Variable: Add `VITE_API_URL` and set it to your deployed Task 01 Render URL.
4. **For Task 02 Frontend:**
   - Repeat steps above, but set Root Directory to `task-02/frontend`.
   - Set `VITE_API_URL` to your deployed Task 02 Render URL.

---

## 🧪 Testing Features

### Task 01
*   **Concurrency Safe & 5-min Lock**: Checkout multiple items at once to see the stock correctly deduct. The `SELECT ... FOR UPDATE` prevents overselling. Leave an order in "Reserved" state, and a background job will automatically release the stock after 5 minutes.
*   **Mock Payment**: Test successful, failed, and timed-out payments.
*   **Idempotency**: Duplicate payment attempts using the same order ID will simply return the original payment status without double-charging.

### Task 02
*   **Search**: Use the search bar to filter products by name.
*   **Refund & Cancel**: Go to the "Orders" tab. You can Cancel a "Reserved" order or Refund a "Paid" order. Stock will be restored appropriately.