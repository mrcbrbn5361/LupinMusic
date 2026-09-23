# 🤝 Syncytium Active Handoff State

> **Proje:** Lupin Music  
> **Tarih:** 2026-09-23  
> **Aktif Görev:** Playback AudioEngine & Discord RPC derin revizyonu  
> **Son Durum:** YouTube Music AudioEngine ve Discord RPC baştan sona profesyonel seviyeye çıkarıldı.

---

## 🎯 Tamamlanan Geliştirmeler & Çözülen Sorunlar
1. [x] **Discord RPC (Rich Presence) Tamir Edildi:**
   - Client ID: `1547602880427724841` olarak güncellendi.
   - Discord kapalıyken veya sonradan açıldığında 15 saniyelik otomatik bağlanma/yoklama döngüsü eklendi.
   - `type: 2` (Listening to / Dinliyor) desteği eklendi.
   - Şarkı kapakları (HTTPS URL) ve süre scrubber'ı (`startTimestamp`, `endTimestamp`) entegre edildi.
   - Kullanıcıya açıklama: Discord profilinde şarkının görünmesi için **bot açmaya kesinlikle gerek yoktur** (yerel IPC bağlantısı).
2. [x] **Discord Bot Guild ID & Env Güncellemesi:**
   - Kullanıcının belirttiği `DISCORD_GUILD_ID=706827379510607893` ve `DISCORD_CLIENT_ID=1547602880427724841` değerleri `scripts/discord-bot/.env` dosyasına işlendi.
3. [x] **AudioEngine Playback & "Akış Alınamadı / 0:00" Hatası Çözüldü:**
   - Electron başlatma bayraklarına `disable-blink-features: AutomationControlled`, `autoplay-policy: no-user-gesture-required`, `disable-background-timer-throttling` eklendi.
   - YouTube Google Cookie Consent engelini kökten kaldırmak için `SOCS` onay çerezi ve `Sec-CH-UA` Client Hints başlıkları eklendi.
   - `AudioEngine.play`: Açık pencere varsa `movie_player.loadVideoById(id)` çağrılarak **100ms içinde anında** sıfır yeniden yükleme ile şarkı geçişi sağlandı.
   - Shadow DOM derin taraması (`RESOLVE_MEDIA_JS`) ile Web Components içindeki `movie_player` ve `<video>` yakalanarak süre/konumun `0:00` kalması engellendi.
   - Reklam engelleme ve atlama nöbetçisi (`skipAd`, `adPlacements` silme) aktif hale getirildi.
4. [x] **Renderer Arayüz Düzeltmeleri:**
   - Geçici bekleme sırasında şarkıların kontrolsüzce arka arkaya atlanmasına neden olan agresif auto-skip döngüsü düzeltildi.
   - Yanlış tetiklenen `track-ended` (`playerState === 0`) olayı şarkının ilk 3 saniyesinde filtrelendi.

---

## 💡 İki IDE İçin Geliştirici Notları
- **OpenCode Tarafı:** `AGENT.md` dosyasını ana talimat olarak kullanır. Bir hata bulunduğunda bu dosyaya veya `.syncytium/handoff.md` dosyasına not düşebilir.
- **Antigravity Tarafı:** `.gemini/antigravity/rules/` kurallarını ve `handoff.md` dosyasını otomatik olarak takip eder.
- Hafıza güncellemesi yapıldığında `npm run sync` çalıştırılarak her iki IDE'nin bağlamı anında eşitlenir.
