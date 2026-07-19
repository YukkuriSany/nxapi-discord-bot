import 'dotenv/config';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events,
  AttachmentBuilder, GatewayIntentBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import QRCode from 'qrcode';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  completeLogin, deleteUserData, hasLoginSession, runNxapi, startLogin, userDataPath,
} from './nxapi.js';
import {
  getBattleSchedule, getEventSchedule, getFestSchedule, getSalmonSchedule,
} from './public-api.js';
import { downloadVideo } from './media.js';

if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKENを設定してください');

const allowedUsers = new Set(
  (process.env.ALLOWED_DISCORD_USER_IDS ?? '').split(',').map(v => v.trim()).filter(Boolean),
);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const pendingFriendRequests = new Map();

client.once(Events.ClientReady, ready => console.log(`${ready.user.tag} として起動しました`));

client.on(Events.InteractionCreate, async interaction => {
  if (!isAllowed(interaction)) return;
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton() && interaction.customId === 'nxapi_login_submit') await showLoginModal(interaction);
    else if (interaction.isButton() && interaction.customId.startsWith('friend_request:')) await confirmFriendRequest(interaction);
    else if (interaction.isModalSubmit() && interaction.customId === 'nxapi_login_modal') await handleLoginModal(interaction);
  } catch (error) {
    console.error(safeLog(error));
    const content = `⚠️ ${friendlyError(error)}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, components: [] });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
});

function isAllowed(interaction) {
  if (!allowedUsers.size || allowedUsers.has(interaction.user.id)) return true;
  interaction.reply({ content: 'このBotを利用する権限がありません。', flags: MessageFlags.Ephemeral }).catch(() => {});
  return false;
}

async function handleCommand(interaction) {
  const name = interaction.commandName;
  const supportsPublic = ['spla-user', 'spla-friends', 'nso-friends'].includes(name);
  const publicData = [
    'stages', 'salmon', 'event', 'fest', 'qr', 'twitter-video', 'youtube-video', 'account',
    'play-status', 'web-services', 'friend-code', 'friend-request', 'spla-profile',
    'spla-battles', 'spla-salmon-results', 'spla-fest-result',
  ].includes(name);
  const makePublic = publicData
    ? true
    : supportsPublic && interaction.options.getBoolean('public') === true;
  await interaction.deferReply(makePublic ? {} : { flags: MessageFlags.Ephemeral });

  if (name === 'login') {
    const url = await startLogin(interaction.user.id);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Nintendoでログイン')
        .setStyle(ButtonStyle.Link)
        .setURL(url),
      new ButtonBuilder()
        .setCustomId('nxapi_login_submit')
        .setLabel('認証URLを貼り付ける')
        .setStyle(ButtonStyle.Primary),
    );
    await interaction.editReply({
      content: [
        '🔒 この案内はあなたにしか見えません。',
        '1. 「Nintendoでログイン」を開きます。',
        '2. 「この人にする」を長押し(スマホ)または右クリック(PC)し、リンクをコピーします。',
        '3. 「認証URLを貼り付ける」を押してURLを送信します。',
        '認証操作は10分で失効します。',
      ].join('\n'),
      components: [row],
    });
  } else if (name === 'account') {
    const output = await runNxapi(['nso', 'user'], { userId: interaction.user.id });
    const data = parseNxapiUserOutput(output);
    await interaction.editReply({ embeds: [accountEmbed(data)] });
  } else if (name === 'logout') {
    await deleteUserData(interaction.user.id);
    await interaction.editReply('✅ アカウントは正しくログアウトされました　再ログインする場合は/loginが必要になります');
  } else if (name === 'nxapi-status') {
    const output = await runNxapi(['--version']);
    await interaction.editReply(`✅ Bot稼働中 / nxapi ${inline(output)}`);
  } else if (name === 'stages') {
    const mode = interaction.options.getString('mode', true);
    const data = mode === 'fest' ? await getFestSchedule() : await getBattleSchedule();
    const rotations = mode === 'fest' ? data.results : data.result?.[mode];
    await interaction.editReply({ embeds: [battleScheduleEmbed(rotations, mode, 3)] });
  } else if (name === 'salmon') {
    const data = await getSalmonSchedule();
    await interaction.editReply({ embeds: [salmonEmbed(data.results, 3)] });
  } else if (name === 'event') {
    const data = await getEventSchedule();
    await interaction.editReply({ embeds: [eventEmbed(data.results, 3)] });
  } else if (name === 'fest') {
    const data = await getFestSchedule();
    await interaction.editReply({ embeds: [battleScheduleEmbed(data.results, 'fest', 3)] });
  } else if (name === 'qr') {
    const text = interaction.options.getString('text', true);
    const image = await QRCode.toBuffer(text, {
      type: 'png', width: 768, margin: 2, errorCorrectionLevel: 'M',
    });
    await interaction.editReply({
      content: 'QRコードを生成しました。',
      files: [new AttachmentBuilder(image, { name: 'qrcode.png' })],
    });
  } else if (name === 'twitter-video' || name === 'youtube-video') {
    const service = name === 'twitter-video' ? 'twitter' : 'youtube';
    const video = await downloadVideo(
      interaction.options.getString('url', true),
      service,
      interaction.attachmentSizeLimit,
    );
    try {
      await interaction.editReply({
        content: '動画が取得できました',
        files: [new AttachmentBuilder(video.data, { name: video.name })],
      });
    } finally {
      await video.cleanup();
    }
  } else if (name === 'spla-user') {
    const output = await runNxapi(['splatnet3', 'user'], { userId: interaction.user.id });
    await interaction.editReply(codeBlock(output));
  } else if (name === 'spla-friends') {
    const data = await runNxapi(['splatnet3', 'friends'], { json: true, userId: interaction.user.id });
    await interaction.editReply({ embeds: [friendsEmbed(data, interaction.options.getInteger('limit') ?? 10, true)] });
  } else if (name === 'nso-friends') {
    const data = await runNxapi(['nso', 'friends'], { json: true, userId: interaction.user.id });
    await interaction.editReply({ embeds: [friendsEmbed(data, interaction.options.getInteger('limit') ?? 10, false)] });
  } else if (name === 'play-status') {
    const data = await runNxapi(['nso', 'friends'], { json: true, userId: interaction.user.id });
    await interaction.editReply({ embeds: [playStatusEmbed(data)] });
  } else if (name === 'web-services') {
    const data = await runNxapi(['nso', 'webservices'], { json: true, userId: interaction.user.id });
    await interaction.editReply({ embeds: [webServicesEmbed(data)] });
  } else if (name === 'friend-code') {
    const data = await runNxapi(['nso', 'friendcode'], { json: true, userId: interaction.user.id });
    const code = findFirstValue(data, ['friendCode', 'friend_code', 'code']);
    if (!code) throw new Error('フレンドコードを取得できませんでした');
    const normalized = normalizeFriendCode(code);
    const image = await QRCode.toBuffer(String(findFirstValue(data, ['url']) ?? normalized), { type: 'png', width: 512, margin: 2 });
    await interaction.editReply({
      content: `**フレンドコード**\n\`${normalized}\``,
      files: [new AttachmentBuilder(image, { name: 'friend-code.png' })],
    });
  } else if (name === 'friend-request') {
    const code = normalizeFriendCode(interaction.options.getString('code', true));
    const target = await runNxapi(['nso', 'lookup', code], { json: true, userId: interaction.user.id });
    const key = `${interaction.user.id}:${Date.now()}`;
    pendingFriendRequests.set(key, { userId: interaction.user.id, code, expires: Date.now() + 120000 });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(`friend_request:${key}`).setLabel('この相手に申請する').setStyle(ButtonStyle.Danger));
    await interaction.editReply({ embeds: [friendRequestEmbed(target, code)], components: [row] });
  } else if (name === 'spla-profile') {
    const output = await runNxapi(['splatnet3', 'user'], { userId: interaction.user.id });
    const data = parseInspectableOutput(output);
    await interaction.editReply({ embeds: [genericDataEmbed('SplatNet 3 プロフィール', data)] });
  } else if (name === 'spla-battles') {
    await runNxapi(['splatnet3', 'dump-results', '--battles'], { userId: interaction.user.id });
    const record = await loadLatestSplatnetRecord(interaction.user.id, 'battle');
    await interaction.editReply({ embeds: [battleResultEmbed(record)] });
  } else if (name === 'spla-salmon-results') {
    await runNxapi(['splatnet3', 'dump-results', '--coop'], { userId: interaction.user.id });
    const record = await loadLatestSplatnetRecord(interaction.user.id, 'salmon');
    await interaction.editReply({ embeds: [salmonResultEmbed(record)] });
  } else if (name === 'spla-fest-result') {
    const output = await runNxapi(['splatnet3', 'dump-fests'], { userId: interaction.user.id });
    await interaction.editReply({ embeds: [syncEmbed('フェス記録', output)] });
  }
}

