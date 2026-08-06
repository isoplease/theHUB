# theHUB V2 Windows Installer

`theHUB-Setup-2.1.1-x64.exe`, Windows 10/11 x64 için mevcut kullanıcı hesabına kurulan NSIS yükleyicisidir.

## Kurulum

1. EXE dosyasını hedef bilgisayara kopyalayın.
2. Dosyaya çift tıklayın ve kurulum adımlarını tamamlayın.
3. Microsoft Edge WebView2 hedef bilgisayarda yoksa yükleyici internet üzerinden sessizce kurar.

Kaldırıcı, uygulamanın Windows Startup klasöründe oluşturduğu `theHUB.cmd` dosyasını ve önceki sürümden kalabilecek `desktop-dashboard.cmd` dosyasını da siler.
Windows Program Ekle/Kaldır ekranındaki yayıncı alanı `isoplease` olarak ayarlanmıştır.

Dosya ticari bir kod imzalama sertifikasıyla imzalanmamıştır. Bu nedenle Windows SmartScreen ilk çalıştırmada bilinmeyen yayıncı uyarısı gösterebilir.

SHA-256:

```text
489A103E30A2B5CA101A6552D229C2524617779861F433D4D5BDED8AAD3061F9
```
