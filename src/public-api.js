const baseUrl = process.env.SPLA3_API_BASE_URL ?? 'https://spla3.yuu26.com/api';
const cacheTtlMs = 60_000;
const cache = new Map();

export async function getBattleSchedule() {
  return getJson('/schedule');
}

export async function getSalmonSchedule() {
  return getJson('/coop-grouping/schedule');
}

export async function getEventSchedule() {
  return getJson('/event/schedule');
}

export async function getFestSchedule() {
  return getJson('/fest/schedule');
}

async function getJson(path) {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(baseUrl + path, {
      headers: { 'User-Agent': process.env.NXAPI_USER_AGENT ?? 'nxapi-discord-bot/1.0.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`公開APIがHTTP ${response.status}を返しました`);
    const data = await response.json();
    cache.set(path, { data, expiresAt: Date.now() + cacheTtlMs });
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('公開APIへの接続がタイムアウトしました');
    if (cached) return cached.data;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
