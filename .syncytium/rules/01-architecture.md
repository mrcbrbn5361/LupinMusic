---
title: "Lupin Music Mimari ve Güvenlik Standartları"
description: "Electron ve TypeScript mimarisi, IPC güvenliği, stream çözümleme standartları"
tags: ["architecture", "electron", "security", "stream"]
---

# Mimari ve Güvenlik Standartları

1. **Context Isolation & Preload:**
   - Renderer sürecinde doğrudan `nodeIntegration: false`, `contextIsolation: true` zorunludur.
   - Tüm iletişim `src/main/preload.ts` üzerinden `window.api` ile tip korumalı IPC kanallarıyla yürütülür.

2. **Dış Bağlantı Güvenliği:**
   - Harici bağlantılar (`shell.openExternal`) mutlaka güvenli URL doğrulamasından geçirilmelidir (`isSafeExternalUrl`).
   - `javascript:`, `file:`, `data:` gibi tehlikeli protokollere izin verilmez.

3. **Stream Çözümleme ve Dayanıklılık:**
   - YouTube Music InnerTube isteklerinde güncel client sürümü (`1.20250801.00.00`+) kullanılır.
   - Doğrudan URL düşmesi durumunda ses segmenti fallback mekanizması devreye girer.

4. **Yerel Bot API (Port 9863):**
   - Yerel HTTP sunucusu port 9863'te çalışır.
   - Oynatılan şarkı bilgisi, ilerleme yüzdesi, süre ve ses seviyesi `/api/v1/state` endpoint'inde JSON olarak sunulur.
   - Çakışma durumunda (EADDRINUSE) temiz hata yakalama ve otomatik port yönetimi sağlanır.
