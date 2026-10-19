// 用 M8RE 自己的 Scanner + Parser 实测两段文本
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, 'M8RE', 'M8RE-0.1.0', 'content');
for (const f of ['00_ns.js','01_scanner.js','02_expr.js','03_codegen.js','04_parser.js','05_vm.js']) {
  const code = fs.readFileSync(path.join(base, f), 'utf8');
  try { (0, eval)(code); } catch (e) { console.log('load fail', f, e.message); }
}
const M8 = globalThis.M8RE;
console.log('loaded?', typeof M8, Object.keys(M8||{}).slice(0,15).join(','));

function tryParse(label, src) {
  console.log('\n===== ' + label + ' =====');
  try {
    const s = new M8.Scanner(src);
    const p = new M8.Parser(s);
    const vm = new M8.VirtualMachine();
    vm.rewind();
    const bc = p.parse(vm);
    const ops = bc ? bc.length : 0;
    console.log('PARSE OK, 字节码条数 =', ops);
    return true;
  } catch (e) {
    console.log('PARSE FAIL:', e.message);
    return false;
  }
}

// 样本 1：我们文档里的官方 BAS DSL（M8v1 chunk 200 语法）
tryParse('官方 BAS DSL: def text / set', [
  'def text title {',
  '    content = "hello"',
  '    x = 10',
  '    y = 20',
  '}',
  'let inst = title { x = 50 }',
  'set inst { y = 100 } 1.5s "ease-in-out"'
].join('\n'));

// 样本 2：biliscript / M8 风格（Flappy Sina 用的那套 API）
tryParse('biliscript: var/function/Player/enterFrame', [
  'var x = 0;',
  'function main() {',
  '    $.root.addEventListener("enterFrame", main);',
  '    Player.keyTrigger(function(code) { x = 1; }, 100);',
  '}'
].join('\n'));
