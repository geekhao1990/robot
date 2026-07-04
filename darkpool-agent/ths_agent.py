# darkpool-agent/ths_agent.py
# 核心智能体：观察(截屏) -> 决策(智谱GLM-4V) -> 执行(ADB) 循环，
# 目标是在同花顺 App 中打开指定股票的「暗盘」行情页并截图。
import time

import config
import device
import zhipu_vision


class AgentError(Exception):
    pass


def _to_px(v, size):
    """把模型输出的 0~1000 相对坐标换算为像素。"""
    return max(0, min(size - 1, int(int(v) * size / 1000)))


def capture_darkpool(code: str) -> bytes:
    """
    输入股票代码（如 01810），返回该股暗盘行情页的 PNG 截图字节。
    失败抛 AgentError，message 为可展示给用户的原因。
    """
    code = code.strip()
    goal = (
        f"在同花顺App中找到股票代码为 {code} 的港股，"
        f"进入它的「暗盘」行情页面。通常路径：点击顶部搜索图标 -> 输入代码 {code} "
        f"-> 点击搜索结果中的该股票 -> 在个股行情页寻找「暗盘」Tab或入口。"
    )

    w, h = device.screen_size()
    device.launch_ths()

    history = []
    for _ in range(config.MAX_STEPS):
        shot = device.screenshot_b64()
        act = zhipu_vision.decide(shot, goal, history)
        kind = act.get("action")
        reason = act.get("reason", "")

        if kind == "finish":
            # 最终校验：再截一张，让模型确认确实是该股票的暗盘页
            time.sleep(0.8)
            final = device.screenshot_png()
            if _verify(final, code):
                return final
            history.append("上一步声称完成，但校验发现并非目标暗盘页，继续操作")
            continue

        if kind == "fail":
            raise AgentError(reason or "无法进入该股票的暗盘页面")

        if kind == "tap":
            device.tap(_to_px(act["x"], w), _to_px(act["y"], h))
        elif kind == "swipe":
            device.swipe(
                _to_px(act["x1"], w), _to_px(act["y1"], h),
                _to_px(act["x2"], w), _to_px(act["y2"], h),
            )
        elif kind == "type":
            device.input_text(str(act.get("text", code)))
        elif kind == "back":
            device.key_back()
        elif kind == "wait":
            pass
        else:
            history.append(f"返回了未知动作 {kind}，已忽略")
            continue

        history.append(f"{kind}: {reason}")
        time.sleep(config.STEP_WAIT)

    raise AgentError(f"操作步数超过 {config.MAX_STEPS} 步仍未找到 {code} 的暗盘页面")


def _verify(png_bytes: bytes, code: str) -> bool:
    """让视觉模型确认当前屏幕是否为该股票的暗盘行情页。"""
    import base64

    shot = base64.b64encode(png_bytes).decode()
    try:
        act = zhipu_vision.decide(
            shot,
            f"校验：当前屏幕是否已经是股票 {code} 的「暗盘」行情页？"
            f"是则输出 finish，不是则输出 fail 并说明当前是什么页面。",
            [],
        )
        return act.get("action") == "finish"
    except Exception:
        # 校验环节出错时不阻塞主流程，认为通过
        return True
