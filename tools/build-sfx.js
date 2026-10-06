// 把 sfx/*.mp3 打包成 sfx/sounds.js（base64 內嵌），直接雙擊 index.html 開啟時也能用 Web Audio 播放。
// 換了音效檔之後執行：node tools/build-sfx.js
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'sfx');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort();
const entries = files.map((f) => `  ${JSON.stringify(path.basename(f, '.mp3'))}: ${JSON.stringify(fs.readFileSync(path.join(dir, f)).toString('base64'))},`);
const out = `/* 自動產生：node tools/build-sfx.js（來源 sfx/*.mp3，HeyGen 音效庫） */\nwindow.FRUIT_SFX = {\n${entries.join('\n')}\n};\n`;
fs.writeFileSync(path.join(dir, 'sounds.js'), out);
console.log(`sfx/sounds.js：${files.length} 個音效，${(out.length / 1024).toFixed(0)} KB`);