const modeNames = {
  regular: 'レギュラーマッチ',
  bankara_challenge: 'バンカラマッチ（チャレンジ）',
  bankara_open: 'バンカラマッチ（オープン）',
  x: 'Xマッチ',
  fest: 'フェスマッチ',
};

function battleScheduleEmbed(rotations, mode, limit) {
  const list = uniqueRotations(rotations).slice(0, limit);
  const embed = publicEmbed(`${modeNames[mode] ?? mode} ステージ予定`, mode === 'fest' ? 0xff4f9a : 0x7cdb39);
  if (!list.length) {
    embed.setDescription(mode !== 'fest'
      ? '現在このモードの予定はありません。フェス開催中の場合は `/fest` を確認してください。'
      : '現在表示できるフェスマッチ予定はありません。');
    return embed;
  }
  for (const rotation of list) {
    const stages = rotation.stages?.map(stage => stage.name).join(' / ') ?? 'ステージ未定';
    const tricolor = rotation.is_tricolor && rotation.tricolor_stages?.length
      ? `\nトリカラ: ${rotation.tricolor_stages.map(stage => stage.name).join(' / ')}` : '';
    embed.addFields({
      name: formatTimeRange(rotation.start_time, rotation.end_time),
      value: `**${rotation.rule?.name ?? 'ルール未定'}**\n${stages}${tricolor}`,
    });
  }
  const image = list[0]?.stages?.[0]?.image;
  if (image) embed.setThumbnail(image);
  return embed;
}

