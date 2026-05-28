import React, { useState, useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

const NEIGHBORHOODS = [
  'Bahçelievler Mahallesi',
  'Cumhuriyet Mahallesi',
  'Çobançeşme Mahallesi',
  'Fevzi Çakmak Mahallesi',
  'Hürriyet Mahallesi',
  'Kocasinan Merkez Mahallesi',
  'Siyavuşpaşa Mahallesi',
  'Soğanlı Mahallesi',
  'Şirinevler Mahallesi',
  'Yenibosna Merkez Mahallesi',
  'Zafer Mahallesi'
];

// Sıfır Maliyetli Harita Entegrasyonu İçin Koordinatlar (Bahçelievler Mahalle Merkezleri)
const NEIGHBORHOOD_COORDS = {
  'Bahçelievler Mahallesi': [41.0022, 28.8617],
  'Cumhuriyet Mahallesi': [41.0125, 28.8475],
  'Çobançeşme Mahallesi': [40.9930, 28.8250],
  'Fevzi Çakmak Mahallesi': [40.9985, 28.8350],
  'Hürriyet Mahallesi': [41.0050, 28.8315],
  'Kocasinan Merkez Mahallesi': [41.0180, 28.8360],
  'Siyavuşpaşa Mahallesi': [41.0010, 28.8480],
  'Soğanlı Mahallesi': [41.0110, 28.8550],
  'Şirinevler Mahallesi': [40.9960, 28.8430],
  'Yenibosna Merkez Mahallesi': [41.0080, 28.8150],
  'Zafer Mahallesi': [41.0020, 28.8230]
};

export default function App() {
  // Navigation & Mode
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminTab, setAdminTab] = useState('logistics'); // logistics, archive, products, add_product
  const [adminToken, setAdminToken] = useState(localStorage.getItem('admin_token') || '');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Core Data
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  
  // Shop State
  const [cart, setCart] = useState([]);
  const [countdownText, setCountdownText] = useState('');
  const [isPast17, setIsPast17] = useState(false);

  // Modals
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyPhone, setHistoryPhone] = useState('');
  const [customerOrders, setCustomerOrders] = useState([]);
  const [orderSuccessDetails, setOrderSuccessDetails] = useState(null);
  const [activeProductDetail, setActiveProductDetail] = useState(null);

  // Checkout Form State
  const [checkoutForm, setCheckoutForm] = useState({
    customer_name: '',
    customer_phone: '',
    neighborhood: NEIGHBORHOODS[0],
    full_address: '',
    payment_method: 'Nakit'
  });

  // Admin Logistics & Products State
  const [logisticOrders, setLogisticOrders] = useState([]);
  const [adminProducts, setAdminProducts] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [csvUploadStatus, setCsvUploadStatus] = useState(null);

  // Akıllı Dağıtım Rota Sırası (Sequence)
  const [routeSequence, setRouteSequence] = useState(NEIGHBORHOODS);

  // Sipariş Arşivi State
  const [archiveOrders, setArchiveOrders] = useState([]);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveNeighFilter, setArchiveNeighFilter] = useState('');

  // Akıllı Barkod & Kamera Giriş State
  const [scannerActive, setScannerActive] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [scannedProductExists, setScannedProductExists] = useState(false);
  const [scannedForm, setScannedForm] = useState({
    id: null,
    barcode: '',
    title: '',
    description: '',
    price: '',
    stock_quantity: 10,
    category_id: '',
    image_url: '',
    is_active: false
  });
  const [capturedImageFile, setCapturedImageFile] = useState(null);
  const [capturedImagePreview, setCapturedImagePreview] = useState(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');

  // Search & Cart Animations State
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [adminSearchTerm, setAdminSearchTerm] = useState('');
  const [cartPulseClass, setCartPulseClass] = useState('');
  const [analyticsPeriod, setAnalyticsPeriod] = useState('overall'); // today, week, month, overall

  // Refs for scanner & map & file upload
  const scannerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const fileInputRef = useRef(null);

  // --- COÖRDINATE NAVIGATION & ROUTING CALCULATIONS (TSP) ---
  
  // Haversine Formülü: Kuş uçuşu coğrafi mesafe (km)
  const getHaversineDistance = (coords1, coords2) => {
    const [lat1, lon1] = coords1;
    const [lat2, lon2] = coords2;
    const R = 6371; // Dünya yarıçapı
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // En Yakın Komşu (Nearest Neighbor) Traveling Salesperson (TSP) Rota Çözücü
  const calculateOptimalRoute = (activeNeighs) => {
    if (activeNeighs.length === 0) return [];
    
    // Aktürk Kırtasiye Koordinatları
    const storeCoords = [41.0175, 28.8370];
    const unvisited = [...activeNeighs];
    const route = [];
    let currentCoords = storeCoords;

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const neighCoords = NEIGHBORHOOD_COORDS[unvisited[i]];
        if (neighCoords) {
          const dist = getHaversineDistance(currentCoords, neighCoords);
          if (dist < minDistance) {
            minDistance = dist;
            nearestIdx = i;
          }
        }
      }

      const nextNeigh = unvisited.splice(nearestIdx, 1)[0];
      route.push(nextNeigh);
      currentCoords = NEIGHBORHOOD_COORDS[nextNeigh];
    }

    return route;
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('admin_token', data.token);
        setAdminToken(data.token);
        setLoginPassword('');
      } else {
        setLoginError(data.error || 'Şifre yanlış!');
      }
    } catch (err) {
      setLoginError('Ağ hatası, giriş yapılamadı.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    setAdminToken('');
  };

  // --- INITIAL EFFECT & TIMERS ---
  useEffect(() => {
    fetchCategories();
    fetchActiveProducts();
    loadCustomerDataFromStorage();

    // 17:00 Sipariş zaman sınırı geri sayıcı
    const timer = setInterval(updateDeliveryCountdown, 1000);
    updateDeliveryCountdown();

    return () => clearInterval(timer);
  }, []);

  // Mode change or tab change effect
  useEffect(() => {
    if (isAdminMode && adminToken) {
      fetchAdminData();
    } else if (!isAdminMode) {
      fetchActiveProducts();
    }
  }, [isAdminMode, adminTab, adminToken]);

  // --- LEAFLET OPENSTREETMAP RENDER EFFECT ---
  useEffect(() => {
    if (isAdminMode && adminToken && adminTab === 'logistics' && window.L && logisticOrders.length > 0) {
      // Initialize map container if it doesn't exist
      const mapEl = document.getElementById('delivery-map');
      if (mapEl) {
        if (!mapInstanceRef.current) {
          const map = window.L.map('delivery-map').setView([41.0175, 28.8370], 13);
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
          }).addTo(map);
          mapInstanceRef.current = map;
          markersLayerRef.current = window.L.layerGroup().addTo(map);
        } else {
          markersLayerRef.current.clearLayers();
        }

        // Plot Aktürk Kırtasiye (Depot/Store Anchor)
        const storeIcon = window.L.divIcon({
          html: `<span style="background-color: #2ed573; color: white; border: 2px solid white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.1rem; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">🏠</span>`,
          className: 'custom-map-icon store-icon',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });
        window.L.marker([41.0175, 28.8370], { icon: storeIcon })
          .bindPopup(`
            <div style="font-family: 'Inter', sans-serif; font-size: 0.8rem; text-align: center;">
              <strong style="font-size: 0.9rem; color: #2ed573;">Aktürk Kırtasiye</strong><br/>
              <b>📍 Merkez Mağaza (Başlangıç Noktası)</b><br/>
              Kocasinan Merkez, Mahmutbey Cd. No:261/B
            </div>
          `)
          .addTo(markersLayerRef.current);

        // Plot current delivery markers
        const activeNeighs = Object.keys(neighborhoodGroups);
        activeNeighs.forEach(neigh => {
          const coords = NEIGHBORHOOD_COORDS[neigh];
          if (coords) {
            const count = neighborhoodGroups[neigh].length;
            const cashCount = neighborhoodGroups[neigh].filter(o => o.payment_method === 'Nakit').length;
            const posCount = neighborhoodGroups[neigh].filter(o => o.payment_method === 'POS').length;
            const totalVal = neighborhoodGroups[neigh].reduce((sum, o) => sum + parseFloat(o.total_amount), 0);

            // Custom colored icon depending on volume
            const color = count > 3 ? '#d63031' : '#6c5ce7';
            const htmlIcon = window.L.divIcon({
              html: `<span style="background-color: ${color}; color: white; border: 2px solid white; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${count}</span>`,
              className: 'custom-map-icon',
              iconSize: [26, 26],
              iconAnchor: [13, 13]
            });

            window.L.marker(coords, { icon: htmlIcon })
              .bindPopup(`
                <div style="font-family: 'Inter', sans-serif; font-size: 0.8rem;">
                  <strong style="font-size: 0.9rem; color: #6c5ce7;">${neigh}</strong><br/>
                  <b>📦 Toplam Sipariş:</b> ${count} Adet<br/>
                  <b>💵 Nakit:</b> ${cashCount} | <b>💳 POS:</b> ${posCount}<br/>
                  <b>💰 Toplam Tutar:</b> ${totalVal.toFixed(2)} TL
                </div>
              `)
              .addTo(markersLayerRef.current);
          }
        });

        // Draw routing polyline starting from Aktürk Kırtasiye through active neighborhoods in optimal order
        const routePoints = [[41.0175, 28.8370]]; // Depot
        sortedActiveNeighborhoods.forEach(neigh => {
          const coords = NEIGHBORHOOD_COORDS[neigh];
          if (coords) {
            routePoints.push(coords);
          }
        });

        if (routePoints.length > 1) {
          const polyline = window.L.polyline(routePoints, {
            color: '#6c5ce7',
            weight: 4,
            opacity: 0.8,
            dashArray: '8, 8', // elegant dashed routing line
            lineJoin: 'round'
          }).addTo(markersLayerRef.current);

          // Fit map bounds to show the entire route beautifully
          mapInstanceRef.current.fitBounds(polyline.getBounds(), { padding: [30, 30] });
        }
      }
    }
  }, [isAdminMode, adminToken, adminTab, logisticOrders]);

  // Fetch functions
  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      setCategories(data);
      if (data.length > 0 && !scannedForm.category_id) {
        setScannedForm(prev => ({ ...prev, category_id: data[0].id }));
      }
    } catch (err) {
      console.error('Kategoriler çekilemedi:', err);
    }
  };

  const fetchActiveProducts = async (catId = selectedCategoryId) => {
    try {
      let url = '/api/products';
      if (catId) url += `?category_id=${catId}`;
      const res = await fetch(url);
      const data = await res.json();
      setProducts(data);
    } catch (err) {
      console.error('Aktif ürünler çekilemedi:', err);
    }
  };

  const fetchAdminData = () => {
    if (!adminToken) return;
    if (adminTab === 'logistics') {
      fetchLogisticOrders();
    } else if (adminTab === 'products') {
      fetchAdminProducts();
    } else if (adminTab === 'archive') {
      fetchArchiveOrders();
    } else if (adminTab === 'analytics') {
      fetchLogisticOrders();
      fetchArchiveOrders();
    }
  };

  const fetchAdminProducts = async () => {
    try {
      const res = await fetch('/api/products/admin', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setAdminProducts(data);
    } catch (err) {
      console.error('Yönetici ürün listesi çekilemedi:', err);
    }
  };

  const fetchLogisticOrders = async () => {
    try {
      const res = await fetch('/api/orders/logistics', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setLogisticOrders(data);

      // Auto-calculate optimal route using Traveling Salesperson (TSP)
      const activeNeighs = [...new Set(data.map(o => o.neighborhood))];
      const optimalRoute = calculateOptimalRoute(activeNeighs);
      const otherNeighs = NEIGHBORHOODS.filter(n => !optimalRoute.includes(n));
      setRouteSequence([...optimalRoute, ...otherNeighs]);
    } catch (err) {
      console.error('Lojistik siparişler çekilemedi:', err);
    }
  };

  const fetchArchiveOrders = async () => {
    try {
      const res = await fetch('/api/orders/archive', {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setArchiveOrders(data);
    } catch (err) {
      console.error('Arşiv siparişler çekilemedi:', err);
    }
  };

  const loadCustomerDataFromStorage = () => {
    const name = localStorage.getItem('customer_name') || '';
    const phone = localStorage.getItem('customer_phone') || '';
    const neighborhood = localStorage.getItem('customer_neighborhood') || NEIGHBORHOODS[0];
    const address = localStorage.getItem('customer_address') || '';
    
    setCheckoutForm({
      customer_name: name,
      customer_phone: phone,
      neighborhood: neighborhood,
      full_address: address,
      payment_method: 'Nakit'
    });

    if (phone) {
      setHistoryPhone(phone);
    }
  };

  const updateDeliveryCountdown = () => {
    const now = new Date();
    const deadline = new Date();
    deadline.setHours(17, 0, 0, 0); // 17:00

    if (now < deadline) {
      setIsPast17(false);
      const diffMs = deadline - now;
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diffMs % (1000 * 60)) / 1000);
      
      const format = (num) => String(num).padStart(2, '0');
      setCountdownText(`Bugün 19:00-22:00 arası teslimat için son kalan süre: ${format(hours)}:${format(mins)}:${format(secs)}`);
    } else {
      setIsPast17(true);
      setCountdownText('Saat 17:00 teslimat sınırı geçildi. Vereceğiniz siparişler yarın akşam teslim edilecektir.');
    }
  };

  // --- CLIENT CART LOGIC ---
  const triggerCartPulse = () => {
    setCartPulseClass('cart-pulse');
    setTimeout(() => {
      setCartPulseClass('');
    }, 300);
  };

  const handleAddToCart = (product) => {
    const maxStock = product.stock_quantity !== undefined && product.stock_quantity !== null 
      ? parseInt(product.stock_quantity) 
      : 999;

    setCart(prevCart => {
      const existing = prevCart.find(item => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= maxStock) {
          alert(`Üzgünüz, bu üründen stokta en fazla ${maxStock} adet bulunmaktadır.`);
          return prevCart;
        }
        triggerCartPulse();
        return prevCart.map(item => 
          item.product.id === product.id 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        if (maxStock <= 0) {
          alert("Üzgünüz, bu ürün tükenmiştir.");
          return prevCart;
        }
        triggerCartPulse();
        return [...prevCart, { product, quantity: 1 }];
      }
    });
  };

  const handleRemoveFromCart = (productId) => {
    setCart(prevCart => {
      const existing = prevCart.find(item => item.product.id === productId);
      if (!existing) return prevCart;
      triggerCartPulse();
      if (existing.quantity === 1) {
        return prevCart.filter(item => item.product.id !== productId);
      } else {
        return prevCart.map(item =>
          item.product.id === productId
            ? { ...item, quantity: item.quantity - 1 }
            : item
        );
      }
    });
  };

  const handleDeleteFromCart = (productId) => {
    if (window.confirm('Bu ürünü sepetten kaldırmak istiyor musunuz?')) {
      setCart(prevCart => prevCart.filter(item => item.product.id !== productId));
      triggerCartPulse();
    }
  };

  const getCartTotal = () => {
    return cart.reduce((total, item) => total + (item.product.price * item.quantity), 0);
  };

  const getCartItemCount = () => {
    return cart.reduce((count, item) => count + item.quantity, 0);
  };

  const handleCategorySelect = (categoryId) => {
    setSelectedCategoryId(categoryId);
    fetchActiveProducts(categoryId);
  };

  // --- ORDER SUBMIT LOGIC ---
  const handleCheckoutSubmit = async (e) => {
    e.preventDefault();
    if (cart.length === 0) return;

    const orderPayload = {
      customer_name: checkoutForm.customer_name,
      customer_phone: checkoutForm.customer_phone,
      neighborhood: checkoutForm.neighborhood,
      full_address: checkoutForm.full_address,
      payment_method: checkoutForm.payment_method,
      total_amount: getCartTotal(),
      items: cart.map(item => ({
        product_id: item.product.id,
        quantity: item.quantity,
        price: item.product.price
      }))
    };

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      });
      const data = await res.json();
      
      if (res.ok) {
        // LocalStorage'a kaydet
        localStorage.setItem('customer_name', checkoutForm.customer_name);
        localStorage.setItem('customer_phone', checkoutForm.customer_phone);
        localStorage.setItem('customer_neighborhood', checkoutForm.neighborhood);
        localStorage.setItem('customer_address', checkoutForm.full_address);

        setOrderSuccessDetails(data);
        setCart([]);
        setShowCartSheet(false);
      } else {
        alert(data.error || 'Sipariş gönderilirken hata oluştu.');
      }
    } catch (err) {
      alert('Ağ hatası sipariş oluşturulamadı.');
    }
  };

  // --- CUSTOMER HISTORY LOGIC ---
  const handleFetchHistory = async (e) => {
    e.preventDefault();
    if (!historyPhone) return;

    try {
      const res = await fetch(`/api/orders/history/${historyPhone.trim()}`);
      const data = await res.json();
      setCustomerOrders(data);
      localStorage.setItem('customer_phone', historyPhone.trim());
    } catch (err) {
      console.error('Sipariş geçmişi çekilemedi:', err);
    }
  };

  const handleCancelCustomerOrder = async (orderId) => {
    if (!window.confirm('Bu siparişi iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) return;
    
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel-customer`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Siparişiniz başarıyla iptal edildi.');
        // Refresh customer history
        if (historyPhone) {
          const freshRes = await fetch(`/api/orders/history/${historyPhone.trim()}`);
          const freshData = await freshRes.json();
          setCustomerOrders(freshData);
        }
      } else {
        alert(data.error || 'Sipariş iptal edilemedi.');
      }
    } catch (err) {
      alert('Sipariş iptal edilirken ağ hatası oluştu.');
    }
  };

  // --- ADMIN LOGISTICS LOGIC ---
  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      if (res.ok) {
        fetchLogisticOrders();
        fetchArchiveOrders();
      }
    } catch (err) {
      console.error('Sipariş durum güncelleme hatası:', err);
    }
  };

  // Move neighborhood in sequence list (routing customization)
  const moveNeighborhoodSequence = (index, direction) => {
    const newSeq = [...routeSequence];
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= newSeq.length) return;
    
    // Swap
    const temp = newSeq[index];
    newSeq[index] = newSeq[targetIdx];
    newSeq[targetIdx] = temp;
    
    setRouteSequence(newSeq);
  };

  // --- CSV IMPORT LOGIC ---
  const handleCsvImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('csvFile', file);

    setCsvUploadStatus({ loading: true });

    try {
      const res = await fetch('/api/products/import-csv', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: formData
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setCsvUploadStatus({ 
          success: true, 
          msg: `Aktarım başarılı! ${data.summary.inserted} ürün eklendi, ${data.summary.updated} ürün güncellendi.` 
        });
        fetchAdminProducts();
      } else {
        setCsvUploadStatus({ success: false, msg: data.error || 'Dosya işlenirken hata oluştu.' });
      }
    } catch (err) {
      setCsvUploadStatus({ success: false, msg: 'Ağ hatası içe aktarılamadı.' });
    }
  };

  // --- BARCODE SCANNING & INSTANT CAMERA LOGIC ---
  const startBarcodeScanner = () => {
    setScannerActive(true);
    setSaveSuccessMsg('');
    
    // Tiny delay to ensure DOM element is mounted
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner("reader", { 
        fps: 10, 
        qrbox: { width: 250, height: 150 },
        rememberLastUsedCamera: true
      }, false);

      scanner.render(onScanSuccess, onScanFailure);
      scannerRef.current = scanner;
    }, 100);
  };

  const stopBarcodeScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.clear().catch(err => console.error("Scanner clear error", err));
      scannerRef.current = null;
    }
    setScannerActive(false);
  };

  const onScanSuccess = async (decodedText) => {
    stopBarcodeScanner();
    handleBarcodeSearch(decodedText);
  };

  const onScanFailure = (error) => {
    // Silent fail as this runs continuously while scanning
  };

  const handleBarcodeSearch = async (barcode) => {
    setScannedBarcode(barcode);
    setCapturedImageFile(null);
    setCapturedImagePreview(null);
    setSaveSuccessMsg('');

    try {
      const res = await fetch(`/api/products/barcode/${barcode}`);
      const data = await res.json();

      if (res.ok) {
        // Ürün veritabanında var! (Trendpos listesinden gelmiş)
        setScannedProductExists(true);
        setScannedForm({
          id: data.id,
          barcode: data.barcode,
          title: data.title,
          description: data.description || '',
          price: data.price,
          stock_quantity: data.stock_quantity || 10,
          category_id: data.category_id || (categories.length > 0 ? categories[0].id : ''),
          image_url: data.image_url || '',
          is_active: data.is_active === 1 || data.is_active === true
        });
      } else {
        // Ürün veritabanında yok! Sıfırdan giriş formu açalım
        setScannedProductExists(false);
        setScannedForm({
          id: null,
          barcode: barcode,
          title: '',
          description: '',
          price: '',
          stock_quantity: 10,
          category_id: categories.length > 0 ? categories[0].id : '',
          image_url: '',
          is_active: true // Yeni ürünler varsayılan olarak aktif olsun
        });
      }
    } catch (err) {
      console.error('Barkod arama hatası:', err);
    }
  };

  const handleCameraCaptureChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setCapturedImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setCapturedImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    
    let currentImageUrl = scannedForm.image_url;

    // Eğer yeni bir görsel çekildiyse, önce onu yükleyelim (Sharp ile sıkıştırılacak)
    if (capturedImageFile) {
      const imgFormData = new FormData();
      imgFormData.append('image', capturedImageFile);
      
      try {
        const imgRes = await fetch('/api/products/upload-image', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${adminToken}` },
          body: imgFormData
        });
        if (imgRes.status === 401 || imgRes.status === 403) {
          handleLogout();
          return;
        }
        const imgData = await imgRes.json();
        if (imgRes.ok) {
          currentImageUrl = imgData.image_url;
        } else {
          alert('Fotoğraf yükleme/sıkıştırma hatası.');
          return;
        }
      } catch (err) {
        alert('Fotoğraf yüklenirken ağ hatası.');
        return;
      }
    }

    // Ürün Ekle veya Güncelle payload
    const payload = {
      ...scannedForm,
      price: parseFloat(scannedForm.price),
      stock_quantity: parseInt(scannedForm.stock_quantity),
      image_url: currentImageUrl,
      is_active: scannedForm.is_active
    };

    try {
      let url = '/api/products';
      let method = 'POST';

      if (scannedProductExists && scannedForm.id) {
        url = `/api/products/${scannedForm.id}`;
        method = 'PUT';
      }

      const res = await fetch(url, {
        method: method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(payload)
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }

      if (res.ok) {
        alert(scannedProductExists ? '✓ Ürün başarıyla güncellendi!' : '✓ Yeni ürün başarıyla eklendi!');
        setSaveSuccessMsg(scannedProductExists ? 'Ürün fotoğrafı ve bilgileri başarıyla güncellendi!' : 'Yeni ürün başarıyla eklendi ve yayına alındı!');
        
        // Reset form
        setScannedBarcode('');
        setCapturedImageFile(null);
        setCapturedImagePreview(null);
        setScannedForm({
          id: null,
          barcode: '',
          title: '',
          description: '',
          price: '',
          stock_quantity: 10,
          category_id: categories.length > 0 ? categories[0].id : '',
          image_url: '',
          is_active: false
        });
        fetchAdminProducts();
        setAdminTab('products');
      } else {
        const data = await res.json();
        alert(data.error || 'Ürün kaydedilemedi.');
      }
    } catch (err) {
      alert('Ağ hatası ürün kaydedilemedi.');
    }
  };

  const handleEditProductClick = (product) => {
    setScannedProductExists(true);
    setScannedBarcode(product.barcode);
    setCapturedImageFile(null);
    setCapturedImagePreview(null);
    setSaveSuccessMsg('');
    setScannedForm({
      id: product.id,
      barcode: product.barcode,
      title: product.title,
      description: product.description || '',
      price: product.price,
      stock_quantity: product.stock_quantity || 10,
      category_id: product.category_id || (categories.length > 0 ? categories[0].id : ''),
      image_url: product.image_url || '',
      is_active: product.is_active === 1 || product.is_active === true
    });
    setAdminTab('add_product');
  };

  const handleToggleProductActive = async (product) => {
    try {
      const res = await fetch(`/api/products/${product.id}/toggle-active`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      if (res.ok) {
        fetchAdminProducts();
        if (!isAdminMode) fetchActiveProducts();
      }
    } catch (err) {
      console.error('Ürün durumu değiştirilemedi:', err);
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (!window.confirm('Bu ürünü silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) return;
    
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      if (res.ok) {
        fetchAdminProducts();
        if (!isAdminMode) fetchActiveProducts();
      } else {
        const data = await res.json();
        alert(data.error || 'Ürün silinemedi.');
      }
    } catch (err) {
      alert('Ağ hatası ürün silinemedi.');
    }
  };

  // Group logistics orders by neighborhood
  const getOrdersByNeighborhood = () => {
    const groups = {};
    NEIGHBORHOODS.forEach(n => {
      groups[n] = [];
    });
    
    logisticOrders.forEach(order => {
      if (groups[order.neighborhood]) {
        groups[order.neighborhood].push(order);
      } else {
        groups[order.neighborhood] = [order];
      }
    });

    return Object.keys(groups).reduce((acc, key) => {
      if (groups[key].length > 0) acc[key] = groups[key];
      return acc;
    }, {});
  };

  const neighborhoodGroups = getOrdersByNeighborhood();
  const totalLogisticEarnings = logisticOrders.reduce((sum, o) => o.order_status === 'Teslim Edildi' ? sum : sum + o.total_amount, 0);

  // Get active neighborhoods having active orders
  const activeNeighborhoods = Object.keys(neighborhoodGroups);

  // Sort active neighborhoods based on custom sequence
  const sortedActiveNeighborhoods = [...activeNeighborhoods].sort((a, b) => {
    return routeSequence.indexOf(a) - routeSequence.indexOf(b);
  });

  // Filter archive orders
  const filteredArchiveOrders = archiveOrders.filter(order => {
    const matchesSearch = order.customer_name.toLowerCase().includes(archiveSearch.toLowerCase()) || 
                          order.customer_phone.includes(archiveSearch) ||
                          order.id.toString() === archiveSearch;
    const matchesNeigh = archiveNeighFilter ? order.neighborhood === archiveNeighFilter : true;
    return matchesSearch && matchesNeigh;
  });

  // Filter client products (storefront)
  const filteredClientProducts = products.filter(prod => {
    const term = clientSearchTerm.trim().toLowerCase();
    if (!term) return true;
    return prod.title.toLowerCase().includes(term) || 
           prod.barcode.toLowerCase().includes(term) || 
           (prod.description || '').toLowerCase().includes(term);
  });

  // Filter admin products (inventory list)
  const filteredAdminProducts = adminProducts.filter(prod => {
    const term = adminSearchTerm.trim().toLowerCase();
    if (!term) return true;
    return prod.title.toLowerCase().includes(term) || 
           prod.barcode.toLowerCase().includes(term) || 
           (prod.category_name || '').toLowerCase().includes(term);
  });

  const totalArchiveRevenue = archiveOrders.reduce((sum, o) => o.order_status === 'Teslim Edildi' ? sum + parseFloat(o.total_amount) : sum, 0);

  return (
    <div>
      {/* HEADER SECTION */}
      <header>
        <div className="header-container">
          <div className="header-title-section">
            <h1 onClick={() => setIsAdminMode(false)} style={{ cursor: 'pointer' }}>🚀 AKTÜRK KIRTASİYE</h1>
            <div className="header-location">
              <span>📍 Bahçelievler, İstanbul</span>
            </div>
          </div>
          <button 
            className="admin-toggle-btn" 
            onClick={() => setIsAdminMode(!isAdminMode)}
          >
            {isAdminMode ? '🛒 Alışverişe Dön' : '⚙️ Yönetici Paneli'}
          </button>
        </div>
      </header>

      {/* TIME BOUNDARY NOTICE */}
      {!isAdminMode && (
        <div className="time-banner">
          {countdownText}
        </div>
      )}

      {/* ============================================================== */}
      {/* ======================= MÜŞTERİ PANELİ ======================= */}
      {/* ============================================================== */}
      {!isAdminMode && (
        <div>
          {/* CLIENT SEARCH BAR (Moved to the very top, highly prominent, styled for maximum visibility) */}
          <div style={{ padding: '16px 16px 8px 16px', maxWidth: '600px', margin: '0 auto' }}>
            <div className="client-search-box" style={{ 
              position: 'relative', 
              background: '#ffffff', 
              border: '1.5px solid #dcdde1', 
              borderRadius: '16px', 
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center'
            }}>
              <span style={{ paddingLeft: '16px', fontSize: '1.1rem', userSelect: 'none' }}>🔍</span>
              <input 
                type="text"
                placeholder="Ürün adı, barkod veya açıklama ile ara..."
                className="form-control"
                style={{ 
                  width: '100%', 
                  padding: '14px 40px 14px 8px', 
                  background: 'transparent', 
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.98rem',
                  fontWeight: '500',
                  color: 'var(--text-dark)',
                  boxShadow: 'none'
                }}
                value={clientSearchTerm}
                onChange={(e) => setClientSearchTerm(e.target.value)}
              />
              {clientSearchTerm && (
                <button 
                  type="button" 
                  onClick={() => setClientSearchTerm('')} 
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    fontSize: '1.2rem',
                    cursor: 'pointer',
                    color: 'var(--text-muted)'
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* CATEGORIES BAR (Horizontal Scroll) */}
          <div className="categories-nav">
            <button 
              className={`category-tab ${selectedCategoryId === null ? 'active' : ''}`}
              onClick={() => handleCategorySelect(null)}
            >
              Tümü
            </button>
            {categories.map(cat => (
              <button 
                key={cat.id}
                className={`category-tab ${selectedCategoryId === cat.id ? 'active' : ''}`}
                onClick={() => handleCategorySelect(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="container">
            {/* PAST ORDERS ENTRY BUTTON */}
            <button 
              className="history-trigger-btn"
              onClick={() => {
                setShowHistoryModal(true);
                if (historyPhone) {
                  fetch(`/api/orders/history/${historyPhone}`).then(res => res.json()).then(data => setCustomerOrders(data));
                }
              }}
            >
              🕒 Sipariş Geçmişimi Göster / Sorgula
            </button>


            {/* PRODUCT GRID */}
            {products.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                <h3>Mağazada şu an ürün bulunmuyor.</h3>
                <p>Trendpos listenizi yönetici panelinden içe aktararak başlayabilirsiniz!</p>
              </div>
            ) : filteredClientProducts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                <h3>Aramanıza uygun kırtasiye ürünü bulunamadı.</h3>
                <button 
                  className="history-trigger-btn" 
                  style={{ maxWidth: '200px', margin: '12px auto' }} 
                  onClick={() => setClientSearchTerm('')}
                >
                  Aramayı Temizle
                </button>
              </div>
            ) : (
              <div className="product-grid">
                {filteredClientProducts.map(prod => {
                  const cartItem = cart.find(item => item.product.id === prod.id);
                  const isOutOfStock = prod.stock_quantity === 0;
                  const isLowStock = prod.stock_quantity > 0 && prod.stock_quantity <= 5;
                  
                  return (
                    <div className={`product-card ${isOutOfStock ? 'out-of-stock' : ''}`} key={prod.id}>
                      <div className="product-image-container" onClick={() => setActiveProductDetail(prod)} style={{ cursor: 'pointer' }}>
                        {isOutOfStock && (
                          <div className="out-of-stock-badge">TÜKENDİ</div>
                        )}
                        {prod.image_url ? (
                          <img 
                            src={prod.image_url} 
                            alt={prod.title} 
                            className="product-image" 
                          />
                        ) : (
                          <span className="product-image-fallback">📚</span>
                        )}
                      </div>
                      <div className="product-info">
                        <h3 className="product-title" onClick={() => setActiveProductDetail(prod)} style={{ cursor: 'pointer' }}>{prod.title}</h3>
                        <p className="product-desc" onClick={() => setActiveProductDetail(prod)} style={{ cursor: 'pointer' }}>{prod.description || 'Yerel kırtasiye kaliteli kırtasiye ürünü.'}</p>
                        
                        {/* Stock Status Alerts */}
                        {isOutOfStock ? (
                          <div className="stock-status out-of-stock-txt">🚫 Stokta Kalmadı</div>
                        ) : isLowStock ? (
                          <div className="stock-status low-stock-txt">🔥 Son {prod.stock_quantity} Adet!</div>
                        ) : (
                          <div className="stock-status in-stock-txt">✅ Stokta Var ({prod.stock_quantity} Adet)</div>
                        )}

                        <div className="product-footer">
                          <span className="product-price">{parseFloat(prod.price).toFixed(2)} TL</span>
                          
                          {isOutOfStock ? (
                            <button className="add-btn disabled-add-btn" style={{ background: '#cbd5e1', cursor: 'not-allowed', boxShadow: 'none' }} disabled>🚫</button>
                          ) : cartItem ? (
                            <div className="quantity-controller">
                              <button className="qty-btn" onClick={() => handleRemoveFromCart(prod.id)}>-</button>
                              <span className="qty-val">{cartItem.quantity}</span>
                              <button className="qty-btn" onClick={() => handleAddToCart(prod)}>+</button>
                            </div>
                          ) : (
                            <button className="add-btn" onClick={() => handleAddToCart(prod)}>+</button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* STICKY BOTTOM CART BAR */}
          {cart.length > 0 && (
            <div className={`bottom-cart-bar ${cartPulseClass}`}>
              <div className="cart-bar-info">
                <div className={`cart-icon-badge ${cartPulseClass}`}>
                  🛍️
                  <span className="badge">{getCartItemCount()}</span>
                </div>
                <div className="cart-total-section">
                  <span className="total-lbl">Toplam Sepet</span>
                  <span className="total-val">{getCartTotal().toFixed(2)} TL</span>
                </div>
              </div>
              <button 
                className="view-cart-btn"
                onClick={() => setShowCartSheet(true)}
              >
                Siparişi Tamamla ➔
              </button>
            </div>
          )}

          {/* CHECKOUT SLIDE-UP SHEET */}
          {showCartSheet && (
            <div className="modal-overlay" onClick={() => setShowCartSheet(false)}>
              <div className="slide-up-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Siparişinizi Tamamlayın</h2>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button 
                      type="button"
                      className="clear-cart-btn"
                      onClick={() => {
                        if (window.confirm('Sepetinizdeki tüm ürünleri boşaltmak istediğinize emin misiniz?')) {
                          setCart([]);
                          setShowCartSheet(false);
                        }
                      }}
                      style={{
                        background: '#fff0f0',
                        color: 'var(--danger-color)',
                        border: '1px solid #ffe3e3',
                        padding: '6px 12px',
                        borderRadius: '10px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      🗑️ Temizle
                    </button>
                    <button className="close-btn" onClick={() => setShowCartSheet(false)}>✕</button>
                  </div>
                </div>

                <div className="cart-items-list">
                  {cart.map(item => (
                    <div className="cart-item-row" key={item.product.id}>
                      {item.product.image_url ? (
                        <img src={item.product.image_url} alt={item.product.title} className="cart-item-img" />
                      ) : (
                        <div className="cart-item-img" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#e2e8f0', fontSize: '1.2rem' }}>📚</div>
                      )}
                      <div className="cart-item-details">
                        <div className="cart-item-name">{item.product.title}</div>
                        <div className="cart-item-price">{item.quantity} adet x {parseFloat(item.product.price).toFixed(2)} TL</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="quantity-controller">
                          <button className="qty-btn" onClick={() => handleRemoveFromCart(item.product.id)}>-</button>
                          <span className="qty-val">{item.quantity}</span>
                          <button className="qty-btn" onClick={() => handleAddToCart(item.product)}>+</button>
                        </div>
                        <button 
                          type="button"
                          className="delete-item-btn"
                          onClick={() => handleDeleteFromCart(item.product.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '1.1rem',
                            color: '#e74c3c',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="Sepetten Çıkar"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <form className="checkout-form" onSubmit={handleCheckoutSubmit}>
                  <div className="form-group">
                    <label>Adınız Soyadınız</label>
                    <input 
                      type="text" 
                      required
                      placeholder="Örn. Ahmet Yılmaz"
                      className="form-control"
                      value={checkoutForm.customer_name}
                      onChange={(e) => setCheckoutForm({ ...checkoutForm, customer_name: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Telefon Numaranız</label>
                    <input 
                      type="tel" 
                      required
                      placeholder="Örn. 0532XXXXXXX"
                      className="form-control"
                      value={checkoutForm.customer_phone}
                      onChange={(e) => setCheckoutForm({ ...checkoutForm, customer_phone: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Mahalle (Sadece Bahçelievler)</label>
                    <select 
                      className="form-control"
                      value={checkoutForm.neighborhood}
                      onChange={(e) => setCheckoutForm({ ...checkoutForm, neighborhood: e.target.value })}
                    >
                      {NEIGHBORHOODS.map((n, idx) => (
                        <option key={idx} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Açık Adres (Cadde, Sokak, Daire)</label>
                    <textarea 
                      required
                      rows="3"
                      placeholder="Örn. Siyavuşpaşa Mah. Barbaros Cad. No:14 Daire: 5"
                      className="form-control"
                      value={checkoutForm.full_address}
                      onChange={(e) => setCheckoutForm({ ...checkoutForm, full_address: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Ödeme Yöntemi</label>
                    <div className="payment-options">
                      <label className="payment-radio">
                        <input 
                          type="radio" 
                          name="payment" 
                          value="Nakit" 
                          checked={checkoutForm.payment_method === 'Nakit'}
                          onChange={() => setCheckoutForm({ ...checkoutForm, payment_method: 'Nakit' })}
                        />
                        <div className="payment-box">💵 Kapıda Nakit</div>
                      </label>
                      <label className="payment-radio">
                        <input 
                          type="radio" 
                          name="payment" 
                          value="POS" 
                          checked={checkoutForm.payment_method === 'POS'}
                          onChange={() => setCheckoutForm({ ...checkoutForm, payment_method: 'POS' })}
                        />
                        <div className="payment-box">💳 Kapıda Kredi Kartı (POS)</div>
                      </label>
                    </div>
                  </div>

                  <div style={{ background: '#fff9db', border: '1px solid #ffe3e3', padding: '10px', borderRadius: '10px', fontSize: '0.78rem', color: '#e67e22', fontWeight: 600 }}>
                    ⚠️ {isPast17 ? 'Saat 17:00 sınırı geçildiği için siparişiniz YARIN akşam 19:00 - 22:00 arasında teslim edilecektir.' : 'Siparişiniz BUGÜN akşam 19:00 - 22:00 arasında kapınıza teslim edilecektir.'}
                  </div>

                  <button type="submit" className="checkout-submit-btn">
                    Siparişi Onayla ({getCartTotal().toFixed(2)} TL)
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* CUSTOMER HISTORY ORDERS MODAL */}
          {showHistoryModal && (
            <div className="modal-overlay" onClick={() => setShowHistoryModal(false)}>
              <div className="slide-up-sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '80vh' }}>
                <div className="modal-header">
                  <h2>Sipariş Geçmişim</h2>
                  <button className="close-btn" onClick={() => setShowHistoryModal(false)}>✕</button>
                </div>

                <form onSubmit={handleFetchHistory} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  <input 
                    type="tel"
                    placeholder="Kayıtlı Telefon Numaranız"
                    className="form-control"
                    style={{ flexGrow: 1 }}
                    value={historyPhone}
                    onChange={(e) => setHistoryPhone(e.target.value)}
                  />
                  <button type="submit" className="view-cart-btn" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>Sorgula</button>
                </form>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: '55vh' }}>
                  {customerOrders.length === 0 ? (
                    <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>Henüz kayıtlı bir sipariş bulunamadı.</p>
                  ) : (
                    customerOrders.map(order => (
                      <div className="history-order-card" key={order.id}>
                        <div className="history-order-meta">
                          <span>Sipariş #{order.id}</span>
                          <span className={`status-badge ${order.order_status.toLowerCase().replace(' ', '')}`}>
                            {order.order_status}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                          📅 {new Date(order.created_at).toLocaleString('tr-TR')} <br />
                          📍 {order.neighborhood} / {order.full_address} <br />
                          💳 Ödeme: Kapıda {order.payment_method}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {order.items && order.items.map(item => (
                            <div key={item.id} style={{ fontSize: '0.78rem', display: 'flex', justifyContent: 'between' }}>
                              <span>• {item.product_title} ({item.quantity} adet)</span>
                              <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{(item.price * item.quantity).toFixed(2)} TL</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #edf2f7', marginTop: '8px', paddingTop: '6px', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {/* SIFIR MALİYET CANLI GPS ENTEGRASYONU */}
                            <a 
                              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.full_address + ' ' + order.neighborhood + ' Bahçelievler İstanbul')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="directions-link-btn"
                            >
                              🗺️ Haritada Gör
                            </a>
                            {order.order_status === 'Beklemede' && (
                              <button 
                                type="button"
                                className="cancel-order-btn"
                                onClick={() => handleCancelCustomerOrder(order.id)}
                                style={{
                                  background: '#fff0f0',
                                  color: 'var(--danger-color)',
                                  border: '1.5px solid #ffe3e3',
                                  padding: '6px 12px',
                                  borderRadius: '10px',
                                  fontSize: '0.78rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  transition: 'var(--transition)'
                                }}
                              >
                                ✕ Siparişi İptal Et
                              </button>
                            )}
                          </div>
                          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--primary-color)' }}>
                            Toplam: {parseFloat(order.total_amount).toFixed(2)} TL
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SUCCESS MESSAGE MODAL */}
          {orderSuccessDetails && (
            <div className="modal-overlay" onClick={() => setOrderSuccessDetails(null)}>
              <div className="slide-up-sheet" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', padding: '30px' }}>
                <span style={{ fontSize: '4rem' }}>🎉</span>
                <h2 style={{ fontFamily: 'var(--font-title)', fontWeight: 800, marginTop: '10px' }}>Harika! Siparişiniz Alındı</h2>
                <p style={{ margin: '12px 0', fontSize: '0.92rem', color: 'var(--text-muted)' }}>
                  Sipariş Numaranız: <strong>#{orderSuccessDetails.order_id}</strong> <br />
                  {orderSuccessDetails.message}
                </p>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', textAlign: 'left', fontSize: '0.8rem', marginBottom: '20px' }}>
                  📞 Telefon tabanlı giriş sayesinde geçmiş siparişlerinizi aynı telefon numarasıyla dilediğiniz an sorgulayabilirsiniz. Şifreye gerek yoktur!
                </div>
                <button 
                  className="checkout-submit-btn" 
                  style={{ width: '100%' }}
                  onClick={() => setOrderSuccessDetails(null)}
                >
                  Alışverişe Devam Et
                </button>
              </div>
            </div>
          )}

          {/* DETAY MODALI (PRODUCT DETAIL MODAL) */}
          {activeProductDetail && (() => {
            const prod = activeProductDetail;
            const cartItem = cart.find(item => item.product.id === prod.id);
            const isOutOfStock = prod.stock_quantity === 0;
            const isLowStock = prod.stock_quantity > 0 && prod.stock_quantity <= 5;
            
            return (
              <div className="modal-overlay" onClick={() => setActiveProductDetail(null)}>
                <div className="slide-up-sheet product-detail-sheet" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h2>Ürün Detayı</h2>
                    <button className="close-btn" onClick={() => setActiveProductDetail(null)}>✕</button>
                  </div>

                  <div className="product-detail-layout" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="product-detail-image-box" style={{
                      aspectRatio: '1',
                      background: '#f8fafc',
                      borderRadius: '16px',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1.5px solid #edf2f7',
                      position: 'relative'
                    }}>
                      {isOutOfStock && (
                        <div className="out-of-stock-badge" style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 10 }}>TÜKENDİ</div>
                      )}
                      {prod.image_url ? (
                        <img 
                          src={prod.image_url} 
                          alt={prod.title} 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                        />
                      ) : (
                        <span style={{ fontSize: '4rem' }}>📚</span>
                      )}
                    </div>

                    <div className="product-detail-info">
                      <h2 style={{ fontFamily: 'var(--font-title)', fontWeight: 800, fontSize: '1.25rem', color: 'var(--text-dark)', marginBottom: '8px' }}>{prod.title}</h2>
                      
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                        <span style={{ background: 'rgba(108, 92, 231, 0.08)', color: 'var(--primary-color)', padding: '4px 10px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 700 }}>
                          🏷️ {prod.category_name || categories.find(c => c.id === prod.category_id)?.name || 'Kırtasiye'}
                        </span>
                        <span style={{ background: '#f1f5f9', color: 'var(--text-muted)', padding: '4px 10px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 700 }}>
                          🔢 Barkod: {prod.barcode}
                        </span>
                      </div>

                      <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '20px', background: '#f8fafc', padding: '12px', borderRadius: '12px', border: '1px solid #edf2f7' }}>
                        {prod.description || 'Aktürk Kırtasiye güvencesiyle yüksek kaliteli kırtasiye malzemesi. Bahçelievler dükkanımızdan aynı gün akşam kapınıza teslim edilir.'}
                      </p>

                      {/* Stock Status */}
                      <div style={{ marginBottom: '20px' }}>
                        {isOutOfStock ? (
                          <div className="stock-status out-of-stock-txt" style={{ display: 'inline-flex', padding: '6px 12px', background: '#fff0f0', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 700 }}>🚫 Stokta Kalmadı</div>
                        ) : isLowStock ? (
                          <div className="stock-status low-stock-txt" style={{ display: 'inline-flex', padding: '6px 12px', background: '#fff9db', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 700 }}>🔥 Son {prod.stock_quantity} Adet! Kaçırmayın!</div>
                        ) : (
                          <div className="stock-status in-stock-txt" style={{ display: 'inline-flex', padding: '6px 12px', background: '#e3fcef', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 700 }}>✅ Stokta Var ({prod.stock_quantity} Adet)</div>
                        )}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #edf2f7', paddingTop: '16px', marginTop: '16px' }}>
                        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary-color)', fontFamily: 'var(--font-title)' }}>
                          {parseFloat(prod.price).toFixed(2)} TL
                        </span>

                        {isOutOfStock ? (
                          <button className="view-cart-btn" style={{ background: '#cbd5e1', cursor: 'not-allowed', boxShadow: 'none' }} disabled>Tükendi</button>
                        ) : cartItem ? (
                          <div className="quantity-controller" style={{ padding: '4px' }}>
                            <button className="qty-btn" style={{ width: '36px', height: '36px', fontSize: '1.2rem' }} onClick={() => handleRemoveFromCart(prod.id)}>-</button>
                            <span className="qty-val" style={{ fontSize: '1.05rem', minWidth: '32px' }}>{cartItem.quantity}</span>
                            <button className="qty-btn" style={{ width: '36px', height: '36px', fontSize: '1.2rem' }} onClick={() => handleAddToCart(prod)}>+</button>
                          </div>
                        ) : (
                          <button className="view-cart-btn" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={() => handleAddToCart(prod)}>
                            🛒 Sepete Ekle
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ============================================================== */}
      {/* ======================= YÖNETİCİ PANELİ ====================== */}
      {/* ============================================================== */}
      {isAdminMode && (
        !adminToken ? (
          <div className="admin-container" style={{ maxWidth: '450px', margin: '40px auto' }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '24px', padding: '30px', boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)' }}>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <span style={{ fontSize: '3rem' }}>🔑</span>
                <h2 style={{ fontFamily: 'var(--font-title)', fontWeight: 800, marginTop: '10px' }}>Yönetici Girişi</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Devam etmek için lütfen mağaza şifresini girin.</p>
              </div>
              <form onSubmit={handleAdminLogin}>
                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label style={{ fontWeight: 600 }}>Yönetici Şifresi</label>
                  <input 
                    type="password"
                    required
                    placeholder="••••••••"
                    className="form-control"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: '4px' }}
                  />
                </div>
                {loginError && (
                  <div style={{ color: 'var(--accent-color)', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center', marginBottom: '16px', background: '#fff0f0', padding: '8px', borderRadius: '8px', border: '1px solid #ffe3e3' }}>
                    ⚠️ {loginError}
                  </div>
                )}
                <button type="submit" className="checkout-submit-btn" style={{ width: '100%' }}>
                  Giriş Yap
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="admin-container">
            <div className="admin-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '15px' }}>
                <h2 style={{ fontFamily: 'var(--font-title)', fontWeight: 800 }}>⚙️ Mağaza Yönetim Paneli</h2>
                <button 
                  className="status-btn cancel" 
                  onClick={handleLogout}
                  style={{ padding: '6px 12px', fontSize: '0.8rem', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', background: '#ff7675', color: '#fff', border: 'none', fontWeight: 600 }}
                >
                  🔒 Güvenli Çıkış
                </button>
              </div>
              
              <div className="admin-tabs">
                <button 
                  className={`admin-tab-btn ${adminTab === 'logistics' ? 'active' : ''}`}
                  onClick={() => setAdminTab('logistics')}
                >
                  🚚 Akşam Dağıtım
                </button>
                <button 
                  className={`admin-tab-btn ${adminTab === 'analytics' ? 'active' : ''}`}
                  onClick={() => setAdminTab('analytics')}
                >
                  📊 Analiz & Raporlar
                </button>
                <button 
                  className={`admin-tab-btn ${adminTab === 'archive' ? 'active' : ''}`}
                  onClick={() => setAdminTab('archive')}
                >
                  📂 Sipariş Arşivi
                </button>
                <button 
                  className={`admin-tab-btn ${adminTab === 'products' ? 'active' : ''}`}
                  onClick={() => setAdminTab('products')}
                >
                  📦 Ürün Listesi
                </button>
                <button 
                  className={`admin-tab-btn ${adminTab === 'add_product' ? 'active' : ''}`}
                  onClick={() => {
                    setAdminTab('add_product');
                    setScannedBarcode('');
                    setScannedProductExists(false);
                  }}
                >
                  📸 Akıllı Giriş
                </button>
              </div>
            </div>

            {/* TAB 0.5: ANALYTICS & REPORTS PANEL */}
            {adminTab === 'analytics' && (() => {
              const allOrdersRaw = [...logisticOrders, ...archiveOrders];

              const parseOrderDate = (dateStr) => {
                if (!dateStr) return new Date();
                if (dateStr.includes(' ') && !dateStr.includes('T')) {
                  return new Date(dateStr.replace(' ', 'T') + 'Z');
                }
                return new Date(dateStr);
              };

              const allOrders = allOrdersRaw.filter(order => {
                if (analyticsPeriod === 'overall') return true;
                
                const orderTime = parseOrderDate(order.created_at).getTime();
                
                if (analyticsPeriod === 'today') {
                  const startOfToday = new Date();
                  startOfToday.setHours(0, 0, 0, 0);
                  return orderTime >= startOfToday.getTime();
                }
                
                if (analyticsPeriod === 'week') {
                  const startOfWeek = new Date();
                  startOfWeek.setDate(startOfWeek.getDate() - 7);
                  startOfWeek.setHours(0, 0, 0, 0);
                  return orderTime >= startOfWeek.getTime();
                }
                
                if (analyticsPeriod === 'month') {
                  const startOfMonth = new Date();
                  startOfMonth.setDate(1);
                  startOfMonth.setHours(0, 0, 0, 0);
                  return orderTime >= startOfMonth.getTime();
                }
                
                return true;
              });

              const deliveredOrders = allOrders.filter(o => o.order_status === 'Teslim Edildi');
              const activeOrders = allOrders.filter(o => o.order_status === 'Beklemede' || o.order_status === 'Dağıtımda');
              const canceledOrders = allOrders.filter(o => o.order_status === 'İptal');

              const totalRevenue = deliveredOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
              const pendingRevenue = activeOrders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
              const totalOrdersCount = allOrders.length;
              const deliveredCount = deliveredOrders.length;
              const activeCount = activeOrders.length;
              const canceledCount = canceledOrders.length;

              const averageOrderValue = deliveredCount > 0 ? (totalRevenue / deliveredCount) : 0;

              // Neighborhood stats (excluding canceled)
              const neighborhoodOrderCounts = {};
              NEIGHBORHOODS.forEach(n => { neighborhoodOrderCounts[n] = 0; });
              allOrders.forEach(order => {
                if (order.order_status !== 'İptal' && neighborhoodOrderCounts[order.neighborhood] !== undefined) {
                  neighborhoodOrderCounts[order.neighborhood] += 1;
                }
              });

              const maxNeighborhoodCount = Math.max(...Object.values(neighborhoodOrderCounts), 1);
              const activeNeighborhoodsWithOrders = NEIGHBORHOODS.filter(n => neighborhoodOrderCounts[n] > 0)
                .sort((a, b) => neighborhoodOrderCounts[b] - neighborhoodOrderCounts[a]);

              // Top Selling Products
              const productSales = {};
              allOrders.forEach(order => {
                if (order.order_status !== 'İptal' && order.items) {
                  order.items.forEach(item => {
                    const title = item.product_title || `Ürün #${item.product_id}`;
                    productSales[title] = (productSales[title] || 0) + parseInt(item.quantity || 0);
                  });
                }
              });

              const topProducts = Object.entries(productSales)
                .map(([title, qty]) => ({ title, qty }))
                .sort((a, b) => b.qty - a.qty)
                .slice(0, 5);

              const maxProductQty = topProducts.length > 0 ? topProducts[0].qty : 1;

              return (
                <div className="analytics-dashboard">
                  {/* SEGMENTED PERIOD SELECTOR */}
                  <div style={{
                    display: 'flex',
                    background: 'rgba(255, 255, 255, 0.7)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(226, 232, 240, 0.8)',
                    borderRadius: '16px',
                    padding: '6px',
                    gap: '6px',
                    marginBottom: '24px',
                    maxWidth: '520px',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)'
                  }}>
                    {[
                      { id: 'today', label: '📅 Bugün' },
                      { id: 'week', label: '📅 Son 7 Gün' },
                      { id: 'month', label: '📅 Bu Ay' },
                      { id: 'overall', label: '📊 Genel Toplam' }
                    ].map(period => {
                      const isActive = analyticsPeriod === period.id;
                      return (
                        <button
                          key={period.id}
                          onClick={() => setAnalyticsPeriod(period.id)}
                          style={{
                            flex: 1,
                            border: 'none',
                            background: isActive ? 'var(--primary-color)' : 'transparent',
                            color: isActive ? 'white' : 'var(--text-dark)',
                            fontWeight: isActive ? 700 : 500,
                            padding: '10px 12px',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: isActive ? '0 4px 12px rgba(108, 92, 231, 0.25)' : 'none',
                            outline: 'none'
                          }}
                        >
                          {period.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="stats-grid">
                    <div className="stat-card premium-revenue-card">
                      <div className="stat-icon">💰</div>
                      <div className="stat-val">{totalRevenue.toFixed(2)} TL</div>
                      <div className="stat-lbl">Toplam Ciro</div>
                      <div className="stat-sub">
                        {analyticsPeriod === 'today' ? 'Bugünkü teslimat cirosu' :
                         analyticsPeriod === 'week' ? 'Son 7 günlük teslimat cirosu' :
                         analyticsPeriod === 'month' ? 'Bu ayın teslimat cirosu' :
                         'Tüm zamanların teslimat cirosu'}
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">📦</div>
                      <div className="stat-val">{totalOrdersCount}</div>
                      <div className="stat-lbl">Toplam Sipariş</div>
                      <div className="stat-sub">
                        {activeCount} Aktif | {canceledCount} İptal
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">📈</div>
                      <div className="stat-val">{averageOrderValue.toFixed(2)} TL</div>
                      <div className="stat-lbl">Ortalama Sepet (AOV)</div>
                      <div className="stat-sub">
                        {analyticsPeriod === 'today' ? 'Bugünkü ortalama sepet' :
                         analyticsPeriod === 'week' ? 'Son 7 günlük ortalama sepet' :
                         analyticsPeriod === 'month' ? 'Bu ayki ortalama sepet' :
                         'Tüm zamanların ortalaması'}
                      </div>
                    </div>
                  </div>

                  <div className="analytics-details-grid">
                    {/* MAHALLE DAĞILIMI (Saf CSS Grafik) */}
                    <div className="analytics-card">
                      <h3>📍 Bahçelievler Mahalle Dağılımı</h3>
                      <p className="card-sub-desc">Mahallelere göre sipariş (adet) oranları</p>
                      
                      <div className="analytics-chart-container">
                        {activeNeighborhoodsWithOrders.length === 0 ? (
                          <div className="empty-analytics-msg">
                            Sipariş kaydı bulunmuyor.
                          </div>
                        ) : (
                          activeNeighborhoodsWithOrders.map(n => {
                            const count = neighborhoodOrderCounts[n];
                            const percent = (count / maxNeighborhoodCount) * 100;
                            return (
                              <div key={n} className="analytics-bar-row">
                                <div className="analytics-bar-label">{n}</div>
                                <div className="analytics-bar-wrapper">
                                  <div className="analytics-bar-container">
                                    <div className="analytics-bar-fill" style={{ width: `${percent}%` }}>
                                      <span className="analytics-bar-value">{count} Sipariş</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* EN ÇOK SATAN ÜRÜNLER (Liderlik Tablosu) */}
                    <div className="analytics-card">
                      <h3>🔥 En Çok Satan Ürünler</h3>
                      <p className="card-sub-desc">Adet bazında en çok talep gören ilk 5 ürün</p>

                      <div className="leaderboard-container">
                        {topProducts.length === 0 ? (
                          <div className="empty-analytics-msg">
                            Ürün satış kaydı bulunmuyor.
                          </div>
                        ) : (
                          topProducts.map((p, idx) => {
                            const percent = (p.qty / maxProductQty) * 100;
                            return (
                              <div key={idx} className="leaderboard-row">
                                <div className="leaderboard-rank">#{idx + 1}</div>
                                <div className="leaderboard-details">
                                  <div className="leaderboard-title">{p.title}</div>
                                  <div className="leaderboard-bar-container">
                                    <div className="leaderboard-bar-fill" style={{ width: `${percent}%` }}></div>
                                  </div>
                                </div>
                                <div className="leaderboard-qty">{p.qty} Adet</div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* TAB 1: LOGISTICS / DELIVERY MANAGER (MAP + ROUTING SEQUENCE) */}
            {adminTab === 'logistics' && (
              <div>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-val">{logisticOrders.length}</div>
                    <div className="stat-lbl">Toplam Dağıtılacak</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-val">
                      {logisticOrders.filter(o => o.payment_method === 'Nakit').length}
                    </div>
                    <div className="stat-lbl">Kapıda Nakit</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-val">
                      {logisticOrders.filter(o => o.payment_method === 'POS').length}
                    </div>
                    <div className="stat-lbl">Kapıda POS</div>
                  </div>
                </div>

                {logisticOrders.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '16px' }}>
                    <h3>Bugün için dağıtılacak sipariş bulunmuyor.</h3>
                    <p>Müşterilerden yeni siparişler gelince burada listelenecektir.</p>
                  </div>
                ) : (
                  <div>
                    {/* SIFIR MALİYET LEAFLET HARİTA ALANI */}
                    <div className="delivery-map-container">
                      <div className="map-header">
                        <span>🗺️ Etkileşimli Dağıtım Haritası (Bahçelievler)</span>
                        <span style={{ fontSize: '0.75rem', background: 'var(--primary-color)', padding: '2px 8px', borderRadius: '10px' }}>100% Ücretsiz OpenStreetMap</span>
                      </div>
                      <div id="delivery-map" className="map-viewport"></div>
                    </div>

                    {/* AKILLI DAĞITIM ROTA SIRALAMA PANELİ */}
                    <div className="route-sequence-panel">
                      <h3>🔄 Akşam Dağıtım Rotası Sıralaması</h3>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        Mahallelerin dağıtım öncelik sırasını aşağı-yukarı butonlarıyla değiştirin. Sipariş listesi bu sıralamaya göre güncellenecektir.
                      </p>
                      <div className="sequence-list">
                        {routeSequence.map((neigh, idx) => {
                          const hasOrders = neighborhoodGroups[neigh] && neighborhoodGroups[neigh].length > 0;
                          if (!hasOrders) return null;

                          return (
                            <div className="sequence-item" key={neigh}>
                              <span>📍 {idx + 1}. {neigh} ({neighborhoodGroups[neigh].length} Sipariş)</span>
                              <div className="sequence-nav-btns">
                                <button className="seq-btn" onClick={() => moveNeighborhoodSequence(idx, -1)}>▲</button>
                                <button className="seq-btn" onClick={() => moveNeighborhoodSequence(idx, 1)}>▼</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* MAHALLE BAZLI GRUPLANDIRILMIŞ VE ROTA SIRALANMIŞ SİPARİŞ KARTLARI */}
                    <div className="logistic-section">
                      {sortedActiveNeighborhoods.map(neigh => (
                        <div className="neighborhood-group" key={neigh}>
                          <div className="neighborhood-header">
                            <span>📍 {neigh}</span>
                            <span className="neighborhood-badge">{neighborhoodGroups[neigh].length} Sipariş</span>
                          </div>
                          
                          <div className="logistic-orders-list">
                            {neighborhoodGroups[neigh].map(order => (
                              <div className="logistic-order-card" key={order.id}>
                                <div className="order-meta-info">
                                  <span>Sipariş #{order.id} ({new Date(order.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })})</span>
                                  <span className={`status-badge ${order.order_status.toLowerCase()}`}>
                                    {order.order_status}
                                  </span>
                                </div>
                                
                                <div style={{ marginBottom: '8px' }}>
                                  <span className="order-cust-name">{order.customer_name}</span> - 
                                  <a href={`tel:${order.customer_phone}`} className="order-cust-phone"> 📞 {order.customer_phone}</a>
                                </div>

                                <div className="order-address">
                                  🏡 {order.full_address}
                                </div>

                                <div className="order-items-summary">
                                  <strong>Sipariş İçeriği:</strong>
                                  {order.items && order.items.map(item => (
                                    <div key={item.id} style={{ paddingLeft: '8px', fontSize: '0.78rem' }}>
                                      • {item.product_title} - {item.quantity} adet ({parseFloat(item.price).toFixed(2)} TL)
                                    </div>
                                  ))}
                                </div>

                                <div className="order-actions-row">
                                  <span className={`payment-badge ${order.payment_method === 'POS' ? 'pos' : 'cash'}`}>
                                    {order.payment_method === 'POS' ? '💳 Kapıda POS' : '💵 Kapıda Nakit'}
                                  </span>
                                  
                                  <div style={{ fontWeight: 800, color: 'var(--primary-color)', fontSize: '0.95rem' }}>
                                    Tutar: {parseFloat(order.total_amount).toFixed(2)} TL
                                  </div>

                                  <div className="action-status-btns">
                                    {/* SIFIR MALİYET NATIVE NAVİGASYON/YOL TARİFİ AÇMA KÖPRÜSÜ */}
                                    <a 
                                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.full_address + ' ' + order.neighborhood + ' Bahçelievler İstanbul')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="directions-link-btn"
                                      style={{ marginRight: '6px' }}
                                    >
                                      🗺️ Yol Tarifi
                                    </a>
                                    {order.order_status === 'Beklemede' && (
                                      <button 
                                        className="status-btn transit"
                                        onClick={() => handleUpdateOrderStatus(order.id, 'Dağıtımda')}
                                      >
                                        🚚 Dağıt
                                      </button>
                                    )}
                                    {order.order_status === 'Dağıtımda' && (
                                      <button 
                                        className="status-btn deliver"
                                        onClick={() => handleUpdateOrderStatus(order.id, 'Teslim Edildi')}
                                      >
                                        ✅ Teslim
                                      </button>
                                    )}
                                    {order.order_status !== 'Teslim Edildi' && (
                                      <button 
                                        className="status-btn cancel"
                                        onClick={() => handleUpdateOrderStatus(order.id, 'İptal')}
                                      >
                                        ✕ İptal
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: ORDER ARCHIVE (DELIVERED & CANCELLED) */}
            {adminTab === 'archive' && (
              <div>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-val">{archiveOrders.length}</div>
                    <div className="stat-lbl">Arşiv Siparişleri</div>
                  </div>
                  <div className="stat-card" style={{ gridColumn: 'span 2' }}>
                    <div className="stat-val">{totalArchiveRevenue.toFixed(2)} TL</div>
                    <div className="stat-lbl">Toplam Toplanan Gelir</div>
                  </div>
                </div>

                {/* Search & Filter Bar */}
                <div className="archive-search-bar">
                  <input 
                    type="text" 
                    placeholder="Sipariş No, Müşteri Adı veya Telefon Ara..."
                    className="form-control"
                    value={archiveSearch}
                    onChange={(e) => setArchiveSearch(e.target.value)}
                  />
                  <select 
                    className="form-control"
                    value={archiveNeighFilter}
                    onChange={(e) => setArchiveNeighFilter(e.target.value)}
                  >
                    <option value="">Tüm Mahalleler</option>
                    {NEIGHBORHOODS.map((n, idx) => (
                      <option key={idx} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

                {filteredArchiveOrders.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '16px' }}>
                    <h3>Eşleşen arşivlenmiş sipariş bulunamadı.</h3>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {filteredArchiveOrders.map(order => (
                      <div className="logistic-order-card" key={order.id} style={{ background: '#f8fafc' }}>
                        <div className="order-meta-info">
                          <span>Sipariş #{order.id} - {new Date(order.created_at).toLocaleString('tr-TR')}</span>
                          <span className={`status-badge ${order.order_status.toLowerCase().replace(' ', '')}`}>
                            {order.order_status}
                          </span>
                        </div>
                        
                        <div style={{ marginBottom: '6px', fontSize: '0.85rem' }}>
                          <strong>Alıcı:</strong> {order.customer_name} ({order.customer_phone})<br/>
                          <strong>Adres:</strong> 📍 {order.neighborhood} / {order.full_address}
                        </div>

                        <div className="order-items-summary" style={{ background: 'white', padding: '8px', borderRadius: '8px' }}>
                          {order.items && order.items.map(item => (
                            <div key={item.id} style={{ fontSize: '0.78rem' }}>
                              • {item.product_title} - {item.quantity} adet ({parseFloat(item.price).toFixed(2)} TL)
                            </div>
                          ))}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                          <span className={`payment-badge ${order.payment_method === 'POS' ? 'pos' : 'cash'}`}>
                            {order.payment_method === 'POS' ? '💳 Kapıda POS' : '💵 Kapıda Nakit'}
                          </span>
                          
                          {/* SIFIR MALİYET GEÇMİŞ YOL TARİFİ */}
                          <a 
                            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.full_address + ' ' + order.neighborhood + ' Bahçelievler İstanbul')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="directions-link-btn"
                          >
                            🗺️ Haritada Arşivle Gör
                          </a>
                          
                          <div style={{ fontWeight: 800, color: 'var(--text-dark)', fontSize: '0.95rem' }}>
                            Tutar: {parseFloat(order.total_amount).toFixed(2)} TL
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: PRODUCT LIST & CSV EXPORT */}
            {adminTab === 'products' && (
              <div>
                {/* CSV Import Section */}
                <div className="csv-upload-box">
                  <label style={{ cursor: 'pointer', display: 'block', width: '100%', height: '100%' }}>
                    <span style={{ fontSize: '2.5rem' }}>📊</span>
                    <h3 style={{ marginTop: '10px', fontSize: '1rem', fontWeight: 700 }}>Trendpos CSV / Excel Listesini Buraya Yükleyin</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Dosyada "Barkod", "Ürün Adı" ve "Fiyat" sütunları yer almalıdır. Tıklayarak seçebilirsiniz.
                    </p>
                    <input 
                      type="file" 
                      accept=".csv,text/csv" 
                      style={{ display: 'none' }}
                      onChange={handleCsvImport}
                    />
                  </label>
                </div>

                {csvUploadStatus && (
                  <div style={{
                    padding: '12px',
                    borderRadius: '12px',
                    marginBottom: '20px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    textAlign: 'center',
                    background: csvUploadStatus.success ? '#e3fcef' : '#ffe3e3',
                    color: csvUploadStatus.success ? '#00b894' : '#d63031',
                    border: `1px solid ${csvUploadStatus.success ? '#00b894' : '#d63031'}`
                  }}>
                    {csvUploadStatus.loading ? '⏳ CSV Verileri İçe Aktarılıyor...' : csvUploadStatus.msg}
                  </div>
                )}

                {/* ADMIN PRODUCT SEARCH BAR */}
                <div className="admin-search-wrapper" style={{ margin: '14px 0 18px 0', position: 'relative' }}>
                  <input 
                    type="text"
                    placeholder="🔍 Ürün adı, barkod veya kategoriye göre stokta ara..."
                    className="form-control admin-search-input"
                    style={{ width: '100%', paddingRight: '40px', background: '#fff', borderRadius: '12px', border: '1.5px solid #edf2f7' }}
                    value={adminSearchTerm}
                    onChange={(e) => setAdminSearchTerm(e.target.value)}
                  />
                  {adminSearchTerm && (
                    <button 
                      type="button" 
                      onClick={() => setAdminSearchTerm('')} 
                      style={{
                        position: 'absolute',
                        right: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        color: 'var(--text-muted)'
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Product list table */}
                <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #edf2f7', overflow: 'hidden' }}>
                  <div style={{ padding: '16px', fontWeight: 800, borderBottom: '1px solid #edf2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <span>Mağazadaki Tüm Ürünler ({filteredAdminProducts.length} / {adminProducts.length} Ürün)</span>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #edf2f7', fontWeight: 700 }}>
                          <th style={{ padding: '12px 16px' }}>Görsel</th>
                          <th style={{ padding: '12px 16px' }}>Ürün Adı</th>
                          <th style={{ padding: '12px 16px' }}>Barkod</th>
                          <th style={{ padding: '12px 16px' }}>Fiyat</th>
                          <th style={{ padding: '12px 16px' }}>Kategori</th>
                          <th style={{ padding: '12px 16px' }}>Durum</th>
                          <th style={{ padding: '12px 16px' }}>Aksiyon</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAdminProducts.length === 0 ? (
                          <tr>
                            <td colSpan="7" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                              Eşleşen ürün bulunamadı.
                            </td>
                          </tr>
                        ) : (
                          filteredAdminProducts.map(prod => (
                          <tr key={prod.id} style={{ borderBottom: '1px solid #edf2f7' }}>
                            <td style={{ padding: '8px 16px' }}>
                              {prod.image_url ? (
                                <img src={prod.image_url} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '8px' }} />
                              ) : (
                                <span style={{ fontSize: '1.5rem' }}>📚</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 16px', fontWeight: 600 }}>{prod.title}</td>
                            <td style={{ padding: '8px 16px', color: 'var(--text-muted)' }}>{prod.barcode}</td>
                            <td style={{ padding: '8px 16px', fontWeight: 700 }}>{parseFloat(prod.price).toFixed(2)} TL</td>
                            <td style={{ padding: '8px 16px' }}>{prod.category_name || '-'}</td>
                            <td style={{ padding: '8px 16px' }}>
                              <span className={`status-badge ${prod.is_active ? 'teslimedildi' : 'beklemede'}`}>
                                {prod.is_active ? 'Aktif (Satışta)' : 'Pasif (Fotoğrafsız)'}
                              </span>
                            </td>
                            <td style={{ padding: '8px 16px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <button 
                                className="admin-toggle-btn"
                                style={{ padding: '4px 8px', fontSize: '0.75rem', background: 'var(--primary-color)' }}
                                onClick={() => handleEditProductClick(prod)}
                                title="Düzenle"
                              >
                                ✏️
                              </button>
                              <button 
                                className={`status-btn ${prod.is_active ? 'transit' : 'deliver'}`}
                                style={{ padding: '4px 8px', fontSize: '0.75rem', fontWeight: 600, border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#fff' }}
                                onClick={() => handleToggleProductActive(prod)}
                                title={prod.is_active ? 'Pasife Al' : 'Aktife Al'}
                              >
                                {prod.is_active ? '⏸️ Pasif' : '▶️ Aktif'}
                              </button>
                              <button 
                                className="status-btn cancel"
                                style={{ padding: '4px 8px', fontSize: '0.75rem', cursor: 'pointer', background: '#ff7675', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600 }}
                                onClick={() => handleDeleteProduct(prod.id)}
                                title="Ürünü Sil"
                              >
                                🗑️ Sil
                              </button>
                            </td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: SMART BARCODE INPUT & CAMERA COMPRESSION */}
            {adminTab === 'add_product' && (
              <div style={{ background: 'white', borderRadius: '16px', padding: '20px', border: '1px solid #edf2f7', maxWidth: '600px', margin: '0 auto' }}>
                <h3 style={{ fontFamily: 'var(--font-title)', fontWeight: 800, marginBottom: '16px' }}>📷 Akıllı Kamera & Barkod ile Ürün Tanımlama</h3>

                {saveSuccessMsg && (
                  <div style={{ padding: '12px', background: '#e3fcef', color: '#00b894', borderRadius: '12px', fontSize: '0.88rem', fontWeight: 600, textAlign: 'center', marginBottom: '16px', border: '1px solid #00b894' }}>
                    {saveSuccessMsg}
                  </div>
                )}

                {/* CAMERA SCAN BUTTONS */}
                {!scannerActive && !scannedBarcode && (
                  <button 
                    className="checkout-submit-btn" 
                    style={{ width: '100%', marginBottom: '20px', display: 'flex', alignItems: 'center', justifycontent: 'center', gap: '8px' }}
                    onClick={startBarcodeScanner}
                  >
                    🎥 Barkod Okumak İçin Kamerayı Aç
                  </button>
                )}

                {/* SCANNER VIEWPORT */}
                {scannerActive && (
                  <div className="scanner-container">
                    <div id="reader"></div>
                    <button 
                      className="status-btn cancel" 
                      style={{ marginTop: '12px' }}
                      onClick={stopBarcodeScanner}
                    >
                      Kamerayı Kapat
                    </button>
                  </div>
                )}

                {/* BARKOD FALLBACK SEARCH BOX */}
                {!scannerActive && (
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                    <input 
                      type="text" 
                      placeholder="Manuel Barkod Girin veya Okutun"
                      className="form-control"
                      style={{ flexGrow: 1 }}
                      value={scannedBarcode}
                      onChange={(e) => setScannedBarcode(e.target.value)}
                    />
                    <button 
                      type="button" 
                      className="view-cart-btn"
                      style={{ fontSize: '0.85rem' }}
                      onClick={() => handleBarcodeSearch(scannedBarcode)}
                    >
                      Sorgula
                    </button>
                  </div>
                )}

                {/* PRODUCT LOADED FORM */}
                {scannedBarcode && (
                  <div>
                    <div style={{
                      padding: '12px',
                      borderRadius: '12px',
                      background: scannedProductExists ? 'rgba(108, 92, 231, 0.05)' : '#fff9db',
                      color: scannedProductExists ? 'var(--primary-color)' : '#e67e22',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      marginBottom: '16px',
                      border: '1.5px solid'
                    }}>
                      {scannedProductExists 
                        ? '✓ Ürün sistemde kayıtlı! Ürün adını düzenleyebilir ve fotoğraf çekip yayına alabilirsiniz.'
                        : 'ℹ Ürün sistemde kayıtlı değil! Sıfırdan ad, fiyat, kategori girip görsel çekerek ekleyebilirsiniz.'}
                    </div>

                    <form onSubmit={handleSaveProduct} className="checkout-form">
                      <div className="form-group">
                        <label>Barkod No</label>
                        <input 
                          type="text" 
                          required
                          disabled
                          className="form-control"
                          value={scannedForm.barcode}
                        />
                      </div>

                      <div className="form-group">
                        <label>Ürün Adı</label>
                        <input 
                          type="text" 
                          required
                          placeholder="Örn. Rotring 0.5 Versatil Kalem"
                          className="form-control"
                          value={scannedForm.title}
                          onChange={(e) => setScannedForm({ ...scannedForm, title: e.target.value })}
                        />
                      </div>

                      <div className="form-group">
                        <label>Fiyat (TL)</label>
                        <input 
                          type="number" 
                          step="0.01"
                          required
                          placeholder="Örn. 45.50"
                          className="form-control"
                          value={scannedForm.price}
                          onChange={(e) => setScannedForm({ ...scannedForm, price: e.target.value })}
                        />
                      </div>

                      <div className="form-group">
                        <label>Kategori</label>
                        <select 
                          className="form-control"
                          value={scannedForm.category_id}
                          onChange={(e) => setScannedForm({ ...scannedForm, category_id: e.target.value })}
                        >
                          {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Açıklama (Opsiyonel)</label>
                        <textarea 
                          rows="2"
                          placeholder="Ürün detay açıklaması"
                          className="form-control"
                          value={scannedForm.description}
                          onChange={(e) => setScannedForm({ ...scannedForm, description: e.target.value })}
                        />
                      </div>

                      <div className="form-group">
                        <label style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-dark)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                          Ürün Satış Durumu
                        </label>
                        <div style={{ display: 'flex', gap: '16px' }}>
                          <label style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '10px', 
                            cursor: 'pointer', 
                            padding: '12px 16px', 
                            borderRadius: '12px',
                            background: (scannedForm.is_active === true || scannedForm.is_active === 1) ? 'rgba(0, 184, 148, 0.08)' : '#f8fafc',
                            border: (scannedForm.is_active === true || scannedForm.is_active === 1) ? '1.5px solid var(--success-color)' : '1.5px solid #edf2f7',
                            color: (scannedForm.is_active === true || scannedForm.is_active === 1) ? 'var(--success-color)' : 'var(--text-dark)',
                            flex: 1,
                            fontWeight: 700,
                            boxShadow: (scannedForm.is_active === true || scannedForm.is_active === 1) ? '0 4px 12px rgba(0, 184, 148, 0.1)' : 'none',
                            transition: 'all 0.2s ease'
                          }}>
                            <input 
                              type="radio" 
                              name="is_active_status" 
                              checked={scannedForm.is_active === true || scannedForm.is_active === 1}
                              onChange={() => setScannedForm({ ...scannedForm, is_active: true })}
                              style={{ 
                                width: '20px', 
                                height: '20px', 
                                cursor: 'pointer',
                                accentColor: 'var(--success-color)'
                              }}
                            />
                            <span>🟢 Aktif (Satışta)</span>
                          </label>

                          <label style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '10px', 
                            cursor: 'pointer', 
                            padding: '12px 16px', 
                            borderRadius: '12px',
                            background: (scannedForm.is_active === false || scannedForm.is_active === 0) ? 'rgba(214, 48, 49, 0.08)' : '#f8fafc',
                            border: (scannedForm.is_active === false || scannedForm.is_active === 0) ? '1.5px solid var(--danger-color)' : '1.5px solid #edf2f7',
                            color: (scannedForm.is_active === false || scannedForm.is_active === 0) ? 'var(--danger-color)' : 'var(--text-dark)',
                            flex: 1,
                            fontWeight: 700,
                            boxShadow: (scannedForm.is_active === false || scannedForm.is_active === 0) ? '0 4px 12px rgba(214, 48, 49, 0.1)' : 'none',
                            transition: 'all 0.2s ease'
                          }}>
                            <input 
                              type="radio" 
                              name="is_active_status" 
                              checked={scannedForm.is_active === false || scannedForm.is_active === 0}
                              onChange={() => setScannedForm({ ...scannedForm, is_active: false })}
                              style={{ 
                                width: '20px', 
                                height: '20px', 
                                cursor: 'pointer',
                                accentColor: 'var(--danger-color)'
                              }}
                            />
                            <span>🔴 Pasif (Satış Dışı)</span>
                          </label>
                        </div>
                      </div>

                      {/* SIFIR MALİYET KAMERA ENTEGRASYONU */}
                      <div className="form-group">
                        <label>Ürün Fotoğrafı Çek (Anlık Sıkıştırma)</label>
                        <div 
                          className="camera-capture-box" 
                          onClick={() => fileInputRef.current && fileInputRef.current.click()}
                          style={{ cursor: 'pointer' }}
                        >
                          {capturedImagePreview ? (
                            <img src={capturedImagePreview} alt="Önizleme" />
                          ) : scannedForm.image_url ? (
                            <img src={scannedForm.image_url} alt="Kayıtlı Görsel" />
                          ) : (
                            <span style={{ fontSize: '2rem' }}>📸</span>
                          )}
                          <span>{capturedImagePreview || scannedForm.image_url ? 'Fotoğrafı Değiştir' : 'Kamerayı Aç / Fotoğraf Seç'}</span>
                          <input 
                            type="file" 
                            ref={fileInputRef}
                            accept="image/*" 
                            style={{ display: 'none' }}
                            onChange={handleCameraCaptureChange}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          type="button" 
                          className="status-btn cancel"
                          style={{ flex: 1, padding: '12px' }}
                          onClick={() => {
                            setScannedBarcode('');
                            setCapturedImageFile(null);
                            setCapturedImagePreview(null);
                            setAdminTab('products');
                          }}
                        >
                          İptal Et
                        </button>
                        <button 
                          type="submit" 
                          className="checkout-submit-btn"
                          style={{ flex: 2, marginTop: 0 }}
                        >
                          {scannedProductExists ? '💾 Değişiklikleri Kaydet' : '💾 Yeni Ürünü Kaydet'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
