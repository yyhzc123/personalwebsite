import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  FormEvent,
} from "react";
import type { NextPage, GetServerSideProps } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import styles from '../styles/index.module.css';

// Use 2:3 library capsule image ratio
const HEADER_RATIO = 2 / 3;

// Basic Steam game shape coming from the Web API
type SteamGame = {
  appid: number;
  name: string;
  playtime_forever: number;
};

// Layout rectangle for each game
type LayoutGame = SteamGame & {
  x: number;
  y: number;
  width: number;
  height: number;
  albumUrl: string;
};

interface HomeProps {
  initialGames: SteamGame[];
  error: string | null;
  initialSteamId: string;
  initialApiKey: string;
  initialAccounts?: { steamId: string; apiKey: string }[];
  initialProfile?: { avatar: string; personaname: string } | null;
  goldAppids?: number[];
}

const buildAlbumUrl = (appid: number): string => {
  return `https://steamcdn-a.akamaihd.net/steam/apps/${appid}/library_600x900_2x.jpg`;
};

// 带超时和自动重试的 JSON 请求封装
async function fetchJsonWithRetry(
  url: string,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<any> {
  const { timeoutMs = 12000, retries = 2 } = options;

  let lastError: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } catch (e: any) {
      clearTimeout(timer);
      lastError = e;
      // 若是超时或连接重置等网络错误，尝试重试
      const msg = String(e?.message || "");
      const isTransient =
        msg.includes("AbortError") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("network") ||
        msg.includes("NetworkError");
      if (!isTransient || attempt === retries) {
        throw e;
      }
      // 小等待再重试
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastError;
}

// Calculate optimal canvas dimensions for a portrait layout
const calculateCanvasDimensions = (gameCount: number): { width: number; height: number } => {
  if (gameCount === 0) return { width: 1080, height: 1920 };

  // Base area for a mobile-friendly portrait image
  const baseArea = 1080 * 1920;
  const additionalAreaPerGame = 50000; // e.g., ~220x220 per game
  const totalArea = baseArea + (gameCount > 10 ? (gameCount - 10) * additionalAreaPerGame : 0);

  // Target a portrait aspect ratio, e.g., 9:16
  const targetAspect = 9 / 16;

  const width = Math.sqrt(totalArea * targetAspect);
  const height = width / targetAspect;

  // Round to reasonable values, maintaining portrait orientation
  const finalWidth = Math.max(1080, Math.min(4320, Math.round(width / 100) * 100));
  const finalHeight = Math.max(1920, Math.min(7680, Math.round(height / 100) * 100));

  return { width: finalWidth, height: finalHeight };
};

const HomePage: NextPage<HomeProps> = ({
  initialGames,
  error,
  initialSteamId,
  initialApiKey,
  initialAccounts,
  initialProfile,
  goldAppids,
}) => {
  const router = useRouter();
  const [globalApiKey, setGlobalApiKey] = useState(initialApiKey || "");
  const [accounts, setAccounts] = useState<{ steamId: string }[]>(
    Array.isArray(initialAccounts) && initialAccounts.length > 0
      ? initialAccounts.map(a => ({ steamId: a.steamId }))
      : [{ steamId: initialSteamId || "" }]
  );
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => Boolean(globalApiKey.trim()) && accounts.length > 0 && accounts.every(a => a.steamId.trim()),
    [globalApiKey, accounts]
  );

  const addAccount = () => setAccounts([...accounts, { steamId: "" }]);
  const removeAccount = (idx: number) => setAccounts(accounts.filter((_, i) => i !== idx));
  const updateAccount = (idx: number, field: "steamId", value: string) => {
    setAccounts(prev => prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)));
  };

  // Calculate canvas dimensions based on game count
  const canvasDimensions = useMemo(() => {
    const gameCount = initialGames.length;
    return calculateCanvasDimensions(gameCount);
  }, [initialGames]);

  // 计算布局：按离散分级（边长为整数倍）并用“自由矩形填充”优先填补上半部空隙
  const layoutGames: LayoutGame[] = useMemo(() => {
    if (!initialGames || initialGames.length === 0) {
      return [];
    }

    const sorted = [...initialGames].sort(
      (a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0)
    );

    // 显示所有账号的所有游戏（包含0时长）
    const baseList = sorted;

    if (baseList.length === 0) {
      return [];
    }
    // 离散分级（边长为整数倍）与面积近似正比时长
    const times = baseList.map(g => Math.max(g.playtime_forever, 1));
    const maxTime = Math.max(...times, 1);
    // 恢复之前的归一化方式：基于最大时长的平方根归一化
    const sqrtMax = Math.sqrt(maxTime);
    const TIER_MAX = 8; // 调整为8级，更柔和

    const items = baseList
      .map((game) => {
        const sqrtVal = Math.sqrt(Math.max(game.playtime_forever, 1));
        const normalized = sqrtVal / sqrtMax;
        let mult = Math.max(1, Math.round(normalized * TIER_MAX));
        const hours = (game.playtime_forever || 0) / 60;
        if (hours >= 10) {
          mult = Math.max(mult, 2);
        } else {
          mult = 1;
        }
        return { game, mult };
      })
      .sort((a, b) => {
        const t = (b.game.playtime_forever || 0) - (a.game.playtime_forever || 0);
        if (t !== 0) return t;
        return b.mult - a.mult;
      });

    const results: LayoutGame[] = [];
    const { width: LAYOUT_WIDTH, height: LAYOUT_HEIGHT } = canvasDimensions;
    const ASPECT_RATIO = 2 / 3;

    const totalUnits = items.reduce((acc, it) => acc + it.mult * it.mult, 0);
    const canvasArea = LAYOUT_WIDTH * LAYOUT_HEIGHT;
    let baseUnitArea = canvasArea / Math.max(totalUnits, 1);
    let baseUnitHeight = Math.sqrt(baseUnitArea / ASPECT_RATIO);
    let baseUnitWidth = baseUnitHeight * ASPECT_RATIO;

    const maxMult = items.length ? Math.max(...items.map(i => i.mult)) : 1;
    const maxItemWidth = maxMult * baseUnitWidth;
    if (maxItemWidth > LAYOUT_WIDTH) {
      const scale = LAYOUT_WIDTH / maxItemWidth;
      baseUnitWidth *= scale;
      baseUnitHeight *= scale;
    }

    // 量化基础单元，使得布局宽度可被整除，减少无法填满的缝隙
    const gridCols = Math.max(1, Math.floor(LAYOUT_WIDTH / Math.max(baseUnitWidth, 1)));
    baseUnitWidth = Math.max(1, Math.floor(LAYOUT_WIDTH / gridCols));
    baseUnitHeight = Math.max(1, Math.round(baseUnitWidth / ASPECT_RATIO));

    type Rect = { x: number; y: number; width: number; height: number };
    // 画布顶部预留信息栏高度（不大，占整体高度约6%，上限100px，下限60px）
    const headerInfoHeight = Math.max(60, Math.round(Math.min(LAYOUT_HEIGHT * 0.06, 100)));

    const freeRects: Rect[] = [
      { x: 0, y: headerInfoHeight, width: LAYOUT_WIDTH, height: Math.max(0, LAYOUT_HEIGHT - headerInfoHeight) },
    ];

    const RANDOM_SEED = 1337.123;
    const prepared = items.map(it => ({
      ...it,
      width: it.mult * baseUnitWidth,
      height: it.mult * baseUnitHeight,
      // 使用基于 appid 的可复现抖动，避免 SSR/CSR 乱序导致水合不一致
      rnd: Math.abs(Math.sin((it.game.appid || 0) * RANDOM_SEED)),
    }));

    // 工具：矩形包含判断
    const contains = (a: Rect, b: Rect) =>
      a.x <= b.x && a.y <= b.y && (a.x + a.width) >= (b.x + b.width) && (a.y + a.height) >= (b.y + b.height);

    // 工具：清理被包含的自由矩形，避免重叠/冗余
    const pruneFreeRects = () => {
      for (let i = 0; i < freeRects.length; i++) {
        for (let j = 0; j < freeRects.length; j++) {
          if (i === j) continue;
          const ri = freeRects[i];
          const rj = freeRects[j];
          if (ri && rj && contains(rj, ri)) {
            freeRects.splice(i, 1);
            i--;
            break;
          }
        }
      }
    };

    const addFreeRect = (r: Rect) => {
      if (r.width <= 0 || r.height <= 0) return;
      freeRects.push(r);
    };

    // 选择最佳自由矩形：优先上方（y小）、其次左方（x小），并奖励“宽或高精确匹配”
    const chooseBestRect = (w: number, h: number): Rect | null => {
      let best: Rect | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const fr of freeRects) {
        if (fr.width >= w && fr.height >= h) {
          const exactW = fr.width === w;
          const exactH = fr.height === h;
          // 分数：上方优先，其次左方；精确匹配给予大幅奖励（降低分数）
          const score = fr.y * LAYOUT_WIDTH + fr.x + (exactW && exactH ? -1e6 : (exactW || exactH ? -5e5 : 0));
          if (score < bestScore) {
            bestScore = score;
            best = fr;
          }
        }
      }
      return best;
    };

    // 使用“断头台”式拆分：产生右侧与底部两个自由矩形，并清理冗余
    const splitFreeRect = (fr: Rect, placed: Rect) => {
      // 移除被使用的自由矩形
      const idx = freeRects.indexOf(fr);
      if (idx >= 0) freeRects.splice(idx, 1);

      const right: Rect = {
        x: placed.x + placed.width,
        y: fr.y,
        width: fr.width - placed.width,
        height: placed.height,
      };
      const bottom: Rect = {
        x: fr.x,
        y: placed.y + placed.height,
        width: fr.width,
        height: fr.height - placed.height,
      };

      addFreeRect(right);
      addFreeRect(bottom);
      pruneFreeRects();
    };

    // 第一阶段：从大到小为主，加入少量乱序（避免完全按大小排列）
    const RANDOM_JITTER = 0.2; // 乱序强度，可调小以保持大体有序
    const remainingDesc = [...prepared].sort((a, b) => {
      const sa = -a.mult + (a.rnd - 0.5) * RANDOM_JITTER;
      const sb = -b.mult + (b.rnd - 0.5) * RANDOM_JITTER;
      return sa - sb;
    });
    const overflow: typeof prepared = [];

    for (const it of remainingDesc) {
      const w = it.width;
      const h = it.height;
      const target = chooseBestRect(w, h);
      if (!target) {
        overflow.push(it);
        continue;
      }
      const placed: Rect = { x: target.x, y: target.y, width: w, height: h };
      results.push({
        ...it.game,
        x: placed.x,
        y: placed.y,
        width: placed.width,
        height: placed.height,
        albumUrl: buildAlbumUrl(it.game.appid),
      });
      splitFreeRect(target, placed);
    }

    // 第二阶段：对每个自由矩形在内部进行“局部货架式”多次填充
    // 目标：优先用小级数尽量填满该矩形的上方与每一排，减少中间整排空白
    freeRects.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const remainingAsc = overflow.sort((a, b) => a.mult - b.mult);

    const fillRectWithShelf = (fr: Rect) => {
      // 从全局自由矩形中移除，改为在该矩形内部循环填充
      const idx = freeRects.indexOf(fr);
      if (idx >= 0) freeRects.splice(idx, 1);

      let rect: Rect = { ...fr };
      let placedAny = false;

      // 在该rect内反复填充多行（从上到下）
      while (rect.height >= baseUnitHeight) {
        // 选择该行高度：挑选能放进rect的候选中“最小高度”，以小级数优先
        const candidates = remainingAsc.filter(it => it.height <= rect.height && it.width <= rect.width);
        if (candidates.length === 0) break;
        const rowHeight = Math.min(...candidates.map(it => it.height));

        let localX = rect.x;
        let spaceW = rect.width;
        let rowMaxH = 0;
        let rowPlaced = 0;

        // 在该行内，从左到右用“小宽度且能放下”的元素尽量占满
        // 每次找到一个就重新扫描，直到该行无法再放置
        for (;;) {
          let foundIndex = -1;
          let foundWidth = Number.POSITIVE_INFINITY;

          for (let i = 0; i < remainingAsc.length; i++) {
            const it = remainingAsc[i];
            if (it.width <= spaceW && it.height <= rowHeight) {
              // 优先选择更窄的（更容易填满剩余空间）
              if (it.width < foundWidth) {
                foundWidth = it.width;
                foundIndex = i;
              }
            }
          }

          if (foundIndex === -1) break; // 该行不能再放置

          const it = remainingAsc[foundIndex];
          const placed: Rect = { x: localX, y: rect.y, width: it.width, height: it.height };

          results.push({
            ...it.game,
            x: placed.x,
            y: placed.y,
            width: placed.width,
            height: placed.height,
            albumUrl: buildAlbumUrl(it.game.appid),
          });

          localX += it.width;
          spaceW -= it.width;
          rowMaxH = Math.max(rowMaxH, it.height);
          rowPlaced += 1;
          remainingAsc.splice(foundIndex, 1);

          // 防止死循环
          if (spaceW < baseUnitWidth) break;
        }

        if (rowPlaced === 0) break; // 该行无法放置任何元素

        // 该行右侧剩余空间作为新的自由矩形暴露给全局（供后续行或其他空隙继续填）
        if (spaceW > 0) {
          addFreeRect({ x: localX, y: rect.y, width: spaceW, height: rowMaxH });
        }

        // 消化当前行高度，进入下一行
        rect.y += rowMaxH;
        rect.height -= rowMaxH;
        placedAny = true;

        // 清理冗余
        pruneFreeRects();
      }

      // 把未被填满的底部剩余区域也作为自由矩形继续暴露（供其他循环尝试）
      if (rect.height > 0 && rect.width > 0) {
        addFreeRect(rect);
        pruneFreeRects();
      }
      return placedAny;
    };

    for (const fr of freeRects.slice()) {
      fillRectWithShelf(fr);
    }

    return results;
  }, [initialGames, canvasDimensions]);

  // Draw the collage into a canvas
  useEffect(() => {
    let isCancelled = false;

    const drawCollage = async () => {
      if (!canvasRef.current || layoutGames.length === 0) {
        return;
      }

      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      canvas.width = canvasDimensions.width;
      canvas.height = canvasDimensions.height;

      context.fillStyle = "#1a1a1a";
      context.fillRect(0, 0, canvas.width, canvas.height);

      const loadImage = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = src;
        });
      };

      setIsDrawing(true);
      setImageStatus(
        `正在加载 ${layoutGames.length} 个游戏封面并构建拼图...`
      );

      const uniqueGames = new Map<
        number,
        { albumUrl: string; name: string }
      >();

      layoutGames.forEach((game) => {
        if (!uniqueGames.has(game.appid)) {
          uniqueGames.set(game.appid, {
            albumUrl: game.albumUrl,
            name: game.name,
          });
        }
      });

      const imagesByAppid = new Map<number, HTMLImageElement | null>();
      const entries = Array.from(uniqueGames.entries());
      let loadedCount = 0;

      for (const [appid, info] of entries) {
        if (isCancelled) {
          return;
        }

        let img: HTMLImageElement | null = null;

        try {
          img = await loadImage(info.albumUrl);
        } catch {
          img = null;
        }

        imagesByAppid.set(appid, img);
        loadedCount += 1;

        if (loadedCount % 10 === 0 || loadedCount === entries.length) {
          setImageStatus(
            `已加载 ${loadedCount} / ${entries.length} 个游戏封面...`
          );
        }
      }

      setImageStatus("正在绘制拼图...");

      // 顶部信息栏：头像、用户名、游戏数与总时长
      const headerInfoHeight = Math.max(60, Math.round(Math.min(canvas.height * 0.06, 100)));
      let avatarImg: HTMLImageElement | null = null;
      const avatarUrl = initialProfile?.avatar || "";
      const personaName = initialProfile?.personaname || "";
      if (avatarUrl) {
        try {
          avatarImg = await loadImage(avatarUrl);
        } catch {
          avatarImg = null;
        }
      }

      // 背景条
      context.fillStyle = "#0f1115";
      context.fillRect(0, 0, canvas.width, headerInfoHeight);

      // 头像（圆形裁剪）
      const pad = 10;
      const avatarSize = Math.max(40, headerInfoHeight - pad * 2);
      if (avatarImg && avatarImg.width > 0 && avatarImg.height > 0) {
        const ax = pad + avatarSize / 2;
        const ay = headerInfoHeight / 2;
        context.save();
        context.beginPath();
        context.rect(pad, (headerInfoHeight - avatarSize) / 2, avatarSize, avatarSize);
        context.clip();
        context.drawImage(
          avatarImg,
          0,
          0,
          avatarImg.width,
          avatarImg.height,
          pad,
          (headerInfoHeight - avatarSize) / 2,
          avatarSize,
          avatarSize
        );
        context.restore();
        // 头像边框
        context.save();
        context.strokeStyle = "#ffd700";
        context.lineWidth = 3;
        context.beginPath();
        context.strokeRect(pad, (headerInfoHeight - avatarSize) / 2, avatarSize, avatarSize);
        context.stroke();
        context.restore();
      }

      // 文本信息
      const textX = pad * 2 + avatarSize;
      const centerY = headerInfoHeight / 2;
      const totalPlayMinutes = initialGames.reduce((acc, g) => acc + (g.playtime_forever || 0), 0);
      const totalHours = Math.round(totalPlayMinutes / 60);
      const uniqueCount = entries.length;
      context.fillStyle = "#ffffff";
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.font = "bold 18px system-ui, -apple-system";
      context.fillText(personaName || "", textX, centerY - 10);
      context.font = "600 14px system-ui, -apple-system";
      const stats = `游戏数：${uniqueCount}  |  总时长：${totalHours} 小时`;
      context.fillText(stats, textX, centerY + 12);

      const goldSet = new Set(goldAppids || []);

      for (const game of layoutGames) {
        if (isCancelled) {
          return;
        }

        const img = imagesByAppid.get(game.appid) || null;

        if (img && img.width > 0 && img.height > 0) {
          // Draw with proper aspect ratio (cover fit)
          const cellW = game.width;
          const cellH = game.height;
          const cellAspect = cellW / cellH;

          const imgW = img.width;
          const imgH = img.height;
          const imgAspect = imgW / imgH;

          let sx = 0;
          let sy = 0;
          let sWidth = imgW;
          let sHeight = imgH;

          if (imgAspect > cellAspect) {
            sWidth = imgH * cellAspect;
            sx = (imgW - sWidth) / 2;
          } else if (imgAspect < cellAspect) {
            sHeight = imgW / cellAspect;
            sy = (imgH - sHeight) / 2;
          }

          context.drawImage(
            img,
            sx,
            sy,
            sWidth,
            sHeight,
            game.x,
            game.y,
            cellW,
            cellH
          );
          // 超过500小时，绘制时长标记（居中偏下三分之一，随尺寸缩放）
          {
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
              // 边界保护，避免溢出到图块外
              if (bx < game.x + margin) bx = game.x + margin;
              if (bx + badgeW > game.x + cellW - margin) bx = game.x + cellW - margin - badgeW;
              if (by < game.y + margin) by = game.y + margin;
              if (by + badgeH > game.y + cellH - margin) by = game.y + cellH - margin - badgeH;
              context.fillStyle = "rgba(0,0,0,0.6)";
              context.fillRect(bx, by, badgeW, badgeH);
              context.fillStyle = "#ffffff";
              context.textAlign = "center";
              context.textBaseline = "middle";
              context.fillText(badgeText, Math.round(bx + badgeW / 2), Math.round(by + badgeH / 2));
              context.restore();
            }
          }
          // 全成就金色内嵌边框
          if (goldSet.has(game.appid)) {
            const t = Math.max(2, Math.round(Math.min(cellW, cellH) * 0.02));
            const inset = Math.floor(t / 2) + 2;
            context.save();
            context.strokeStyle = "#ffd700";
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
        } else {
          // Fallback for failed images
          context.fillStyle = "#f97316";
          context.fillRect(game.x, game.y, game.width, game.height);

          context.fillStyle = "#000000";
          context.font = "bold 14px system-ui, -apple-system";
          context.textAlign = "center";
          context.textBaseline = "middle";

          const maxChars = Math.floor(game.width / 8);
          const label =
            game.name.length > maxChars 
              ? `${game.name.slice(0, maxChars)}...` 
              : game.name;

          context.save();
          context.beginPath();
          context.rect(game.x, game.y, game.width, game.height);
          context.clip();
          context.fillText(
            label,
            game.x + game.width / 2,
            game.y + game.height / 2
          );
          context.restore();

          // 全成就金色内嵌边框（即使封面加载失败也标记）
          if (goldSet.has(game.appid)) {
            const cellW = game.width;
            const cellH = game.height;
            const t = Math.max(2, Math.round(Math.min(cellW, cellH) * 0.02));
            const inset = Math.floor(t / 2) + 2;
            context.save();
            context.strokeStyle = "#ffd700";
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
          // 超过500小时，绘制时长标记（封面加载失败同样显示；居中偏下三分之一，随尺寸缩放）
          {
            const hours = Math.round((game.playtime_forever || 0) / 60);
            if (hours >= 500) {
              const badgeText = `${hours}h`;
              context.save();
              const cellW = game.width;
              const cellH = game.height;
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
              context.fillStyle = "rgba(0,0,0,0.6)";
              context.fillRect(bx, by, badgeW, badgeH);
              context.fillStyle = "#ffffff";
              context.textAlign = "center";
              context.textBaseline = "middle";
              context.fillText(badgeText, Math.round(bx + badgeW / 2), Math.round(by + badgeH / 2));
              context.restore();
            }
          }
        }
      }

      if (!isCancelled) {
        setImageStatus(
          `完成!共 ${layoutGames.length} 个游戏,分辨率 ${canvasDimensions.width}x${canvasDimensions.height}`
        );
        setIsDrawing(false);
        setPreviewImage(canvas.toDataURL("image/png"));
      }
    };

    drawCollage();

    return () => {
      isCancelled = true;
    };
  }, [layoutGames, canvasDimensions]);

  const hasGames = layoutGames.length > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    setPreviewImage(null); // Reset preview on new submission

    const normalizedSteamIds = accounts
      .map(a => a.steamId.trim())
      .filter(s => s);

    const key = globalApiKey.trim();
    if (normalizedSteamIds.length === 0 || !key) {
      setImageStatus("请至少输入一个Steam ID，并提供全局API密钥");
      return;
    }

    setImageStatus(`正在从Steam API获取${normalizedSteamIds.length}个账号的游戏库...`);

    router.push(
      {
        pathname: "/",
        query: {
          steamId: normalizedSteamIds,
          apiKey: key,
        },
      },
      undefined
    );
  };

  const handleDownload = async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    try {
      const dataUrl = canvas.toDataURL("image/png");
      setPreviewImage(dataUrl); // Set the preview image
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `steam-collage-${layoutGames.length}games-${canvasDimensions.width}x${canvasDimensions.height}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      setImageStatus("导出失败,可能是浏览器安全限制");
    }
  };

  const scaleX = 100 / canvasDimensions.width;
  const scaleY = 100 / canvasDimensions.height;

  return (
    <>
      <Head>
        <title>STEAM生涯拼图</title>
        <meta
          name="description"
          content="根据Steam游戏时长生成拼图,游戏时长越长图片越大"
        />
      </Head>
      <div className="min-h-screen bg-gray-100 text-black">
        <main className="max-w-6xl mx-auto px-4 py-8 md:py-12">
          <header className="mb-8 md:mb-10">
            <div className="inline-block bg-[#1DB954] text-black border-4 border-black rounded-xl px-6 py-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
              <h1 className="text-3xl md:text-4xl font-black tracking-tight uppercase">
                STEAM生涯拼图
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
                1. 连接Steam账号
              </h2>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  <span className="uppercase tracking-wide">请提供Steam Web API KEY</span>
                  <input
                    type="password"
                    value={globalApiKey}
                    onChange={(e) => setGlobalApiKey(e.target.value)}
                    placeholder="输入任一STEAM账号的API KEY"
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
                        placeholder="17位数字、STEAM主页链接或自定义用户名"
                        className="mt-1 w-full bg-transparent text-black pb-1 text-sm font-mono placeholder-gray-700 focus:outline-none border-b-2 border-gray-400 focus:border-black"
                      />
                    </label>
                    
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={() => removeAccount(idx)}
                        className="inline-flex items-center justify-center rounded-lg border-4 border-black bg-red-400 text-black px-3 py-2 text-xs font-extrabold uppercase tracking-wide shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:translate-x-1"
                      >
                        移除该账号
                      </button>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addAccount}
                  className="inline-flex items-center justify-center rounded-lg border-4 border-black bg-white text-black px-3 py-2 text-xs font-extrabold uppercase tracking-wide shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:translate-x-1"
                >
                  ＋ 添加账号
                </button>

                <p className="text-xs text-black">
                  在{' '}
                  <a
                    href="https://steamcommunity.com/dev/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono font-semibold underline text-black hover:text-black"
                  >
                    https://steamcommunity.com/dev/apikey
                  </a>{' '}
                  获取API密钥,并将资料可见性设置为公开。
                </p>

                <button
                  type="submit"
                  className="mt-2 inline-flex items-center justify-center rounded-lg border-4 border-black bg-[#D8B4FE] text-black px-4 py-2 text-sm font-extrabold uppercase tracking-wide shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:translate-x-1 active:translate-y-0 active:translate-x-0 disabled:cursor-not-allowed disabled:bg-gray-300"
                  disabled={!canSubmit}
                >
                  生成拼图
                </button>

                {error && (
                  <div className="mt-2 rounded-lg border-4 border-black bg-red-200 px-3 py-2 text-xs font-semibold text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <p className="uppercase tracking-wide">Steam API错误</p>
                    <p className="mt-1 break-words">{error}</p>
                  </div>
                )}

                {imageStatus && (
                  <p className="mt-1 text-xs font-semibold text-gray-800">
                    {imageStatus}
                  </p>
                )}

                {/* 隐私说明已移除 */}
              </form>
            </div>

            <div className="bg-[#1DB954] text-black border-4 border-black rounded-xl px-4 pt-5 pb-5 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg md:text-xl font-extrabold uppercase">
                  2. 预览拼图
                </h2>
                {hasGames && (
                  <span className="rounded-full border-4 border-black bg-[#1DB954] px-3 py-1 text-xs font-black uppercase tracking-wide text-black">
                    {layoutGames.length}个游戏
                  </span>
                )}
              </div>

              <div className="relative w-full rounded-xl border-4 border-black bg-white overflow-hidden shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] text-black">
              <div className="relative w-full aspect-[3/4] md:aspect-[2/3]">
                  {!hasGames && (
                    <div className="flex h-full flex-col items-center justify-center gap-4 bg-green-100">
                      <div className="bg-gray-200 border-2 border-dashed rounded-xl w-16 h-16" />
                      <p className="max-w-xs px-4 text-center text-xs md:text-sm font-semibold">
                        输入Steam账号信息后,你的游戏拼图将在这里显示
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
                  disabled={!hasGames || isDrawing}
                  className="inline-flex items-center justify-center rounded-lg border-4 border-black bg-[#D8B4FE] text-black px-3 py-2 text-xs font-extrabold uppercase tracking-wide shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-1 hover:translate-x-1 active:translate-y-0 active:translate-x-0 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {isDrawing ? "生成中..." : "下载PNG"}
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
    typeof rawSteamId === "string"
      ? [rawSteamId]
      : Array.isArray(rawSteamId)
      ? rawSteamId
      : [];
  const apiKeys =
    typeof rawApiKey === "string"
      ? [rawApiKey]
      : Array.isArray(rawApiKey)
      ? rawApiKey
      : [];

  const initialAccounts =
    steamIds.length > 0
      ? steamIds.map((id, idx) => ({
          steamId: id || "",
          apiKey: apiKeys[idx] || apiKeys[0] || "",
        }))
      : [];

  const props: HomeProps = {
    initialGames: [],
    error: null,
    initialSteamId: initialAccounts[0]?.steamId || "",
    initialApiKey: initialAccounts[0]?.apiKey || "",
    initialAccounts,
    initialProfile: null,
    goldAppids: [],
  };

  if (steamIds.length === 0 || apiKeys.length === 0) {
    return { props };
  }

  const pairs = steamIds
    .map((id, idx) => ({
      input: String(id || "").trim(),
      key: String(apiKeys[idx] || apiKeys[0] || "").trim(),
    }))
    .filter((p) => p.input && p.key);

  if (pairs.length === 0) {
    props.error = "未提供有效的Steam账号";
    return { props };
  }

  const resolveOne = async (input: string, apiKeyParam: string): Promise<string | null> => {
    // 支持: 17位数字、任意数字、主页链接(id/profiles)、仅Vanity用户名
    const urlMatch = input.match(
      /^https?:\/\/steamcommunity\.com\/(id|profiles)\/([^\/?#]+)/
    );
    if (urlMatch) {
      const kind = urlMatch[1];
      const value = decodeURIComponent(urlMatch[2]);
      if (kind === "profiles") {
        return /^\d{17}$/.test(value) ? value : null;
      }
      // kind === "id" -> Vanity
      const vanityEndpoint = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${encodeURIComponent(
        apiKeyParam
      )}&vanityurl=${encodeURIComponent(value)}`;
      try {
        const vd = await fetchJsonWithRetry(vanityEndpoint, { timeoutMs: 12000, retries: 2 });
        const maybeId = vd?.response?.steamid;
        const success = vd?.response?.success;
        if (success === 1 && typeof maybeId === "string" && /^\d+$/.test(maybeId)) {
          return maybeId;
        }
        return null;
      } catch {
        return null;
      }
    }
    if (/^\d{17}$/.test(input)) return input;
    if (/^\d+$/.test(input)) return input; // 允许非17位数字
    // 仅Vanity用户名（无URL）
    const vanityEndpoint = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${encodeURIComponent(
      apiKeyParam
    )}&vanityurl=${encodeURIComponent(input)}`;
    try {
      const vd = await fetchJsonWithRetry(vanityEndpoint, { timeoutMs: 12000, retries: 2 });
      const maybeId = vd?.response?.steamid;
      const success = vd?.response?.success;
      if (success === 1 && typeof maybeId === "string" && /^\d+$/.test(maybeId)) {
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
      resolveErrors.push(`无法解析: ${p.input}`);
    }
  }

  if (resolvedPairs.length === 0) {
    props.error = resolveErrors.length > 0 ? resolveErrors.join("; ") : "无法解析任何Steam ID";
    return { props };
  }

  // 并发查询每个账号的游戏
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
    if (res.status === "fulfilled") {
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
      const msg = String((res as any).reason?.message || "查询失败");
      fetchErrors.push(`账号 ${sid} 查询失败: ${msg}`);
    }
  });

  const aggregatedGames = Array.from(aggregated.values());
  if (aggregatedGames.length === 0) {
    props.error = fetchErrors.length > 0 ? fetchErrors.join("; ") : "未找到任何账号的游戏，请检查隐私设置与网络。";
    return { props };
  }

  props.initialGames = aggregatedGames;
  if (fetchErrors.length > 0 || resolveErrors.length > 0) {
    props.error = [...resolveErrors, ...fetchErrors].join("; ");
  }

  // 获取首个用户的头像与用户名
  try {
    const first = resolvedPairs[0];
    if (first) {
      const psUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(
        first.key
      )}&steamids=${encodeURIComponent(first.id)}`;
      const psData = await fetchJsonWithRetry(psUrl, { timeoutMs: 12000, retries: 1 });
      const player = psData?.response?.players?.[0];
      if (player && typeof player === "object") {
        props.initialProfile = {
          avatar: String(player.avatarfull || player.avatar || ""),
          personaname: String(player.personaname || ""),
        };
      }
    }
  } catch {
    // ignore profile errors
  }

  // 检测全成就（优化为并发+限量，避免请求过多导致SSR超时）
  try {
    const LIMIT = Math.min(50, aggregatedGames.length);
    const CONCURRENCY = 6;
    const MAX_REQUESTS = Math.min(LIMIT * resolvedPairs.length, 200); // 动态上限，随账号数与前50规模调整
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
    // 将待检查任务展开为 [appid, rp] 组合，优先按时长靠前的游戏
    const tasks: Array<{ appid: number; rp: { id: string; key: string } }> = [];
    for (const g of topGames) {
      for (const rp of resolvedPairs) {
        tasks.push({ appid: g.appid, rp });
      }
    }
    // 并发执行，提早收集到金边即可跳过该app的后续检查
    const seenApps = new Set<number>();
    let i = 0;
    while (i < tasks.length && issued < MAX_REQUESTS) {
      const batch = tasks.slice(i, i + CONCURRENCY).filter(t => !seenApps.has(t.appid));
      issued += batch.length;
      const results = await Promise.allSettled(
        batch.map(({ appid, rp }) => checkFull(appid, rp.id, rp.key).then(ok => ({ appid, ok })))
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
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