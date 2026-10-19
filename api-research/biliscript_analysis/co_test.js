globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
globalThis.performance = { now: () => Date.now() };
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, 'M8RE', 'M8RE-0.1.0', 'content');
for (const f of ['00_ns.js','01_scanner.js','02_expr.js','03_codegen.js','04_parser.js','05_vm.js']) {
  (0, eval)(fs.readFileSync(path.join(base, f), 'utf8'));
}
const M8 = globalThis.M8RE;
const HOST = { trace: (...a)=>console.log('  [trace]',...a), int: v=>Math.trunc(Number(v))||0, Math, String, parseInt, parseFloat };
function compile(src){
  const vm=new M8.VirtualMachine();
  for(const k in HOST) vm.getGlobalObject()[k]=HOST[k];
  const p=new M8.Parser(new M8.Scanner(src));
  vm.rewind(); vm.setByteCode(p.parse(vm));
  return vm;
}
const SRC = `
coroutine job(a, b) {
  trace("step1 " + (a+b));
  yield;
  trace("step2");
  yield;
  trace("step3");
  return "done";
}
trace("toplevel done");
`;
const vm = compile(SRC);
console.log('execute() =', vm.execute());
const co = vm.runCoroutine('job',[3,4]);
console.log('co =', Object.prototype.toString.call(co));
console.log('proto methods =', co && Object.getOwnPropertyNames(Object.getPrototypeOf(co)));
if(co){
  for(let i=0;i<5;i++){
    let r;
    try { r = co.resume ? co.resume('R'+i) : co.next('R'+i); } catch(e){ console.log('  drive FAIL:', e.message); break; }
    console.log('  drive#'+i+' ->', JSON.stringify(r));
    if(r===undefined||r===null||r===false) break;
  }
}
