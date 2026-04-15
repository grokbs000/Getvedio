import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import https from 'https';

const execFileAsync = promisify(execFile);

// Helper to get yt-dlp binary path (Auto-downloads in Vercel environment)
async function getYtdlpPath(): Promise<string> {
  if (process.env.VERCEL) {
    const dest = '/tmp/yt-dlp';
    if (!fs.existsSync(dest)) {
      console.log('🔄 Downloading yt-dlp standalone binary for Vercel...');
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
        https.get(url, (response) => {
          if (response.statusCode === 302 && response.headers.location) {
            https.get(response.headers.location, (res) => {
              res.pipe(file);
              file.on('finish', () => { file.close(); fs.chmodSync(dest, 0o755); resolve(true); });
            }).on('error', reject);
          } else {
            response.pipe(file);
            file.on('finish', () => { file.close(); fs.chmodSync(dest, 0o755); resolve(true); });
          }
        }).on('error', reject);
      });
      console.log('✅ yt-dlp standalone binary downloaded to /tmp/yt-dlp');
    }
    return dest;
  }
  return 'yt-dlp';
}

// Function to update yt-dlp manually
async function ensureLatestYtdlp() {
  if (process.env.VERCEL) return; // Vercel downloads latest automatically
  console.log('🔄 Checking for yt-dlp updates...');
  try {
    const ytdlpPath = await getYtdlpPath();
    const { stdout, stderr } = await execFileAsync(ytdlpPath, ['-U']);
    console.log('✅ yt-dlp Update Result:', stdout.trim());
    if (stderr) console.error('⚠️ yt-dlp Update Warning:', stderr);
  } catch (error: any) {
    console.error('❌ Failed to update yt-dlp:', error.message || error);
  }
}

function getBaseYtdlpArgs(url?: string): string[] {
  const args = ['--no-warnings'];
  const cookiesPath = process.env.VERCEL ? '/tmp/cookies.txt' : path.join(process.cwd(), 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath);
  } else {
    // Fallback to mobile User-Agent which helps bypass some blocks
    // Exclude TikTok/Douyin (mobile breaking) and Bilibili (WAF strict UA mapping)
    if (!url || !/(tiktok\.com|douyin\.com|bilibili\.com|b23\.tv)/i.test(url)) {
      args.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');
    }
  }

  // Bilibili specific fixes: use multiple clients to bypass 412 errors
  if (url && /(bilibili\.com|b23\.tv)/i.test(url)) {
    args.push('--extractor-args', 'bilibili:player_client=ios,tv,web');
    args.push('--add-header', 'Referer: https://www.bilibili.com');
  }

  // Xiaohongshu specific: add referer and proper headers
  if (url && /(xiaohongshu\.com|xhslink\.com)/i.test(url)) {
    args.push('--add-header', 'Referer: https://www.xiaohongshu.com');
  }

  return args;
}

const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
  youtube: [/youtube\.com/, /youtu\.be/, /youtube\.com\/shorts/],
  tiktok: [/tiktok\.com/, /vm\.tiktok\.com/],
  douyin: [/douyin\.com/],
  instagram: [/instagram\.com/, /instagr\.am/],
  facebook: [/facebook\.com/, /fb\.watch/, /fb\.com/],
  twitter: [/twitter\.com/, /x\.com/, /t\.co/],
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

function detectPlatform(url: string): string {
  const lower = url.toLowerCase();
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    if (patterns.some(p => p.test(lower))) return platform;
  }
  return 'other';
}

// Extract XHS note ID from a resolved xiaohongshu.com URL
function extractXhsNoteId(url: string): string | null {
  const m = url.match(/\/(?:discovery\/item|explore|item)\/([a-zA-Z0-9]+)/i);
  return m ? m[1] : null;
}

