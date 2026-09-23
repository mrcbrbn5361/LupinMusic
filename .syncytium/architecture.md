# 🏛️ Lupin Music — Sistem Mimarisi (Architecture)

## 1. Genel Bakış
Lupin Music, Windows ve macOS için tasarlanmış yüksek performanslı, ultra lüks neon mor/pembe temalı bir müzik akış ve masaüstü oynatıcı platformudur. Aquality Music'in temel felsefesini devralıp, InnerTube stream akışlarını ve yerel bot köprüsünü sıfır kırılganlıkla çalışacak şekilde modernize etmiştir.

## 2. Teknoloji Yığını
- **Masaüstü Motoru:** Electron (Node.js 20+, ContextIsolation, Güvenli Preload)
- **Arayüz (Renderer):** Vite + React / Modern TS, CSS Glassmorphism, Web Audio API Ekolayzır
- **Görsel Dil:** Neon Magenta (`#ec4899`, `#f43f5e`), Neon Violet (`#a855f7`, `#8b5cf6`), Deep Obsidian (`#090214`)
- **Ses & Akış Kaynağı:** YouTube Music InnerTube Entegrasyonu (Gelişmiş clientVersion 1.2025+, fallback stream resolver)
- **Yerel Bot Köprüsü:** Port 9863 HTTP REST API (`/api/v1/state`, `/api/v1/playback`)
- **Discord Entegrasyonu:**
  - Masaüstü: `discord-rpc` Rich Presence entegrasyonu
  - Discord Botu: `lupin.music` komutu, Canvas ile dinamik mor neon oynatıcı kartı render motoru
- **Ortak Ajan Hafızası:** SyncytiumMD (Antigravity + OpenCode çift yönlü senkronizasyon)

## 3. Veri Akış Şeması
```
[YouTube Music / InnerTube]
           │ (Audio Stream & Metadata)
           ▼
[Electron Main Process] ──(IPC / contextBridge)── [Renderer (React/Vite UI)]
           │
           ├─► [Yerel REST API: Port 9863 (/api/v1/state)]
           │            ▲
           │            │ (HTTP Fetch)
           │     [Discord Bot (lupin.music)] ──► [Discord Kanalları / Kart Render]
           │
           └─► [Discord RPC IPC] ──► [Kullanıcı Discord Profili]
```
