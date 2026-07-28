# Desktop Dashboard

Modern bir masaüstü dashboard uygulaması. Tauri, React ve TypeScript ile Windows için hazırlanmıştır.

## Özellikler

- Tek sütunlu modern dashboard arayüzü
- Todo listesi ve hızlı not alanı
- Yerel IndexedDB tabanlı veri saklama (SQLite benzeri yerel depolama katmanı)
- Koyu/açık tema desteği
- Modüler React bileşen yapısı
- TypeScript strict uyumlu yapı
- API/depolama işlemleri ayrı servis katmanında

## Kurulum

1. Node.js 20+ ve npm kurulu olmalıdır.
2. Bağımlılıkları yükleyin:

```bash
npm install
```

3. Geliştirme modunda çalıştırın:

```bash
npm run dev
```

## Üretim build

```bash
npm run build
```

## Not

Bu sürümde Windows başlangıçta otomatik başlatma ve kapatma konumunu hatırlama mantığı kurulum için hazır hale getirilmiştir. Windows için kurulum dosyası üretmek için Tauri paketleme adımları da hazırlanmıştır.

## Güvenlik ve gizlilik

- Geliştirme sunucusu yalnızca `127.0.0.1` üzerinden erişilebilir.
- Tauri WebView, Content Security Policy ile yalnızca kullanılan hava durumu ve döviz API'lerine bağlanabilir.
- Hava durumu sorgularında kesin konum yerine iki ondalık basamağa yuvarlanmış yaklaşık konum paylaşılır.
- Todo ve not verileri cihazdaki WebView IndexedDB alanında şifrelenmeden saklanır. Parola, API anahtarı veya başka hassas bilgiler kaydedilmemelidir.
- Todo başlıkları 200, notlar 10.000 karakter ile sınırlıdır.

Bağımlılık veya sürüm güncellemesinden sonra aşağıdaki kontroller çalıştırılmalıdır:

```bash
npm install
npm audit
npm run lint
npm run build
cargo generate-lockfile --manifest-path src-tauri/Cargo.toml
cargo audit
```

`package-lock.json` ve `src-tauri/Cargo.lock` dağıtımdan önce sürüm kontrolüne eklenmelidir.

## Windows kurulum dosyası oluşturma

Aşağıdaki komut ile NSIS ve MSI kurulumu üretilebilir:

```bash
npm run tauri build
```

Çıktı klasörü:

- src-tauri/target/release/bundle/nsis/
- src-tauri/target/release/bundle/msi/

Hazır Windows x64 yükleyicisi:

- `installer/Desktop-Dashboard-Setup-0.1.0-x64.exe`

Yükleyici mevcut kullanıcı hesabına kurulur. Kod imzalama sertifikası kullanılmadığı için Windows SmartScreen ilk çalıştırmada bilinmeyen yayıncı uyarısı gösterebilir.
