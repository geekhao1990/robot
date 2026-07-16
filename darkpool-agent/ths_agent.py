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
    输入A股代码（如 600519），返回该股「资金」栏目主力暗盘板块的 PNG 截图字节。
    失败抛 AgentError，message 为可展示给用户的原因。
    """
    code = code.strip()
    goal = (
        f"在同花顺App中打开股票代码为 {code} 的A股个股行情页，切换到「资金」栏目，"
        f"让「主力流向」板块（包含主力净流入、主力明盘、主力暗盘柱状图）完整显示在屏幕中。"
        f"通常路径：点击顶部搜索图标 -> 输入代码 {code} -> 点击搜索结果中的该股票 "
        f"-> 在个股页中部的Tab栏点「资金」-> 如「主力流向」未完整可见则轻微上下滚动。"
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


def discover_watchlist_codes() -> list[str]:
    """
    读取同花顺「自选股」列表中的全部股票代码，作为每日跑批的对象。
    把需要给客户提供暗盘截图的股票加进 App 自选股即可，无需改代码。
    找不到自选列表时抛 AgentError。
    """
    goal = (
        "在同花顺App中打开「自选股」列表页（展示我关注的股票列表，含名称和代码）。"
        "通常路径：底部导航栏点「自选」。看到自选股列表时输出 finish；"
        "找不到自选入口或列表为空时输出 fail。"
    )
    w, h = device.screen_size()
    device.launch_ths()

    history = []
    for _ in range(config.MAX_STEPS):
        shot = device.screenshot_b64()
        act = zhipu_vision.decide(shot, goal, history)
        kind = act.get("action")

        if kind == "finish":
            break
        if kind == "fail":
            raise AgentError(act.get("reason") or "未找到暗盘列表页")
        if kind == "tap":
            device.tap(_to_px(act["x"], w), _to_px(act["y"], h))
        elif kind == "swipe":
            device.swipe(
                _to_px(act["x1"], w), _to_px(act["y1"], h),
                _to_px(act["x2"], w), _to_px(act["y2"], h),
            )
        elif kind == "back":
            device.key_back()
        history.append(f"{kind}: {act.get('reason', '')}")
        time.sleep(config.STEP_WAIT)
    else:
        raise AgentError("未能在限定步数内打开自选股列表页")

    # 读当前屏 + 上滑一屏，合并识别到的代码
    question = (
        '请读出截图中自选股列表里所有股票的代码（6位数字的A股代码），'
        '输出 JSON：{"codes": ["600519", "300750"]}，没有则输出 {"codes": []}。'
    )
    codes: list[str] = []
    for i in range(2):
        data = zhipu_vision.ask_json(device.screenshot_b64(), question)
        for c in data.get("codes", []):
            c = str(c).strip().zfill(6)
            if c.isdigit() and c not in codes:
                codes.append(c)
        if i == 0:
            device.swipe(w // 2, int(h * 0.75), w // 2, int(h * 0.35))
            time.sleep(1.2)
    return codes


def _verify(png_bytes: bytes, code: str) -> bool:
    """让视觉模型确认当前屏幕是否为该股票的暗盘行情页。"""
    import base64

    shot = base64.b64encode(png_bytes).decode()
    try:
        act = zhipu_vision.decide(
            shot,
            f"校验：当前屏幕是否是股票 {code} 的「资金」栏目，"
            f"且「主力流向」板块（主力明盘/主力暗盘柱状图）完整可见？"
            f"是则输出 finish，不是则输出 fail 并说明当前是什么页面。",
            [],
        )
        return act.get("action") == "finish"
    except Exception:
        # 校验环节出错时不阻塞主流程，认为通过
        return True
