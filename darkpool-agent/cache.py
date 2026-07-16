# darkpool-agent/cache.py
# 本地按天截图缓存：cache/YYYYMMDD/<code>.png
# 「收盘后暗盘」模式下截图当天不会变化，同一天同一股票直接复用。
import datetime
import pathlib
import shutil

CACHE_DIR = pathlib.Path(__file__).resolve().parent / "cache"


def today() -> str:
    return datetime.date.today().strftime("%Y%m%d")


def _path(code: str, date: str | None = None) -> pathlib.Path:
    return CACHE_DIR / (date or today()) / f"{code}.png"


def get(code: str, date: str | None = None) -> bytes | None:
    p = _path(code, date)
    return p.read_bytes() if p.exists() else None


def put(code: str, png: bytes, date: str | None = None) -> None:
    p = _path(code, date)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(png)


def purge_old(keep_days: int = 7) -> None:
    """删除 keep_days 天之前的缓存目录。"""
    if not CACHE_DIR.exists():
        return
    limit = (datetime.date.today() - datetime.timedelta(days=keep_days)).strftime("%Y%m%d")
    for d in CACHE_DIR.iterdir():
        if d.is_dir() and d.name.isdigit() and d.name < limit:
            shutil.rmtree(d, ignore_errors=True)
