// cloudfunctions/kbchat/index.js
// 私有知识库客服智能体（RAG）：检索知识库 -> 拼 Prompt -> 调用 Claude 生成答案。
// 未配置 ANTHROPIC_API_KEY 时自动降级为「直接返回检索到的知识」，保证可跑。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { retrieve } = require('./retriever');
const { callClaude } = require('./llm');

exports.main = async (event = {}) => {
  const question = String(event.question || '').trim();
  const history = Array.isArray(event.history) ? event.history.slice(-6) : [];

  if (!question) {
    return { answer: '你好，请问有什么可以帮你的？', sources: [], usedLLM: false };
  }

  // 1) 检索知识库
  const docs = retrieve(question, 3);
  const context = docs
    .map((d, i) => `【资料${i + 1}】${d.title}\n${d.content}`)
    .join('\n\n');

  // 2) 构造系统提示（约束：只依据资料回答，不编造）
  const system =
    '你是「小红书助手」的智能客服。请只依据下面提供的资料回答用户问题；' +
    '若资料中没有相关内容，请如实说明「暂时没有查到相关信息，建议联系人工客服」，不要编造。' +
    '回答要简洁、友好、口语化。\n\n知识库资料：\n' +
    (context || '（暂无相关资料）');

  // 3) 调用 Claude；失败或未配置 Key 时降级
  let answer = null;
  try {
    answer = await callClaude(system, question, history);
  } catch (e) {
    answer = null;
  }

  if (!answer) {
    answer = docs.length
      ? `根据知识库为你找到：\n\n${docs
          .map((d) => `• ${d.title}：${d.content}`)
          .join('\n\n')}`
      : '暂时没有查到相关信息，建议联系人工客服～';
  }

  return {
    answer,
    sources: docs.map((d) => ({ id: d.id, title: d.title })),
    usedLLM: !!process.env.ANTHROPIC_API_KEY,
  };
};
