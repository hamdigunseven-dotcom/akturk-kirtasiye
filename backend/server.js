const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { dbQuery } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

// Gerekli klasörlerin varlığını kontrol et ve oluştur
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Aktürk Kırtasiye API başarıyla çalışıyor!' });
});

// Multer dosya yükleme ayarları (Geçici olarak bellekte tut, Sharp ile işleyip diske yazacağız)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Maksimum 10MB
});

// --- YÖNETİCİ AUTH MİMARİSİ ---
const adminAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token === 'admin-secret-session-token-12345') {
      return next();
    }
  }
  res.status(401).json({ error: 'Yetkisiz erişim. Lütfen admin şifresiyle giriş yapın.' });
};

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'Akturk123!';
  if (password === adminPassword) {
    res.json({ success: true, token: 'admin-secret-session-token-12345' });
  } else {
    res.status(401).json({ error: 'Geçersiz admin şifresi!' });
  }
});

// --- API ENDPOINT'LERİ ---

// 1. Kategorileri Getir
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await dbQuery.all('SELECT * FROM categories ORDER BY name ASC');
    res.json(categories);
  } catch (error) {
    console.error('Kategoriler getirilirken hata oluştu:', error);
    res.status(500).json({ error: 'Kategoriler yüklenemedi.' });
  }
});

// Kategori Ekle
app.post('/api/categories', adminAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Kategori adı gereklidir.' });
  }
  try {
    const result = await dbQuery.run('INSERT INTO categories (name) VALUES (?)', [name.trim()]);
    res.json({ id: result.id, name: name.trim() });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Bu kategori zaten mevcut.' });
    }
    console.error('Kategori eklenirken hata oluştu:', error);
    res.status(500).json({ error: 'Kategori eklenemedi.' });
  }
});

// 2. Müşteri İçin Aktif Ürünleri Listele
app.get('/api/products', async (req, res) => {
  const { category_id } = req.query;
  try {
    let sql = 'SELECT * FROM products WHERE is_active = 1';
    const params = [];
    
    if (category_id) {
      sql += ' AND category_id = ?';
      params.push(category_id);
    }
    
    sql += ' ORDER BY id DESC';
    const products = await dbQuery.all(sql, params);
    res.json(products);
  } catch (error) {
    console.error('Ürünler listelenirken hata oluştu:', error);
    res.status(500).json({ error: 'Ürünler yüklenemedi.' });
  }
});

// 3. Yönetici İçin Tüm Ürünleri Listele (Aktif/Pasif dahil)
app.get('/api/products/admin', adminAuth, async (req, res) => {
  try {
    const products = await dbQuery.all(`
      SELECT p.*, c.name as category_name 
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.id DESC
    `);
    res.json(products);
  } catch (error) {
    console.error('Yönetici ürün listesi hatası:', error);
    res.status(500).json({ error: 'Ürünler yüklenemedi.' });
  }
});

// 4. Barkod ile Ürün Sorgula (Trendpos Import sonrası taramada kullanmak için)
app.get('/api/products/barcode/:barcode', async (req, res) => {
  const { barcode } = req.params;
  try {
    const product = await dbQuery.get('SELECT * FROM products WHERE barcode = ?', [barcode.trim()]);
    if (!product) {
      return res.status(404).json({ error: 'Ürün bulunamadı.', notFound: true });
    }
    res.json(product);
  } catch (error) {
    console.error('Barkod sorgulama hatası:', error);
    res.status(500).json({ error: 'Barkod sorgulanırken hata oluştu.' });
  }
});

