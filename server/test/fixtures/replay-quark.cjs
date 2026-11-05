// Offline CLI protocol fixture. No network or real account operations.
const args = process.argv.slice(2), emit = data => console.log(JSON.stringify(data));
if (process.env.REPLAY_TEST_AUTH_FAIL === '1') {
  emit({ type: 'result', code: -1408, msg: '未完成授权认证', data: {} }); process.exit(1);
}
if (args[0] === 'upload' && args[1] === 'list') {
  if (process.env.REPLAY_TEST_NO_RECORD !== '1') emit({ type: 'list', code: 0, data: { recordId: 'saved-record', fileName: 'course-123.mp4', state: 'paused' } });
  emit({ type: 'result', code: 0, data: {} });
} else if (args[0] === 'upload') {
  emit({ type: 'progress', data: { percent: 65, current: 65, total: 100 } });
  emit({ type: 'list', code: 0, data: { recordId: 'saved-record', fileId: 'fixture-fid' } });
  emit({ type: 'result', code: 0, data: { fids: ['fixture-fid'], args } });
} else if (args[0] === 'share') {
  emit({ type: 'result', code: 0, data: { share_url: 'https://pan.quark.cn/s/fixture', args } });
} else if (args[0] === 'get-user-info') emit({ type: 'result', code: 0, data: {} });
else { emit({ type: 'result', code: -1, msg: '未知测试命令' }); process.exit(1); }
