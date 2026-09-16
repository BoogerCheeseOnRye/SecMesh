import { boot, runFrames, allHandlers, errors } from './ui-harness.mjs';

const app = (await boot()).app;
await runFrames(20);
const ch = app.ch;
if (!ch || !ch.atoms || !ch.atoms.length) throw new Error('no atoms');

// tap-inspect default on
if (!app._tapInspect) throw new Error('tap-inspect should default on');

// settings overlay anchors exist + values round-trip
const sInspect = allHandlers().find(([ev, fn, el]) => ev === 'change' && el && el._id === 'setInspect');
const sOverlay = allHandlers().find(([ev, fn, el]) => ev === 'change' && el && el._id === 'setOverlay');
const sHud = allHandlers().find(([ev, fn, el]) => ev === 'input' && el && el._id === 'setHud');
if (!sInspect || !sOverlay) throw new Error('settings handlers missing: ' + [sInspect, sOverlay, sHud].map(Boolean).join(','));

// toggle tap-inspect off then on (set the bound element's checked, then fire)
const inspEl = sInspect[2];
inspEl.checked = false; sInspect[1](); if (app._tapInspect !== false) throw new Error('setInspect off failed');
inspEl.checked = true;  sInspect[1](); if (app._tapInspect !== true) throw new Error('setInspect on failed');

// overlay modes
sOverlay[1](); sOverlay[1](); // toggles harmlessly
if (!['full','calm','min'].includes(app._overlayMode)) throw new Error('overlay mode bad: ' + app._overlayMode);

// hud scale path — force an input value
sHud[1](); // harness input target.value is '50' → scale clamped to 1.3
if (!(app._hudScale >= 0.7 && app._hudScale <= 1.3)) throw new Error('hud scale out of range: ' + app._hudScale);

// part modals: drive openPartModal directly (harness raycaster won't real-hit)
if (typeof app.openPartModal !== 'function') throw new Error('openPartModal not exposed');
app.openPartModal('Chladni Plate', [['mode', '3,4'], ['drive', '50%']]);
if (!app._modalOpen) throw new Error('part modal did not open');
app.closeModal();
if (app._modalOpen) throw new Error('part modal did not close');
console.log('PARTS-OK: tap-inspect default ✓ · settings handlers wired · overlay modes ✓ · hud scale ✓ · part modal open/close ✓');
process.exit(0);