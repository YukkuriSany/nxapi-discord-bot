import { SlashCommandBuilder } from 'discord.js';

const visibilityOption = option => option
  .setName('public')
  .setDescription('チャンネル全体へ公開します（既定は本人のみ）');

export const commands = [
  new SlashCommandBuilder()
    .setName('login')
    .setDescription('Nintendoアカウントに非公開でログイン'),
  new SlashCommandBuilder()
    .setName('account')
    .setDescription('自分のNintendoアカウントのログイン状態を確認します'),
  new SlashCommandBuilder()
    .setName('logout')
    .setDescription('ログアウトします'),
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
    .setDescription('サーモンランの予定を表示します'),
  new SlashCommandBuilder()
    .setName('event')
    .setDescription('イベントマッチの予定を表示します'),
  new SlashCommandBuilder()
    .setName('fest')
    .setDescription('フェスマッチの予定を表示します'),
  new SlashCommandBuilder()
    .setName('qr')
    .setDescription('文字列やURLからQRコードを生成します')
    .addStringOption(option => option
      .setName('text').setDescription('QRコードに埋め込む内容').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder()
    .setName('twitter-video')
    .setDescription('X/Twitter動画を取得します')
    .addStringOption(option => option
      .setName('url').setDescription('X/Twitter投稿のURL').setRequired(true)),
  new SlashCommandBuilder()
    .setName('youtube-video')
    .setDescription('YouTube動画を取得します 今、音がたまにバグるので注意')
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
  new SlashCommandBuilder()
    .setName('play-status')
    .setDescription('フレンドのオンライン状態とプレイ中のゲームを表示します'),
  new SlashCommandBuilder()
    .setName('web-services')
    .setDescription('利用可能なNintendo Switch Online連携サービスを表示します'),
  new SlashCommandBuilder()
    .setName('friend-code')
    .setDescription('自分のフレンドコードとQRコードを表示します'),
  new SlashCommandBuilder()
    .setName('friend-request')
    .setDescription('フレンドコードを確認してフレンド申請します')
    .addStringOption(option => option
      .setName('code').setDescription('SW-0000-0000-0000').setRequired(true)),
  new SlashCommandBuilder()
    .setName('spla-profile')
    .setDescription('SplatNet 3のプロフィールを表示します'),
  new SlashCommandBuilder()
    .setName('spla-battles')
    .setDescription('SplatNet 3の最新バトル記録を取得します'),
  new SlashCommandBuilder()
    .setName('spla-salmon-results')
    .setDescription('SplatNet 3の最新バイト記録を取得します'),
  new SlashCommandBuilder()
    .setName('spla-fest-result')
    .setDescription('SplatNet 3のフェス記録を取得します'),
].map(command => command.toJSON());

