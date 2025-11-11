import { useState, useEffect, useRef, FormEvent, useMemo } from 'react';
import { GetServerSideProps } from 'next';
import Head from 'next/head';
import { useRouter } from 'next/router';

// Type definitions
interface Game {
  appid: number;
  name: string;
  playtime_forever: number;
  img_icon_url?: string;
}

interface LayoutGame extends Game {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Profile {
  avatar: string;
  personaname: string;
}

interface HomeProps {
  initialGames: Game[];
  error: string | null;
  initialSteamId: string;
  initialApiKey: string;
  initialAccounts: { steamId: string; apiKey: string }[];
  initialProfile: Profile | null;
  goldAppids: number[];
}

// Helper function to fetch JSON with retry logic
async function fetchJsonWithRetry(
  url: string,
  options: { timeoutMs: number; retries: number }
): Promise<any> {
  const { timeoutMs, retries } = options;
  for (let i = 0; i < retries + 1; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (e) {
      if (i === retries) {
        throw e;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

const HomePage = ({
  initialGames,
  error,
  initialAccounts,
  initialProfile,
  goldAppids,
}: HomeProps) => {
  const router = useRouter();
  const [accounts, setAccounts] = useState(
    initialAccounts.length > 0
      ? initialAccounts
      : [{ steamId: '', apiKey: '' }]
  );
  const [globalApiKey, setGlobalApiKey] = useState(
    initialAccounts[0]?.apiKey || ''
  );
  const [games, setGames] = useState<Game[]>(initialGames);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const canSubmit =
    accounts.some(a => a.steamId.trim()) && globalApiKey.trim();

  const addAccount = () => {
    setAccounts([...accounts, { steamId: '', apiKey: '' }]);
  };

  const removeAccount = (index: number) => {
    setAccounts(accounts.filter((_, i) => i !== index));
  };

  const updateAccount = (
    index: number,
    field: 'steamId' | 'apiKey',
    value: string
  ) => {
    const newAccounts = [...accounts];
    newAccounts[index][field] = value;
    setAccounts(newAccounts);
  };

  const { layoutGames, canvasDimensions } = useMemo(() => {
    if (games.length === 0) {
      return { layoutGames: [], canvasDimensions: { width: 0, height: 0 } };
    }

    const sortedGames = [...games].sort(
      (a, b) => b.playtime_forever - a.playtime_forever
    );

    const imageCount = sortedGames.length;
    const targetWidth = 1200;
    
    // Prioritize vertical growth
    const numCols = Math.max(1, Math.min(5, Math.floor(Math.sqrt(imageCount) / 1.5)));
    const numRows = Math.ceil(imageCount / numCols);

    const cellWidth = Math.floor(targetWidth / numCols);
    const cellHeight = cellWidth; // Maintain square cells for simplicity for now

    const canvasWidth = numCols * cellWidth;
    const canvasHeight = numRows * cellHeight;

    const layout: LayoutGame[] = [];
    for (let i = 0; i < imageCount; i++) {
      const game = sortedGames[i];
      const row = Math.floor(i / numCols);
      const col = i % numCols;
      layout.push({
        ...game,
        x: col * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      });
    }

    return {
      layoutGames: layout,
      canvasDimensions: { width: canvasWidth, height: canvasHeight },
    };
  }, [games]);

  useEffect(() => {
    if (layoutGames.length === 0 || !canvasRef.current) return;

    let isCancelled = false;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = canvasDimensions.width;
    canvas.height = canvasDimensions.height;

    const drawCollage = async () => {
      setIsDrawing(true);
      setImageStatus(`Drawing ${layoutGames.length} games...`);

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000000';
      context.fillRect(0, 0, canvas.width, canvas.height);

      const imagePromises = layoutGames.map(game => {
        return new Promise<HTMLImageElement | null>(resolve => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = `https://steamcdn-a.akamaihd.net/steam/apps/${game.appid}/header.jpg`;
        });
      });

      const images = await Promise.all(imagePromises);

      if (isCancelled) return;

      for (let i = 0; i < layoutGames.length; i++) {
        const game = layoutGames[i];
        const img = images[i];
        const cellW = game.width;
        const cellH = game.height;

        if (img) {
          const scale = Math.max(cellW / img.width, cellH / img.height);
          const imgW = img.width * scale;
          const imgH = img.height * scale;
          const imgX = (cellW - imgW) / 2;
          const imgY = (cellH - imgH) / 2;
          context.drawImage(
            img,
            game.x + imgX,
            game.y + imgY,
            imgW,
            imgH
          );
        } else {
          context.fillStyle = '#333';
          context.fillRect(game.x, game.y, cellW, cellH);
          context.fillStyle = '#fff';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.font = '12px system-ui';
          context.fillText(game.name, game.x + cellW / 2, game.y + cellH / 2, cellW - 20);
        }

        if (goldAppids.includes(game.appid)) {
          context.save();
          const inset = 2;
          const t = Math.max(2, Math.min(6, cellW * 0.02));
          context.strokeStyle = '#ffd700';
          context.lineWidth = t;
          context.globalAlpha = 0.95;
          context.strokeRect(
            game.x + inset,
            game.y + inset,
            cellW - inset * 2,
            cellH - inset * 2
          );
          context.restore();
        }

        const hours = Math.round((game.playtime_forever || 0) / 60);
        if (hours >= 500) {
          const badgeText = `${hours}h`;
          context.save();
          const base = Math.min(cellW, cellH);
          const fontSize = Math.round(Math.max(12, Math.min(24, base * 0.08)));
          const padding = Math.round(Math.max(4, Math.min(12, base * 0.03)));
          context.font = `bold ${fontSize}px system-ui, -apple-system`;
          const metrics = context.measureText(badgeText);
          const textW = Math.ceil(metrics.width);
          const badgeW = textW + padding * 2;
          const badgeH = Math.round(fontSize + padding * 1.2);
          const margin = Math.round(Math.max(4, base * 0.02));
          const centerX = game.x + cellW / 2;
          const centerY = game.y + cellH * 0.66;
          let bx = Math.round(centerX - badgeW / 2);
          let by = Math.round(centerY - badgeH / 2);
          if (bx < game.x + margin) bx = game.x + margin;
          if (bx + badgeW > game.x + cellW - margin) bx = game.x + cellW - margin - badgeW;
          if (by < game.y + margin) by = game.y + margin;
          if (by + badgeH > game.y + cellH - margin) by = game.y + cellH - margin - badgeH;
          context.fillStyle = 'rgba(0,0,0,0.6)';
          context.fillRect(bx, by, badgeW, badgeH);
          context.fillStyle = '#ffffff';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(badgeText, Math.round(bx + badgeW / 2), Math.round(by + badgeH / 2));
          context.restore();
        }
      }

      if (!isCancelled) {
        setImageStatus(
          `Complete! Total ${layoutGames.length} games. Resolution: ${canvasDimensions.width}x${canvasDimensions.height}`
        );
        setIsDrawing(false);
        setPreviewImage(canvas.toDataURL('image/png'));
      }
    };

    drawCollage();

    return () => {
      isCancelled = true;
    };
  }, [layoutGames, canvasDimensions, goldAppids]);

  const hasGames = layoutGames.length > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setPreviewImage(null);
    const normalizedSteamIds = accounts
      .map(a => a.steamId.trim())
      .filter(s => s);
    const key = globalApiKey.trim();
    if (normalizedSteamIds.length === 0 || !key) {
      setImageStatus('Please enter at least one Steam ID and provide a global API key.');
      return;
    }
    setImageStatus(`Fetching games for ${normalizedSteamIds.length} accounts from Steam API...`);
    router.push(
      {
        pathname: '/',
        query: {
          steamId: normalizedSteamIds,
          apiKey: key,
        },
      },
      undefined
    );
  };

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'steam-collage.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <Head>
        <title>STEAM 生涯拼贴</title>
        <meta
          name="description"
          content="根据你的 Steam 游戏时间生成一个拼贴画。你玩的时间越长，图像就越大。"
        />
      </Head>
      <div className="min-h-screen bg-gray-100 text-black">
        <main className="max-w-6xl mx-auto px-4 py-8 md:py-12">
          <header className="mb-8 md:mb-10">
            <div className="inline-block bg-[#1DB954] text-black border-4 border-black rounded-xl px-6 py-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              <h1 className="text-3xl md:text-4xl font-black tracking-tight uppercase">
                STEAM 生涯拼贴
              </h1>
            </div>
            <p className="mt-4 max-w-2xl text-sm md:text-base font-medium">
              {hasGames && (
                <span className="block mt-2 text-gray-700 font-bold">
                  当前显示 {layoutGames.length} 个游戏 | 输出分辨率: {canvasDimensions.width}×{canvasDimensions.height}
                </span>
              )}
            </p>
          </header>

          <section className="grid gap-6 md:grid-cols-2 md:gap-8 items-start">
            <div className="bg-[#1DB954] text-black border-4 border-black rounded-xl p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-4">
              <h2 className="text-lg md:text-xl font-extrabold uppercase">
                1. 连接 Steam 帐户
              </h2>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  <span className="uppercase tracking-wide">请输入一个 Steam Web API KEY</span>
                  <input
                    type="password"
                    value={globalApiKey}
                    onChange={(e) => setGlobalApiKey(e.target.value)}
                    placeholder="输入任意一个 STEAM 帐户的 API KEY"
                    className="mt-1 w-full rounded-lg border-4 border-black bg-white text-black px-3 py-2 text-sm font-mono placeholder-gray-700 focus:outline-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                  />
                </label>
                {accounts.map((acc, idx) => (
                  <div key={idx} className="flex flex-col gap-3 rounded-lg border-4 border-black bg-white p-3 text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <label className="flex flex-col gap-1 text-sm font-semibold">
                      <span className="uppercase tracking-wide">Steam ID</span>
                      <input
                        type="text"
                        value={acc.steamId}
                        onChange={(e) => updateAccount(idx, "steamId", e.target.value)}
                        placeholder="17 位数字、STEAM 主页链接或自定义用户名"
                        className="mt-1 w-full bg-transparent text-black pb-1 text-sm font-mono placeholder-gray-700 focus:outline-none border-b-2 border-gray-400 focus:border-black"
                      />
                    </label>
                    
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={() => removeAccount(idx)}
                        className="inline-flex items-center justify-center rounded-lg border-4 border-black bg-red-400 text-black px-3 py-2 text-xs font-extrabold uppercase tracking-wide shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:translate-x-1"
                      >
                        删除此帐户
                      </button>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addAccount}
                  className="inline-flex items-center justify-center rounded-lg border-4 border-black bg-white text-black px-3 py-2 text-xs font-extrabold uppercase tracking-wide shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:translate-x-1"
                >
                  + 添加帐户
                </button>

                <p className="text-xs text-black">
                  在以下网址获取 API 密钥{' '}
                  <a
                    href="https://steamcommunity.com/dev/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono font-semibold underline text-black hover:text-black"
                  >
                    https://steamcommunity.com/dev/apikey
                  </a>{' '}
                  并将你的个人资料可见性设置为公开。
                </p>

                <button
                  type="submit"
                  className="mt-2 inline-flex items-center justify-center rounded-lg border-4 border-black bg-[#D8B4FE] text-black px-4 py-2 text-sm font-extrabold uppercase tracking-wide shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:translate-x-1 active:translate-y-0 active:translate-x-0 disabled:cursor-not-allowed disabled:bg-gray-300"
                  disabled={!canSubmit}
                >
                  生成拼贴
                </button>

                {error && (
                  <div className="mt-2 rounded-lg border-4 border-black bg-red-200 px-3 py-2 text-xs font-semibold text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <p className="uppercase tracking-wide">Steam API 错误</p>
                    <p className="mt-1 break-words">{error}</p>
                  </div>
                )}

                {imageStatus && (
                  <p className="mt-1 text-xs font-semibold text-gray-800">
                    {imageStatus}
                  </p>
                )}
              </form>
            </div>

            <div className="bg-[#1DB954] text-black border-4 border-black rounded-xl px-4 pt-5 pb-5 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg md:text-xl font-extrabold uppercase">
                  2. 预览拼贴
                </h2>
                {hasGames && (
                  <span className="rounded-full border-4 border-black bg-[#1DB954] px-3 py-1 text-xs font-black uppercase tracking-wide text-black">
                    {layoutGames.length} 个游戏
                  </span>
                )}
              </div>

              <div className="relative w-full rounded-xl border-4 border-black bg-white overflow-hidden shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] text-black">
              <div className="relative w-full aspect-[3/4] md:aspect-[2/3]">
                  {!hasGames && (
                    <div className="flex h-full flex-col items-center justify-center gap-4 bg-green-100">
                      <div className="bg-gray-200 border-2 border-dashed rounded-xl w-16 h-16" />
                      <p className="max-w-xs px-4 text-center text-xs md:text-sm font-semibold">
                        输入你的 Steam 帐户信息，你的游戏拼贴将显示在这里。
                      </p>
                    </div>
                  )}

                  {previewImage ? (
                    <img src={previewImage} alt="Generated Collage" className="h-full w-full object-contain bg-gray-800" />
                  ) : hasGames ? (
                    <div className="flex h-full flex-col items-center justify-center gap-4 bg-green-100">
                      <div className="bg-gray-200 border-2 border-dashed rounded-xl w-16 h-16 animate-pulse" />
                      <p className="max-w-xs px-4 text-center text-xs md:text-sm font-semibold">
                        {imageStatus}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 mt-4 mb-4 md:mt-5 md:mb-5">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!hasGames}
                  className="inline-flex items-center justify-center rounded-lg border-4 border-black bg-[#D8B4FE] text-black px-3 py-2 text-xs font-extrabold uppercase tracking-wide shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:translate-x-1 active:translate..."
                >
                  下载 PNG
                </button>
              </div>

              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
          </section>
        </main>
      </div>
    </>
  );
};

export const getServerSideProps: GetServerSideProps<HomeProps> = async (
  context
) => {
  const rawSteamId = context.query.steamId;
  const rawApiKey = context.query.apiKey;

  const steamIds =
    typeof rawSteamId === 'string'
      ? [rawSteamId]
      : Array.isArray(rawSteamId)
      ? rawSteamId
      : [];
  const apiKeys =
    typeof rawApiKey === 'string'
      ? [rawApiKey]
      : Array.isArray(rawApiKey)
      ? rawApiKey
      : [];

  const initialAccounts =
    steamIds.length > 0
      ? steamIds.map((id, idx) => ({
          steamId: id || '',
          apiKey: apiKeys[idx] || apiKeys[0] || '',
        }))
      : [];

  const props: HomeProps = {
    initialGames: [],
    error: null,
    initialSteamId: initialAccounts[0]?.steamId || '',
    initialApiKey: initialAccounts[0]?.apiKey || '',
    initialAccounts,
    initialProfile: null,
    goldAppids: [],
  };

  if (steamIds.length === 0 || apiKeys.length === 0) {
    return { props };
  }

  const pairs = steamIds
    .map((id, idx) => ({
      input: String(id || '').trim(),
      key: String(apiKeys[idx] || apiKeys[0] || '').trim(),
    }))
    .filter((p) => p.input && p.key);

  if (pairs.length === 0) {
    props.error = 'No valid Steam accounts provided.';
    return { props };
  }

  const resolveOne = async (input: string, apiKeyParam: string): Promise<string | null> => {
    const urlMatch = input.match(
      /^https?:\/\/steamcommunity\.com\/(id|profiles)\/([^\/?#]+)/
    );
    if (urlMatch) {
      const kind = urlMatch[1];
      const value = decodeURIComponent(urlMatch[2]);
      if (kind === 'profiles') {
        return /^\d{17}$/.test(value) ? value : null;
      }
      const vanityEndpoint = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${encodeURIComponent(
        apiKeyParam
      )}&vanityurl=${encodeURIComponent(value)}`;
      try {
        const vd = await fetchJsonWithRetry(vanityEndpoint, { timeoutMs: 12000, retries: 2 });
        const maybeId = vd?.response?.steamid;
        const success = vd?.response?.success;
        if (success === 1 && typeof maybeId === 'string' && /^\d+$/.test(maybeId)) {
          return maybeId;
        }
        return null;
      } catch {
        return null;
      }
    }
    if (/^\d{17}$/.test(input)) return input;
    if (/^\d+$/.test(input)) return input;
    const vanityEndpoint = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${encodeURIComponent(
      apiKeyParam
    )}&vanityurl=${encodeURIComponent(input)}`;
    try {
      const vd = await fetchJsonWithRetry(vanityEndpoint, { timeoutMs: 12000, retries: 2 });
      const maybeId = vd?.response?.steamid;
      const success = vd?.response?.success;
      if (success === 1 && typeof maybeId === 'string' && /^\d+$/.test(maybeId)) {
        return maybeId;
      }
      return null;
    } catch {
      return null;
    }
  };

  const resolvedPairs: { id: string; key: string }[] = [];
  const resolveErrors: string[] = [];

  for (const p of pairs) {
    const id = await resolveOne(p.input, p.key);
    if (id) {
      resolvedPairs.push({ id, key: p.key });
    } else {
      resolveErrors.push(`Could not resolve: ${p.input}`);
    }
  }

  if (resolvedPairs.length === 0) {
    props.error = resolveErrors.length > 0 ? resolveErrors.join('; ') : 'Could not resolve any Steam IDs.';
    return { props };
  }

  const fetchOwned = async (sid: string, key: string) => {
    const endpoint = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(
      key
    )}&steamid=${encodeURIComponent(
      sid
    )}&include_appinfo=1&include_played_free_games=1&format=json`;
    try {
      const data = await fetchJsonWithRetry(endpoint, { timeoutMs: 15000, retries: 2 });
      const games = data?.response?.games;
      if (!Array.isArray(games)) return [];
      return games.map((g: any) => ({ appid: g.appid, name: g.name, playtime_forever: g.playtime_forever || 0 }));
    } catch (e: any) {
      return Promise.reject(e);
    }
  };

  const results = await Promise.allSettled(
    resolvedPairs.map((pair) => fetchOwned(pair.id, pair.key))
  );

  const aggregated = new Map<number, { appid: number; name: string; playtime_forever: number }>();
  const fetchErrors: string[] = [];

  results.forEach((res, idx) => {
    const sid = resolvedPairs[idx]?.id;
    if (res.status === 'fulfilled') {
      const list = res.value as Array<{ appid: number; name: string; playtime_forever: number }>;
      for (const g of list) {
        const prev = aggregated.get(g.appid);
        if (prev) {
          prev.playtime_forever += g.playtime_forever;
        } else {
          aggregated.set(g.appid, { appid: g.appid, name: g.name, playtime_forever: g.playtime_forever });
        }
      }
    } else {
      const msg = String((res as any).reason?.message || 'Query failed');
      fetchErrors.push(`Account ${sid} query failed: ${msg}`);
    }
  });

  const aggregatedGames = Array.from(aggregated.values());
  if (aggregatedGames.length === 0) {
    props.error = fetchErrors.length > 0 ? fetchErrors.join('; ') : 'No games found for any account. Please check privacy settings and network.';
    return { props };
  }

  props.initialGames = aggregatedGames;
  if (fetchErrors.length > 0 || resolveErrors.length > 0) {
    props.error = [...resolveErrors, ...fetchErrors].join('; ');
  }

  try {
    const first = resolvedPairs[0];
    if (first) {
      const psUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(
        first.key
      )}&steamids=${encodeURIComponent(first.id)}`;
      const psData = await fetchJsonWithRetry(psUrl, { timeoutMs: 12000, retries: 1 });
      const player = psData?.response?.players?.[0];
      if (player && typeof player === 'object') {
        props.initialProfile = {
          avatar: String(player.avatarfull || player.avatar || ''),
          personaname: String(player.personaname || ''),
        };
      }
    }
  } catch {
    // ignore profile errors
  }

  try {
    const LIMIT = Math.min(50, aggregatedGames.length);
    const CONCURRENCY = 6;
    const MAX_REQUESTS = Math.min(LIMIT * resolvedPairs.length, 200);
    const topGames = [...aggregatedGames]
      .sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0))
      .slice(0, LIMIT);

    const goldSet = new Set<number>();
    const checkFull = async (appid: number, sid: string, key: string): Promise<boolean> => {
      const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?appid=${encodeURIComponent(
        appid
      )}&key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(sid)}`;
      try {
        const data = await fetchJsonWithRetry(url, { timeoutMs: 12000, retries: 1 });
        const success = data?.playerstats?.success;
        const ach = data?.playerstats?.achievements;
        if (success !== true && success !== 1) return false;
        if (!Array.isArray(ach) || ach.length === 0) return false;
        return ach.every((a: any) => Number(a?.achieved) === 1);
      } catch {
        return false;
      }
    };

    let issued = 0;
    const tasks: Array<{ appid: number; rp: { id: string; key: string } }> = [];
    for (const g of topGames) {
      for (const rp of resolvedPairs) {
        tasks.push({ appid: g.appid, rp });
      }
    }
    const seenApps = new Set<number>();
    let i = 0;
    while (i < tasks.length && issued < MAX_REQUESTS) {
      const batch = tasks.slice(i, i + CONCURRENCY).filter(t => !seenApps.has(t.appid));
      issued += batch.length;
      const results = await Promise.allSettled(
        batch.map(({ appid, rp }) => checkFull(appid, rp.id, rp.key).then(ok => ({ appid, ok })))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { appid, ok } = r.value as { appid: number; ok: boolean };
          if (ok) {
            goldSet.add(appid);
            seenApps.add(appid);
          }
        }
      }
      i += CONCURRENCY;
    }
    props.goldAppids = Array.from(goldSet);
  } catch {
    // ignore achievement errors
  }

  return { props };
};

export default HomePage;