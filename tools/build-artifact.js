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
const body = pick('<!-- @@BODY-START -->', '<!-- @@BODY-END -->');
fs.writeFileSync(path.join(out, 'index.html'), head.trim() + '\n' + body.trim() + '\n');
for (const f of fs.readdirSync(path.join(root, 'src'))) fs.copyFileSync(path.join(root, 'src', f), path.join(out, 'src', f));
console.log('built', out);
