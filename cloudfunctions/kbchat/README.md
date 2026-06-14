# kbchat —— 私有知识库客服智能体（云函数 / RAG）

基于微信云开发的云函数，实现「根据私有知识库回答问题」的客服智能体：
**检索知识库 → 拼 Prompt → 调用 Claude 生成答案**。未配置大模型 Key 时自动降级为
「直接返回检索到的知识条目」，因此**开箱即可跑**。

## 文件结构

```
cloudfunctions/kbchat/
├── index.js        # 入口：检索 + 组装 Prompt + 调用 LLM + 降级
├── retriever.js    # 轻量检索（关键词 + 字符二元组打分，无需外部服务）
├── knowledge.js    # 私有知识库（示例，替换成你的真实内容）
├── llm.js          # 调用 Claude Messages API（Node 内置 https）
└── package.json    # 依赖 wx-server-sdk
```

## 部署步骤（微信开发者工具）

1. 顶部菜单开通 **云开发**（首次需创建一个环境，会得到一个环境 ID）。
2. 右键 `cloudfunctions/kbchat` → **上传并部署：云端安装依赖**。
3. （可选，接入真实大模型）在 **云开发控制台 → 云函数 → kbchat → 配置 → 环境变量** 添加：
   - `ANTHROPIC_API_KEY`：你的 Anthropic API Key
   - `CLAUDE_MODEL`：可选，默认 `claude-sonnet-4-6`（客服推荐，快且省）；复杂场景可用 `claude-opus-4-8`
4. 前端无需改动：`app.js` 已用 `wx.cloud.DYNAMIC_CURRENT_ENV` 初始化，AI 助手页会自动调用 `kbchat`。
   - 未开通云开发时，AI 助手自动使用本地降级回复，App 仍可正常运行。

## 调用契约

```js
// 入参
{ question: "怎么发布笔记？", history: [{ role:"user|assistant", content:"..." }] }
// 返回
{ answer: "……", sources: [{ id, title }], usedLLM: true|false }
```

## 升级为「向量检索」（生产建议）

当前 `retriever.js` 是关键词/字符重叠的轻量检索，适合冷启动。知识库变大后建议升级为
embedding 向量检索：

1. **建库（离线）**：把知识库文档切分成 chunk → 调用 embedding 接口（Claude RAG 官方推荐
   **Voyage AI**，如 `voyage-3`）得到向量 → 存入向量库。
   - 云开发可用 **云数据库** 存 `{text, vector}`；规模大可用 Milvus / Qdrant / pgvector。
2. **检索（在线）**：对用户问题做同样的 embedding → 计算余弦相似度取 top-k →
   替换 `retrieve()` 的返回。
3. `index.js`、`llm.js` 无需改动，生成环节继续用 Claude。

## 安全提醒

- **API Key 只放云函数环境变量**，切勿写进小程序前端或提交到仓库。
- 系统提示已约束「只依据资料回答、查不到就转人工」，可按业务再细化。
