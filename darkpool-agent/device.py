# darkpool-agent/device.py
# ADB 设备封装：截屏、点击、滑动、输入、启动 App。
# 需要电脑已安装 adb，且手机/模拟器打开 USB 调试并授权。
import base64
import subprocess
import time

import config


def _adb(*args, binary=False, timeout=30):
    cmd = ["adb"]
    if config.ADB_SERIAL:
        cmd += ["-s", config.ADB_SERIAL]
    cmd += list(args)
    out = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if out.returncode != 0:
        raise RuntimeError(
            f"adb {' '.join(args)} failed: {out.stderr.decode('utf-8', 'ignore')}"
        )
    return out.stdout if binary else out.stdout.decode("utf-8", "ignore")


def screen_size():
    """返回 (width, height) 物理分辨率。"""
    out = _adb("shell", "wm", "size")
    # e.g. "Physical size: 1080x2400"
    part = out.strip().split()[-1]
    w, h = part.split("x")
    return int(w), int(h)


def screenshot_png() -> bytes:
    """截取当前屏幕，返回 PNG 字节。"""
    return _adb("exec-out", "screencap", "-p", binary=True)


def screenshot_b64() -> str:
    return base64.b64encode(screenshot_png()).decode()


def tap(x: int, y: int):
    _adb("shell", "input", "tap", str(x), str(y))


def swipe(x1, y1, x2, y2, ms=350):
    _adb("shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(ms))


def input_text(text: str):
    """输入文本（股票代码为数字/字母，input text 即可，无需中文输入法）。"""
    _adb("shell", "input", "text", text)


def key_back():
    _adb("shell", "input", "keyevent", "4")


def launch_ths():
    """启动同花顺 App 并回到其主界面。"""
    _adb(
        "shell", "monkey",
        "-p", config.THS_PACKAGE,
        "-c", "android.intent.category.LAUNCHER", "1",
    )
    time.sleep(4)


def force_stop_ths():
    _adb("shell", "am", "force-stop", config.THS_PACKAGE)
