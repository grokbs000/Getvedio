import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { execFile, spawn } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Helper to get common yt-dlp args (cookies for IG/XHS)
function getBaseYtdlpArgs(url?: string): string[] {
  const args = ['--no-warnings'];
  const cookiesPath = path.join(process.cwd(), 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    args.push('--cookies', cookiesPath);
  } else {
    // Fallback to mobile User-Agent which helps bypass some blocks
    // Exclude TikTok/Douyin as the mobile markup breaks yt-dlp parsing (causes "status code 0")
    if (!url || !/(tiktok\.com|douyin\.com)/i.test(url)) {
      args.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');
    }
  }
  return args;
}

// Function to update yt-dlp to the latest version
async function ensureLatestYtdlp() {
  console.log('🔄 Checking for yt-dlp updates...');
  try {
    const { stdout, stderr } = await execFileAsync('yt-dlp', ['-U']);
    console.log('✅ yt-dlp Update Result:', stdout.trim());
    if (stderr) console.error('⚠️ yt-dlp Update Warning:', stderr);
  } catch (error: any) {
    console.error('❌ Failed to update yt-dlp:', error.message || error);
  }
}


// Platform detection patterns
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
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      ...getBaseYtdlpArgs(url),
      '--dump-json',
      '--no-playlist',
      '--socket-timeout', '30',
      url
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });

    const data = JSON.parse(stdout);
    const platform = detectPlatform(url);

    // Parse formats
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
      duration: data.duration || null,
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
    // Check if it's a playlist
    if (err.stderr?.includes('playlist') || err.message?.includes('playlist')) {
      try {
        const { stdout } = await execFileAsync('yt-dlp', [
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

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

  // Fetch video info
  app.post('/api/fetch-info', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }

      const info = await getVideoInfo(url);
      res.json(info);
    } catch (error: any) {
      console.error('Error fetching video info:', error.message || error);
      const errMsg = error.stderr
        ? error.stderr.split('\n').filter((l: string) => l.includes('ERROR')).join('; ') || 'Failed to fetch video info'
        : error.message || 'Failed to fetch video info';
    }
  });

  // Manual update trigger for yt-dlp (Admin/Maintenance)
  app.post('/api/update-ytdlp', async (req, res) => {
    try {
      console.log('🚀 Manual yt-dlp update triggered via API');
      const { stdout } = await execFileAsync('yt-dlp', ['-U']);
      res.json({ message: 'Update process completed', output: stdout.trim() });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Update failed' });
    }
  });


  // Download video via yt-dlp streaming
  app.get('/api/download', async (req, res) => {
    try {
      const url = req.query.url as string;
      const quality = req.query.quality as string || 'best';
      const format = req.query.format as string || 'mp4';
      const audioOnly = req.query.audioOnly === 'true';

      if (!url) {
        return res.status(400).send('URL is required');
      }

      // Build yt-dlp args
      const args: string[] = [...getBaseYtdlpArgs(url), '--no-playlist', '-o', '-'];

      if (audioOnly) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
        // When extracting audio to stdout, we need to use a specific approach
        args.splice(args.indexOf('-o'), 2); // Remove -o -
        args.push('-o', '-');
      } else {
        // Video format selection
        let formatStr = '';
        switch (quality) {
          case '2160':
            formatStr = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best';
            break;
          case '1440':
            formatStr = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]/best';
            break;
          case '1080':
            formatStr = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
            break;
          case '720':
            formatStr = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
            break;
          case '480':
            formatStr = 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
            break;
          case '360':
            formatStr = 'bestvideo[height<=360]+bestaudio/best[height<=360]/best';
            break;
          default:
            formatStr = 'bestvideo+bestaudio/best';
        }
        args.push('-f', formatStr);

        // Merge to mp4
        if (format === 'mp4') {
          args.push('--merge-output-format', 'mp4');
        }
      }

      args.push(url);

      // First get filename
      let filename = 'download';
      try {
        const { stdout: nameOut } = await execFileAsync('yt-dlp', [
          ...getBaseYtdlpArgs(url),
          '--get-filename',
          '--no-playlist',
          '-o', '%(title)s.%(ext)s',
          url
        ], { timeout: 30000 });
        filename = nameOut.trim();
      } catch {
        // fallback
      }

      // Sanitize filename
      filename = filename.replace(/[/\\?%*:|"<>]/g, '_');
      if (audioOnly && !filename.endsWith('.mp3')) {
        filename = filename.replace(/\.[^.]+$/, '.mp3');
      } else if (!audioOnly && !filename.endsWith(`.${format}`)) {
        filename = filename.replace(/\.[^.]+$/, `.${format}`);
      }

      const contentType = audioOnly ? 'audio/mpeg' : 'video/mp4';

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Transfer-Encoding', 'chunked');

      const ytdlp = spawn('yt-dlp', args);

      ytdlp.stdout.pipe(res);

      ytdlp.stderr.on('data', (data) => {
        const line = data.toString();
        // Log progress but don't send to client
        if (line.includes('[download]')) {
          console.log(line.trim());
        }
      });

      ytdlp.on('error', (err) => {
        console.error('yt-dlp spawn error:', err);
        if (!res.headersSent) {
          res.status(500).send('Download failed');
        }
      });

      ytdlp.on('close', (code) => {
        if (code !== 0 && !res.headersSent) {
          res.status(500).send('Download failed');
        }
      });

      req.on('close', () => {
        ytdlp.kill('SIGTERM');
      });

    } catch (error) {
      console.error('Error downloading:', error);
      if (!res.headersSent) {
        res.status(500).send('Error downloading file');
      }
    }
  });

  // Download progress endpoint using SSE
  app.get('/api/download-progress', async (req, res) => {
    const url = req.query.url as string;
    const quality = req.query.quality as string || 'best';
    const audioOnly = req.query.audioOnly === 'true';

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const args: string[] = [...getBaseYtdlpArgs(url), '--no-playlist', '--newline'];

    if (audioOnly) {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
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
      args.push('-f', formatStr, '--merge-output-format', 'mp4');
    }

    // Download to a temp file with progress
    const tmpDir = path.join(process.cwd(), '.downloads');
    const { mkdirSync } = await import('fs');
    try { mkdirSync(tmpDir, { recursive: true }); } catch {}

    const outputTemplate = path.join(tmpDir, '%(title)s.%(ext)s');
    args.push('-o', outputTemplate, url);

    const ytdlp = spawn('yt-dlp', args);
    let outputFile = '';

    ytdlp.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.includes('[download] Destination:')) {
          outputFile = line.replace('[download] Destination:', '').trim();
        }
        const progressMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\w+)\s+at\s+([\d.]+\w+\/s|Unknown speed)/);
        if (progressMatch) {
          res.write(`data: ${JSON.stringify({
            type: 'progress',
            percent: parseFloat(progressMatch[1]),
            size: progressMatch[2],
            speed: progressMatch[3],
          })}\n\n`);
        }
        if (line.includes('[download] 100%') || line.includes('has already been downloaded')) {
          if (!outputFile && line.includes('Destination:')) {
            outputFile = line.replace(/.*Destination:\s*/, '').trim();
          }
        }
      }
    });

    ytdlp.stdout.on('data', (data) => {
      const line = data.toString();
      if (line.includes('[download] Destination:')) {
        outputFile = line.replace('[download] Destination:', '').trim();
      }
      const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);
      if (progressMatch) {
        res.write(`data: ${JSON.stringify({
          type: 'progress',
          percent: parseFloat(progressMatch[1]),
        })}\n\n`);
      }
    });

    ytdlp.on('close', (code) => {
      if (code === 0 && outputFile) {
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          file: path.basename(outputFile),
        })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({
          type: 'error',
          message: 'Download failed',
        })}\n\n`);
      }
      res.end();
    });

    req.on('close', () => {
      ytdlp.kill('SIGTERM');
    });
  });

  // Serve downloaded files
  app.get('/api/serve-file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(process.cwd(), '.downloads', filename);
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Error serving file:', err);
        if (!res.headersSent) {
          res.status(404).send('File not found');
        }
      }
      // Clean up file after serving
      import('fs').then(fs => {
        try { fs.unlinkSync(filePath); } catch {}
      });
    });
  });

  // Proxy thumbnail images (to bypass CORS)
  app.get('/api/proxy-image', async (req, res) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl) return res.status(400).send('URL required');

      const { default: axios } = await import('axios');
      const response = await axios.get(imageUrl, {
        responseType: 'stream',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': new URL(imageUrl).origin,
        }
      });

      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      res.setHeader('Cache-Control', 'public, max-age=86400');
      response.data.pipe(res);
    } catch {
      res.status(404).send('Image not found');
    }
  });

  // Vite middleware for development
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
    console.log(`🚀 GetVideo Server running on http://localhost:${PORT}`);
    console.log(`📱 Access from Android: http://<your-mac-ip>:${PORT}`);

    // Initial update check on startup
    await ensureLatestYtdlp();

    // Schedule update check every 24 hours
    setInterval(() => {
      ensureLatestYtdlp();
    }, 24 * 60 * 60 * 1000);
  });
}

startServer();