function salmonEmbed(rotations, limit) {
  const list = uniqueRotations(rotations).slice(0, limit);
  const embed = publicEmbed('サーモンラン予定', 0xf28c28);
  if (!list.length) return embed.setDescription('現在表示できるサーモンラン予定はありません。');
  for (const rotation of list) {
    const weapons = rotation.weapons?.map(weapon => weapon.name).join(' / ') ?? 'ブキ未定';
    embed.addFields({
      name: formatTimeRange(rotation.start_time, rotation.end_time),
      value: [
        `**${rotation.is_big_run ? 'ビッグラン: ' : ''}${rotation.stage?.name ?? 'ステージ未定'}**`,
        `ブキ: ${weapons}`,
        rotation.boss?.name ? `オカシラ: ${rotation.boss.name}` : null,
      ].filter(Boolean).join('\n'),
    });
  }
  if (list[0]?.stage?.image) embed.setThumbnail(list[0].stage.image);
  return embed;
}

function eventEmbed(rotations, limit) {
  const list = uniqueRotations(rotations).slice(0, limit);
  const embed = publicEmbed('イベントマッチ予定', 0xa970ff);
  if (!list.length) return embed.setDescription('現在予定されているイベントマッチはありません。');
  for (const rotation of list) {
    embed.addFields({
      name: `${rotation.event?.name ?? 'イベントマッチ'}\n${formatTimeRange(rotation.start_time, rotation.end_time)}`,
      value: [
        rotation.event?.desc,
        rotation.rule?.name ? `ルール: ${rotation.rule.name}` : null,
        rotation.stages?.length ? `ステージ: ${rotation.stages.map(stage => stage.name).join(' / ')}` : null,
      ].filter(Boolean).join('\n').slice(0, 1024),
    });
  }
  return embed;
}

