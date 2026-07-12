import 'dotenv/config';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events,
  AttachmentBuilder, GatewayIntentBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import QRCode from 'qrcode';
import {
  completeLogin, deleteUserData, hasLoginSession, runNxapi, startLogin,
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

client.once(Events.ClientReady, ready => console.log(`${ready.user.tag} として起動しました`));

client.on(Events.InteractionCreate, async interaction => {
  if (!isAllowed(interaction)) return;
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton() && interaction.customId === 'nxapi_login_submit') await showLoginModal(interaction);
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
  const publicData = ['stages', 'salmon', 'event', 'fest', 'qr', 'twitter-video', 'youtube-video'].includes(name);
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
        '2. 「この人にする」を長押しまたは右クリックし、リンクをコピーします。',
        '3. 「認証URLを貼り付ける」を押してURLを送信します。',
        '認証操作は10分で失効します。',
      ].join('\n'),
      components: [row],
    });
  } else if (name === 'account') {
    const output = await runNxapi(['nso', 'user'], { userId: interaction.user.id });
    await interaction.editReply(codeBlock(output));
  } else if (name === 'logout') {
    await deleteUserData(interaction.user.id);
    await interaction.editReply('✅ あなたのNintendo認証情報をBotから削除しました。');
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
        content: '権利を持つ動画、または保存が許可された動画に限って利用してください。',
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
  if (/Remote configuration prevents Coral authentication/i.test(message)) {
    return '現在nxapi側でNintendo Switch Online認証が停止されています。Botや入力内容の問題ではありません。nxapiがNintendo Switch Appの更新へ対応するまで、ログインと個人データ機能は利用できません。';
  }
  if (/No token|no user|not authenticated|NintendoAccountToken\.undefined/i.test(message)) {
    return 'まだログインしていません。先に /login を実行してください。';
  }
  return inline(message.slice(0, 500));
}

function safeLog(error) {
  return inline(error instanceof Error ? error.message : String(error)).replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED]');
}
function inline(text) { return String(text).replaceAll('`', 'ˋ').replace(/\s+/g, ' ').trim(); }
function codeBlock(text) { return `\`\`\`text\n${String(text).replaceAll('```', 'ˋˋˋ').slice(0, 1900)}\n\`\`\``; }
function escapeMarkdown(text) { return text.replace(/[\\`*_{}\[\]()#+\-.!|>~]/g, '\\$&'); }

client.login(process.env.DISCORD_TOKEN);
