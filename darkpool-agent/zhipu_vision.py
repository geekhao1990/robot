# darkpool-agent/zhipu_vision.py
# 智谱视觉模型客户端：把当前屏幕截图 + 任务目标发给 GLM-4V，
# 让模型以 JSON 决策下一步动作（点哪里 / 滑动 / 输入 / 完成 / 失败）。
import json
import re

import requests

import config

SYSTEM_PROMPT = """你是一个手机 GUI 操作智能体，正在操作安卓手机上的「同花顺」炒股 App。
每一轮你会收到当前手机屏幕截图和任务目标，请判断下一步该做什么，只输出一个 JSON 对象，不要输出其他文字。

坐标系：x、y 为相对坐标，取值 0~1000 的整数（屏幕左上角为 0,0，右下角为 1000,1000）。

可选动作：
{"action": "tap", "x": 500, "y": 300, "reason": "点击放大镜搜索图标"}
{"action": "swipe", "x1": 800, "y1": 400, "x2": 200, "y2": 400, "reason": "滑动寻找「资金」Tab"}
{"action": "type", "text": "600519", "reason": "在搜索框输入股票代码"}
{"action": "back", "reason": "返回上一页"}
{"action": "wait", "reason": "页面正在加载，等待"}
{"action": "finish", "reason": "已进入目标页面"}
{"action": "fail", "reason": "该股票没有暗盘数据/需要付费开通/找不到入口"}

注意：
- 弹窗、广告、升级提示等遮挡界面时，先点关闭（通常是右上角 X）。
- 这里说的「暗盘」是同花顺的付费功能：A股个股行情页「资金」栏目中的主力资金统计，
  页面上会显示「主力流向」板块，含「主力明盘」「主力暗盘」柱状图（暗盘=大资金量化拆单的资金量）。
- 只有确认已经处于目标股票的「资金」栏目、且「主力明盘/主力暗盘」数据完整可见时才输出 finish。
- 如果界面提示需要付费/开通权限而当前账号没有，输出 fail 并说明原因。"""


def _extract_json(text: str):
    """从模型输出中稳健地抠出第一个 JSON 对象。"""
    text = text.strip()
    # 去掉 markdown 代码块包裹
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{[^{}]*\}", text, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return None


def _chat(system: str, image_b64: str, text: str) -> str:
    if not config.ZHIPU_API_KEY:
        raise RuntimeError("未配置 ZHIPU_API_KEY 环境变量")
    payload = {
        "model": config.ZHIPU_VISION_MODEL,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                    },
                    {"type": "text", "text": text},
                ],
            },
        ],
    }
    resp = requests.post(
        config.ZHIPU_API_URL,
        headers={
            "Authorization": f"Bearer {config.ZHIPU_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def decide(image_b64: str, goal: str, history: list) -> dict:
    """请求视觉模型决策下一步动作。history 为之前每步的动作摘要（字符串列表）。"""
    steps = "\n".join(f"{i + 1}. {h}" for i, h in enumerate(history)) or "（无）"
    user_text = f"任务目标：{goal}\n\n已执行过的步骤：\n{steps}\n\n这是当前屏幕截图，请给出下一步动作 JSON。"
    content = _chat(SYSTEM_PROMPT, image_b64, user_text)
    action = _extract_json(content)
    if not action or "action" not in action:
        raise RuntimeError(f"视觉模型返回无法解析：{content[:200]}")
    return action


def ask_json(image_b64: str, question: str) -> dict:
    """看图回答问题，要求模型只输出一个 JSON 对象（用于读取暗盘股票列表等）。"""
    content = _chat(
        "你是一个屏幕内容识别助手。请根据用户要求识别截图中的信息，只输出一个 JSON 对象，不要输出其他文字。",
        image_b64,
        question,
    )
    data = _extract_json(content)
    if data is None:
        raise RuntimeError(f"视觉模型返回无法解析：{content[:200]}")
    return data