function publicEmbed(title, color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setURL('https://spla3.yuu26.com/')
    .setFooter({ text: 'データ提供: Spla3 API（非公式）' })
    .setTimestamp();
}

function formatTimeRange(start, end) {
  const startUnix = Math.floor(new Date(start).getTime() / 1000);
  const endUnix = Math.floor(new Date(end).getTime() / 1000);
  return `<t:${startUnix}:F> ～ <t:${endUnix}:t>`;
}

function uniqueRotations(rotations) {
  if (!Array.isArray(rotations)) return [];
  const seen = new Set();
  return rotations.filter(rotation => {
    const key = `${rotation.start_time}|${rotation.end_time}|${rotation.event?.id ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function showLoginModal(interaction) {
  if (!hasLoginSession(interaction.user.id)) {
    await interaction.reply({ content: 'ログイン操作が期限切れです。もう一度 /login を実行してください。', flags: MessageFlags.Ephemeral });
    return;
  }
  const input = new TextInputBuilder()
    .setCustomId('callback_url')
    .setLabel('「この人にする」からコピーしたURL')
    .setPlaceholder('npf71b963c1b7b6d119://auth#...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);
  const modal = new ModalBuilder()
    .setCustomId('nxapi_login_modal')
    .setTitle('Nintendoアカウント認証')
    .addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleLoginModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const callbackUrl = interaction.fields.getTextInputValue('callback_url');
  const result = await completeLogin(interaction.user.id, callbackUrl);
  await interaction.editReply(`✅ ${result}\n認証情報はあなた専用の領域へ保存されました。`);
}

function friendsEmbed(data, limit, splatoon) {
  const list = findArray(data).slice(0, limit);
  const lines = list.map((friend, index) => {
    const name = friend.playerName ?? friend.name ?? friend.nickname ?? `Friend ${index + 1}`;
    const state = splatoon
      ? friend.onlineState ?? friend.vsMode?.name ?? ''
      : friend.presence?.game?.name ? `プレイ中: ${friend.presence.game.name}` : friend.presence?.state ?? '';
    return `**${escapeMarkdown(String(name))}**${state ? ` — ${escapeMarkdown(String(state))}` : ''}`;
  });
  return new EmbedBuilder()
    .setColor(splatoon ? 0x6be34a : 0xe60012)
    .setTitle(splatoon ? 'Splatoon 3 フレンド' : 'Nintendo Switch フレンド')
    .setDescription(lines.join('\n') || '表示できるフレンドはいません。')
    .setFooter({ text: `${list.length}件表示` });
}

function accountEmbed(data) {
  const objects = collectObjects(data);
  const account = objects.find(value => value.country || value.language || value.region) ?? {};
  const switchUser = objects.find(value => value.nsaId || value.supportId || value.links?.friendCode
    || value.friendCode || (value.name && (value.imageUri || value.image2Uri))) ?? {};
  const friendCode = switchUser.links?.friendCode?.id
    ?? switchUser.links?.friendCode?.friendCode
    ?? switchUser.friendCode
    ?? null;
  const name = switchUser.name ?? 'Nintendo Switchユーザー';

  const embed = new EmbedBuilder()
    .setColor(0xe60012)
    .setTitle('Nintendoアカウント')
    .setDescription(`**${escapeMarkdown(String(name))}**`)
    .addFields(
      { name: 'Switchユーザー名', value: displayValue(switchUser.name), inline: true },
      { name: 'フレンドコード', value: friendCode ? `\`${normalizeFriendCode(friendCode)}\`` : '未取得', inline: false },
      { name: '国・地域', value: displayValue(account.country ?? account.region), inline: true },
      { name: '言語', value: displayValue(account.language), inline: true },
      { name: 'みまもり制限', value: switchUser.isChildRestricted === true ? 'あり' : switchUser.isChildRestricted === false ? 'なし' : '不明', inline: true },
    )
    .setFooter({ text: 'Nintendo Switchユーザー情報' })
    .setTimestamp();

  const icon = switchUser.imageUri ?? switchUser.image2Uri;
  if (typeof icon === 'string' && /^https:\/\//i.test(icon)) embed.setThumbnail(icon);
  return embed;
}

function parseNxapiUserOutput(output) {
  const text = String(output);
  const accountSection = text.match(/Nintendo Account\s*\{([\s\S]*?)(?=\n\}\s*\{|\nNintendo Switch user|$)/i)?.[1] ?? text;
  const switchSection = text.match(/Nintendo Switch user\s*\{([\s\S]*)/i)?.[1] ?? '';
  const read = (section, key) => {
    const match = section.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(?:'([^']*)'|"([^"]*)"|([^,\\n}]+))`, 'i'));
    if (!match) return null;
    const value = (match[1] ?? match[2] ?? match[3]).trim();
    if (value === 'null' || value === 'undefined') return null;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  };
  const friendCode = switchSection.match(/friendCode\s*:\s*\{[\s\S]*?(?:id|friendCode)\s*:\s*['"]([^'"]+)['"]/i)?.[1]
    ?? read(switchSection, 'friendCode');
  return {
    account: {
      country: read(accountSection, 'country'),
      region: read(accountSection, 'region'),
      language: read(accountSection, 'language'),
      iconUri: read(accountSection, 'iconUri'),
    },
    switchUser: {
      name: read(switchSection, 'name'),
      imageUri: read(switchSection, 'imageUri'),
      image2Uri: read(switchSection, 'image2Uri'),
      isChildRestricted: read(switchSection, 'isChildRestricted'),
      friendCode,
    },
  };
}

function parseInspectableOutput(output) {
  const result = {};
  const blocked = /token|secret|session|credential|email|birthday|supportId|correlation/i;
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(?:'([^']*)'|"([^"]*)"|([^,{}\[\]]+))\s*,?\s*$/);
    if (!match || blocked.test(match[1])) continue;
    const value = (match[2] ?? match[3] ?? match[4]).trim();
    if (!value || value === '[Object]' || value === 'null' || value === 'undefined') continue;
    if (!(match[1] in result)) result[match[1]] = value;
  }
  if (!Object.keys(result).length) result.status = 'プロフィールを取得しましたが、表示可能な項目がありませんでした';
  return result;
}

function playStatusEmbed(data) {
  const friends = findArray(data).slice(0, 25);
  const lines = friends.map((friend, index) => {
    const name = friend.name ?? friend.nickname ?? friend.playerName ?? `Friend ${index + 1}`;
    const game = friend.presence?.game?.name ?? friend.game?.name ?? friend.presence?.titleName;
    const state = friend.presence?.state ?? friend.onlineState ?? '不明';
    const updated = friend.presence?.updatedAt ?? friend.presence?.logoutAt;
    const time = updated ? ` / <t:${toUnix(updated)}:R>` : '';
    return `**${escapeMarkdown(String(name))}** — ${escapeMarkdown(String(game ?? state))}${time}`;
  });
  return new EmbedBuilder().setColor(0xe60012).setTitle('フレンドのプレイ状況')
    .setDescription(lines.join('\n').slice(0, 4096) || '表示できるフレンドがいません').setTimestamp();
}

function webServicesEmbed(data) {
  const services = findArray(data).slice(0, 25);
  const lines = services.map((service, index) => {
    const name = service.name ?? service.title ?? service.displayName ?? `サービス ${index + 1}`;
    return `• **${escapeMarkdown(String(name))}**`;
  });
  return new EmbedBuilder().setColor(0xe60012).setTitle('利用可能なWebサービス')
    .setDescription(lines.join('\n') || '利用可能なサービスがありません').setTimestamp();
}

function friendRequestEmbed(data, code) {
  const user = collectObjects(data).find(value => value.name || value.nickname) ?? {};
  const embed = new EmbedBuilder().setColor(0xf5a623).setTitle('フレンド申請の確認')
    .setDescription(`**${escapeMarkdown(String(user.name ?? user.nickname ?? 'ユーザー'))}**\n\`${code}\`\n\n下のボタンを押すと申請します。ボタンは実行者だけが使用できます。`)
    .setTimestamp();
  const icon = user.imageUri ?? user.iconUri;
  if (typeof icon === 'string' && /^https:\/\//i.test(icon)) embed.setThumbnail(icon);
  return embed;
}

async function confirmFriendRequest(interaction) {
  const key = interaction.customId.slice('friend_request:'.length);
  const pending = pendingFriendRequests.get(key);
  if (!pending || pending.expires < Date.now()) {
    pendingFriendRequests.delete(key);
    await interaction.reply({ content: 'この確認操作は期限切れです。もう一度 `/friend-request` を実行してください。', flags: MessageFlags.Ephemeral });
    return;
  }
  if (pending.userId !== interaction.user.id) {
    await interaction.reply({ content: 'この申請ボタンはコマンドを実行した本人だけが使用できます。', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  await runNxapi(['nso', 'add-friend', pending.code], { userId: interaction.user.id });
  pendingFriendRequests.delete(key);
  await interaction.editReply({ content: `✅ \`${pending.code}\` へフレンド申請を送信しました。`, embeds: [], components: [] });
}

function syncEmbed(label, output) {
  const detail = inline(output).slice(0, 1000);
  return new EmbedBuilder().setColor(0x6be34a).setTitle(`SplatNet 3 ${label}`)
    .setDescription(`✅ 最新データを取得しました${detail ? `\n\n${escapeMarkdown(detail)}` : ''}`).setTimestamp();
}

async function loadLatestSplatnetRecord(userId, type) {
  const root = path.join(userDataPath(userId), 'splatnet3');
  const files = await listJsonFiles(root);
  const patterns = type === 'battle'
    ? /battle|versus|vs[-_]?history/i
    : /coop|salmon|job/i;
  const candidates = files.filter(file => patterns.test(file)).slice(0, 80);
  let best = null;
  for (const file of candidates.length ? candidates : files.slice(0, 80)) {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      for (const object of collectObjects(data)) {
        const score = recordScore(object, type);
        if (score > (best?.score ?? 0)) best = { score, data: object };
      }
    } catch { /* nxapiの補助JSONや書き込み途中のファイルは無視 */ }
  }
  if (!best || best.score < 2) throw new Error('取得したデータから最新の戦績を読み取れませんでした');
  return best.data;
}

async function listJsonFiles(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(full);
    }
  }
  await walk(root);
  const dated = await Promise.all(found.map(async file => ({ file, mtime: (await stat(file)).mtimeMs })));
  return dated.sort((a, b) => b.mtime - a.mtime).map(item => item.file);
}

function recordScore(value, type) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const keys = new Set(Object.keys(value));
  const wanted = type === 'battle'
    ? ['judgement', 'vsRule', 'vsMode', 'myTeam', 'otherTeams', 'playedTime', 'awards']
    : ['coopStage', 'resultWave', 'jobScore', 'gradePoint', 'bossResult', 'playedTime', 'myResult'];
  return wanted.reduce((score, key) => score + (keys.has(key) ? 1 : 0), 0);
}

function battleResultEmbed(record) {
  const player = record.myTeam?.players?.find(item => item.isMyself) ?? record.myTeam?.players?.[0] ?? {};
  const result = player.result ?? record.result ?? {};
  const judgement = String(record.judgement ?? record.result?.judgement ?? 'UNKNOWN').toUpperCase();
  const won = judgement === 'WIN';
  const stage = record.vsStage?.name ?? record.stage?.name ?? '不明';
  const rule = record.vsRule?.name ?? record.rule?.name ?? '不明';
  const mode = record.vsMode?.name ?? record.mode?.name ?? '不明';
  const weapon = player.weapon?.name ?? '不明';
  const played = record.playedTime ? Math.floor(new Date(record.playedTime).getTime() / 1000) : null;
  const embed = new EmbedBuilder().setColor(won ? 0x61d836 : 0xf04444)
    .setTitle(`${won ? 'WIN' : judgement === 'LOSE' ? 'LOSE' : judgement} — ${rule}`)
    .addFields(
      { name: 'モード', value: displayValue(mode), inline: true },
      { name: 'ステージ', value: displayValue(stage), inline: true },
      { name: 'ブキ', value: displayValue(weapon), inline: true },
      { name: 'キル', value: String(result.kill ?? result.killCount ?? '不明'), inline: true },
      { name: 'デス', value: String(result.death ?? result.deathCount ?? '不明'), inline: true },
      { name: 'アシスト', value: String(result.assist ?? result.assistCount ?? '不明'), inline: true },
      { name: 'スペシャル', value: String(result.special ?? result.specialCount ?? '不明'), inline: true },
    ).setFooter({ text: 'SplatNet 3 最新バトル' }).setTimestamp();
  if (played && Number.isFinite(played)) embed.setDescription(`<t:${played}:F>（<t:${played}:R>）`);
  const image = record.vsStage?.image?.url ?? record.vsStage?.image;
  if (typeof image === 'string' && /^https:\/\//.test(image)) embed.setThumbnail(image);
  return embed;
}

function salmonResultEmbed(record) {
  const result = record.myResult ?? record.result ?? {};
  const stage = record.coopStage?.name ?? record.stage?.name ?? '不明';
  const clear = record.resultWave === 0 || record.resultWave === null || record.jobResult?.isClear === true;
  const played = record.playedTime ? Math.floor(new Date(record.playedTime).getTime() / 1000) : null;
  const embed = new EmbedBuilder().setColor(clear ? 0xf28c28 : 0x8b5a2b)
    .setTitle(`${clear ? 'クリア' : 'バイト終了'} — ${stage}`)
    .addFields(
      { name: '金イクラ', value: String(result.deliverCount ?? result.goldenDeliverCount ?? record.jobScore ?? '不明'), inline: true },
      { name: 'イクラ', value: String(result.goldenAssistCount ?? result.powerEggCount ?? '不明'), inline: true },
      { name: '救助', value: String(result.rescueCount ?? '不明'), inline: true },
      { name: '助けられた回数', value: String(result.rescuedCount ?? '不明'), inline: true },
      { name: '評価', value: String(record.grade?.name ?? record.gradePoint ?? '不明'), inline: true },
      { name: '到達WAVE', value: String(record.resultWave ?? 'クリア'), inline: true },
    ).setFooter({ text: 'SplatNet 3 最新バイト' }).setTimestamp();
  if (played && Number.isFinite(played)) embed.setDescription(`<t:${played}:F>（<t:${played}:R>）`);
  const image = record.coopStage?.image?.url ?? record.coopStage?.image;
  if (typeof image === 'string' && /^https:\/\//.test(image)) embed.setThumbnail(image);
  return embed;
}

function genericDataEmbed(title, data) {
  const entries = collectDisplayEntries(data).slice(0, 20);
  const description = entries.map(([key, value]) => `**${escapeMarkdown(key)}**\n${escapeMarkdown(value)}`).join('\n');
  return new EmbedBuilder().setColor(0xe60012).setTitle(title)
    .setDescription(description.slice(0, 4096) || '表示できる情報がありません').setTimestamp();
}

function collectDisplayEntries(value, prefix = '', found = []) {
  if (found.length >= 20 || value === null || value === undefined) return found;
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    const blocked = /token|secret|session|credential|email|birthday|supportid|correlation/i.test(prefix);
    if (!blocked && String(value).length <= 200) found.push([prefix || '値', String(value)]);
    return found;
  }
  if (Array.isArray(value)) {
    value.slice(0, 10).forEach((item, index) => collectDisplayEntries(item, `${prefix || '項目'} ${index + 1}`, found));
  } else if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectDisplayEntries(item, prefix ? `${prefix} / ${key}` : key, found));
  }
  return found;
}

