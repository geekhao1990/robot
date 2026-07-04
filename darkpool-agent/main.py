# darkpool-agent/main.py
# HTTP 服务：POST /api/darkpool/screenshot {"code": "01810"}
# 返回 {"ok": true, "code": "01810", "image_base64": "..."}
#
# 启动：
#   export ZHIPU_API_KEY=xxx AGENT_TOKEN=yyy
#   uvicorn main:app --host 0.0.0.0 --port 8787
import base64
import re
import threading

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

import config
import ths_agent

app = FastAPI(title="THS DarkPool Screenshot Agent")

# 同一台手机同时只能跑一个任务
_lock = threading.Lock()

CODE_RE = re.compile(r"^\d{1,6}$")


class ShotReq(BaseModel):
    code: str


def _check_token(authorization: str | None):
    if not config.AGENT_TOKEN:
        return  # 未配置 token 则不鉴权（仅建议内网使用）
    if authorization != f"Bearer {config.AGENT_TOKEN}":
        raise HTTPException(status_code=401, detail="invalid token")


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/api/darkpool/screenshot")
def darkpool_screenshot(req: ShotReq, authorization: str | None = Header(None)):
    _check_token(authorization)

    code = req.code.strip().upper().replace("HK", "").strip(".")
    if not CODE_RE.match(code):
        raise HTTPException(status_code=400, detail="股票代码格式不正确")
    # 港股代码统一补齐为 5 位，如 700 -> 00700
    if len(code) <= 5:
        code = code.zfill(5)

    if not _lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="设备正忙，请稍后再试")
    try:
        png = ths_agent.capture_darkpool(code)
        return {
            "ok": True,
            "code": code,
            "image_base64": base64.b64encode(png).decode(),
        }
    except ths_agent.AgentError as e:
        return {"ok": False, "code": code, "message": str(e)}
    finally:
        _lock.release()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT)
