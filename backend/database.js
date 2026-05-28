const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'kirtasiye.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('SQLite veritabanı bağlantı hatası:', err);
  } else {
    console.log('SQLite veritabanı bağlantısı başarılı:', dbPath);
    initializeDatabase();
  }
});

// Callback tabanlı sqlite3 API'sini modern async/await vaatlerine (Promises) çeviren yardımcı nesne
const dbQuery = {
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  },
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  exec(sql) {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};

async function initializeDatabase() {
  try {
    // 1. Kategoriler tablosu
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )
    `);

    // 2. Ürünler tablosu
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        image_url TEXT,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        is_active BOOLEAN NOT NULL DEFAULT 0
      )
    `);
    
    // Barkod aramalarını hızlandırmak için indeks ekleyelim
    await dbQuery.run(`
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)
    `);

    // 3. Siparişler tablosu
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        neighborhood TEXT NOT NULL,
        full_address TEXT NOT NULL,
        payment_method TEXT CHECK(payment_method IN ('Nakit', 'POS')) NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        order_status TEXT CHECK(order_status IN ('Beklemede', 'Dağıtımda', 'Teslim Edildi', 'İptal')) NOT NULL DEFAULT 'Beklemede',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Sipariş Kalemleri tablosu
    await dbQuery.run(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL,
        price DECIMAL(10, 2) NOT NULL
      )
    `);

    console.log('Veritabanı tabloları kontrol edildi / başarıyla oluşturuldu.');

    // Örnek kategorileri yükleyelim (eğer yoksa)
    const categoryCount = await dbQuery.get('SELECT COUNT(*) as count FROM categories');
    if (categoryCount.count === 0) {
      const defaultCategories = [
        'Kırtasiye & Okul',
        'Defter & Kağıt Grubu',
        'Kalem & Yazı Gereçleri',
        'Resim & Boyama Malzemeleri',
        'Dosyalama & Arşiv',
        'Ofis İhtiyaçları',
        'Hobi & Sanatsal',
        'Oyuncak & Eğitici Kartlar'
      ];

      for (const catName of defaultCategories) {
        await dbQuery.run('INSERT INTO categories (name) VALUES (?)', [catName]);
      }
      console.log('Varsayılan kategoriler veritabanına yüklendi.');
    }
  } catch (error) {
    console.error('Veritabanı başlangıç hatası:', error);
  }
}

module.exports = {
  db,
  dbQuery
};
