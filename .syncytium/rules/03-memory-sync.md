---
title: "Antigravity ve OpenCode Ortak Hafıza ve Handoff Protokolü"
description: "SyncytiumMD ile IDE'ler arası ortak bağlam, kural ve hata takip standartları"
tags: ["syncytium", "antigravity", "opencode", "memory"]
---

# Ortak Hafıza ve Handoff Protokolü

1. **Tek Doğruluk Kaynağı (Single Source of Truth):**
   - Projenin ana hafızası ve kuralları yalnızca `.syncytium/` altında tutulur.
   - Her kural veya durum değişikliğinden sonra `syncytium sync` veya `npm run sync` çalıştırılarak tüm ajan dosyaları (`.gemini/antigravity/rules/`, `AGENT.md`, `CONVENTIONS.md`) güncellenir.

2. **İki IDE Arasında Hata Tespiti ve Onarım (Cross-IDE Debugging):**
   - OpenCode'da çalışan geliştirici bir hata veya eksik tespit ettiğinde `.syncytium/HANDOFF.md` içindeki `Known Issues` bölümüne ekler veya `syncytium handoff` çalıştırır.
   - Antigravity bu değişikliği `.gemini/antigravity/rules/handoff.md` üzerinden doğrudan okur ve aynı bağlam üzerinden hatayı onarır.
   - Onarım tamamlandığında handoff dosyası güncellenip sync edilir.

3. **Otomatik Senkronizasyon:**
   - Geliştirme sırasında `syncytium watch` arka planda çalıştırılarak `.syncytium/` değişiklikleri anında Antigravity ve OpenCode dosyalarına aktarılır.
