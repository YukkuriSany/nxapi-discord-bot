# nxapi Discord Bot

非公式の[nxapi](https://github.com/samuelthomas2774/nxapi)を利用して、Nintendo Switch Online / SplatNet 3の情報をDiscordに表示するBotです。

## コマンド

- `/login` — Discord上の非公開操作でNintendoアカウントへログイン（nxapiのサービス状況に依存）
- `/account` — 自分のログイン状態
- `/logout` — 自分の認証情報を削除
- `/nxapi-status` — Botとnxapiの状態
- `/stages <mode>` — バトルのステージ予定
- `/salmon` — サーモンラン予定
- `/event` — イベントマッチ予定
- `/fest` — フェスマッチ予定
- `/qr <text>` — 文字列やURLからQRコードを生成
- `/twitter-video <url>` — 保存が許可されたX/Twitter動画を取得
- `/youtube-video <url>` — 保存が許可されたYouTube動画を取得
- `/spla-user` — SplatNet 3プロフィール
- `/spla-friends [limit]` — Splatoon 3フレンド
- `/nso-friends [limit]` — Nintendo Switchフレンド
- `/play-status` — フレンドのオンライン状態・プレイ中ゲーム
- `/web-services` — 利用可能なゲーム連携サービス
- `/friend-code` — フレンドコードとQRコード
- `/friend-request <code>` — 確認ボタン付きフレンド申請
- `/spla-profile` — SplatNet 3プロフィール
- `/spla-battles` — 最新バトル記録を取得
- `/spla-salmon-results` — 最新バイト記録を取得
- `/spla-fest-result` — フェス記録を取得

ログイン情報はDiscordユーザーIDごとに分離して保存されます。`/login` と `/logout` は実行者だけに見えるephemeral応答です。`/account` はNintendoアカウント名を除外してチャンネルへ公開されます。今回追加した情報表示コマンドもチャンネルへ公開されます。フレンド申請の確認メッセージは公開されますが、確定ボタンはコマンド実行者しか使用できません。

公開スケジュール機能は[Spla3 API](https://spla3.yuu26.com/)を利用します。取得結果はAPI負荷軽減のため60秒間キャッシュします。

動画取得コマンドの応答はチャンネルへ公開されます。単一動画のみ対応し、DiscordがInteractionで通知する添付上限に自動追従します（既定は10MiBで、サーバーのBoost状況などにより増える場合があります）。タイムアウトは180秒です。自分が権利を持つ動画、または保存が許可された動画に限って利用してください。非公開・ログイン必須・DRM保護された動画の回避には対応しません。

## セットアップ

1. Discord Developer PortalでApplicationとBotを作成します。招待時のscopeは `bot` と `applications.commands`、Bot権限は `Send Messages` と `Embed Links` を付けます。
2. `.env.example` を `.env` にコピーし、Discordの値と有効な `NXAPI_USER_AGENT` を設定します。
3. イメージをビルドします。

```sh
docker compose build
```

Dockerビルド時に[nxapiのGitHubリポジトリ](https://github.com/samuelthomas2774/nxapi)から`main`ブランチを取得し、TypeScriptをコンパイルしてインストールします。npmレジストリの旧版は使用しません。固定したい場合は`.env`の`NXAPI_GIT_REF`へタグまたはブランチ名を指定します。ソースビルドではnxapi-authクライアントIDが必要になる場合があるため、その場合は`.env`の`NXAPI_AUTH_CLIENT_ID`を設定してください。

4. Discordコマンドを登録してBotを起動します。

```sh
docker compose run --rm bot node src/register-commands.js
docker compose up -d
docker compose logs -f bot
```

5. Discordで `/login` を実行します。本人だけに表示されるボタンからNintendoへログインし、「この人にする」のリンクをコピーしてDiscordのモーダルへ貼り付けます。操作は10分で失効します。

認証状態は `nxapi-data` ボリューム内のユーザー別ディレクトリに保存されます。SplatNet 3を使えるNintendoアカウントとNintendo Switch Online加入が必要です。

`DISCORD_GUILD_ID`を設定したギルドコマンドは通常すぐ反映されます。空欄のグローバルコマンドは反映に時間がかかる場合があります。

## 更新と運用

```sh
docker compose build --pull --no-cache
docker compose up -d
```

`.env` とNintendo認証データをGitへ追加しないでください。nxapiはNintendoの非公開APIをリバースエンジニアリングした非公式ツールです。Nintendo側の変更で動かなくなる可能性や、アカウントへのリスクがあります。また、認証時に一時トークンがnxapiの認証補助サーバーへ送られる仕様を理解したうえで利用してください。

