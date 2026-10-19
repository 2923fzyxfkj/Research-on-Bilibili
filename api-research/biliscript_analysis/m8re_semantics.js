globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
globalThis.performance = { now: () => Date.now() };
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, 'M8RE', 'M8RE-0.1.0', 'content');
for (const f of ['00_ns.js','01_scanner.js','02_expr.js','03_codegen.js','04_parser.js','05_vm.js']) {
  (0, eval)(fs.readFileSync(path.join(base, f), 'utf8'));
}
const M8 = globalThis.M8RE;

// 宿主注入的全局（对应 11_hostapi.js 的 installGlobals）
const HOST = {
  trace: function () { console.log('  [trace]', Array.prototype.slice.call(arguments).join(' ')); },
  int: function (v) { return Math.trunc(Number(v)) || 0; },
  Math: Math, String: String, parseInt: parseInt, parseFloat: parseFloat
};

function run(label, src, inject) {
  process.stdout.write('\n===== ' + label + ' =====\n');
  let vm;
  try {
    vm = new M8.VirtualMachine();
    for (const k in HOST) vm.getGlobalObject()[k] = HOST[k];
    if (inject) inject(vm.getGlobalObject());
    const p = new M8.Parser(new M8.Scanner(src));
    vm.rewind();
    vm.setByteCode(p.parse(vm));
    const r = vm.execute();
    console.log('OK, execute() =', r);
  } catch (e) {
    console.log('FAIL:', e.message);
  }
}

// 1. trace 输出 + 变量作用域
run('trace / 数值 / 运算', `
trace("hello " + (1+2));
var a = 10, b = 3;
trace(a/b);
trace(a%b);
trace(a<<2);
trace(1==1);
trace("int=" + int(3.7));
trace("str=" + "a"+1);
`);

// 2. 函数/递归/闭包
run('function / 递归 / 闭包', `
function fib(n) { if (n<2) return n; return fib(n-1)+fib(n-2); }
trace("fib(10)=" + fib(10));
var counter = 0;
function inc() { counter++; }
inc(); inc(); inc();
trace("counter=" + counter);
`);

// 3. 对象 / 数组 / for 循环
run('对象 / 数组 / 循环', `
var o = { a: 1, b: "two" };
trace("o.a=" + o.a + " o.b=" + o.b);
var arr = [1,2,3];
for (var i=0;i<arr.length;i++) trace(i + ":" + arr[i]);
var s = 0;
while (s < 10) { s += 3; }
trace("s=" + s);
var t = 0;
do { t++; } while (t < 5);
trace("t=" + t);
switch (t) { case 5: trace("five"); break; default: trace("other"); }
`);

// 4. coroutine + yield
run('coroutine / yield', `
function job(a, b) {
  var got = yield a + b;
  trace("resumed with: " + got);
  yield "second";
  return "done";
}
var co = new Object();
trace("start");
`);

// 5. 错误语义
run('运行时错误：调用 undefined', `var o = {}; o.f();`);
run('死循环预算（应报 OutOfTime）', `loop { var x = 1; }`);

// 7. with 语句：未限定名是否落到 with 对象，块结束是否恢复
run('with 作用域', `
var g = "outer";
var o = { g: "inner", k: 42 };
with (o) {
  trace("in-with g=" + g);
  trace("in-with k=" + k);
}
trace("after-with g=" + g);
var hit = false;
with (o) { hit = (k == 42); }
trace("assign-leak=" + hit);
`);

// 8. RSH / URSH / LSH 边界
run('位移运算边界', `
var n = -8;
trace("n>>1=" + (n >> 1));
trace("n>>>1=" + (n >>> 1));
trace("-1>>>28=" + (-1 >>> 28));
trace("1<<31=" + (1 << 31));
trace("-8/2=" + (-8 / 2));
trace("-7%3=" + (-7 % 3));
trace("int(-3.7)=" + int(-3.7));
trace("5>>0=" + (5 >> 0));
`);

// 6. 单引号 vs 双引号
// 用拼接构造，避免宿主 JS 模板字符串把待测的转义吃掉
run('字符串转义 / 单引号',
  "trace('a\\tb\\nc\\x41d\\101');" +
  ' trace("it\'s");'
);
