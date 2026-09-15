/**
 * Concurrency test for Task 02:
 * Verifies that concurrent checkout requests on an e-commerce item
 * never result in overselling.
 */
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4002';

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

async function runConcurrencyTest() {
  console.log('--- Starting Concurrency Test for Task 02 ---');
  try {
    const createRes = await request('POST', '/products', {
      name: 'Flash Sale Gadget',
      category: 'Electronics',
      description: 'Ultra-hot deal item',
      price: 99.0,
      stock: 2,
    });
    if (createRes.status !== 201) {
      throw new Error(`Failed to create product: ${JSON.stringify(createRes.body)}`);
    }
    const product = createRes.body;
    console.log(`Created test product ${product.id} with stock = 2`);

    console.log('Sending 10 simultaneous checkout requests...');
    const attempts = Array.from({ length: 10 }).map((_, i) =>
      request('POST', '/cart/checkout', {
        userId: `user-${i}`,
        items: [{ productId: product.id, qty: 1 }],
      })
    );

    const results = await Promise.all(attempts);
    const successes = results.filter(r => r.status === 201);
    const conflicts = results.filter(r => r.status === 409);

    console.log(`Results: ${successes.length} succeeded, ${conflicts.length} rejected (409 Conflict).`);

    const prodRes = await request('GET', `/products/${product.id}`);
    console.log(`Final product state: available=${prodRes.body.available}, reserved=${prodRes.body.reserved}, total_stock=${prodRes.body.stock}`);

    if (successes.length === 2 && conflicts.length === 8 && prodRes.body.available === 0) {
      console.log('TASK 02 TEST PASSED: No overselling occurred! Concurrency lock is 100% verified.');
      process.exit(0);
    } else {
      console.error('TASK 02 TEST FAILED: Unexpected distribution of successes/failures.');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution error:', err.message);
    process.exit(1);
  }
}

runConcurrencyTest();
