# 同花顺「暗盘」截图智能体（设备端）

输入港股代码，自动操作安卓手机上的同花顺 App，进入该股票的**暗盘**行情页并截图，
通过 HTTP 接口返回图片，供小程序聊天框发送给客户。

## 工作原理

智谱 API 本身不能"截图手机 App"——截图必须由真实设备完成。本服务的分工是：

```
FastAPI 接口 (main.py)
   └─ 智能体循环 (ths_agent.py)：观察 → 决策 → 执行
        ├─ 观察：adb screencap 截取当前屏幕          (device.py)
        ├─ 决策：截图发给智谱 GLM-4V，让它判断        (zhipu_vision.py)
        │        下一步点哪里/滑动/输入/完成/失败
        └─ 执行：adb input tap/swipe/text 模拟操作    (device.py)
```

即：**智谱视觉模型当"眼睛和大脑"，ADB 当"手"**。模型每一步看一张屏幕截图，
输出 JSON 动作（0~1000 相对坐标），直到确认进入目标股票的暗盘页，再截最终图返回。

## 部署前提

1. 一台常驻的安卓手机或模拟器（如雷电/MuMu），安装**同花顺**App；
2. App 内已登录**开通了暗盘行情权限的付费账号**（本工具不会、也不能绕过付费）；
3. 电脑安装 `adb`，手机打开 USB 调试并授权（`adb devices` 能看到设备）；
4. 智谱开放平台 API Key：https://open.bigmodel.cn

## 启动

```bash
cd darkpool-agent
pip install -r requirements.txt

export ZHIPU_API_KEY="你的智谱APIKey"
export AGENT_TOKEN="自定义访问令牌"        # 云函数调用时需带上，防止接口裸奔
# 可选：export ZHIPU_VISION_MODEL=glm-4v-plus  ADB_SERIAL=emulator-5554

uvicorn main:app --host 0.0.0.0 --port 8787
```

本机验证：

```bash
curl -X POST http://127.0.0.1:8787/api/darkpool/screenshot \
  -H "Authorization: Bearer 自定义访问令牌" \
  -H "Content-Type: application/json" \
  -d '{"code":"01810"}'
```

返回 `{"ok":true,"code":"01810","image_base64":"..."}`。

## 让云函数访问到本服务

微信云函数在公网，本服务通常跑在家里/办公室内网，需要二选一：

- 部署在有公网 IP 的云服务器上（手机用云真机或将模拟器装在服务器上）；
- 内网穿透（frp / ngrok / cpolar 等）暴露 8787 端口。

然后在云函数 `darkpool` 的环境变量里配置：

| 变量 | 说明 |
| --- | --- |
| `DARKPOOL_AGENT_URL` | 本服务地址，如 `https://xxx.frp.example.com` |
| `DARKPOOL_AGENT_TOKEN` | 与上面 `AGENT_TOKEN` 一致 |

## ⚠️ 合规提示

- 暗盘行情是同花顺的**付费数据服务**。请使用自己已付费开通的账号，并自行确认
  你与同花顺的用户协议 / 数据授权是否允许将行情截图转发给客户（尤其是商业用途、
  面向不特定多数人分发的场景）。
- 自动化操作第三方 App 可能触发其风控（异地登录、频繁操作等），建议控制调用频率。
- 本工具仅做"打开页面并截图"，不破解、不绕过任何付费或加密机制。