function findFirstValue(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key) && ['string', 'number'].includes(typeof child)) return child;
    const found = findFirstValue(child, keys);
    if (found !== null) return found;
  }
  return null;
}

function toUnix(value) {
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : Math.floor(Date.now() / 1000);
}

function collectObjects(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (!Array.isArray(value)) found.push(value);
  for (const child of Object.values(value)) collectObjects(child, found);
  return found;
}

function displayValue(value) {
  return value === null || value === undefined || value === ''
    ? '未取得'
    : escapeMarkdown(String(value)).slice(0, 1024);
}

function normalizeFriendCode(value) {
  const text = String(value).trim();
  if (/^SW-/i.test(text)) return text.toUpperCase();
  const digits = text.replace(/\D/g, '');
  return digits.length === 12 ? `SW-${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}` : text;
}

function findArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['friends', 'result', 'data', 'nodes']) {
    const found = findArray(value[key]);
    if (found.length) return found;
  }
  return [];
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : '不明なエラーです';
  if (/Membership required error|status:\s*9450/i.test(message)) {
    return [
      'Nintendo Switch Onlineの加入権を確認できませんでした。',
      'このNintendoアカウントに紐づくSwitchユーザーが、個人プランまたはファミリープランの利用対象になっているか確認してください。',
      '加入直後の場合はSwitchでニンテンドーeショップまたは対応ゲームを一度起動してから、Botで `/logout` → `/login` を試してください。',
      '',
      'エラーコード: `9450 Membership required`',
    ].join('\n');
  }
  if (/Remote configuration prevents Coral authentication/i.test(message)) {
    return [
      '現在nxapi側でNintendo Switch Online認証が停止されています。Botや入力内容の問題ではありません。ログインと個人データ機能は現在利用できません。',
      '',
      `nxapiエラー: \`${sanitizeErrorForUser(message)}\``,
    ].join('\n');
  }
  if (/No token|no user|not authenticated|NintendoAccountToken\.undefined/i.test(message)) {
    return 'まだログインしていません。先に /login を実行してください。';
  }
  return inline(message.slice(0, 500));
}

function sanitizeErrorForUser(message) {
  return inline(message)
    .replace(/Session token\s+\S+/gi, 'Session token [REDACTED]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED]')
    .slice(0, 700);
}

function safeLog(error) {
  return inline(error instanceof Error ? error.message : String(error)).replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED]');
}
function inline(text) { return String(text).replaceAll('`', 'ˋ').replace(/\s+/g, ' ').trim(); }
function codeBlock(text) { return `\`\`\`text\n${String(text).replaceAll('```', 'ˋˋˋ').slice(0, 1900)}\n\`\`\``; }
function escapeMarkdown(text) { return text.replace(/[\\`*_{}\[\]()#+\-.!|>~]/g, '\\$&'); }

client.login(process.env.DISCORD_TOKEN);

