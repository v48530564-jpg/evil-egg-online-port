const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pageScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const gameScript = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function emptyArchive() {
    const buffer = new ArrayBuffer(57602080);
    new DataView(buffer).setUint32(buffer.byteLength - 22, 0x06054b50, true);
    return buffer;
}

function browser(options = {}) {
    const status = { textContent: 'Loading Evil Egg...', style: {} };
    const listeners = {};
    const scripts = [];
    const canvas = { addEventListener() {}, focus() { canvas.focused = true; } };
    const context = {
        console: { log() {}, info() {}, error() {} },
        Uint8Array,
        TextDecoder, TextEncoder,
        document: {
            getElementById: id => id === 'status' ? status : canvas,
            createElement: () => ({}),
            body: { appendChild(script) { scripts.push(script.src); queueMicrotask(() => script.onload()); } }
        },
        window: { addEventListener(name, callback) { listeners[name] = callback; } },
        navigator: options.noServiceWorker ? {} : {
            serviceWorker: {
                controller: {},
                ready: Promise.resolve(),
                register: () => Promise.resolve()
            }
        },
        fetch: options.fetch || (() => Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(emptyArchive())
        }))
    };
    vm.createContext(context);
    vm.runInContext(pageScript, context);
    return { context, status, canvas, listeners, scripts };
}

function start(game, options = {}) {
    const state = { dependencies: 0, started: false, installed: false };
    const { context } = game;
    context.Love = module => {
        if (options.rejectRuntime) return Promise.reject(new Error('Wasm failed'));
        module.addRunDependency = () => state.dependencies++;
        module.removeRunDependency = () => {
            state.dependencies--;
            state.started = true;
            module.onRuntimeInitialized();
            module.setStatus('Running...');
            module.setStatus('');
        };
        module._malloc = () => 0;
        module.HEAPU8 = new Uint8Array(57602080);
        module.FS_createDataFile = () => {
            if (options.installError) throw new Error('Filesystem failed');
            state.installed = true;
        };
        module.preRun.forEach(callback => callback());
        return Promise.resolve(module);
    };
    vm.runInContext(gameScript, context);
    return state;
}

test('successful startup installs the archive and uncovers the canvas', async () => {
    const game = browser();
    const state = start(game);
    await flush();
    assert.equal(state.installed, true);
    assert.equal(state.started, true);
    assert.equal(state.dependencies, 0);
    assert.equal(game.status.style.display, 'none');
    assert.equal(game.canvas.focused, true);
});

test('page requests both scripts with the current build version', async () => {
    const game = browser();
    await flush();
    assert.deepEqual(game.scripts, [
        './love.js?v=' + game.context.GAME_BUILD,
        './game.js?v=' + game.context.GAME_BUILD
    ]);
});

test('HTTP errors remain visible and prevent game startup', async () => {
    const game = browser({ fetch: async () => ({ ok: false, status: 404 }) });
    const state = start(game);
    await flush();
    assert.equal(state.started, false);
    assert.equal(state.installed, false);
    assert.equal(game.status.style.display, 'grid');
    assert.match(game.status.textContent, /HTTP 404/);
});

test('network failures prevent game startup', async () => {
    const game = browser({ fetch: async () => { throw new Error('Network failed'); } });
    const state = start(game);
    await flush();
    assert.equal(state.started, false);
    assert.match(game.status.textContent, /Network failed/);
});

test('truncated archives prevent game startup', async () => {
    const game = browser({ fetch: async () => ({
        ok: true, arrayBuffer: async () => new ArrayBuffer(10)
    }) });
    const state = start(game);
    await flush();
    assert.equal(state.started, false);
    assert.equal(state.installed, false);
    assert.match(game.status.textContent, /Wrong game.data size/);
});

test('filesystem failures prevent game startup', async () => {
    const game = browser();
    const state = start(game, { installError: true });
    await flush();
    assert.equal(state.started, false);
    assert.match(game.status.textContent, /Filesystem failed/);
});

test('runtime promise rejections reach the error screen', async () => {
    const game = browser();
    start(game, { rejectRuntime: true });
    await flush();
    assert.match(game.status.textContent, /Wasm failed/);
    assert.equal(game.status.style.display, 'grid');
});

test('later status updates cannot erase a runtime error', async () => {
    const game = browser();
    start(game);
    await flush();
    game.context.Module.onAbort('Runtime aborted');
    game.context.Module.setStatus('Running...');
    game.context.Module.setStatus('');
    assert.match(game.status.textContent, /Runtime aborted/);
    assert.equal(game.status.style.display, 'grid');
});

test('unsupported service workers produce a visible explanation', async () => {
    const game = browser({ noServiceWorker: true });
    await flush();
    assert.match(game.status.textContent, /Service workers are unavailable/);
    assert.equal(game.status.style.display, 'grid');
});

test('uncaught script errors reach the error screen', async () => {
    const game = browser();
    await flush();
    game.listeners.error({ error: new Error('Script failed') });
    assert.match(game.status.textContent, /Script failed/);
});

test('unhandled asynchronous errors reach the error screen', async () => {
    const game = browser();
    await flush();
    game.listeners.unhandledrejection({ reason: new Error('Async failed') });
    assert.match(game.status.textContent, /Async failed/);
});