// 5. Ürün Ekle veya Güncelle
app.post('/api/products', adminAuth, async (req, res) => {
  const { barcode, title, description, price, stock_quantity, category_id, is_active } = req.body;
  
  if (!barcode || !title || price === undefined) {
    return res.status(400).json({ error: 'Barkod, Ürün Adı ve Fiyat zorunludur.' });
  }

  try {
    const query = `
      INSERT INTO products (barcode, title, description, price, stock_quantity, category_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await dbQuery.run(query, [
      barcode.trim(),
      title.trim(),
      description || '',
      price,
      stock_quantity || 0,
      category_id || null,
      is_active ? 1 : 0
    ]);
    
    res.status(201).json({ id: result.id, message: 'Ürün başarıyla eklendi.' });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Bu barkoda sahip bir ürün zaten kayıtlı.' });
    }
    console.error('Ürün ekleme hatası:', error);
    res.status(500).json({ error: 'Ürün eklenemedi.' });
  }
});

// Ürün Düzenle
app.put('/api/products/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { barcode, title, description, price, stock_quantity, category_id, is_active, image_url } = req.body;

  try {
    const query = `
      UPDATE products 
      SET barcode = ?, title = ?, description = ?, price = ?, stock_quantity = ?, category_id = ?, is_active = ?, image_url = ?
      WHERE id = ?
    `;
    await dbQuery.run(query, [
      barcode.trim(),
      title.trim(),
      description || '',
      price,
      stock_quantity || 0,
      category_id || null,
      is_active ? 1 : 0,
      image_url || null,
      id
    ]);
    
    res.json({ message: 'Ürün başarıyla güncellendi.' });
  } catch (error) {
    console.error('Ürün güncelleme hatası:', error);
    res.status(500).json({ error: 'Ürün güncellenemedi.' });
  }
});

// Ürünün Aktiflik Durumunu Değiştir
app.put('/api/products/:id/toggle-active', adminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const product = await dbQuery.get('SELECT is_active FROM products WHERE id = ?', [id]);
    if (!product) {
      return res.status(404).json({ error: 'Ürün bulunamadı.' });
    }
    const newActiveState = product.is_active === 1 ? 0 : 1;
    await dbQuery.run('UPDATE products SET is_active = ? WHERE id = ?', [newActiveState, id]);
    res.json({ success: true, is_active: newActiveState });
  } catch (error) {
    console.error('Ürün aktiflik toggle hatası:', error);
    res.status(500).json({ error: 'Ürün durumu güncellenemedi.' });
  }
});

// Ürün Sil (Resim dosyası dahil - sıfır şişme depolama)
app.delete('/api/products/:id', adminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const product = await dbQuery.get('SELECT id, image_url FROM products WHERE id = ?', [id]);
    if (!product) {
      return res.status(404).json({ error: 'Ürün bulunamadı.' });
    }
    
    if (product.image_url && product.image_url.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, product.image_url);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error('Resim dosyası silinirken hata:', err);
        }
      }
    }

    await dbQuery.run('DELETE FROM products WHERE id = ?', [id]);
    res.json({ success: true, message: 'Ürün başarıyla silindi.' });
  } catch (error) {
    console.error('Ürün silme hatası:', error);
    res.status(500).json({ error: 'Ürün silinemedi.' });
  }
});

// 6. Ürün Fotoğrafı Yükle & SHARP ile .webp formatında optimize et (SIFIR ŞİŞME)
app.post('/api/products/upload-image', adminAuth, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Fotoğraf gönderilmedi.' });
  }

  try {
    const filename = `img-${Date.now()}.webp`;
    const outputPath = path.join(uploadsDir, filename);

    // Sharp ile resmi optimize et: Maksimum 800px genişlik, 80 kalite, WebP formatı
    await sharp(req.file.buffer)
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(outputPath);

    const imageUrl = `/uploads/${filename}`;
    res.json({ image_url: imageUrl });
  } catch (error) {
    console.error('Resim işleme hatası (Sharp):', error);
    res.status(500).json({ error: 'Resim işlenirken ve kaydedilirken hata oluştu.' });
  }
});

// 7. Trendpos CSV Toplu Yükleme (Ürün İçe Aktarma)
app.post('/api/products/import-csv', adminAuth, upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'CSV dosyası yüklenmedi.' });
  }

  try {
    const csvData = req.file.buffer.toString('utf-8');
    const lines = csvData.split(/\r?\n/);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV dosyası boş veya geçersiz formatta.' });
    }

    // Başlık satırını analiz et
    const headers = lines[0].split(/[;,\t]/).map(h => h.trim().toLowerCase());
    
    // Sütun indekslerini tespit et (Barkod, Ürün Adı, Fiyat için alternatif isimleri destekle)
    const barcodeIdx = headers.findIndex(h => h.includes('barkod') || h.includes('barcode') || h.includes('kod') || h.includes('code'));
    const titleIdx = headers.findIndex(h => h.includes('ad') || h.includes('name') || h.includes('title') || h.includes('ürün') || h.includes('urun'));
    const priceIdx = headers.findIndex(h => h.includes('fiyat') || h.includes('price') || h.includes('tutar'));

    if (barcodeIdx === -1 || titleIdx === -1 || priceIdx === -1) {
      return res.status(400).json({ 
        error: 'CSV başlıkları algılanamadı. Dosyada "Barkod", "Ürün Adı" ve "Fiyat" sütunları bulunmalıdır.',
        headers
      });
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = line.split(/[;,\t]/).map(c => c.trim().replace(/^["']|["']$/g, '')); // Tırnakları temizle
      if (columns.length <= Math.max(barcodeIdx, titleIdx, priceIdx)) {
        skipped++;
        continue;
      }

      const barcode = columns[barcodeIdx];
      const title = columns[titleIdx];
      let priceStr = columns[priceIdx].replace(',', '.'); // Türkçe ondalık virgülünü noktaya çevir
      const price = parseFloat(priceStr);

      if (!barcode || !title || isNaN(price)) {
        skipped++;
        continue;
      }

      // SQLite üzerinde Upsert (Varsa güncelle, yoksa ekle)
      const existing = await dbQuery.get('SELECT id FROM products WHERE barcode = ?', [barcode]);
      
      if (existing) {
        await dbQuery.run(
          'UPDATE products SET title = ?, price = ? WHERE barcode = ?',
          [title, price, barcode]
        );
        updated++;
      } else {
        // CSV'den gelenler ilk başta fotoğrafsız ve açıklamasız olacağı için pasif yüklenebilir, 
        // ancak dükkan sahibi hızlıca bulabilsin diye is_active = 0 olarak açıyoruz
        await dbQuery.run(
          'INSERT INTO products (barcode, title, price, is_active) VALUES (?, ?, ?, 0)',
          [barcode, title, price]
        );
        inserted++;
      }
    }

    res.json({
      message: 'CSV aktarımı başarıyla tamamlandı.',
      summary: { inserted, updated, skipped }
    });

  } catch (error) {
    console.error('CSV Import hatası:', error);
    res.status(500).json({ error: 'CSV dosyası işlenirken hata oluştu.' });
  }
});

// 8. Müşteri Tarafından Sipariş Oluşturulması
app.post('/api/orders', async (req, res) => {
  const { customer_name, customer_phone, neighborhood, full_address, payment_method, total_amount, items } = req.body;

  if (!customer_name || !customer_phone || !neighborhood || !full_address || !payment_method || !items || items.length === 0) {
    return res.status(400).json({ error: 'Lütfen tüm sipariş ve iletişim bilgilerini eksiksiz girin.' });
  }

  try {
    // 1. Sipariş kaydını oluştur
    const orderResult = await dbQuery.run(`
      INSERT INTO orders (customer_name, customer_phone, neighborhood, full_address, payment_method, total_amount, order_status)
      VALUES (?, ?, ?, ?, ?, ?, 'Beklemede')
    `, [
      customer_name.trim(),
      customer_phone.trim(),
      neighborhood.trim(),
      full_address.trim(),
      payment_method,
      total_amount
    ]);

    const orderId = orderResult.id;

    // 2. Sipariş kalemlerini oluştur ve stok miktarını düşür (opsiyonel ama sağlıklı)
    for (const item of items) {
      await dbQuery.run(`
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?)
      `, [orderId, item.product_id, item.quantity, item.price]);

      // Stok düşürme işlemi
      await dbQuery.run(`
        UPDATE products 
        SET stock_quantity = MAX(0, stock_quantity - ?) 
        WHERE id = ?
      `, [item.quantity, item.product_id]);
    }

    res.status(201).json({
      order_id: orderId,
      message: 'Siparişiniz başarıyla alındı. Bu akşam kapınızdayız!'
    });

  } catch (error) {
    console.error('Sipariş oluşturma hatası:', error);
    res.status(500).json({ error: 'Sipariş oluşturulurken bir hata meydana geldi.' });
  }
});

// 8.5 Müşteri Tarafından Kendi Siparişinin İptal Edilmesi
app.post('/api/orders/:id/cancel-customer', async (req, res) => {
  const { id } = req.params;

  try {
    const order = await dbQuery.get('SELECT order_status FROM orders WHERE id = ?', [id]);
    
    if (!order) {
      return res.status(404).json({ error: 'Sipariş bulunamadı.' });
    }

    if (order.order_status !== 'Beklemede') {
      return res.status(400).json({ 
        error: `Bu sipariş şu an '${order.order_status}' durumunda olduğu için iptal edilemez. Lütfen dükkan ile iletişime geçin.` 
      });
    }

    // İptal durumuna al
    await dbQuery.run("UPDATE orders SET order_status = 'İptal' WHERE id = ?", [id]);

    // Stokları iade et
    const items = await dbQuery.all('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [id]);
    for (const item of items) {
      await dbQuery.run(`
        UPDATE products 
        SET stock_quantity = stock_quantity + ? 
        WHERE id = ?
      `, [item.quantity, item.product_id]);
    }

    res.json({ success: true, message: 'Siparişiniz başarıyla iptal edildi ve ürün stokları iade edildi.' });

  } catch (error) {
    console.error('Müşteri sipariş iptal hatası:', error);
    res.status(500).json({ error: 'Sipariş iptal edilirken sistemsel bir hata oluştu.' });
  }
});

// 9. Müşterinin Geçmiş Siparişlerini Sorgulaması (SMS OTP yerine Yerel Telefon Girişi)
app.get('/api/orders/history/:phone', async (req, res) => {
  const { phone } = req.params;
  try {
    const orders = await dbQuery.all(`
      SELECT * FROM orders 
      WHERE customer_phone = ? 
      ORDER BY id DESC
    `, [phone.trim()]);

    // Sipariş kalemlerini de ekleyerek gönderelim
    const ordersWithItems = [];
    for (const order of orders) {
      const items = await dbQuery.all(`
        SELECT oi.*, p.title as product_title, p.image_url 
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);
      
      ordersWithItems.push({
        ...order,
        items
      });
    }

    res.json(ordersWithItems);
  } catch (error) {
    console.error('Sipariş geçmişi getirme hatası:', error);
    res.status(500).json({ error: 'Sipariş geçmişi yüklenemedi.' });
  }
});