// Try multiple third-party XHS download APIs to get video info
async function fetchXhsViaThirdParty(noteId: string | null, originalUrl: string): Promise<{ videoUrl: string; title: string; cover: string } | null> {
  const { default: axios } = await import('axios');
  // Use the full URL if it contains xsec_token, otherwise use the noteId link
  const targetUrl = originalUrl.includes('xsec') ? originalUrl : (noteId ? `https://www.xiaohongshu.com/explore/${noteId}` : originalUrl);

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

  // Helper for fast API calls
  async function tryApi(name: string, config: any) {
    try {
      const res = await axios({ ...config, timeout: 5000, headers: { ...headers, ...config.headers } });
      return res;
    } catch (e) {
      console.log(`${name} failed`);
      return null;
    }
  }

  // API 0: anythink.cc
  let r = await tryApi('anythink.cc', { url: `https://v.anythink.cc/api/video/xiaohongshu?url=${encodeURIComponent(targetUrl)}` });
  if (r?.data?.code === 200 && r?.data?.data?.video) {
    return { videoUrl: r.data.data.video, title: r.data.data.title || '小紅書影片', cover: r.data.data.cover || '' };
  }

  // API 1: TenAPI
  r = await tryApi('TenAPI', { url: `https://tenapi.cn/v2/xiaohongshu?url=${encodeURIComponent(targetUrl)}` });
  if (r?.data?.code === 200 && r?.data?.data?.url) {
    return { videoUrl: r.data.data.url, title: r.data.data.title || '小紅書影片', cover: r.data.data.cover || '' };
  }

  // API 2: ExperAPI
  r = await tryApi('ExperAPI', { url: `https://www.experapi.com/xhsdown/index.php?url=${encodeURIComponent(targetUrl)}` });
  if (r?.data?.data?.video_url || r?.data?.video || r?.data?.url) {
    const videoUrl = r.data?.data?.video_url || r.data?.video || r.data?.url;
    return { videoUrl, title: r.data?.data?.title || r.data?.title || '小紅書影片', cover: r.data?.data?.cover || r.data?.cover || '' };
  }

  // API 3: Pearktrue
  r = await tryApi('Pearktrue', { url: `https://api.pearktrue.cn/api/xiaohongshu/?url=${encodeURIComponent(targetUrl)}` });
  if (r?.data?.code === 200 && r?.data?.data?.video) {
    return { videoUrl: r.data.data.video, title: r.data.data.title || '小紅書影片', cover: r.data.data.img || '' };
  }

  // API 4: xhsdownload (Post)
  try {
    const res = await axios.post('https://api2.xhsdownload.com/api/xhs', { url: targetUrl }, { timeout: 5000, headers: { ...headers, 'Content-Type': 'application/json' } });
    if (res.data?.data?.video) {
      return { videoUrl: res.data.data.video, title: res.data.data.title || '小紅書影片', cover: res.data.data.cover || '' };
    }
  } catch {}

  return null;
}

