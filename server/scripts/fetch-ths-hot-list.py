"""手动抓取同花顺 24 小时 A 股热榜，并生成后台可直接粘贴的候选 JSON。"""

import json
import pathlib
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
STOCK_MAP_PATH = ROOT / "data" / "stock-map.json"
OUTPUT_PATH = ROOT / "data" / "ths-hot-list.json"
HOT_LIST_URL = "https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock"


def main():
    stock_map = json.loads(STOCK_MAP_PATH.read_text(encoding="utf-8"))
    params = urllib.parse.urlencode({"list_type": "normal", "stock_type": "a", "type": "day"})
    request = urllib.request.Request(
        f"{HOT_LIST_URL}?{params}",
        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://eq.10jqka.com.cn/"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    rows = payload.get("data", {}).get("stock_list", [])
    stocks = []
    for row in rows:
        code = str(row.get("code", "")).strip()
        mapped = stock_map.get(code)
        if not mapped or code.startswith(("4", "8", "92")):
            continue
        if isinstance(mapped, str):
            mapped = {"name": mapped, "displayName": mapped}
        stocks.append({
            "rank": int(row.get("order") or len(stocks) + 1),
            "stockCode": code,
            "stockName": mapped.get("name") or row.get("name") or "",
            "stockDisplayName": mapped.get("displayName") or mapped.get("name") or "",
        })
        if len(stocks) >= 30:
            break
    if not stocks:
        raise RuntimeError("同花顺热榜没有匹配到本地股票 Map，请先更新 stock-map.json")
    output = {
        "source": "同花顺热榜-24小时",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "stocks": stocks,
    }
    text = json.dumps(output, ensure_ascii=False, indent=2)
    OUTPUT_PATH.write_text(text + "\n", encoding="utf-8")
    print(text)
    print(f"\n已保存：{OUTPUT_PATH}")


if __name__ == "__main__":
    main()
