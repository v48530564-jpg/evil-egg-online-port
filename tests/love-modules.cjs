process.on('uncaughtException', error => { console.error(error.message); process.exitCode = 1; });
// Run a small .love archive from stdin in the actual bundled Lua runtime.
// Graphics are disabled by the fixture. Browser IndexedDB persistence is
// bypassed here because this regression test runs in Node, not a browser.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let runtime = fs.readFileSync('love.js', 'utf8');
const start = runtime.indexOf('if(typeof ENVIRONMENT_IS_PTHREAD===');
const end = runtime.indexOf('if(runtimeInitialized){moduleRtn=', start);
if (start < 0 || end < 0) throw new Error('Cannot locate browser persistence setup');
runtime = runtime.slice(0, start) + runtime.slice(end);

const context = {
    console, require, process, setTimeout, clearTimeout, TextDecoder, TextEncoder,
    Blob, Response, DecompressionStream, performance, URL, URLSearchParams, WebAssembly, Uint8Array, ArrayBuffer, Promise,
    __dirname: process.cwd(),
    __filename: path.resolve('love.js'),
    window: {
        location: { search: '' },
        addEventListener() {},
        requestAnimationFrame: callback => setTimeout(callback, 0)
    },
    navigator: { language: 'en-US', userAgent: 'Node', platform: 'Linux' },
    document: { getElementById: () => ({ addEventListener() {} }) }
};
vm.createContext(context);
vm.runInContext(runtime, context);
const bytes = fs.readFileSync(0);
const moduleConfig = {
    arguments: ['/test.love'],
    setExceptionMessage(error) {
        console.error(error);
        process.exitCode = 1;
    },
    preRun: [module => module.FS_createDataFile('/test.love', null, bytes, true, true, true)]
};
function fail(error) {
    console.error(error);
    process.exitCode = 1;
}
if (process.argv.includes('--loader')) {
    // Exercise the production archive repair, malloc, filesystem installation,
    // dependency release, and Lua startup together, with graphics disabled.
    Object.assign(context, {
        setFocus() {},
        drawLoadingStatus() {},
        onException: fail,
        fetch: async () => ({
            ok: true,
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        })
    });
    const loader = fs.readFileSync('game.js', 'utf8')
        .replace('var expected = 57602080;', `var expected = ${bytes.length};`);
    vm.runInContext(loader, context);
} else {
    context.Love(moduleConfig).catch(fail);
}