// 10. Akşam Dağıtım ve Lojistik Listesi (Özel Dağıtım Raporu)
// O gün (veya geçmiş günlerde kalıp teslim edilmemiş olan) saat 17:00 öncesi verilen ve
// 'Beklemede' veya 'Dağıtımda' olan siparişleri getirir.
app.get('/api/orders/logistics', adminAuth, async (req, res) => {
  try {
    // Dağıtılacak siparişler: 'Beklemede' veya 'Dağıtımda' olan siparişler.
    // Mahalle bazında sıralı gelmesi kuryenin dağıtım planı için kritiktir.
    const orders = await dbQuery.all(`
      SELECT * FROM orders 
      WHERE order_status IN ('Beklemede', 'Dağıtımda')
      ORDER BY neighborhood ASC, id ASC
    `);

    const ordersWithItems = [];
    for (const order of orders) {
      const items = await dbQuery.all(`
        SELECT oi.*, p.title as product_title, p.barcode
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);

      ordersWithItems.push({
        ...order,
        items
      });
    }

    res.json(ordersWithItems);
  } catch (error) {
    console.error('Lojistik sipariş listesi hatası:', error);
    res.status(500).json({ error: 'Lojistik verileri yüklenemedi.' });
  }
});

// 11. Sipariş Durumunu Güncelle (Kurye / Yönetici İçin)
app.put('/api/orders/:id/status', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Beklemede', 'Dağıtımda', 'Teslim Edildi', 'İptal'].includes(status)) {
    return res.status(400).json({ error: 'Geçersiz sipariş durumu.' });
  }

  try {
    await dbQuery.run('UPDATE orders SET order_status = ? WHERE id = ?', [status, id]);
    res.json({ message: `Sipariş durumu '${status}' olarak güncellendi.` });
  } catch (error) {
    console.error('Sipariş durum güncelleme hatası:', error);
    res.status(500).json({ error: 'Sipariş durumu güncellenemedi.' });
  }
});

// 12. Yönetici İçin Sipariş Arşivi ve Geçmişi (Teslim Edilen ve İptaller)
app.get('/api/orders/archive', adminAuth, async (req, res) => {
  try {
    const orders = await dbQuery.all(`
      SELECT * FROM orders 
      WHERE order_status IN ('Teslim Edildi', 'İptal')
      ORDER BY id DESC
    `);

    const ordersWithItems = [];
    for (const order of orders) {
      const items = await dbQuery.all(`
        SELECT oi.*, p.title as product_title, p.barcode
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);

      ordersWithItems.push({
        ...order,
        items
      });
    }

    res.json(ordersWithItems);
  } catch (error) {
    console.error('Arşiv sipariş listesi hatası:', error);
    res.status(500).json({ error: 'Arşiv verileri yüklenemedi.' });
  }
});

// Sunucuyu Başlat
app.listen(PORT, () => {
  console.log(`Kırtasiye API Sunucusu http://localhost:${PORT} portunda yayında!`);
});

