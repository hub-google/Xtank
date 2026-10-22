'use strict';
const path=require('node:path');
const esbuild=require('esbuild');
// Generate a CommonJS copy of the shared simulation at build time for
// Electron ASAR compatibility. The browser and server still share one source.
esbuild.buildSync({
 entryPoints:[path.resolve(__dirname,'../src/simulation.js')],
 outfile:path.resolve(__dirname,'../server/engine.cjs'),
 platform:'node',format:'cjs',target:'node22',
 bundle:true,minify:false,sourcemap:false,
});
console.log('Built server/engine.cjs from src/simulation.js');
