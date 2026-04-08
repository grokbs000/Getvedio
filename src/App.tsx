import React, { useState, useRef, useEffect } from 'react';
import {
  Download, Link2, Loader2, Music, Video, AlertCircle,
  ClipboardPaste, Globe, Clock, Eye, ThumbsUp, ChevronDown,
  Sparkles, X, CheckCircle2, Film, Headphones, Save,
} from 'lucide-react';
import { cn } from './lib/utils';

// Platform metadata
const PLATFORMS: Record<string, { name: string; color: string; gradient: string; icon: string }> = {
  youtube:      { name: 'YouTube',       color: '#FF0000', gradient: 'from-red-600 to-red-500',       icon: '▶️' },
  tiktok:       { name: 'TikTok',        color: '#00f2ea', gradient: 'from-cyan-400 to-pink-500',     icon: '🎵' },
  douyin:       { name: '抖音',           color: '#161823', gradient: 'from-cyan-400 to-pink-500',     icon: '🎵' },
  instagram:    { name: 'Instagram',     color: '#E4405F', gradient: 'from-purple-600 to-orange-400', icon: '📸' },
  facebook:     { name: 'Facebook',      color: '#1877F2', gradient: 'from-blue-600 to-blue-500',     icon: '👤' },
  twitter:      { name: 'Twitter / X',   color: '#1DA1F2', gradient: 'from-sky-500 to-blue-600',      icon: '🐦' },
  bilibili:     { name: 'Bilibili',      color: '#00A1D6', gradient: 'from-sky-400 to-pink-400',      icon: '📺' },
  twitch:       { name: 'Twitch',        color: '#9146FF', gradient: 'from-purple-600 to-purple-400', icon: '🎮' },
  niconico:     { name: 'Niconico',      color: '#252525', gradient: 'from-gray-700 to-gray-500',     icon: '🇯🇵' },
  vimeo:        { name: 'Vimeo',         color: '#1AB7EA', gradient: 'from-cyan-500 to-teal-400',     icon: '🎬' },
  dailymotion:  { name: 'Dailymotion',   color: '#0066DC', gradient: 'from-blue-600 to-indigo-500',   icon: '🌐' },
  pinterest:    { name: 'Pinterest',     color: '#E60023', gradient: 'from-red-600 to-red-400',       icon: '📌' },
  reddit:       { name: 'Reddit',        color: '#FF4500', gradient: 'from-orange-600 to-orange-400', icon: '🤖' },

  soundcloud:   { name: 'SoundCloud',    color: '#FF5500', gradient: 'from-orange-500 to-orange-400', icon: '🎧' },
  xiaohongshu:  { name: '小紅書',         color: '#FE2C55', gradient: 'from-red-500 to-pink-400',      icon: '📕' },
  xigua:        { name: '西瓜視頻',       color: '#FF4040', gradient: 'from-red-500 to-orange-400',    icon: '🍉' },
  kuaishou:     { name: '快手',           color: '#FF6633', gradient: 'from-orange-500 to-yellow-500', icon: '⚡' },
  other:        { name: '其他平台',       color: '#6366F1', gradient: 'from-indigo-500 to-purple-500', icon: '🔗' },
};

const QUALITY_OPTIONS = [
  { value: 'best', label: '最高畫質', desc: '自動選擇最佳' },
  { value: '2160', label: '4K (2160p)', desc: '超高清' },
  { value: '1440', label: '2K (1440p)', desc: '高清' },
  { value: '1080', label: '1080p', desc: 'Full HD' },
  { value: '720',  label: '720p',  desc: 'HD' },
  { value: '480',  label: '480p',  desc: '標準' },
  { value: '360',  label: '360p',  desc: '流暢' },
];

