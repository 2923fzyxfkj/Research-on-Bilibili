use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use md5::Context as Md5Ctx;
use std::collections::BTreeMap;

/// B 站前端 `mixinKeyEncTab` —— 64 个下标的重排顺序表，自 WBI 上线未变。
const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Parser)]
#[command(about = "B 站 WBI 签名逆向实现", version)]
struct Cli {
    /// 打印每一步中间值
    #[arg(short, long, global = true)]
    debug: bool,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// 拉取 nav 接口，打印当前 img_key / sub_key / mixin_key
    Keys,
    /// 本地计算 mixin_key，不联网
    Mixin {
        #[arg(long)]
        img: String,
        #[arg(long)]
        sub: String,
    },
    /// 对一组参数签名，输出可直接拼接的 query string
    Sign {
        /// 形如 foo=1&bar=2，值里不要自己 urlencode
        params: String,
        /// 覆盖时间戳（默认取当前秒），用于对齐抓包复现
        #[arg(long)]
        wts: Option<i64>,
    },
    /// 用给定 wts 签名，但先用 nav 校验 key 是否新鲜
    Verify {
        /// 已知的 w_rid
        w_rid: String,
        /// 原始参数（不含 wts / w_rid）
        params: String,
        #[arg(long)]
        wts: i64,
    },
}

/// 第 1 步：从两个 key 按置换表重排取前 32 字符。
fn get_mixin_key(img_key: &str, sub_key: &str) -> Result<String> {
    let orig: String = format!("{}{}", img_key, sub_key);
    if orig.len() != 64 {
        anyhow::bail!("img_key + sub_key 长度应为 64，实际 {}", orig.len());
    }
    let bytes = orig.as_bytes();
    let mixed: String = MIXIN_KEY_ENC_TAB
        .iter()
        .map(|&i| bytes[i] as char)
        .collect::<String>();
    Ok(mixed[..32].to_string())
}

/// B 站风格 URL encode：大写十六进制，空格转 %20，保留 !'()*。
/// 注意：值里的 !'()* 会在拼串前被过滤掉，所以 encode 时保留它们无影响。
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*'
            | b'\'' | b'(' | b')' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// 第 2+3 步：排序 → 过滤 → 拼接 → MD5。
fn enc_wbi(
    params: &BTreeMap<String, String>,
    mixin_key: &str,
    wts: i64,
    debug: bool,
) -> String {
    let mut merged = params.clone();
    merged.insert("wts".to_string(), wts.to_string());

    // 值里的 !'()* 必须先剔除，否则服务端重算会得到不同摘要
    for v in merged.values_mut() {
        *v = v.chars().filter(|c| !matches!(c, '!' | '\'' | '(' | ')' | '*')).collect();
    }

    let query: String = merged
        .iter()
        .map(|(k, v)| format!("{}={}", url_encode(k), url_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let to_hash = format!("{}{}", query, mixin_key);
    let mut ctx = Md5Ctx::new();
    ctx.consume(to_hash.as_bytes());
    let w_rid = format!("{:x}", ctx.compute());

    if debug {
        eprintln!("[1] 排序后 query : {}", query);
        eprintln!("[2] mixin_key    : {}", mixin_key);
        eprintln!("[3] 待哈希原文   : {}", to_hash);
        eprintln!("[4] w_rid        : {}", w_rid);
    }

    w_rid
}

fn fetch_keys() -> Result<(String, String)> {
    let out = std::process::Command::new("curl")
        .args([
            "-s",
            "https://api.bilibili.com/x/web-interface/nav",
            "-H",
            &format!("User-Agent: {}", UA),
            "-H",
            "Referer: https://www.bilibili.com/",
        ])
        .output()
        .context("调用 curl 失败，确认系统 PATH 里有 curl")?;

    let body = String::from_utf8_lossy(&out.stdout).to_string();
    let json: serde_json::Value = serde_json::from_str(&body).context("nav 返回非 JSON，可能被风控拦了")?;

    let wbi = &json["data"]["wbi_img"];
    let img_url = wbi["img_url"].as_str().context("缺少 data.wbi_img.img_url")?;
    let sub_url = wbi["sub_url"].as_str().context("缺少 data.wbi_img.sub_url")?;

    let extract = |u: &str| -> String {
        u.rsplit('/')
            .next()
            .unwrap_or_default()
            .trim_end_matches(".png")
            .to_string()
    };
    Ok((extract(img_url), extract(sub_url)))
}

fn parse_params(raw: &str) -> BTreeMap<String, String> {
    raw.split('&')
        .filter(|s| !s.is_empty())
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.cmd {
        Cmd::Keys => {
            let (img, sub) = fetch_keys()?;
            let mk = get_mixin_key(&img, &sub)?;
            println!("img_key   = {}", img);
            println!("sub_key   = {}", sub);
            println!("mixin_key = {}", mk);
            if cli.debug {
                let orig = format!("{}{}", img, sub);
                println!("[0] orig  = {}", orig);
            }
        }
        Cmd::Mixin { img, sub } => {
            let mk = get_mixin_key(&img, &sub)?;
            println!("{}", mk);
        }
        Cmd::Sign { params, wts } => {
            let (img, sub) = fetch_keys()?;
            let mk = get_mixin_key(&img, &sub)?;
            let ts = wts.unwrap_or_else(now_ts);
            let map = parse_params(&params);
            let w_rid = enc_wbi(&map, &mk, ts, cli.debug);
            println!("mixin_key={}", mk);
            println!("wts={}", ts);
            println!("w_rid={}", w_rid);
            println!("--- 可直接拼接 ---");
            println!("{}&w_rid={}&wts={}", params, w_rid, ts);
        }
        Cmd::Verify { w_rid, params, wts } => {
            let (img, sub) = fetch_keys()?;
            let mk = get_mixin_key(&img, &sub)?;
            let map = parse_params(&params);
            let got = enc_wbi(&map, &mk, wts, true);
            println!("{}", if got == w_rid { "MATCH" } else { "MISMATCH" });
        }
    }
    Ok(())
}
