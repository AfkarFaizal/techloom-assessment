import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function App() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [orderStatus, setOrderStatus] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const [orders, setOrders] = useState([]);
  
  // Admin form state
  const [newProduct, setNewProduct] = useState({ name: '', price: '', stock: '' });
  const [editingProduct, setEditingProduct] = useState(null);

  useEffect(() => {
    fetchProducts();
    fetchOrders();
  }, []);

  const fetchProducts = async () => {
    try {
      const res = await axios.get(`${API_URL}/products`);
      setProducts(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchOrders = async () => {
    try {
      const res = await axios.get(`${API_URL}/orders`);
      setOrders(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateOrUpdateProduct = async (e) => {
    e.preventDefault();
    try {
      if (editingProduct) {
        await axios.put(`${API_URL}/products/${editingProduct.id}`, {
          name: newProduct.name,
          price: parseFloat(newProduct.price),
          stock: parseInt(newProduct.stock, 10)
        });
        setEditingProduct(null);
      } else {
        await axios.post(`${API_URL}/products`, {
          name: newProduct.name,
          price: parseFloat(newProduct.price),
          stock: parseInt(newProduct.stock, 10)
        });
      }
      setNewProduct({ name: '', price: '', stock: '' });
      fetchProducts();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleEditClick = (p) => {
    setEditingProduct(p);
    setNewProduct({ name: p.name, price: p.price, stock: p.stock });
  };

  const handleDeleteProduct = async (id) => {
    try {
      await axios.delete(`${API_URL}/products/${id}`);
      fetchProducts();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const addToCart = (product) => {
    const existing = cart.find(item => item.productId === product.id);
    if (existing) {
      setCart(cart.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, price: product.price, quantity: 1 }]);
    }
  };

  const checkout = async () => {
    try {
      setOrderStatus('Processing...');
      const res = await axios.post(`${API_URL}/checkout`, { cart: cart.map(c => ({ productId: c.productId, quantity: c.quantity })) });
      setOrderStatus(`Reserved (Order ID: ${res.data.orderId})`);
      setOrderId(res.data.orderId);
      setCart([]);
      fetchProducts();
      fetchOrders();
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
      fetchProducts();
      fetchOrders();
    } catch (err) {
      setOrderStatus(`Payment Error: ${err.response?.data?.error || err.message}`);
      fetchProducts();
      fetchOrders();
    }
  };

  const cancelOrder = async (id) => {
    try {
      await axios.post(`${API_URL}/orders/${id}/cancel`);
      fetchOrders();
      fetchProducts();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  return (
    <div className="App">
      <h1>POS Order & Inventory System</h1>
      
      <div className="admin-section">
        <h2>{editingProduct ? 'Admin: Update Product' : 'Admin: Add Product'}</h2>
        <form onSubmit={handleCreateOrUpdateProduct}>
          <input type="text" placeholder="Name" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} required />
          <input type="number" step="0.01" placeholder="Price" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} required />
          <input type="number" placeholder="Stock" value={newProduct.stock} onChange={e => setNewProduct({...newProduct, stock: e.target.value})} required />
          <button type="submit">{editingProduct ? 'Update Product' : 'Add Product'}</button>
          {editingProduct && <button type="button" onClick={() => { setEditingProduct(null); setNewProduct({ name: '', price: '', stock: '' }); }}>Cancel</button>}
        </form>
      </div>

      <div className="products">
        <h2>Products</h2>
        {products.map(p => (
          <div key={p.id} className="product-card">
            <span>{p.name} - ${p.price} (Stock: {p.stock})</span>
            <div>
              <button onClick={() => addToCart(p)} disabled={p.stock === 0}>Add to Cart</button>
              <button onClick={() => handleEditClick(p)} style={{marginLeft: '10px'}}>Edit</button>
              <button onClick={() => handleDeleteProduct(p.id)} style={{marginLeft: '10px', background: 'red', color: 'white'}}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <div className="cart">
        <h2>Cart</h2>
        {cart.map(c => (
          <div key={c.productId}>
            {c.name} - ${c.price} x {c.quantity}
          </div>
        ))}
        {cart.length > 0 && <button onClick={checkout}>Checkout (Reserve Stock)</button>}
      </div>

      {orderStatus && (
        <div className="status">
          <h2>Order Status: {orderStatus}</h2>
          {orderId && orderStatus.includes('Reserved') && (
            <div>
              <button onClick={() => pay('success')}>Mock Payment Success</button>
              <button onClick={() => pay('failure')}>Mock Payment Failure</button>
              <button onClick={() => pay('timeout')}>Mock Payment Timeout</button>
            </div>
          )}
        </div>
      )}

      <div className="orders-section">
        <h2>Order History</h2>
        <ul>
          {orders.map(o => (
            <li key={o.id}>
              Order #{o.id} - ${o.total_amount} - Status: {o.status}
              {o.status === 'Reserved' && <button onClick={() => cancelOrder(o.id)} style={{marginLeft: '10px'}}>Cancel Order</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
