# darkpool-agent/config.py
# 全部通过环境变量配置，便于在不同机器上部署。
import os

# ---- 智谱 API ----
# 在 https://open.bigmodel.cn 申请 API Key
ZHIPU_API_KEY = os.environ.get("ZHIPU_API_KEY", "")
# 视觉模型：负责"看屏幕、找按钮、确认页面"。
# 可选：glm-4v-plus / glm-4v-flash / glm-4.1v-thinking-flash 等
ZHIPU_VISION_MODEL = os.environ.get("ZHIPU_VISION_MODEL", "glm-4v-plus")
ZHIPU_API_URL = os.environ.get(
    "ZHIPU_API_URL", "https://open.bigmodel.cn/api/paas/v4/chat/completions"
)

# ---- ADB / 设备 ----
# 多台设备时指定序列号（adb devices 查看）；单台设备留空即可
ADB_SERIAL = os.environ.get("ADB_SERIAL", "")
# 同花顺 App 包名（手炒同花顺）
THS_PACKAGE = os.environ.get("THS_PACKAGE", "com.hexin.plat.android")

# ---- 智能体 ----
# 单次任务最多执行多少步（防止死循环）
MAX_STEPS = int(os.environ.get("MAX_STEPS", "14"))
# 每步操作后等待界面渲染的秒数
STEP_WAIT = float(os.environ.get("STEP_WAIT", "1.8"))

# ---- 收盘后跑批 ----
# 每天自动批量预抓取暗盘截图的时间（本机时间 HH:MM，服务器请设为北京时间）。
# 收盘为 15:00，默认 15:30 跑批；留空 "" 则关闭自动跑批（改用手动/外部 cron 触发）。
PREFETCH_AT = os.environ.get("PREFETCH_AT", "15:30")
# 跑批股票代码列表（逗号分隔，如 "01810,02525"）；
# 留空则由智能体自动打开同花顺暗盘列表页识别当天全部代码。
PREFETCH_CODES = [
    c.strip() for c in os.environ.get("PREFETCH_CODES", "").replace("，", ",").split(",")
    if c.strip()
]

# ---- HTTP 服务 ----
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8787"))
# 简单的访问令牌，云函数请求时需带 Authorization: Bearer <token>
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "")
