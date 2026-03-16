#!/usr/bin/env node
/**
 * public/ 资源初始化脚本
 *
 * npm install 后自动执行 (postinstall)，确保 public/ 下的运行时资源就位。
 *
 * 资源来源:
 *   1. Bravura 字体 → 从 node_modules/@coderline/alphatab/dist/font/ 复制
 *   2. sql-wasm.wasm → 从 node_modules/sql.js/dist/sql-wasm.wasm 复制
 *   3. MuseScore_General.sf3 → 从远程 URL 下载 (38MB)
 *
 * 每个资源只在目标文件不存在时才操作，重复执行是安全的。
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import { createWriteStream } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');

// ── 工具函数 ──────────────────────────────────────────────

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function copyIfMissing(src, dest, label) {
  if (existsSync(dest)) return;
  if (!existsSync(src)) {
    console.warn(`⚠️  ${label}: 源文件不存在 ${src}`);
    return;
  }
  copyFileSync(src, dest);
  console.log(`✅ ${label}: ${dest}`);
}

function download(url, dest, label) {
  return new Promise((resolve, reject) => {
    if (existsSync(dest)) { resolve(); return; }
    console.log(`⬇️  ${label}: 下载中...`);
    const proto = url.startsWith('https') ? https : http;
    const request = (reqUrl) => {
      proto.get(reqUrl, (res) => {
        // 跟随重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const file = createWriteStream(dest);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(1);
            process.stdout.write(`\r   ${label}: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`\n✅ ${label}: ${dest}`);
          resolve();
        });
        file.on('error', reject);
      }).on('error', reject);
    };
    request(url);
  });
}

// ── 主流程 ────────────────────────────────────────────────

async function main() {
  console.log('\n📦 初始化 public/ 资源...\n');

  // 1. Bravura 字体
  const fontDir = join(PUBLIC, 'font');
  ensureDir(fontDir);
  const alphaTabFont = join(ROOT, 'node_modules/@coderline/alphatab/dist/font');
  if (existsSync(alphaTabFont)) {
    for (const f of readdirSync(alphaTabFont)) {
      copyIfMissing(join(alphaTabFont, f), join(fontDir, f), `Bravura/${f}`);
    }
  } else {
    console.warn('⚠️  alphaTab font 目录不存在，跳过 Bravura 字体复制');
  }

  // 2. sql-wasm.wasm
  const wasmSrc = join(ROOT, 'node_modules/sql.js/dist/sql-wasm.wasm');
  copyIfMissing(wasmSrc, join(PUBLIC, 'sql-wasm.wasm'), 'sql-wasm.wasm');

  // 3. MuseScore General SoundFont
  const sfDir = join(PUBLIC, 'soundfont');
  ensureDir(sfDir);
  const sfDest = join(sfDir, 'MuseScore_General.sf3');
  const sfUrl = 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3';
  try {
    await download(sfUrl, sfDest, 'MuseScore_General.sf3');
  } catch (e) {
    console.error(`❌ SoundFont 下载失败: ${e.message}`);
    console.error('   请手动下载: ' + sfUrl);
    console.error('   放到: public/soundfont/MuseScore_General.sf3');
  }

  console.log('\n✨ public/ 资源初始化完成\n');
}

main().catch(e => {
  console.error('setup-public 失败:', e);
  process.exit(1);
});
