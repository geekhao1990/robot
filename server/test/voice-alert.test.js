const test = require('node:test');
const assert = require('node:assert/strict');
const { percentEncode, signedParams, voiceConfig } = require('../src/voice-alert');

test('voice alert uses Aliyun RPC-safe encoding and signs without exposing the secret', () => {
  assert.equal(percentEncode('a b*c'), 'a%20b%2Ac');
  const params = signedParams({
    accessKeyId: 'test-id', accessKeySecret: 'top-secret', calledNumber: '02212345678',
    ttsCode: 'TTS_123', calledShowNumber: '',
  }, 'DF123456');
  assert.equal(params.Action, 'SingleCallByTts');
  assert.equal(params.CalledNumber, '02212345678');
  assert.equal(params.TtsParam, JSON.stringify({ orderId: 'DF123456' }));
  assert.ok(params.Signature);
  assert.doesNotMatch(JSON.stringify(params), /top-secret/);
});

test('voice alert remains disabled until every required credential exists', () => {
  const previous = {
    id: process.env.ALIYUN_VOICE_ACCESS_KEY_ID,
    secret: process.env.ALIYUN_VOICE_ACCESS_KEY_SECRET,
    phone: process.env.AI_ALERT_PHONE,
    code: process.env.ALIYUN_VOICE_TTS_CODE,
  };
  delete process.env.ALIYUN_VOICE_ACCESS_KEY_ID;
  delete process.env.ALIYUN_VOICE_ACCESS_KEY_SECRET;
  delete process.env.AI_ALERT_PHONE;
  delete process.env.ALIYUN_VOICE_TTS_CODE;
  assert.equal(voiceConfig().ready, false);
  if (previous.id === undefined) delete process.env.ALIYUN_VOICE_ACCESS_KEY_ID; else process.env.ALIYUN_VOICE_ACCESS_KEY_ID = previous.id;
  if (previous.secret === undefined) delete process.env.ALIYUN_VOICE_ACCESS_KEY_SECRET; else process.env.ALIYUN_VOICE_ACCESS_KEY_SECRET = previous.secret;
  if (previous.phone === undefined) delete process.env.AI_ALERT_PHONE; else process.env.AI_ALERT_PHONE = previous.phone;
  if (previous.code === undefined) delete process.env.ALIYUN_VOICE_TTS_CODE; else process.env.ALIYUN_VOICE_TTS_CODE = previous.code;
});
