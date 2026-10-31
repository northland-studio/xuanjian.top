// 护栏旁路逻辑自检（ESM，直接 node 运行）
import path from 'node:path';
import * as config from '/opt/xuanjian-notice/src/config.mjs';
import * as g from '/opt/xuanjian-notice/src/guards.mjs';

const ROOT = '/opt/xuanjian-notice';
const dataDir = path.join(ROOT, 'data');

config.initConfig({ pluginPath: ROOT, dataPath: dataDir, envFile: path.join(ROOT, '.env') });
g.initGuards({ dataDir, tripHandler: null });

console.log('  初始 bypass: ' + JSON.stringify(g.bypassState()));
const w0 = g.windowState();
console.log('  时间窗: open=' + w0.open + ' bypassed=' + !!w0.bypassed);
const q0 = g.checkQuota('temp', 50);
console.log('  配额(50人): ok=' + q0.ok + ' errors=' + JSON.stringify(q0.errors).slice(0, 90));

const st = g.setBypassState(true, 'deploy-selftest', '部署自检');
console.log('  开启后: bypass=' + st.on + ' by=' + st.by);

const w1 = g.windowState();
const q1 = g.checkQuota('temp', 50);
console.log('  时间窗: open=' + w1.open + ' bypassed=' + !!w1.bypassed);
console.log('  配额(50人): ok=' + q1.ok + ' bypassed=' + !!q1.bypassed);
console.log('  熔断: ' + JSON.stringify(g.breakerBlock()));

g.setBypassState(false, 'deploy-selftest', '自检结束复原');
const w2 = g.windowState();
const q2 = g.checkQuota('temp', 50);
console.log('  复原后: bypass=' + g.bypassState().on + ' 时间窗open=' + w2.open + ' 配额ok=' + q2.ok);

const ok = q1.ok === true && q1.bypassed === true && w1.bypassed === true && g.bypassState().on === false;
console.log('\n  自检结果: ' + (ok ? 'PASS' : 'FAIL'));
process.exit(ok ? 0 : 1);
