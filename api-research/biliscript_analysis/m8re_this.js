globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, 'M8RE', 'M8RE-0.1.0', 'content');
for (const f of ['00_ns.js','01_scanner.js','02_expr.js','03_codegen.js','04_parser.js','05_vm.js']) {
  (0, eval)(fs.readFileSync(path.join(base, f), 'utf8'));
}
const M8 = globalThis.M8RE;
function run(label, src) {
  process.stdout.write('\n== ' + label + ' ==\n');
  try {
    const vm = new M8.VirtualMachine();
    vm.getGlobalObject().trace = function(){ console.log('  [t]', [].slice.call(arguments).join(' ')); };
    vm.getGlobalObject().getTimer = function(){ return 0; };
    const p = new M8.Parser(new M8.Scanner(src));
    vm.rewind(); vm.setByteCode(p.parse(vm)); vm.execute();
  } catch (e) { console.log('  FAIL:', e.message); }
}
run('this 绑定：CALLM vs CALL', `
var o = { tag: "OBJ", who: function() { trace("this.tag=" + this.tag); } };
o.who();                // CALLM -> this = o
var f = o.who;
f();                   // CALL  -> this = global
`);
run('不声明就赋值 -> 静默全局', `
undeclaredVar = 99;
trace("读到=" + undeclaredVar);
`);
run('strict vs 宽松 比较', `
trace("1=='1'  ->" + (1 == "1"));
trace("1==='1' ->" + (1 === "1"));
`);
run('函数内隐式全局仍可读', `
function f() { inner = 7; }
f();
trace("inner=" + inner);
`);
