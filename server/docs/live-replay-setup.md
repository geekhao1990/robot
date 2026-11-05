# 课程回放接入与验收

## 本次实现和边界

- 用户端只展示预告、录制中、可回放，回填夸克链接才是可回放。
- 后台笔记管理新增“回放处理”列、接入检查、单课处理/重试、自动处理开关。
- 课表仍按北京时间 08:30–21:00 每半小时同步；处理器每 30 秒检查已有课表，一次处理一节。
- 只有源站 status=3、has_replay=true、is_future=false，才请求登录后的回放页。不能只用时间或 5000 端口可访问判断回放就绪。
- 支持回放页明确提供一个 M3U8 地址、完整未加密 TS 点播列表、常规主列表。加密、分离音轨、分段 MP4、字节范围播放列表不会绕过限制，会明确阻塞。此版本不执行源站 JavaScript。
- 已核验示例回放页及播放列表，但未实际上传用户网盘。真实合并、夸克上传及分享需要服务器授权后联调。
- 非暂态错误显示“需要处理”；网络/工具暂态错误最多尝试三次。上传结果不确定时核对工具持久化记录，不能确定则停下，避免重复上传。
- 任务保存工作文件和断点，成功回填后仅删除该任务的 TS、MP4 和合并清单；失败任务保留用于排查，需关注磁盘占用。
- 运行一个 Node API 实例。当前项目的数据库是进程内快照，不支持多个 API 进程同时写入；本地工作锁不是跨机器数据库锁。
- 自动处理默认关闭。开启后处理所有符合条件且未回填的同步课程。关闭只停止后续自动任务，已启动任务继续完成；手动试运行独立于自动开关。

## 服务器准备

1. Node.js 20+；安装系统提供的 FFmpeg / FFprobe，并确认 `ffmpeg -version`、`ffprobe -version` 可运行。
2. 通过夸克官方工具完成独立账号授权。必须使用运行 Node 服务的同一系统用户；不要把授权码、Cookie、令牌放进后台、聊天或代码库。
3. 如果之前克隆到了 `/root/quark-drive-tools`，安装入口是：

```bash
cd /root/quark-drive-tools/skills/quarkclouddrive
test -f ./install.sh && bash ./install.sh
test -f ./scripts/quark-drive.cjs && node ./scripts/quark-drive.cjs login
```

若服务不以 root 运行，应在服务账号能访问的目录安装并授权，不能把 root 的私有授权文件直接复制给其他账号。远程无桌面服务器的授权流程以工具实际输出为准；如果浏览器回调不能抵达服务器，停止并提供脱敏错误，不开放授权端口到公网。

4. 在服务器现有 `.env` 里添加/修改以下配置（不要覆盖整份配置文件）：

```dotenv
QUARK_CLI_PATH=/root/quark-drive-tools/skills/quarkclouddrive/scripts/quark-drive.cjs
LIVE_REPLAY_MEDIA_ORIGINS=https://playback-hw.myhithink.com
LIVE_REPLAY_MAX_BYTES=8589934592
```

上述媒体 origin 已于 2026-11-05 通过示例回放页只读核验。源站若改 CDN，先核实再追加精确 origin，不能放开任意地址或通配符。源站用户名密码复用现有 `LIVETABLE_SOURCE_*`，没有时使用 `GOLD_FINGER_SOURCE_*`；此处不重复记录密码。

可选 `QUARK_PARENT_FID` 为你选定的夸克目标目录 ID，不填由官方工具决定默认目录。`LIVE_REPLAY_WORK_DIR` 默认为服务端 `data/live-replay`（非公开目录）。默认单视频最大 8GB，磁盘需要容纳下载分片和合并结果；失败文件不会自动清理。

5. 重启 Node 服务，进入后台“笔记管理”，点击“检查回放接入”。全部通过后才进行下一步。

## 部署包

把完整 `live-replay-bundle.tar.gz` 上传服务器 `/tmp/`，不在 Windows 解压。执行：

```bash
(
set -e
test -s /tmp/live-replay-bundle.tar.gz
STAGE=$(mktemp -d)
tar -xzf /tmp/live-replay-bundle.tar.gz -C "$STAGE"
sed -i 's/\r$//' "$STAGE/scripts/install-replay-bundle.sh"
bash -n "$STAGE/scripts/install-replay-bundle.sh"
bash "$STAGE/scripts/install-replay-bundle.sh"
)
```

包中包含本次包月日限额 99 次的服务器校验，旧包月也自动生效，无须重购。小程序的默认额度字段也已更新，但不展示日限额；发布小程序代码独立于服务端部署。

## 验收（不要跳过）

1. 源站课表同步成功后，在一条已结束、回放就绪且具有下载分享授权的课程点击“处理 / 重试”。
2. 观察检查环境 → 下载 → 合并 → 上传夸克 → 生成分享链接 → 回填 → 已回填。
3. 到夸克确认视频可完整播放、时长正确，分享链接可用，笔记夸克字段已回填，用户列表和详情均显示“可回放”。
4. 再点同步、重启服务，确认不会重复上传；人工填写过的夸克链接不得被覆盖。
5. 通过后才点“开启自动回放处理”。授权过期会显示错误，需要在服务器重新授权后手动重试；不会后台自动登录或要求用户把令牌填进网页。

## 官方协议参考

- https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/main/skills/quarkclouddrive/references/auth.md
- https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/main/skills/quarkclouddrive/references/file-upload.md
- https://github.com/quark-clouddrive/quarkclouddrive_offical/blob/main/skills/quarkclouddrive/references/file-share.md

适配器解析官方 NDJSON 的进度、文件标识及分享链接；授权和工具版本必须在目标服务器验证。不会上传日志、凭据或其他用户文件，仅处理选定课程的生成 MP4。
