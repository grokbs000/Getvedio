FROM node:22-bookworm-slim

# 安裝 Python, FFmpeg, curl 以及 yt-dlp
# 並透過 pip 安裝 curl_cffi，供 yt-dlp 作為突破驗證挑戰的依賴套件
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    pip3 install --break-system-packages curl_cffi && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 複製 package.json 進行安裝
COPY package*.json ./

# 安裝所有依賴 (包含 build 需要的 vite 等)
RUN npm install

# 複製專案原始碼
COPY . .

# 打包前端靜態網頁 (產出 dist 資料夾)
RUN npm run build

# 設定環境變數
ENV NODE_ENV=production
ENV PORT=3000

# 開放對外的 Port
EXPOSE 3000

# 啟動伺服器
CMD ["npm", "start"]
