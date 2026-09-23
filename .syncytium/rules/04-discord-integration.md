---
title: "Discord Bot (lupin.music) ve Discord RPC Entegrasyonu"
description: "Discord üzerinde lupin.music komutu, port 9863 REST API ve Canvas kart render motoru"
tags: ["discord", "rpc", "bot", "canvas"]
---

# Discord Bot ve RPC Entegrasyonu

1. **`lupin.music` Komutu:**
   - Discord sunucularında veya DM'de kullanıcı `lupin.music` (veya `.lupin`) yazdığında bot tetiklenir.
   - Bot, öncelikle Discord kullanıcısının Gateway Presence (Lupin RPC) aktivitesine bakar.
   - Eğer presence kapalıysa veya yerel moddaysa, `http://127.0.0.1:9863/api/v1/state` endpoint'inden canlı şarkı verisini çeker.

2. **Görsel Oynatıcı Kartı (Canvas Player Card):**
   - `@napi-rs/canvas` ile mor neon parıltılı, koyu obsidian gradyanlı, Lupin mühür logolu ve şarkı kapaklı 1200x500 lüks kart üretilir.
   - Şarkı adı, sanatçı, geçen süre, toplam süre ve dinamik neon ilerleme çubuğu kart üzerine işlenir.

3. **Masaüstü Discord RPC:**
   - Masaüstü uygulaması `discord-rpc` kütüphanesini kullanarak şarkı çalarken kullanıcının Discord profilinde Rich Presence gösterir.
   - Durum bilgisi şarkı değiştiğinde veya duraklatıldığında anında güncellenir.