// Detect platform from URL
function detectPlatform(url: string): string {
  const lower = url.toLowerCase();
  const patterns: Record<string, RegExp[]> = {
    youtube: [/youtube\.com/, /youtu\.be/],
    tiktok: [/tiktok\.com/, /vm\.tiktok\.com/],
    douyin: [/douyin\.com/],
    instagram: [/instagram\.com/, /instagr\.am/],
    facebook: [/facebook\.com/, /fb\.watch/, /fb\.com/],
    twitter: [/twitter\.com/, /x\.com/],
    bilibili: [/bilibili\.com/, /b23\.tv/],
    twitch: [/twitch\.tv/],
    niconico: [/nicovideo\.jp/, /nico\.ms/],
    vimeo: [/vimeo\.com/],
    dailymotion: [/dailymotion\.com/, /dai\.ly/],
    pinterest: [/pinterest\.com/, /pin\.it/],
    reddit: [/reddit\.com/, /redd\.it/],

    soundcloud: [/soundcloud\.com/],
    xiaohongshu: [/xiaohongshu\.com/, /xhslink\.com/],
    xigua: [/ixigua\.com/],
    kuaishou: [/kuaishou\.com/, /gifshow\.com/],
  };
  for (const [platform, pats] of Object.entries(patterns)) {
    if (pats.some(p => p.test(lower))) return platform;
  }
  return 'other';
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return '';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

interface VideoInfo {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number | null;
  uploader: string;
  uploader_id: string;
  view_count: number | null;
  like_count: number | null;
  platform: string;
  webpage_url: string;
  formats: any[];
  is_playlist: boolean;
  playlist_count: number | null;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<VideoInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [quality, setQuality] = useState('best');
  const [showQuality, setShowQuality] = useState(false);
  const [downloadType, setDownloadType] = useState<'video' | 'audio'>('video');
  const [detectedPlatform, setDetectedPlatform] = useState<string>('');
  const [quickSaveStatus, setQuickSaveStatus] = useState<'idle' | 'reading' | 'fetching' | 'downloading' | 'success' | 'error'>('idle');
  const [quickSaveMsg, setQuickSaveMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const qualityRef = useRef<HTMLDivElement>(null);

  // Handle share target from Android (URL shared from other apps)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get('url') || params.get('text') || '';
    if (sharedUrl) {
      // Extract URL from shared text (could be mixed with other text)
      const urlMatch = sharedUrl.match(/https?:\/\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=%]+/);
      if (urlMatch) {
        setUrl(urlMatch[0]);
      } else {
        setUrl(sharedUrl);
      }
      // Clean URL params
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Auto-detect platform as user types
  useEffect(() => {
    if (url.trim()) {
      setDetectedPlatform(detectPlatform(url));
    } else {
      setDetectedPlatform('');
    }
  }, [url]);

  // Close quality dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (qualityRef.current && !qualityRef.current.contains(e.target as Node)) {
        setShowQuality(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  };

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError('');
    setData(null);

    try {
      const response = await fetch('/api/fetch-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('伺服器回應異常，請重新整理頁面再試');
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || '無法取得影片資訊');
      }

      setData(result);
    } catch (err: any) {
      setError(err.message || '取得影片資訊時發生錯誤');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!data) return;
    setDownloading(true);

    const params = new URLSearchParams({
      url: data.webpage_url || url,
      quality,
      format: 'mp4',
      audioOnly: downloadType === 'audio' ? 'true' : 'false',
    });

    // Open download in new window to not interrupt the page
    const downloadUrl = `/api/download?${params.toString()}`;
    
    // Create a temporary link to trigger download
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => setDownloading(false), 3000);
  };

  // Quick Save: read clipboard → fetch info → auto download
  const handleQuickSave = async () => {
    if (quickSaveStatus === 'fetching' || quickSaveStatus === 'downloading') return;

    try {
      // Step 1: Read clipboard
      setQuickSaveStatus('reading');
      setQuickSaveMsg('讀取剪貼簿...');
      let clipText = '';
      try {
        clipText = await navigator.clipboard.readText();
      } catch {
        setQuickSaveStatus('error');
        setQuickSaveMsg('無法讀取剪貼簿');
        setTimeout(() => { setQuickSaveStatus('idle'); setQuickSaveMsg(''); }, 2500);
        return;
      }

      // Extract URL from clipboard
      const urlMatch = clipText.match(/https?:\/\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=%]+/);
      if (!urlMatch) {
        setQuickSaveStatus('error');
        setQuickSaveMsg('剪貼簿中沒有連結');
        setTimeout(() => { setQuickSaveStatus('idle'); setQuickSaveMsg(''); }, 2500);
        return;
      }

      const videoUrl = urlMatch[0];
      setUrl(videoUrl);

      // Step 2: Fetch video info
      setQuickSaveStatus('fetching');
      setQuickSaveMsg('解析影片...');
      const response = await fetch('/api/fetch-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl }),
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('伺服器回應異常');
      }

      const info = await response.json();
      if (!response.ok) {
        throw new Error(info.error || '解析失敗');
      }

      setData(info);

      // Step 3: Auto-download with best quality
      setQuickSaveStatus('downloading');
      setQuickSaveMsg('開始下載...');

      const params = new URLSearchParams({
        url: info.webpage_url || videoUrl,
        quality: 'best',
        format: 'mp4',
        audioOnly: 'false',
      });

      const downloadUrl = `/api/download?${params.toString()}`;
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = '';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setQuickSaveStatus('success');
      setQuickSaveMsg('下載開始！');
      setTimeout(() => { setQuickSaveStatus('idle'); setQuickSaveMsg(''); }, 3000);

    } catch (err: any) {
      setQuickSaveStatus('error');
      setQuickSaveMsg(err.message || '操作失敗');
      setError(err.message || '快速儲存失敗');
      setTimeout(() => { setQuickSaveStatus('idle'); setQuickSaveMsg(''); }, 3000);
    }
  };

  // Auto-trigger quick save when shared URL is received
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get('url') || params.get('text') || '';
    if (sharedUrl) {
      const urlMatch = sharedUrl.match(/https?:\/\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=%]+/);
      if (urlMatch) {
        setUrl(urlMatch[0]);
        // Auto-fetch after a short delay
        setTimeout(() => {
          handleQuickSave();
        }, 500);
      }
    }
  }, []);

  const handleClear = () => {
    setUrl('');
    setData(null);
    setError('');
    inputRef.current?.focus();
  };

  const platformInfo = detectedPlatform ? PLATFORMS[detectedPlatform] || PLATFORMS.other : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-violet-500/30 overflow-x-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-radial from-violet-900/20 via-transparent to-transparent animate-pulse-slow" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-radial from-cyan-900/15 via-transparent to-transparent animate-pulse-slow delay-1000" />
      </div>

      {/* Mobile App Container */}
      <div className="max-w-lg mx-auto min-h-screen flex flex-col relative">

        {/* Header */}
        <header className="px-5 pt-12 pb-6 flex flex-col items-center justify-center relative z-10">
          <div className="relative mb-4">
            <button
              onClick={handleQuickSave}
              disabled={quickSaveStatus === 'fetching' || quickSaveStatus === 'downloading'}
              className={cn(
                "w-16 h-16 bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 rounded-[1.25rem] flex items-center justify-center shadow-xl shadow-violet-500/25 transition-all duration-500 cursor-pointer group active:scale-95 disabled:cursor-not-allowed",
                quickSaveStatus === 'idle' ? "rotate-3 hover:rotate-0 hover:scale-110" : "rotate-0 scale-100"
              )}
              title="快速存片 (自動讀取剪貼簿)"
            >
              {(quickSaveStatus === 'fetching' || quickSaveStatus === 'downloading') ? (
                <Loader2 className="w-8 h-8 text-white animate-spin" strokeWidth={2.5} />
              ) : (
                <Download className="w-8 h-8 text-white drop-shadow-md group-hover:scale-110 transition-transform" strokeWidth={2.5} />
              )}
            </button>
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-400 rounded-full flex items-center justify-center ring-4 ring-zinc-950">
              <Sparkles className="w-3 h-3 text-zinc-900" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
            GetVideo
          </h1>
          <p className="text-sm text-zinc-500 mt-1.5 text-center">
            一鍵下載 · 支援 20+ 影音平台
          </p>
        </header>

        {/* Scrollable platform tags */}
        <div className="px-4 pb-4 overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 w-max mx-auto">
            {['youtube', 'tiktok', 'instagram', 'bilibili', 'twitter', 'facebook', 'twitch', 'vimeo', 'soundcloud'].map(p => {
              const pi = PLATFORMS[p];
              return (
                <div
                  key={p}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-300 select-none",
                    detectedPlatform === p
                      ? `bg-gradient-to-r ${pi.gradient} text-white shadow-lg scale-105`
                      : "bg-zinc-900/80 text-zinc-500 border border-zinc-800/50"
                  )}
                >
                  <span>{pi.icon}</span>
                  <span>{pi.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Content */}
        <main className="flex-1 px-5 pb-8 flex flex-col gap-5 relative z-10">

          {/* Input Form */}
          <form onSubmit={handleFetch} className="flex flex-col gap-3">
            <div className="relative group">
              {/* Platform indicator glow */}
              {platformInfo && (
                <div
                  className="absolute inset-0 rounded-2xl opacity-20 blur-xl transition-all duration-500 pointer-events-none"
                  style={{ backgroundColor: platformInfo.color }}
                />
              )}
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  {platformInfo ? (
                    <span className="text-lg">{platformInfo.icon}</span>
                  ) : (
                    <Link2 className="h-5 w-5 text-zinc-600" />
                  )}
                </div>
                <input
                  ref={inputRef}
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="貼上影片連結..."
                  className={cn(
                    "block w-full pl-12 pr-20 py-4 bg-zinc-900/80 backdrop-blur-sm border rounded-2xl text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:border-transparent transition-all duration-300 outline-none text-[16px]",
                    platformInfo
                      ? `border-zinc-700/50 focus:ring-[${platformInfo.color}]/40`
                      : "border-zinc-800/60 focus:ring-violet-500/40"
                  )}
                  required
                />
                <div className="absolute inset-y-0 right-2 flex items-center gap-1">
                  {url && (
                    <button type="button" onClick={handleClear} className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors active:scale-90">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="p-2 text-zinc-400 hover:text-violet-400 transition-colors active:scale-90"
                    title="從剪貼簿貼上"
                  >
                    <ClipboardPaste className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Platform badge */}
            {platformInfo && detectedPlatform && (
              <div className="flex items-center gap-2 px-1 animate-fade-in">
                <div className={cn("w-2 h-2 rounded-full animate-pulse", `bg-gradient-to-r ${platformInfo.gradient}`)} />
                <span className="text-xs text-zinc-400">
                  已偵測到 <span className="text-zinc-200 font-semibold">{platformInfo.name}</span>
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !url.trim()}
              className={cn(
                "w-full py-4 font-bold rounded-2xl flex items-center justify-center gap-2.5 transition-all duration-300 active:scale-[0.97] text-base",
                platformInfo
                  ? `bg-gradient-to-r ${platformInfo.gradient} text-white shadow-lg hover:shadow-xl disabled:opacity-40`
                  : "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/20 hover:shadow-violet-500/40 disabled:opacity-40",
                "disabled:cursor-not-allowed"
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  解析中...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  解析影片
                </>
              )}
            </button>
          </form>

          {/* Error State */}
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 text-red-400 animate-fade-in">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed">{error}</p>
            </div>
          )}

          {/* Result Card */}
          {data && (
            <div className="flex flex-col gap-4 animate-slide-up">

              {/* Video Preview Card */}
              <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800/50 rounded-3xl overflow-hidden shadow-2xl">
                {/* Thumbnail */}
                <div className="relative aspect-video w-full bg-zinc-800 overflow-hidden">
                  <img
                    src={`/api/proxy-image?url=${encodeURIComponent(data.thumbnail)}`}
                    alt="封面"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = data.thumbnail;
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent" />

                  {/* Platform badge overlay */}
                  <div className={cn(
                    "absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 bg-gradient-to-r shadow-lg",
                    PLATFORMS[data.platform]?.gradient || PLATFORMS.other.gradient,
                    "text-white"
                  )}>
                    <span>{PLATFORMS[data.platform]?.icon || '🔗'}</span>
                    <span>{PLATFORMS[data.platform]?.name || '其他'}</span>
                  </div>

                  {/* Duration badge */}
                  {data.duration && (
                    <div className="absolute bottom-3 right-3 px-2.5 py-1 bg-black/70 backdrop-blur-sm rounded-lg text-xs font-mono text-zinc-200 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      {formatDuration(data.duration)}
                    </div>
                  )}

                  {/* Playlist badge */}
                  {data.is_playlist && (
                    <div className="absolute bottom-3 left-3 px-2.5 py-1 bg-violet-600/80 backdrop-blur-sm rounded-lg text-xs font-semibold text-white">
                      📋 播放清單 · {data.playlist_count} 部影片
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4 space-y-3">
                  <h2 className="font-bold text-zinc-100 leading-snug line-clamp-2 text-[15px]">
                    {data.title}
                  </h2>

                  <div className="flex items-center gap-3 text-zinc-500 text-xs">
                    <span className="font-medium text-zinc-300 truncate max-w-[50%]">
                      {data.uploader}
                    </span>
                    {data.view_count !== null && (
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {formatNumber(data.view_count)}
                      </span>
                    )}
                    {data.like_count !== null && (
                      <span className="flex items-center gap-1">
                        <ThumbsUp className="w-3 h-3" />
                        {formatNumber(data.like_count)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Download Options */}
              <div className="space-y-3">

                {/* Download type toggle */}
                <div className="flex gap-2 p-1 bg-zinc-900/80 border border-zinc-800/50 rounded-2xl">
                  <button
                    onClick={() => setDownloadType('video')}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300",
                      downloadType === 'video'
                        ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg"
                        : "text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    <Film className="w-4 h-4" />
                    影片
                  </button>
                  <button
                    onClick={() => setDownloadType('audio')}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-300",
                      downloadType === 'audio'
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg"
                        : "text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    <Headphones className="w-4 h-4" />
                    音訊 (MP3)
                  </button>
                </div>

                {/* Quality selector (only for video) */}
                {downloadType === 'video' && (
                  <div ref={qualityRef} className="relative">
                    <button
                      onClick={() => setShowQuality(!showQuality)}
                      className="w-full py-3.5 px-4 bg-zinc-900/80 border border-zinc-800/50 rounded-2xl text-sm flex items-center justify-between text-zinc-300 hover:border-zinc-700 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Video className="w-4 h-4 text-violet-400" />
                        <span>
                          畫質：
                          <span className="text-zinc-100 font-semibold">
                            {QUALITY_OPTIONS.find(q => q.value === quality)?.label || '最高畫質'}
                          </span>
                        </span>
                      </div>
                      <ChevronDown className={cn("w-4 h-4 transition-transform", showQuality && "rotate-180")} />
                    </button>

                    {showQuality && (
                      <div className="absolute top-full mt-2 w-full bg-zinc-900 border border-zinc-800/60 rounded-2xl overflow-hidden shadow-2xl z-50 animate-fade-in">
                        {QUALITY_OPTIONS.map(q => (
                          <button
                            key={q.value}
                            onClick={() => { setQuality(q.value); setShowQuality(false); }}
                            className={cn(
                              "w-full px-4 py-3 text-sm flex items-center justify-between transition-colors",
                              quality === q.value
                                ? "bg-violet-600/20 text-violet-300"
                                : "text-zinc-300 hover:bg-zinc-800/60"
                            )}
                          >
                            <span className="font-medium">{q.label}</span>
                            <span className="text-xs text-zinc-500">{q.desc}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Download button */}
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className={cn(
                    "w-full py-4.5 rounded-2xl font-bold text-base flex items-center justify-center gap-3 transition-all duration-300 active:scale-[0.97]",
                    downloadType === 'video'
                      ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-xl shadow-emerald-500/20 hover:shadow-emerald-500/40"
                      : "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-xl shadow-orange-500/20 hover:shadow-orange-500/40",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {downloading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      準備下載中...
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5" />
                      {downloadType === 'video' ? '下載影片' : '下載音訊'}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Supported Platforms Section */}
          {!data && !loading && (
            <div className="mt-4 animate-fade-in">
              <h3 className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-3 text-center">
                支援平台
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(PLATFORMS).filter(([k]) => k !== 'other').map(([key, p]) => (
                  <div
                    key={key}
                    className="flex flex-col items-center gap-1.5 p-3 bg-zinc-900/40 border border-zinc-800/30 rounded-2xl hover:border-zinc-700/50 transition-all duration-300 hover:scale-105 active:scale-95"
                  >
                    <span className="text-xl">{p.icon}</span>
                    <span className="text-[10px] text-zinc-500 font-medium text-center leading-tight">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </main>

        {/* Footer */}
        <footer className="px-5 py-4 text-center border-t border-zinc-800/30">
          <p className="text-[10px] text-zinc-700">
            Powered by yt-dlp · 僅供個人使用
          </p>
        </footer>
      </div>

      {/* Floating Quick Save Button */}
      <div className="fixed bottom-8 right-5 z-[9999] flex flex-col items-end gap-2">
        {/* Status toast */}
        {quickSaveMsg && (
          <div className={cn(
            "px-4 py-2.5 rounded-2xl text-xs font-semibold shadow-2xl backdrop-blur-md animate-fade-in max-w-[200px] text-center",
            quickSaveStatus === 'error'
              ? "bg-red-500/90 text-white"
              : quickSaveStatus === 'success'
              ? "bg-emerald-500/90 text-white"
              : "bg-zinc-800/90 text-zinc-200 border border-zinc-700/50"
          )}>
            {quickSaveMsg}
          </div>
        )}

        {/* FAB button */}
        <button
          onClick={handleQuickSave}
          disabled={quickSaveStatus === 'fetching' || quickSaveStatus === 'downloading'}
          className={cn(
            "w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 active:scale-90",
            "ring-2 ring-white/10",
            quickSaveStatus === 'idle' && "bg-gradient-to-br from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 shadow-violet-500/30",
            quickSaveStatus === 'reading' && "bg-gradient-to-br from-amber-500 to-orange-500 shadow-amber-500/30",
            quickSaveStatus === 'fetching' && "bg-gradient-to-br from-blue-500 to-cyan-500 shadow-blue-500/30 animate-pulse",
            quickSaveStatus === 'downloading' && "bg-gradient-to-br from-blue-500 to-cyan-500 shadow-blue-500/30 animate-pulse",
            quickSaveStatus === 'success' && "bg-gradient-to-br from-emerald-500 to-teal-500 shadow-emerald-500/30",
            quickSaveStatus === 'error' && "bg-gradient-to-br from-red-500 to-rose-500 shadow-red-500/30",
            "disabled:opacity-70"
          )}
          aria-label="快速儲存影片"
        >
          {(quickSaveStatus === 'fetching' || quickSaveStatus === 'downloading') ? (
            <Loader2 className="w-7 h-7 text-white animate-spin" />
          ) : quickSaveStatus === 'success' ? (
            <CheckCircle2 className="w-7 h-7 text-white" />
          ) : quickSaveStatus === 'error' ? (
            <AlertCircle className="w-7 h-7 text-white" />
          ) : (
            <Save className="w-7 h-7 text-white" />
          )}
        </button>
      </div>
    </div>
  );
}
