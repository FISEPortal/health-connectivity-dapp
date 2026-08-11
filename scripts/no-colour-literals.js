// Every colour in the DApp must come from the palette in src/app/health/theme.ts.
//
// Four inline colours once lived outside the styles object, so the provider names kept the
// dark theme's near-white and were invisible on the light card. A unit test cannot see that;
// this can. Guarding the file is cheaper than re-discovering it in a screenshot.
const fs = require('fs');
const src = fs.readFileSync('src/app/init.tsx', 'utf8');
const hits = src.match(/#[0-9a-fA-F]{6}/g) || [];
if (hits.length) {
    console.error('CHECK FAILED: colour literals in init.tsx, use the palette instead:', [...new Set(hits)]);
    process.exit(1);
}
console.log('  no colour literals outside the palette OK');
