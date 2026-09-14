import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

function ProductList({ addToCart }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchProducts();
  }, [search]);

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${API_URL}/products?search=${search}`);
      setProducts(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <h2>Products</h2>
      <input 
        type="text" 
        placeholder="Search products..." 
        value={search} 
        onChange={(e) => setSearch(e.target.value)} 
      />
      <div className="products">
        {products.map(p => (
          <div key={p.id} className="product-card">
            <Link to={`/product/${p.id}`}><h3>{p.name}</h3></Link>
            <span>${p.price} (Stock: {p.stock})</span>
            <button onClick={() => addToCart(p)} disabled={p.stock === 0}>Add to Cart</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductDetails({ addToCart }) {
  const { id } = useParams();
  const [product, setProduct] = useState(null);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const res = await axios.get(`${API_URL}/products/${id}`);
        setProduct(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchProduct();
  }, [id]);

  if (!product) return <div>Loading...</div>;

  return (
    <div>
      <h2>{product.name}</h2>
      <p>Price: ${product.price}</p>
      <p>Stock: {product.stock}</p>
      <button onClick={() => addToCart(product)} disabled={product.stock === 0}>Add to Cart</button>
    </div>
  );
}

function Checkout({ cart, clearCart }) {
  const [orderStatus, setOrderStatus] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const navigate = useNavigate();

  const handleCheckout = async () => {
    try {
      setOrderStatus('Processing...');
      const res = await axios.post(`${API_URL}/checkout`, { cart: cart.map(c => ({ productId: c.productId, quantity: c.quantity })) });
      setOrderStatus(`Reserved (Order ID: ${res.data.orderId})`);
      setOrderId(res.data.orderId);
      clearCart();
    } catch (err) {
      setOrderStatus(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const pay = async (outcome) => {
    if (!orderId) return;
    const idempotencyKey = `pay-${orderId}-${Date.now()}`;
    try {
      setOrderStatus('Processing Payment...');
      const res = await axios.post(`${API_URL}/payment`, { orderId, idempotencyKey, outcome });
      setOrderStatus(`Payment ${res.data.payment.status}`);
      setTimeout(() => navigate('/orders'), 2000);
    } catch (err) {
      setOrderStatus(`Payment Error: ${err.response?.data?.error || err.message}`);
    }
  };

  return (
    <div>
      <h2>Checkout</h2>
      <div className="cart">
        {cart.map(c => (
          <div key={c.productId}>{c.name} - ${c.price} x {c.quantity}</div>
        ))}
      </div>
      {cart.length > 0 && <button onClick={handleCheckout}>Reserve Stock & Checkout</button>}
      
      {orderStatus && (
        <div className="status">
          <h3>Status: {orderStatus}</h3>
          {orderId && orderStatus.includes('Reserved') && (
            <div>
              <button onClick={() => pay('success')}>Mock Payment Success</button>
              <button onClick={() => pay('failure')}>Mock Payment Failure</button>
              <button onClick={() => pay('timeout')}>Mock Payment Timeout</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Orders() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const res = await axios.get(`${API_URL}/orders`);
      setOrders(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const cancelOrder = async (id) => {
    try {
      await axios.post(`${API_URL}/orders/${id}/cancel`);
      fetchOrders();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const refundOrder = async (id) => {
    try {
      await axios.post(`${API_URL}/orders/${id}/refund`);
      fetchOrders();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  return (
    <div>
      <h2>Order History</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>${o.total_amount}</td>
              <td>{o.status}</td>
              <td>
                {o.status === 'Reserved' && <button onClick={() => cancelOrder(o.id)}>Cancel</button>}
                {o.status === 'Paid' && <button onClick={() => refundOrder(o.id)}>Refund</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [cart, setCart] = useState([]);

  const addToCart = (product) => {
    const existing = cart.find(item => item.productId === product.id);
    if (existing) {
      setCart(cart.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, price: product.price, quantity: 1 }]);
    }
    alert('Added to cart!');
  };

  const clearCart = () => setCart([]);

  return (
    <Router>
      <div className="App">
        <nav>
          <Link to="/">Products</Link> | 
          <Link to="/checkout"> Checkout ({cart.reduce((a, c) => a + c.quantity, 0)})</Link> | 
          <Link to="/orders"> Orders</Link>
        </nav>
        
        <Routes>
          <Route path="/" element={<ProductList addToCart={addToCart} />} />
          <Route path="/product/:id" element={<ProductDetails addToCart={addToCart} />} />
          <Route path="/checkout" element={<Checkout cart={cart} clearCart={clearCart} />} />
          <Route path="/orders" element={<Orders />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