async function sanitizeVideoUrl(inputUrl: string): Promise<string> {
  if (!inputUrl) return inputUrl;
  try {
    let finalUrl = inputUrl;
    
    // Resolve b23.tv shortlinks if needed
    if (finalUrl.includes('b23.tv')) {
      const { default: axios } = await import('axios');
      try {
        const res = await axios.get(finalUrl, {
          maxRedirects: 5,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (res.request?.res?.responseUrl) {
          finalUrl = res.request.res.responseUrl;
        }
      } catch (err: any) {
        if (err.response?.headers?.location) {
          finalUrl = err.response.headers.location;
          if (finalUrl.startsWith('/')) finalUrl = 'https://www.bilibili.com' + finalUrl;
        }
      }
    }

    // Resolve xhslink.com shortlinks
    // Manually follow redirects to avoid TLS block on final xiaohongshu.com domain
    if (finalUrl.includes('xhslink.com')) {
      const { default: axios } = await import('axios');
      try {
        let currentUrl = finalUrl;
        for (let i = 0; i < 5; i++) {
          if (currentUrl.includes('xiaohongshu.com')) break;
          const res = await axios.get(currentUrl, {
            maxRedirects: 0,
            timeout: 3000,
            validateStatus: (status) => status >= 200 && status < 400,
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });
          
          if (res.status >= 300 && res.status < 400 && res.headers.location) {
            currentUrl = res.headers.location;
          } else {
            break;
          }
        }
        
        if (currentUrl.includes('xiaohongshu.com')) {
           finalUrl = currentUrl;
           console.log('✅ Resolved xhslink.com manually →', finalUrl);
        }
      } catch (err: any) {
        console.error('⚠️ Failed to resolve xhslink.com:', err.message);
      }
    }

    // Clean m.bilibili.com and strip query parameters for stability
    if (finalUrl.includes('m.bilibili.com/video/')) {
      finalUrl = finalUrl.replace(/m\.bilibili\.com\/video\//g, 'www.bilibili.com/video/');
    }
    
    // Strip query parameters for Bilibili to avoid WAF blocks
    if (finalUrl.includes('bilibili.com/video/')) {
      try {
        const u = new URL(finalUrl);
        finalUrl = u.origin + u.pathname;
      } catch {}
    }

    return finalUrl;
  } catch {
    return inputUrl;
  }
}

interface VideoFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize: number | null;
  vcodec: string;
  acodec: string;
  format_note: string;
  fps: number | null;
  tbr: number | null;
  has_video: boolean;
  has_audio: boolean;
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
  formats: VideoFormat[];
  is_playlist: boolean;
  playlist_count: number | null;
}

async function getVideoInfo(url: string): Promise<VideoInfo> {
  const ytdlpPath = await getYtdlpPath();
  try {
    const { stdout } = await execFileAsync(ytdlpPath, [
      ...getBaseYtdlpArgs(url),
      '--dump-json',
      '--no-playlist',
      '--socket-timeout', '10',
      url
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 20000 });

    const data = JSON.parse(stdout);
    const platform = detectPlatform(url);

    const formats: VideoFormat[] = (data.formats || [])
      .filter((f: any) => f.url || f.manifest_url)
      .map((f: any) => ({
        format_id: f.format_id || '',
        ext: f.ext || 'mp4',
        resolution: f.resolution || (f.height ? `${f.width || '?'}x${f.height}` : 'audio only'),
        filesize: f.filesize || f.filesize_approx || null,
        vcodec: f.vcodec || 'none',
        acodec: f.acodec || 'none',
        format_note: f.format_note || '',
        fps: f.fps || null,
        tbr: f.tbr || null,
        has_video: f.vcodec !== 'none' && f.vcodec !== null,
        has_audio: f.acodec !== 'none' && f.acodec !== null,
      }));

    return {
      id: data.id || '',
      title: data.title || 'Untitled',
      description: data.description || '',
      thumbnail: data.thumbnail || '',
      duration: data.duration ?? null,
      uploader: data.uploader || data.channel || data.creator || 'Unknown',
      uploader_id: data.uploader_id || data.channel_id || '',
      view_count: data.view_count || null,
      like_count: data.like_count || null,
      platform,
      webpage_url: data.webpage_url || url,
      formats,
      is_playlist: false,
      playlist_count: null,
    };
  } catch (err: any) {
    if (detectPlatform(url) === 'tiktok') {
      try {
        console.log('🔄 yt-dlp failed for TikTok, falling back to TikWM...');
        const { default: axios } = await import('axios');
        const tikwmRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        if (tikwmRes.data?.code === 0 && tikwmRes.data?.data) {
          const tData = tikwmRes.data.data;
          return {
            id: tData.id || '',
            title: tData.title || 'TikTok Video',
            description: tData.title || '',
            thumbnail: tData.cover || tData.origin_cover || '',
            duration: tData.duration || null,
            uploader: tData.author?.nickname || 'Unknown',
            uploader_id: tData.author?.unique_id || '',
            view_count: tData.play_count || null,
            like_count: tData.digg_count || null,
            platform: 'tiktok',
            webpage_url: url,
            formats: [{
              format_id: 'tikwm',
              ext: 'mp4',
              resolution: '1080p',
              filesize: tData.size || null,
              vcodec: 'h264',
              acodec: 'aac',
              format_note: 'Watermark-free',
              fps: null,
              tbr: null,
              has_video: true,
              has_audio: true,
            }],
            is_playlist: false,
            playlist_count: null,
          };
        }
      } catch (tikwmErr: any) {
        console.error('TikWM info fallback failed:', tikwmErr.message);
      }
    }

    // Xiaohongshu fallback: direct page scraping + third-party APIs
    if (detectPlatform(url) === 'xiaohongshu') {
      const noteId = extractXhsNoteId(url);
      console.log('🔄 yt-dlp failed for XHS, trying direct scraping... Note ID:', noteId || 'unknown');

      // Step 1: Direct page scraping (works from servers that can reach xiaohongshu.com)
      try {
        const { default: axios } = await import('axios');
        const xhsRes = await axios.get(url, {
          timeout: 8000,
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': 'https://www.xiaohongshu.com',
          },
        });

        const html = xhsRes.data;
        const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})<\/script>/s)
          || html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})\s*;?\s*<\/script>/s);

        if (stateMatch) {
          const jsonStr = stateMatch[1].replace(/undefined/g, 'null');
          const state = JSON.parse(jsonStr);
          const noteData = state?.note?.noteDetailMap;
          const firstNote = noteData ? Object.values(noteData)[0] as any : null;
          const note = firstNote?.note;

          if (note) {
            const videoInfo = note.video;
            let videoUrl = '';
            if (videoInfo?.consumer?.originVideoKey) {
              videoUrl = `https://sns-video-bd.xhscdn.com/${videoInfo.consumer.originVideoKey}`;
            } else if (videoInfo?.media?.stream?.h264?.[0]?.masterUrl) {
              videoUrl = videoInfo.media.stream.h264[0].masterUrl;
            }

            const coverUrl = note.imageList?.[0]?.urlDefault
              || note.imageList?.[0]?.url
              || note.imageList?.[0]?.infoList?.[0]?.url
              || '';

            console.log('✅ XHS direct scraping success, video URL found:', !!videoUrl);
            return {
              id: note.noteId || note.id || noteId || '',
              title: note.title || note.desc || '小紅書影片',
              description: note.desc || '',
              thumbnail: coverUrl,
              duration: videoInfo?.capa?.duration ? Math.round(videoInfo.capa.duration / 1000) : null,
              uploader: note.user?.nickname || note.user?.nickName || 'Unknown',
              uploader_id: note.user?.userId || '',
              view_count: note.interactInfo?.viewCount || null,
              like_count: note.interactInfo?.likedCount || null,
              platform: 'xiaohongshu',
              webpage_url: url,
              formats: videoUrl ? [{
                format_id: 'xhs-origin',
                ext: 'mp4',
                resolution: 'original',
                filesize: null,
                vcodec: 'h264',
                acodec: 'aac',
                format_note: 'Original',
                fps: null,
                tbr: null,
                has_video: true,
                has_audio: true,
              }] : [],
              is_playlist: false,
              playlist_count: null,
            };
          }
        }

        // Fallback: try og:video meta tag from the page
        const ogVideoMatch = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/)
          || html.match(/<meta[^>]*property="og:video:url"[^>]*content="([^"]+)"/);
        const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
        const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);

        if (ogVideoMatch || ogTitleMatch) {
          console.log('✅ XHS og:video fallback, video found:', !!ogVideoMatch);
          return {
            id: noteId || '',
            title: ogTitleMatch?.[1] || '小紅書影片',
            description: '',
            thumbnail: ogImageMatch?.[1] || '',
            duration: null,
            uploader: 'Unknown',
            uploader_id: '',
            view_count: null,
            like_count: null,
            platform: 'xiaohongshu',
            webpage_url: url,
            formats: ogVideoMatch ? [{
              format_id: 'xhs-og',
              ext: 'mp4',
              resolution: 'original',
              filesize: null,
              vcodec: 'h264',
              acodec: 'aac',
              format_note: 'OG Video',
              fps: null,
              tbr: null,
              has_video: true,
              has_audio: true,
            }] : [],
            is_playlist: false,
            playlist_count: null,
          };
        }
      } catch (scrapeErr: any) {
        console.error('XHS direct scraping failed:', scrapeErr.message);
      }

      // Step 2: Third-party APIs as secondary fallback
      try {
        const xhsData = await fetchXhsViaThirdParty(noteId, url);
        if (xhsData) {
          return {
            id: noteId || '',
            title: xhsData.title,
            description: '',
            thumbnail: xhsData.cover,
            duration: null,
            uploader: 'Unknown',
            uploader_id: '',
            view_count: null,
            like_count: null,
            platform: 'xiaohongshu',
            webpage_url: url,
            formats: xhsData.videoUrl ? [{
              format_id: 'xhs-thirdparty',
              ext: 'mp4',
              resolution: 'original',
              filesize: null,
              vcodec: 'h264',
              acodec: 'aac',
              format_note: 'Original',
              fps: null,
              tbr: null,
              has_video: true,
              has_audio: true,
            }] : [],
            is_playlist: false,
            playlist_count: null,
          };
        }
      } catch (apiErr: any) {
        console.error('XHS third-party API fallback failed:', apiErr.message);
      }
      
      throw new Error('小紅書影片解析失敗。請確認連結為公開影片。');
    }

    if (detectPlatform(url) === 'instagram') {
      try {
        console.log('🔄 yt-dlp failed for Instagram, trying third-party fallback...');
        const { default: axios } = await import('axios');
        // Try a few known IG scraper APIs
        const igApis = [
          `https://api.vience.cn/api/ins?url=${encodeURIComponent(url)}`,
          `https://api.pearktrue.cn/api/instagram/?url=${encodeURIComponent(url)}`
        ];

        for (const api of igApis) {
          try {
            const res = await axios.get(api, { timeout: 15000 });
            if (res.data?.code === 200 && (res.data?.data?.video || res.data?.data?.url)) {
              const d = res.data.data;
              console.log('✅ Instagram via third-party:', api);
              return {
                id: '',
                title: 'Instagram Video',
                description: '',
                thumbnail: d.cover || d.thumbnail || '',
                duration: null,
                uploader: 'Instagram User',
                uploader_id: '',
                view_count: null,
                like_count: null,
                platform: 'instagram',
                webpage_url: url,
                formats: [{
                  format_id: 'ig-thirdparty',
                  ext: 'mp4',
                  resolution: 'original',
                  filesize: null,
                  vcodec: 'h264',
                  acodec: 'aac',
                  format_note: 'Original',
                  fps: null,
                  tbr: null,
                  has_video: true,
                  has_audio: true,
                }],
                is_playlist: false,
                playlist_count: null,
              };
            }
          } catch {}
        }
      } catch (igErr: any) {
        console.error('Instagram fallback failed:', igErr.message);
      }
    }

    if (err.stderr?.includes('playlist') || err.message?.includes('playlist')) {
      try {
        const { stdout } = await execFileAsync(ytdlpPath, [
          ...getBaseYtdlpArgs(url),
          '--flat-playlist',
          '--dump-json',
          url
        ], { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });

        const entries = stdout.trim().split('\n').map((line: string) => JSON.parse(line));
        const first = entries[0] || {};
        const platform = detectPlatform(url);

        return {
          id: first.id || '',
          title: first.playlist_title || first.title || 'Playlist',
          description: '',
          thumbnail: first.thumbnail || first.thumbnails?.[0]?.url || '',
          duration: null,
          uploader: first.uploader || first.channel || 'Unknown',
          uploader_id: first.uploader_id || '',
          view_count: null,
          like_count: null,
          platform,
          webpage_url: url,
          formats: [],
          is_playlist: true,
          playlist_count: entries.length,
        };
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

// ======================= APP SETUP =======================
const app = express();
app.use(express.json());

// Fetch video info
app.post('/api/fetch-info', async (req, res) => {
  try {
    let { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    url = await sanitizeVideoUrl(url);
    const info = await getVideoInfo(url);
    res.json(info);
  } catch (error: any) {
    console.error('Error fetching video info:', error.message || error);
    
    // Check if it's a known expected error, return 400 instead of 500
    const errStr = error.stderr || error.message || '';
    if (errStr.includes('小紅書影片解析失敗') || errStr.includes('Unsupported URL') || errStr.includes('Video unavailable')) {
        return res.status(400).json({ error: error.message || '不支援的影片連結，或影片已設為私密。' });
    }

    res.status(500).json({ error: error.stderr ? error.stderr.split('\n').filter((l: string) => l.includes('ERROR')).join('; ') || 'Failed to fetch video info' : error.message || 'Failed to fetch video info' });
  }
});

// Download video via yt-dlp streaming
app.get('/api/download', async (req, res) => {
  try {
    let url = req.query.url as string;
    const quality = req.query.quality as string || 'best';
    const format = req.query.format as string || 'mp4';
    const audioOnly = req.query.audioOnly === 'true';
    const embedSubs = req.query.embedSubs === 'true';
    const titleHint = req.query.title as string || '';

    if (!url) {
      return res.status(400).send('URL is required');
    }
    url = await sanitizeVideoUrl(url);

    const ytdlpPath = await getYtdlpPath();
    const args: string[] = [...getBaseYtdlpArgs(url), '--no-playlist', '-o', '-', '-N', '8'];

    if (embedSubs && !audioOnly) {
      args.push('--write-subs', '--write-auto-subs', '--embed-subs');
    }

    if (audioOnly) {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      args.splice(args.indexOf('-o'), 2); 
      args.push('-o', '-');
    } else {
      let formatStr = '';
      switch (quality) {
        case '2160': formatStr = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best'; break;
        case '1440': formatStr = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best'; break;
        case '1080': formatStr = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best'; break;
        case '720': formatStr = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best'; break;
        case '480': formatStr = 'bestvideo[height<=480]+bestaudio/best[height<=480]/best'; break;
        case '360': formatStr = 'bestvideo[height<=360]+bestaudio/best[height<=360]/best'; break;
        default: formatStr = 'bestvideo+bestaudio/best';
      }
      args.push('-f', formatStr);
      if (format === 'mp4') {
        args.push('--merge-output-format', embedSubs ? 'mkv' : 'mp4');
      }
    }
    args.push(url);

    let filename = 'download';
    let ytdlpFailed = false;
    try {
      const { stdout: nameOut } = await execFileAsync(ytdlpPath, [
        ...getBaseYtdlpArgs(url),
        '--get-filename',
        '--no-playlist',
        '-o', '%(title)s.%(ext)s',
        url
      ], { timeout: 20000 });
      filename = nameOut.trim();
    } catch (err: any) {
      console.log('yt-dlp get-filename failed:', err.message);
      ytdlpFailed = true;
      // Use title hint from frontend as fallback filename
      if (titleHint) {
        const ext = audioOnly ? 'mp3' : (format || 'mp4');
        filename = `${titleHint}.${ext}`;
        console.log('Using title hint as filename:', filename);
      }
    }

    if (ytdlpFailed && detectPlatform(url) === 'tiktok') {
      try {
        console.log('🔄 yt-dlp failed, falling back to TikWM proxy stream...');
        const { default: axios } = await import('axios');
        const tikwmRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        if (tikwmRes.data?.code === 0 && tikwmRes.data?.data) {
          const tData = tikwmRes.data.data;
          let targetUrl = tData.play || tData.wmplay;
          if (audioOnly) {
            targetUrl = tData.music || targetUrl;
          }
          if (targetUrl) {
            console.log('✅ Proxying TikWM CDN URL to Client');
            let fallbackFilename = (tData.title || `tiktok_${tData.id}`) + (audioOnly ? '.mp3' : '.mp4');
            fallbackFilename = fallbackFilename.replace(/[/\\?%*:|"<>]/g, '_');
            
            const response = await axios.get(targetUrl, { responseType: 'stream' });
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fallbackFilename)}"; filename*=UTF-8''${encodeURIComponent(fallbackFilename)}`);
            res.setHeader('Content-Type', audioOnly ? 'audio/mpeg' : 'video/mp4');
            if (response.headers['content-length']) {
              res.setHeader('Content-Length', response.headers['content-length']);
            }
            return response.data.pipe(res);
          }
        }
      } catch (e: any) {
        console.error('TikWM fallback proxy stream failed:', e.message);
      }
    }

    // Xiaohongshu download fallback: direct scraping + third-party APIs
    if (ytdlpFailed && detectPlatform(url) === 'xiaohongshu') {
      const { default: axios } = await import('axios');
      const noteId = extractXhsNoteId(url);
      let videoUrl = '';
      let xhsTitle = '';

      // Step 1: Direct page scraping
      try {
        console.log('🔄 yt-dlp failed for XHS download, trying direct scraping...');
        const xhsRes = await axios.get(url, {
          timeout: 20000,
          maxRedirects: 10,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': 'https://www.xiaohongshu.com',
          },
        });

        const html = xhsRes.data;
        const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})<\/script>/s)
          || html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})\s*;?\s*<\/script>/s);

        if (stateMatch) {
          const jsonStr = stateMatch[1].replace(/undefined/g, 'null');
          const state = JSON.parse(jsonStr);
          const noteData = state?.note?.noteDetailMap;
          const firstNote = noteData ? Object.values(noteData)[0] as any : null;
          const note = firstNote?.note;
          if (note) {
            xhsTitle = note.title || note.desc || '小紅書影片';
            const videoInfo = note.video;
            if (videoInfo?.consumer?.originVideoKey) {
              videoUrl = `https://sns-video-bd.xhscdn.com/${videoInfo.consumer.originVideoKey}`;
            } else if (videoInfo?.media?.stream?.h264?.[0]?.masterUrl) {
              videoUrl = videoInfo.media.stream.h264[0].masterUrl;
            }
          }
        }

        if (!videoUrl) {
          const ogVideoMatch = html.match(/<meta[^>]*property="og:video(?::url)?"[^>]*content="([^"]+)"/);
          const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
          if (ogVideoMatch) videoUrl = ogVideoMatch[1];
          if (ogTitleMatch) xhsTitle = xhsTitle || ogTitleMatch[1];
        }
      } catch (scrapeErr: any) {
        console.error('XHS direct scraping for download failed:', scrapeErr.message);
      }

      // Step 2: Third-party APIs if scraping didn't find video
      if (!videoUrl) {
        try {
          const xhsData = await fetchXhsViaThirdParty(noteId, url);
          if (xhsData?.videoUrl) {
            videoUrl = xhsData.videoUrl;
            xhsTitle = xhsTitle || xhsData.title;
          }
        } catch (e: any) {
          console.error('XHS third-party download fallback failed:', e.message);
        }
      }

      // Proxy the video stream
      if (videoUrl) {
        try {
          console.log('✅ Proxying XHS video to client');
          let xhsFilename = (xhsTitle || titleHint || 'xiaohongshu_video') + '.mp4';
          xhsFilename = xhsFilename.replace(/[/\\?%*:"|<>]/g, '_');

          const response = await axios.get(videoUrl, {
            responseType: 'stream',
            timeout: 60000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://www.xiaohongshu.com',
            },
          });
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(xhsFilename)}"; filename*=UTF-8''${encodeURIComponent(xhsFilename)}`);
          res.setHeader('Content-Type', 'video/mp4');
          if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
          }
          return response.data.pipe(res);
        } catch (proxyErr: any) {
          console.error('XHS video proxy failed:', proxyErr.message);
        }
      }
    }

    filename = filename.replace(/[/\\?%*:|"<>]/g, '_');
    if (audioOnly && !filename.endsWith('.mp3')) {
      filename = filename.replace(/\.[^.]+$/, '.mp3');
    } else if (!audioOnly) {
      const targetExt = embedSubs ? '.mkv' : `.${format}`;
      if (!filename.endsWith(targetExt)) {
        filename = filename.replace(/\.[^.]+$/, targetExt);
      }
    }

    const contentType = audioOnly ? 'audio/mpeg' : 'video/mp4';

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Transfer-Encoding', 'chunked');

    const ytdlp = spawn(ytdlpPath, args);
    ytdlp.stdout.pipe(res);

    ytdlp.stderr.on('data', (data) => {
      const line = data.toString();
      if (line.includes('[download]')) console.log(line.trim());
    });

    ytdlp.on('error', (err) => {
      console.error('yt-dlp spawn error:', err);
      if (!res.headersSent) res.status(500).send('Download failed');
    });

    ytdlp.on('close', (code) => {
      if (code !== 0 && !res.headersSent) res.status(500).send('Download failed');
    });

    req.on('close', () => ytdlp.kill('SIGTERM'));

  } catch (error) {
    console.error('Error downloading:', error);
    if (!res.headersSent) res.status(500).send('Error downloading file');
  }
});

