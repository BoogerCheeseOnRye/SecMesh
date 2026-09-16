import { boot } from './ui-harness.mjs';
const mod = await boot();
console.log('typeof global $:', typeof globalThis.$);
console.log('window.$:', typeof globalThis.window.$);
console.log('g $:', new Function('return typeof $')());
console.log('app exported:', !!mod.app, 'inst:', !!(mod.app && mod.app._inst));
console.log('chart on:', JSON.stringify(mod.app?._inst?.chart?.on));
