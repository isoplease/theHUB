# theHUB V2

Tauri, React, TypeScript ve Tailwind CSS ile Windows için hazırlanmış yerel masaüstü dashboard uygulaması.

## Özellikler

- Görevler, görev geçmişi, takvim ve günlük/haftalık/aylık/yıllık görsel otomasyonlar
- İşaretleme renkleri ve ayarlanabilir yüksekliği bulunan Hızlı Not alanı
- Standart ve bilimsel modlu hesap makinesi ile kalıcı hesaplama geçmişi
- Aynı kartta kronometre ve 24 saatlik zamanlayıcı
- Koyu/açık tema, özel renkler, arka plan şeffaflığı ve isteğe bağlı çerçevesiz pencere
- System Tray çalışma biçimi, pencere konumunu hatırlama ve Windows başlangıcında otomatik açılma
- Görev hatırlatıcıları için yerel Windows bildirimleri
- IndexedDB tabanlı cihaz içi veri saklama

## Geliştirme

Node.js 20+ ve npm gereklidir.

```bash
npm install
npm run dev
```

Üretim web derlemesi:

```bash
npm run build
```

Kontroller:

```bash
npm audit
npm run lint
npm test
cargo audit --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --all-targets -- -D warnings
```

## Güvenlik ve gizlilik

- Geliştirme sunucusu yalnızca `127.0.0.1` üzerinde çalışır.
- Tauri Content Security Policy dış ağ bağlantılarını engeller.
- Görev ve not verileri cihazdaki WebView depolama alanında şifrelenmeden tutulur. Parola, API anahtarı veya başka hassas bilgiler kaydedilmemelidir.
- Görev başlıkları 200, notlar 10.000 karakter ile sınırlıdır.
- `package-lock.json` ve `src-tauri/Cargo.lock` dağıtımdan önce sürüm kontrolüne eklenmelidir.

## Windows yükleyicisi

Yalnızca NSIS `.exe` paketi üretmek için:

```bash
npm run tauri -- build --bundles nsis
```

Yeni adla üretilecek Windows 10/11 x64 yükleyicisi:

- `installer/theHUB-Setup-2.1.1-x64.exe`

Yükleyici mevcut kullanıcı hesabına kurulur. Kaldırıcı, uygulamanın oluşturduğu `theHUB.cmd` başlangıç dosyasını ve önceki sürümden kalabilecek `desktop-dashboard.cmd` dosyasını temizler. Kod imzalama sertifikası kullanılmadığı için Windows SmartScreen ilk çalıştırmada bilinmeyen yayıncı uyarısı gösterebilir.

## Font lisansı

Hesap makinesi ve zaman araçları ekranında `fonts` klasöründeki DS-Digital fontu kullanılır. Fontun shareware koşulları [fonts/DIGITAL.TXT](fonts/DIGITAL.TXT) dosyasında yer alır; dağıtım türünüze uygun lisans koşullarını değerlendirin.
