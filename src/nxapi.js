import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const timeoutMs = Number.parseInt(process.env.NXAPI_TIMEOUT_MS ?? '45000', 10);
const loginTimeoutMs = 10 * 60 * 1000;
const dataRoot = process.env.NXAPI_DATA_PATH ?? '/data';
const loginSessions = new Map();

export function userDataPath(userId) {
  if (!/^\d{16,22}$/.test(userId)) throw new Error('不正なDiscordユーザーIDです');
  return path.join(dataRoot, 'users', userId);
}

export function runNxapi(args, { json = false, userId } = {}) {
  return new Promise((resolve, reject) => {
    const scopedArgs = userId ? ['--data-path', userDataPath(userId), ...args] : args;
    const finalArgs = json ? [...scopedArgs, '--json'] : scopedArgs;
    const child = spawn('nxapi', finalArgs, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('nxapiの応答がタイムアウトしました'));
      if (code !== 0) return reject(new Error(safeError(stderr || stdout)));
      if (!json) return resolve(stdout.trim());
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('nxapiから不正なJSON応答を受信しました'));
      }
    });
  });
}

export async function startLogin(userId) {
  cancelLogin(userId);
  const dir = userDataPath(userId);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  return new Promise((resolve, reject) => {
    const child = spawn('nxapi', ['--data-path', dir, 'nso', 'auth'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let resolvedUrl = false;
    let settleCompletion;
    let rejectCompletion;
    const completion = new Promise((res, rej) => {
      settleCompletion = res;
      rejectCompletion = rej;
    });
    // モーダル送信前にプロセスが終了しても未処理rejectionにしない。
    completion.catch(() => {});

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectCompletion(new Error('ログイン操作が10分で失効しました。もう一度 /login を実行してください'));
      loginSessions.delete(userId);
    }, loginTimeoutMs);

    const inspect = () => {
      if (resolvedUrl) return;
      const match = stdout.match(/https:\/\/accounts\.nintendo\.com\/connect\/1\.0\.0\/authorize[^\s]+/);
      if (match) {
        resolvedUrl = true;
        loginSessions.set(userId, { child, completion, timer });
        resolve(match[0]);
      }
    };

    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; inspect(); });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      loginSessions.delete(userId);
      if (!resolvedUrl) reject(error);
      rejectCompletion(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      loginSessions.delete(userId);
      if (code === 0) {
        settleCompletion('Nintendoアカウントへのログインが完了しました。');
      } else {
        const error = new Error(safeError(stderr || stdout));
        if (!resolvedUrl) reject(error);
        rejectCompletion(error);
      }
    });
  });
}

export function hasLoginSession(userId) {
  return loginSessions.has(userId);
}

export async function completeLogin(userId, callbackUrl) {
  const session = loginSessions.get(userId);
  if (!session) throw new Error('ログイン操作が見つからないか、期限切れです。もう一度 /login を実行してください');
  validateCallbackUrl(callbackUrl);
  session.child.stdin.end(callbackUrl.trim() + '\n');
  return session.completion;
}

export function cancelLogin(userId) {
  const session = loginSessions.get(userId);
  if (!session) return;
  clearTimeout(session.timer);
  session.child.kill('SIGTERM');
  loginSessions.delete(userId);
}

export async function deleteUserData(userId) {
  cancelLogin(userId);
  await rm(userDataPath(userId), { recursive: true, force: true });
}

function validateCallbackUrl(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('NintendoからコピーしたURLの形式が正しくありません'); }
  if (url.protocol !== 'npf71b963c1b7b6d119:' || url.hostname !== 'auth') {
    throw new Error('URLは npf71b963c1b7b6d119://auth から始まる必要があります');
  }
  const params = new URLSearchParams(url.hash.slice(1));
  if (!params.has('session_token_code') || !params.has('state')) {
    throw new Error('認証URLに必要な情報がありません');
  }
}

function safeError(message) {
  return String(message)
    .replace(/Session token\s+\S+/gi, 'Session token [REDACTED]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED]')
    .trim()
    .slice(0, 1000) || 'nxapiの実行に失敗しました';
}
