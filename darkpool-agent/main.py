# darkpool-agent/main.py
# HTTP 服务（收盘后暗盘模式）：
#   POST /api/darkpool/screenshot {"code": "600519"}
#       -> 先查当天本地缓存，命中直接返回；未命中才操作真机截图并写入缓存。
#   POST /api/darkpool/prefetch  {"codes": ["600519"]}   codes 省略则自动读取App自选股列表
#       -> 后台批量预抓取（默认每天 15:30 收盘后由内置定时器自动触发）。
#   GET  /api/darkpool/prefetch/status  -> 查看跑批进度
#
# 启动：
#   export ZHIPU_API_KEY=xxx AGENT_TOKEN=yyy
#   uvicorn main:app --host 0.0.0.0 --port 8787
import base64
import datetime
import re
import threading

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

import cache
import config
import ths_agent

app = FastAPI(title="THS DarkPool Screenshot Agent")

# 同一台手机同时只能跑一个任务
_device_lock = threading.Lock()
# 同一代码的并发请求合并：第一个请求真正截图，其余等它完成后读缓存
_inflight: dict[str, threading.Event] = {}
_inflight_lock = threading.Lock()

# 跑批进度
_prefetch = {"running": False, "date": "", "total": 0, "done": 0, "results": []}

CODE_RE = re.compile(r"^\d{6}$")


class ShotReq(BaseModel):
    code: str


class PrefetchReq(BaseModel):
    codes: list[str] | None = None


def _check_token(authorization: str | None):
    if not config.AGENT_TOKEN:
        return  # 未配置 token 则不鉴权（仅建议内网使用）
    if authorization != f"Bearer {config.AGENT_TOKEN}":
        raise HTTPException(status_code=401, detail="invalid token")


def _norm_code(raw: str) -> str:
    code = raw.strip().upper().removeprefix("SH").removeprefix("SZ").strip(".")
    if not CODE_RE.match(code):
        raise HTTPException(status_code=400, detail="请输入 6 位A股代码，如 600519")
    return code


def _capture_with_cache(code: str) -> tuple[bytes, bool]:
    """返回 (png, 是否命中缓存)。同代码并发只截一次，其余请求等待复用。"""
    png = cache.get(code)
    if png:
        return png, True

    with _inflight_lock:
        ev = _inflight.get(code)
        is_owner = ev is None
        if is_owner:
            ev = threading.Event()
            _inflight[code] = ev

    if not is_owner:
        # 别的请求正在截同一只股票，等它完成后直接用缓存
        ev.wait(timeout=150)
        png = cache.get(code)
        if png:
            return png, True
        raise HTTPException(status_code=503, detail="截图任务未在预期时间内完成，请稍后再试")

    try:
        if not _device_lock.acquire(blocking=False):
            raise HTTPException(status_code=429, detail="设备正忙（可能正在跑批预抓取），请稍后再试")
        try:
            png = ths_agent.capture_darkpool(code)
            cache.put(code, png)
            return png, False
        finally:
            _device_lock.release()
    finally:
        with _inflight_lock:
            _inflight.pop(code, None)
        ev.set()


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/api/darkpool/screenshot")
def darkpool_screenshot(req: ShotReq, authorization: str | None = Header(None)):
    _check_token(authorization)
    code = _norm_code(req.code)
    try:
        png, cached = _capture_with_cache(code)
    except ths_agent.AgentError as e:
        return {"ok": False, "code": code, "message": str(e)}
    return {
        "ok": True,
        "code": code,
        "cached": cached,
        "image_base64": base64.b64encode(png).decode(),
    }


def _run_prefetch(codes: list[str] | None):
    global _prefetch
    cache.purge_old()
    try:
        if not codes:
            with _device_lock:
                codes = ths_agent.discover_watchlist_codes()
        _prefetch.update(date=cache.today(), total=len(codes), done=0, results=[])
        for code in codes:
            item = {"code": code, "ok": True, "cached": False, "message": ""}
            try:
                _, item["cached"] = _capture_with_cache(code)
            except Exception as e:
                item["ok"] = False
                item["message"] = getattr(e, "detail", None) or str(e)
            _prefetch["results"].append(item)
            _prefetch["done"] += 1
    except Exception as e:
        _prefetch["results"].append({"code": "*", "ok": False, "message": str(e)})
    finally:
        _prefetch["running"] = False


@app.post("/api/darkpool/prefetch")
def darkpool_prefetch(req: PrefetchReq, authorization: str | None = Header(None)):
    _check_token(authorization)
    if _prefetch["running"]:
        return {"ok": False, "message": "已有跑批任务在进行中", "status": _prefetch}
    codes = [_norm_code(c) for c in (req.codes or [])]
    _prefetch.update(running=True, date=cache.today(), total=len(codes), done=0, results=[])
    threading.Thread(target=_run_prefetch, args=(codes or None,), daemon=True).start()
    return {"ok": True, "message": "跑批已启动", "auto_discover": not codes}


@app.get("/api/darkpool/prefetch/status")
def prefetch_status(authorization: str | None = Header(None)):
    _check_token(authorization)
    return {"ok": True, "status": _prefetch, "timestamp": datetime.datetime.now().isoformat()}


def _scheduler():
    """内置定时器：每天到 PREFETCH_AT（默认 15:30，收盘后）自动跑批一次。"""
    import time as _time

    last_date = ""
    while True:
        if config.PREFETCH_AT:
            now = datetime.datetime.now()
            if (
                now.strftime("%H:%M") >= config.PREFETCH_AT
                and last_date != cache.today()
                and not _prefetch["running"]
            ):
                last_date = cache.today()
                _prefetch.update(running=True, date=cache.today(), total=0, done=0, results=[])
                _run_prefetch(config.PREFETCH_CODES or None)
        _time.sleep(30)


threading.Thread(target=_scheduler, daemon=True).start()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT)
