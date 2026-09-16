import { boot } from './ui-harness.mjs';
const mod = await boot();
import('fs').then(fs => {});
const ids = ['methodAdds','chartCsvBtn','snapFile','stageArmBtn','seedBtn','noteAddBtn','detResetBtn','laserWavIn','methodRunBtn'];
// app binds via $('id') then addEventListener; harness stores [ev,fn,el] tuples
let all;
try { const m = await import('./ui-harness.mjs'); all = m.allHandlers(); } catch {}
for (const id of ids){
  const found = all.some(([ev, fn, el]) => ev === 'click' && el && (el._id === id));
  console.log(id, '→', found ? 'HANDLER' : 'MISSING');
}
