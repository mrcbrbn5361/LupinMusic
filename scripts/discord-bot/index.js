const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  AttachmentBuilder,
  PermissionsBitField
} = require('discord.js');
require('dotenv').config();
const { renderPlayerCard } = require('./cardRenderer');

const TOKEN = process.env.DISCORD_TOKEN;
const LUPIN_APP_ID = process.env.DISCORD_CLIENT_ID || '1552301617938825216';
const LUPIN_GUILD_ID = process.env.DISCORD_GUILD_ID || '706827379510607893';
const LUPIN_INVITE_URL = process.env.DISCORD_INVITE_URL || 'https://discord.gg/Rma8w8JrQH';

// Anti-Spam Cooldown
const cooldowns = new Map();
const COOLDOWN_MS = 3000;

// Gateway Intents
const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildPresences,
  GatewayIntentBits.GuildMembers
];

const client = new Client({ intents: INTENTS });

// Yerel Port 9863 REST API'den canlı şarkı durumunu çekme
async function fetchLocalLupinState() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://127.0.0.1:9863/api/v1/state', {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data && (data.track || data.status === 'playing')) {
        return data;
      }
    }
  } catch (e) {
    // Local API not responding or desktop app closed
  }
  return null;
}

// iTunes API üzerinden öneri şarkıları çekme
async function fetchSuggestions(artist, currentTitle) {
  const fallback = [
    { title: 'Lupin Midnight Melodies', artist: artist || 'Lupin Music' },
    { title: 'Neon Cyber Lounge', artist: 'Cyberpunk' },
    { title: 'Obsidian Velvet', artist: 'Synthpop' }
  ];

  if (!artist || artist === 'Bilinmeyen Sanatçı') return fallback;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=song&limit=6`, {
      signal: controller.signal
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const results = (data.results || [])
        .filter(x => !currentTitle || x.trackName.toLowerCase() !== currentTitle.toLowerCase())
        .slice(0, 3)
        .map(x => ({
          title: x.trackName,
          artist: x.artistName
        }));

      if (results.length === 3) return results;
      if (results.length > 0) {
        while (results.length < 3) results.push(fallback[results.length]);
        return results;
      }
    }
  } catch (e) {}

  return fallback;
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`\n========================================`);
  console.log(`💜 Lupin Music Discord Botu Aktif: ${readyClient.user.tag}`);
  console.log(`🎵 Ana Komut: lupin.music (veya .lupin)`);
  console.log(`📡 Port 9863 Yerel Köprü: Aktif`);
  console.log(`========================================\n`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim().toLowerCase();
  const isLupinCmd = content === 'lupin.music' ||
                     content.startsWith('lupin.music ') ||
                     content === '.lupin' ||
                     content === '.lupin.music' ||
                     content === '!lupin';

  if (!isLupinCmd) return;

  console.log(`[Lupin Bot] Komut alındı: "${message.content}" | Kullanıcı: ${message.author.tag}`);

  // Guild filter (if set in .env)
  if (LUPIN_GUILD_ID && message.guild && message.guild.id !== LUPIN_GUILD_ID) {
    return;
  }

  // Anti-Spam Rate Limit
  const now = Date.now();
  const userCooldown = cooldowns.get(message.author.id);
  if (userCooldown && now < userCooldown) {
    const remaining = Math.ceil((userCooldown - now) / 1000);
    try {
      const warn = await message.reply(`⏳ Çok hızlısın! Lütfen **${remaining}** saniye sonra tekrar dene.`);
      setTimeout(() => { try { warn.delete(); } catch (e) {} }, 2500);
    } catch (e) {}
    return;
  }
  cooldowns.set(message.author.id, now + COOLDOWN_MS);

  // Permission check
  if (message.guild && message.channel && message.guild.members?.me) {
    try {
      const perms = message.channel.permissionsFor(message.guild.members.me);
      if (perms && !perms.has(PermissionsBitField.Flags.SendMessages)) {
        return;
      }
    } catch (e) {}
  }

  // 1. ÖNCELİK: Yerel Port 9863 REST API
  const localState = await fetchLocalLupinState();

  // 2. ÖNCELİK: Discord Gateway Presence (Lupin RPC)
  let member = message.member;
  if (!member?.presence && message.guild) {
    try {
      member = await message.guild.members.fetch({ user: message.author.id, withPresences: true, force: true });
    } catch (err) {}
  }

  const activities = member?.presence?.activities || [];
  const activity = activities.find(a => 
    (a.applicationId && String(a.applicationId) === String(LUPIN_APP_ID)) ||
    (a.name && (
      a.name.toLowerCase().includes('lupin') ||
      a.name.toLowerCase() === 'music'
    ))
  );

  let trackInfo = null;

  if (localState && localState.track) {
    trackInfo = {
      title: localState.track.title,
      artist: localState.track.artist,
      album: localState.track.album || 'Lupin Music',
      coverUrl: localState.track.thumbnail || null,
      currentSec: localState.currentTime || 0,
      durationSec: localState.duration || localState.track.duration || 0
    };
  } else if (activity) {
    const elapsed = activity.timestamps?.start ? Math.max(0, (Date.now() - activity.timestamps.start) / 1000) : 0;
    const dur = (activity.timestamps?.end && activity.timestamps?.start) ? (activity.timestamps.end - activity.timestamps.start) / 1000 : 0;
    trackInfo = {
      title: activity.details || 'Bilinmeyen Parça',
      artist: activity.state ? activity.state.replace(/^by\s+/i, '') : 'Lupin Music',
      album: 'Lupin Music',
      coverUrl: activity.assets?.largeImageURL?.() || null,
      currentSec: elapsed,
      durationSec: dur
    };
  }

  // Eğer hiçbir yerde çalan şarkı bulunamadıysa
  if (!trackInfo) {
    const notPlayingEmbed = new EmbedBuilder()
      .setColor('#ec4899')
      .setTitle('🎵 Aktif Şarkı Bulunamadı')
      .setDescription(
        `Hey <@${message.author.id}>, şu anda **Lupin Music** üzerinde dinlediğin bir şarkı tespit edilemedi!\n\n` +
        `**Nasıl Çalışır?**\n` +
        `1. Bilgisayarında **Lupin Music** masaüstü uygulamasını aç.\n` +
        `2. Ayarlar menüsünden **Discord RPC** seçeneğinin açık olduğundan emin ol.\n` +
        `3. İstediğin bir şarkıyı çal ve bu kanala tekrar **\`lupin.music\`** yaz!\n\n` +
        `💡 *İpucu: Uygulama açıkken Port 9863 yerel köprüsü sayesinde çalan parçan otomatik algılanır.*`
      )
      .setFooter({ text: 'Lupin Music • Luxury Audio Engine', iconURL: client.user.displayAvatarURL() });

    try {
      await message.reply({ embeds: [notPlayingEmbed] });
    } catch (e) {
      console.error('[Lupin Bot] Reply error:', e);
    }
    return;
  }

  // Dinamik öneriler
  const suggestions = await fetchSuggestions(trackInfo.artist, trackInfo.title);

  // Kart Oluşturma (Canvas)
  try {
    const cardBuffer = await renderPlayerCard({
      title: trackInfo.title,
      artist: trackInfo.artist,
      album: trackInfo.album,
      coverUrl: trackInfo.coverUrl,
      currentSec: trackInfo.currentSec,
      durationSec: trackInfo.durationSec,
      username: message.author.username,
      suggestions
    });

    const attachment = new AttachmentBuilder(cardBuffer, { name: 'lupin-now-playing.png' });

    // Butonlar
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('💜 Discord Sunucusu')
        .setStyle(ButtonStyle.Link)
        .setURL(LUPIN_INVITE_URL),
      new ButtonBuilder()
        .setLabel('🎵 Lupin Masaüstü')
        .setStyle(ButtonStyle.Link)
        .setURL('https://github.com/mrcbrbn5361'),
      new ButtonBuilder()
        .setCustomId('btn_lupin_refresh')
        .setLabel('🔄 Yenile')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.reply({
      files: [attachment],
      components: [row]
    });
  } catch (err) {
    console.error('[Lupin Bot] Kart render hatası:', err);
    await message.reply(`🎵 **Şu anda dinleniyor:** **${trackInfo.title}** - *${trackInfo.artist}*`);
  }
});

// Interactive Button Interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'btn_lupin_refresh') {
    await interaction.reply({
      content: '🔄 Şarkı durumu güncelleniyor! Tekrar **`lupin.music`** yazarak en güncel kartı alabilirsin.',
      ephemeral: true
    });
  }
});

if (TOKEN) {
  client.login(TOKEN).catch(err => {
    console.warn('[Lupin Bot] Discord login error (TOKEN geçersiz veya eksik olabilir):', err.message);
  });
} else {
  console.log('[Lupin Bot] DISCORD_TOKEN tanımlanmadı. Botu başlatmak için .env dosyasına DISCORD_TOKEN ekleyin.');
}

module.exports = { client };
