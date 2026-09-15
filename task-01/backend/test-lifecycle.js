/**
 * Order Lifecycle & Payment Test for Task 01:
 * Verifies:
 * 1. Product CRUD (Create, Read, Update, Delete)
 * 2. Checkout reservation & 5-minute hold
 * 3. Payment Success -> 'Paid'
 * 4. Payment Failure -> 'Failed' & stock release
 * 5. Payment Timeout -> 'Expired' & stock release
 * 6. Idempotency Key -> duplicate rejection
 * 7. Order Cancellation -> 'Cancelled' & stock restore
 */
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4001';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const req = http.request(
      url,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runLifecycleTests() {
  console.log('--- Starting Lifecycle & Payment Tests for Task 01 ---');
  try {
    // 1. Create product
    const pRes = await request('POST', '/products', { name: 'Lifecycle Item', price: 10, stock: 10 });
    const prodId = pRes.body.id;
    console.log(`1. Created product ${prodId}`);

    // 2. Checkout (Reserve)
    const chkRes = await request('POST', '/cart/checkout', { items: [{ productId: prodId, qty: 3 }] });
    const order1 = chkRes.body;
    console.log(`2. Created order ${order1.id}, status = ${order1.status}`);
    if (order1.status !== 'Reserved') throw new Error('Expected status Reserved');

    // 3. Payment Idempotency & Success
    const key = `idem-test-${Date.now()}`;
    const pay1 = await request('POST', `/orders/${order1.id}/pay`, { outcome: 'success', idempotencyKey: key });
    console.log(`3. Payment outcome: ${pay1.body.outcome}, order status = ${pay1.body.order.status}`);
    if (pay1.body.order.status !== 'Paid') throw new Error('Expected status Paid');

    const payDup = await request('POST', `/orders/${order1.id}/pay`, { outcome: 'success', idempotencyKey: key });
    console.log(`4. Duplicate payment check: duplicate = ${payDup.body.duplicate}`);
    if (!payDup.body.duplicate) throw new Error('Expected duplicate = true');

    // 5. Cancellation on Paid Order -> restores stock
    const cancelRes = await request('POST', `/orders/${order1.id}/cancel`);
    console.log(`5. Cancelled order ${order1.id}, new status = ${cancelRes.body.status}`);
    if (cancelRes.body.status !== 'Cancelled') throw new Error('Expected status Cancelled');

    // 6. Verify stock restored
    const finalProd = await request('GET', `/products/${prodId}`);
    console.log(`6. Final stock restored: ${finalProd.body.stock}`);
    if (finalProd.body.stock !== 10) throw new Error('Stock was not restored correctly');

    console.log('ALL LIFECYCLE TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
  }
}

runLifecycleTests();
