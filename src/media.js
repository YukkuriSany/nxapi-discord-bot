import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const configuredMaxSizeMb = Number.parseInt(process.env.VIDEO_MAX_SIZE_MB ?? '100', 10);
const timeoutMs = Number.parseInt(process.env.VIDEO_DOWNLOAD_TIMEOUT_MS ?? '180000', 10);
const allowedHosts = {
  twitter: new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']),
  youtube: new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']),
};

export async function downloadVideo(urlText, service, discordLimitBytes) {
  const url = validateUrl(urlText, service);
  const defaultDiscordLimit = 10 * 1024 * 1024;
  const safetyMargin = 64 * 1024;
  const effectiveMaxBytes = Math.max(1024 * 1024, Math.min(
    configuredMaxSizeMb * 1024 * 1024,
    (discordLimitBytes ?? defaultDiscordLimit) - safetyMargin,
  ));
  const effectiveMaxLabel = (effectiveMaxBytes / 1024 / 1024).toFixed(1);
  const directory = await mkdtemp(path.join(tmpdir(), 'discord-video-'));
  try {
    await runYtDlp([
      '--no-playlist', '--no-progress', '--restrict-filenames',
      '--max-filesize', String(effectiveMaxBytes),
      '--format', [
        'bv*[vcodec^=avc1][height<=720]+ba[ext=m4a]',
        'b[vcodec^=avc1][height<=720][ext=mp4]',
        'bv*[height<=720]+ba/b[height<=720]/b',
      ].join('/'),
      '--merge-output-format', 'mp4',
      '--output', path.join(directory, '%(title).80B-%(id)s.%(ext)s'),
      url.toString(),
    ]);
    const files = (await readdir(directory))
      .filter(name => !name.endsWith('.part') && !name.endsWith('.ytdl'));
    if (!files.length) throw new Error(`動画を取得できませんでした。上限${effectiveMaxLabel}MiBを超えている可能性があります`);
    const downloadedPath = path.join(directory, files[0]);
    const filePath = await normalizeAudioForDiscord(downloadedPath, directory);
    if ((await stat(filePath)).size > effectiveMaxBytes) throw new Error(`動画が上限の${effectiveMaxLabel}MiBを超えています`);
    return {
      data: await readFile(filePath),
      name: safeFilename(path.parse(files[0]).name + '.mp4'),
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function normalizeAudioForDiscord(inputPath, directory) {
  const outputPath = path.join(directory, 'discord-compatible.mp4');
  await runProcess('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'copy',
    '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '128k', '-ar', '48000',
    '-movflags', '+faststart',
    outputPath,
  ], '音声の変換に失敗しました');
  return outputPath;
}

function validateUrl(value, service) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('URLの形式が正しくありません'); }
  if (url.protocol !== 'https:') throw new Error('HTTPSのURLを指定してください');
  if (!allowedHosts[service]?.has(url.hostname.toLowerCase())) throw new Error('対応していない動画サイトです');
  return url;
}

function runYtDlp(args) {
  return runProcess('yt-dlp', args, '動画を取得できませんでした', mediaError);
}

function runProcess(command, args, defaultError, errorFormatter) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('動画取得がタイムアウトしました'));
      if (code !== 0) return reject(new Error(errorFormatter ? errorFormatter(stderr) : defaultError));
      resolve();
    });
  });
}

function mediaError(stderr) {
  if (/Sign in to confirm|cookies/i.test(stderr)) return 'この動画はログインが必要なため取得できません';
  if (/Private video|private/i.test(stderr)) return '非公開動画は取得できません';
  if (/Unsupported URL/i.test(stderr)) return '対応していない動画URLです';
  if (/copyright|unavailable|not available/i.test(stderr)) return 'この動画は利用できないか、保存が許可されていません';
  return '動画を取得できませんでした';
}

function safeFilename(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100) || 'video.mp4';
}
