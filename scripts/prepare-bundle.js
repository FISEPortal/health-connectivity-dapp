// prepare-bundle.js
// Builds the Signet DApp bundle directly from src/app/init.tsx using esbuild.
// Run via: npm run bundle  (or: yarn bundle)

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const distDir    = path.resolve(__dirname, '../dist');
const initEntry  = path.resolve(__dirname, '../src/app/init.tsx');
const jsOutput   = path.resolve(distDir, 'index.bundle.js');
const cssOutput  = path.resolve(distDir, 'index.css');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

console.log('Building DApp bundle…');
console.log('  entry:', initEntry);
console.log('  output:', jsOutput);

// React and ReactDOM are loaded by Signet before calling init, via the
// "scripts" array in manifest.json. We mark them as external so they are
// not bundled, and provide a require() shim that maps them to the browser
// globals (window.React / window.ReactDOM) that those CDN scripts expose.
const requireShim = `\
if (typeof require === "undefined") {
  var require = function (id) {
    if (id === "react" || id === "react/jsx-runtime") return window.React;
    if (id === "react-dom" || id === "react-dom/client") return window.ReactDOM;
    throw new Error("Module not found: " + id);
  };
}`;

try {
    esbuild.buildSync({
        entryPoints: [initEntry],
        bundle:      true,
        outfile:     jsOutput,
        platform:    'browser',
        format:      'iife',
        jsx:         'transform',
        jsxFactory:  'React.createElement',
        jsxFragment: 'React.Fragment',
        external:    ['react', 'react-dom', 'react-dom/client'],
        define:      { 'process.env.NODE_ENV': '"production"' },
        loader:      { '.css': 'empty', '.scss': 'empty' },
        minify:      true,
        banner:      { js: requireShim },
    });

    console.log('JS bundle written to', jsOutput);
} catch (err) {
    console.error('esbuild failed:', err.message);
    process.exit(1);
}

// This DApp uses inline styles; a CSS file is still required by the manifest.
fs.writeFileSync(cssOutput, '/* Signet DApp Starter - uses inline styles */\n');
console.log('CSS written to', cssOutput);

console.log('\nBundle ready for deployment:');
console.log(' ', jsOutput);
console.log(' ', cssOutput);