// Helper for download-progress temp folder
function getTmpDownloadsDir() {
  return process.env.VERCEL ? '/tmp/.downloads' : path.join(process.cwd(), '.downloads');
}

app.get('/api/download-progress', async (req, res) => {
  let url = req.query.url as string;
  const quality = req.query.quality as string || 'best';
  const audioOnly = req.query.audioOnly === 'true';
  const embedSubs = req.query.embedSubs === 'true';

  if (!url) return res.status(400).json({ error: 'URL is required' });
  url = await sanitizeVideoUrl(url);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const ytdlpPath = await getYtdlpPath();
  const args: string[] = [...getBaseYtdlpArgs(url), '--no-playlist', '--newline', '-N', '8'];

  if (embedSubs && !audioOnly) {
    args.push('--write-subs', '--write-auto-subs', '--embed-subs');
  }

  if (audioOnly) {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    // ... quality select ...
    let formatStr = 'bestvideo+bestaudio/best';
    args.push('-f', formatStr, '--merge-output-format', embedSubs ? 'mkv' : 'mp4');
  }

  const tmpDir = getTmpDownloadsDir();
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

  const outputTemplate = path.join(tmpDir, '%(title)s.%(ext)s');
  args.push('-o', outputTemplate, url);

  const ytdlp = spawn(ytdlpPath, args);
  let outputFile = '';

  ytdlp.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.includes('[download] Destination:')) {
        outputFile = line.replace('[download] Destination:', '').trim();
      }
      const progressMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\w+)\s+at\s+([\d.]+\w+\/s|Unknown speed)/);
      if (progressMatch) {
        res.write(`data: ${JSON.stringify({ type: 'progress', percent: parseFloat(progressMatch[1]), size: progressMatch[2], speed: progressMatch[3] })}\n\n`);
      }
    }
  });

  ytdlp.on('close', (code) => {
    if (code === 0) res.write(`data: ${JSON.stringify({ type: 'complete', file: path.basename(outputFile) })}\n\n`);
    else res.write(`data: ${JSON.stringify({ type: 'error', message: 'Download failed' })}\n\n`);
    res.end();
  });
  req.on('close', () => ytdlp.kill('SIGTERM'));
});

// Proxy thumbnail images
app.get('/api/proxy-image', async (req, res) => {
  try {
    const imageUrl = req.query.url as string;
    if (!imageUrl) return res.status(400).send('URL required');
    const { default: axios } = await import('axios');
    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': new URL(imageUrl).origin }
    });
    if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    response.data.pipe(res);
  } catch {
    res.status(404).send('Image not found');
  }
});

app.get('/api/serve-file/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(getTmpDownloadsDir(), filename);
  res.download(filePath, filename, (err) => {
    if (err) if (!res.headersSent) res.status(404).send('File not found');
    try { fs.unlinkSync(filePath); } catch {}
  });
});

// Start local dev server if not in Vercel
if (!process.env.VERCEL) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  (async () => {
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    app.listen(PORT, '0.0.0.0', async () => {
      console.log(`🚀 GetVideo Server running on port ${PORT}`);
      if (!process.env.RENDER) {
        await ensureLatestYtdlp();
      }
    });
  })();
}

export default app;
