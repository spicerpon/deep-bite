// 아티팩트(미리보기) 게시용 빌드: index.html을 문서 골격 없는 조각으로 바꾸고 CSS를 인라인합니다.
// 사용: node tools/build-artifact.js  → dist/artifact/
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'artifact');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'src'), { recursive: true });

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const pick = (a, b) => html.slice(html.indexOf(a) + a.length, html.indexOf(b));
let head = pick('<!-- @@HEAD-START -->', '<!-- @@HEAD-END -->');
head = head.replace(/<link rel="stylesheet" href="css\/style.css">/, `<style>\n${css}\n</style>`);
let body = pick('<!-- @@BODY-START -->', '<!-- @@BODY-END -->');
// 미리보기(아티팩트)는 CSP 때문에 Firebase에 연결할 수 없으므로 온라인 안내 문구를 실제 주소로 바꿈
body = body.replace(
  /<p class="note" id="online-note" hidden>[\s\S]*?<\/p>/,
  '<p class="note" id="online-note" hidden>Online play is blocked in this preview. Play online at <a href="https://kogames.dev/deep-bite/" target="_blank" rel="noopener">kogames.dev/deep-bite</a>. Bots are always ready.</p>'
);
fs.writeFileSync(path.join(out, 'index.html'), head.trim() + '\n' + body.trim() + '\n');
for (const f of fs.readdirSync(path.join(root, 'src'))) fs.copyFileSync(path.join(root, 'src', f), path.join(out, 'src', f));
// 미리보기용 빈 Firebase 설정 (Play Online 비활성화)
fs.writeFileSync(path.join(out, 'src', 'firebase-config.js'), '// preview build: online play lives at https://kogames.dev/deep-bite/\nwindow.GF_FIREBASE_CONFIG = { apiKey: "", databaseURL: "" };\n');
// 미리보기에는 광고 없음 (CSP가 광고 스크립트를 막음)
fs.writeFileSync(path.join(out, 'src', 'ads-config.js'), '// preview build: no ads\nwindow.GF_ADS_CONFIG = { provider: "none" };\n');
console.log('built', out);
