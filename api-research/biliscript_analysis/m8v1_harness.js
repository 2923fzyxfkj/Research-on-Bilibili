// M8v1 官方解析器本地测试台
// 直接吃官方 chunk npd.200.8f4f679a.js，桩掉 webpack 运行时，
// 走真实 F.parse()（同步路径），用于发弹幕前自检 M8v1 脚本。
const fs = require("fs");
const path = require("path");

const CHUNK = path.join(__dirname, "m8v1-parser.js");
const src = fs.readFileSync(CHUNK, "utf8");

// ---- 1) 抓 chunk 里的模块表 -------------------------------------------------
let factories = null;
global.self = {
  nanoWidgetsJsonp: {
    push(arr) {
      factories = arr[1];
    }
  }
};
(0, eval)(src);

// ---- 2) 桩 webpack 运行时 ---------------------------------------------------
const cssAcc = [];
function cssStubFactory() {
  const noop = function () {
    return noop;
  };
  noop.push = function (item) {
    cssAcc.push(item);
    return 0;
  };
  const factory = function () {
    return noop;
  };
  factory.must = factory;
  factory.p = noop;
  return factory;
}

const registry = new Map();
function req(id) {
  if (registry.has(id)) return registry.get(id);
  const exp = {};
  registry.set(id, exp); // 占位，防循环依赖
  factories[id](exp, exp, stub);
  return exp;
}

function stub(id) {
  // 54712 = @babel/runtime：Object.defineProperties 的封装
  // 解析器用 (0, n._)(proto, { get/set }) 给 yyrestart 装属性存取器
  if (id === 54712) {
    const define = (proto, desc) => Object.defineProperties(proto, desc);
    define.s = define;
    define.d = define;
    define.n = define;
    define.o = (o, p) => Object.prototype.hasOwnProperty.call(o, p);
    define.p = () => {};
    define.r = (e) => e;
    define.e = (e) => e;
    define.t = {};
    define.g = (o, p) => o[p];
    define.a = (o, p, v) => ((o[p] = v), v);
    return define;
  }
  if (id === 56239) return req(56239);
  // 20341 / 75497 / 96542 / 44210 / 75357 / 74262 / 15882：浏览器 API / style-loader
  if (id === 20341) return {}; // typeof window / navigator 判定
  return function () {};
}
stub.n = () => cssStubFactory();
stub.r = (exp) => exp;
stub.d = (exp, defs) => {
  for (const key of Object.keys(defs)) {
    Object.defineProperty(exp, key, {
      get: defs[key],
      enumerable: true,
      configurable: true,
    });
  }
  return exp;
};
stub.o = (o, p) => Object.prototype.hasOwnProperty.call(o, p);

// ---- 3) 拿到播放器类（90891 的 default 导出）--------------------------------
// 90891 顶层会 `new Worker(URL.createObjectURL(new Blob([src])))` 起解析 Worker。
// 我们只想用同步解析路径，但那份字面量仍会被执行，所以先把浏览器 API 桩掉。
global.Worker = function () {
  throw new Error("harness: 不该真的起 Worker");
};
global.Blob = function (parts) {
  this.parts = parts;
};
global.URL = { createObjectURL: () => "blob:stub", revokeObjectURL: () => {} };
global.window = global;
global.document = {
  createElement: () => ({ getContext: () => ({ font: "", measureText: (t) => ({ width: t.length * 8 }) }) }),
  head: { appendChild: () => {} },
};
global.navigator = { userAgent: "node" };

const mod90891 = req(90891);
const F = mod90891.default;
if (!F || typeof F.parse !== "function") {
  console.error("加载失败：没拿到 parse。90891 keys =", Object.keys(mod90891).join(","));
  process.exit(1);
}

// ---- 4) 强制同步解析（不起 Worker）------------------------------------------
F.workerDisabled = true;

/** 解析一段 M8v1 脚本，返回 { defs, sets }；语法错则抛异常。 */
function parse(text) {
  let out = null;
  let err = null;
  F.parse({
    danmaku: { text: text },
    success: (d) => {
      out = d;
    },
    error: (e) => {
      err = e;
    }
  });
  if (err) throw new Error(String(err && err.message ? err.message : err));
  if (!out) throw new Error("parse 既没 success 也没 error");
  return out;
}

module.exports = { parse: parse, F: F, css: cssAcc };

// ---- CLI --------------------------------------------------------------------
if (require.main === module) {
  const file = process.argv[2];
  const text = file
    ? fs.readFileSync(file, "utf8")
    : "//M8v1\ndef text a { x = 10 y = 20 }\n";
  try {
    const r = parse(text);
    console.log("PARSE OK");
    console.log("defs:", JSON.stringify(r.defs, null, 2));
    console.log("sets:", JSON.stringify(r.sets, null, 2));
  } catch (e) {
    console.log("PARSE FAIL:", e.message);
    process.exitCode = 1;
  }
}
