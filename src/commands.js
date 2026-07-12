import { SlashCommandBuilder } from 'discord.js';

const visibilityOption = option => option
  .setName('public')
  .setDescription('チャンネル全体へ公開します（既定は本人のみ）');

export const commands = [
  new SlashCommandBuilder()
    .setName('login')
    .setDescription('Nintendoアカウントへ非公開でログインします'),
  new SlashCommandBuilder()
    .setName('account')
    .setDescription('自分のNintendoアカウントのログイン状態を確認します'),
  new SlashCommandBuilder()
    .setName('logout')
    .setDescription('自分のNintendo認証情報をこのBotから削除します'),
  new SlashCommandBuilder()
    .setName('nxapi-status')
    .setDescription('Botとnxapiの稼働状態を確認します'),
  new SlashCommandBuilder()
    .setName('stages')
    .setDescription('バトルのステージ予定を表示します')
    .addStringOption(option => option
      .setName('mode')
      .setDescription('表示するモード')
      .setRequired(true)
      .addChoices(
        { name: 'レギュラーマッチ', value: 'regular' },
        { name: 'バンカラマッチ（チャレンジ）', value: 'bankara_challenge' },
        { name: 'バンカラマッチ（オープン）', value: 'bankara_open' },
        { name: 'Xマッチ', value: 'x' },
        { name: 'フェスマッチ', value: 'fest' },
      )),
  new SlashCommandBuilder()
    .setName('salmon')
    .setDescription('サーモンラン予定を表示します'),
  new SlashCommandBuilder()
    .setName('event')
    .setDescription('イベントマッチ予定を表示します'),
  new SlashCommandBuilder()
    .setName('fest')
    .setDescription('フェスマッチ予定を表示します'),
  new SlashCommandBuilder()
    .setName('qr')
    .setDescription('文字列やURLからQRコードを生成します')
    .addStringOption(option => option
      .setName('text').setDescription('QRコードに埋め込む内容').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder()
    .setName('twitter-video')
    .setDescription('保存が許可されたX/Twitter動画を取得します')
    .addStringOption(option => option
      .setName('url').setDescription('X/Twitter投稿のURL').setRequired(true)),
  new SlashCommandBuilder()
    .setName('youtube-video')
    .setDescription('保存が許可されたYouTube動画を取得します')
    .addStringOption(option => option
      .setName('url').setDescription('YouTube動画のURL').setRequired(true)),
  new SlashCommandBuilder()
    .setName('spla-user')
    .setDescription('SplatNet 3の自分のプロフィールを表示します')
    .addBooleanOption(visibilityOption),
  new SlashCommandBuilder()
    .setName('spla-friends')
    .setDescription('Splatoon 3を遊んだフレンドを表示します')
    .addIntegerOption(option => option
      .setName('limit').setDescription('表示件数（既定10件）').setMinValue(1).setMaxValue(20))
    .addBooleanOption(visibilityOption),
  new SlashCommandBuilder()
    .setName('nso-friends')
    .setDescription('Nintendo Switchのフレンドを表示します')
    .addIntegerOption(option => option
      .setName('limit').setDescription('表示件数（既定10件）').setMinValue(1).setMaxValue(20))
    .addBooleanOption(visibilityOption),
].map(command => command.toJSON());
