// Runs scripts/checks-entry.ts under Node: esbuild bundles it (resolving the
// @/* tsconfig paths) to a temp CommonJS file, then we require it. Keeps the
// checks in TypeScript without adding a ts-node/tsx dependency.
const esbuild = require('esbuild');
const path = require('path');
const os = require('os');
const fs = require('fs');

const entry = path.resolve(__dirname, 'checks-entry.ts');
const out = path.join(os.tmpdir(), `hcd-checks-${process.pid}.cjs`);

esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile: out,
    platform: 'node',
    format: 'cjs',
});

try {
    require(out);
} finally {
    fs.rmSync(out, { force: true });
}
