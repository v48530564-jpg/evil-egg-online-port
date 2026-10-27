/*
 * Evil Egg - web data loader
 *
 * This is a small replacement for the generated file-packager loader.
 * The LÖVE web runtime is started by Love(Module), while game.data is
 * assembled by the service worker from game.part1/2/3.
 */

console.log("[Evil Egg] loader build: lua51-20261027-4");

/*
 * The bundled Lua compatibility modules were packed with dotted filenames.
 * Lua resolves require("table.clear") as table/clear.lua (and likewise new).
 * Correct both ZIP filename records in memory. The replacement names have
 * the same byte lengths, so file offsets, contents, and CRCs stay unchanged.
 */
function fixTableModulePaths(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = bytes.length - 22;
    var minimum = Math.max(0, end - 65535);

    while (end >= minimum) {
        if (view.getUint32(end, true) === 0x06054b50 &&
            end + 22 + view.getUint16(end + 20, true) === bytes.length) {
            break;
        }
        end--;
    }
    if (end < minimum) {
        throw new Error("Invalid game archive: ZIP directory not found.");
    }

    var replacements = {
        "table.clear.lua": "table/clear.lua",
        "table.new.lua": "table/new.lua"
    };
    var count = view.getUint16(end + 10, true);
    var cursor = view.getUint32(end + 16, true);

    for (var entry = 0; entry < count; entry++) {
        if (view.getUint32(cursor, true) !== 0x02014b50) {
            throw new Error("Invalid game archive: bad ZIP directory entry.");
        }
        var length = view.getUint16(cursor + 28, true);
        var name = "";
        for (var i = 0; i < length; i++) {
            name += String.fromCharCode(bytes[cursor + 46 + i]);
        }
        if (Object.prototype.hasOwnProperty.call(replacements, name)) {
            var local = view.getUint32(cursor + 42, true);
            if (view.getUint32(local, true) !== 0x04034b50 ||
                view.getUint16(local + 26, true) !== length) {
                throw new Error("Invalid game archive: bad Lua module entry.");
            }
            for (var j = 0; j < length; j++) {
                if (bytes[local + 30 + j] !== name.charCodeAt(j)) {
                    throw new Error("Invalid game archive: mismatched Lua module paths.");
                }
            }
            var replacement = replacements[name];
            for (var k = 0; k < length; k++) {
                bytes[local + 30 + k] = replacement.charCodeAt(k);
                bytes[cursor + 46 + k] = replacement.charCodeAt(k);
            }
        }
        cursor += 46 + length + view.getUint16(cursor + 30, true) +
            view.getUint16(cursor + 32, true);
    }
    return bytes;
}

// Repair LuaJIT syntax and generated helpers for the Lua 5.1 web runtime.
// Only replacement entries are appended; all original asset payloads stay intact.
async function fixLua51Labels(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = bytes.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error("Missing ZIP directory");
    var start = view.getUint32(end + 16, true);
    var count = view.getUint16(end + 10, true);
    var targets = new Set(["filesystem.lua", "graphics.lua", "lib/anim.lua", "world/GameWorld.lua", "lib/gen/curry.lua"]);
    var records = [], additions = [], cursor = start, offset = start;
    for (var n = 0; n < count; n++) {
        if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid ZIP directory entry");
        var nameLength = view.getUint16(cursor + 28, true);
        var recordLength = 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
        var name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
        var record = new Uint8Array(bytes.subarray(cursor, cursor + recordLength));
        if (targets.has(name)) {
            var local = view.getUint32(cursor + 42, true);
            var dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
            var compressed = bytes.subarray(dataStart, dataStart + view.getUint32(cursor + 20, true));
            var method = view.getUint16(cursor + 10, true);
            var source;
            if (method === 0) source = new TextDecoder().decode(compressed);
            else if (method === 8) {
                var stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
                source = await new Response(stream).text();
            } else throw new Error("Unsupported Lua ZIP compression: " + method);
            var patched = source.replace(/^[\t ]*::continue::[\t ]*\r?$/gm, function (line) {
                return line.replace(/[^\r\n]/g, " ");
            });
            if (name === "lib/gen/curry.lua") {
                // The generated deeply nested functions overflow the web
                // Lua compiler's stack. Preserve currying with shallow code.
                patched = `-- Web-compatible equivalent of the generated curry2..curry59 helpers.
local function make_curry(n)
    return function(f)
        local function stage(values, count)
            return function(value, ...)
                local args = {}
                for i = 1, count do args[i] = values[i] end
                args[count + 1] = value
                if count + 1 == n then
                    local extra = select('#', ...)
                    for i = 1, extra do args[n + i] = select(i, ...) end
                    return f(unpack(args, 1, n + extra))
                end
                return stage(args, count + 1)
            end
        end
        return stage({}, 0)
    end
end
for n = 2, 59 do _G['curry' .. n] = make_curry(n) end
`;
            }
            if (patched !== source) {
                var data = new TextEncoder().encode(patched);
                var crc = -1;
                for (var i = 0; i < data.length; i++) {
                    crc ^= data[i];
                    for (var bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
                }
                crc = (crc ^ -1) >>> 0;
                var header = new Uint8Array(30 + nameLength);
                var h = new DataView(header.buffer);
                h.setUint32(0, 0x04034b50, true);
                h.setUint16(4, 20, true);
                h.setUint32(14, crc, true);
                h.setUint32(18, data.length, true);
                h.setUint32(22, data.length, true);
                h.setUint16(26, nameLength, true);
                header.set(bytes.subarray(cursor + 46, cursor + 46 + nameLength), 30);
                var r = new DataView(record.buffer);
                r.setUint16(8, 0, true); // No data descriptor or encryption.
                r.setUint16(10, 0, true); // Store corrected Lua source uncompressed.
                r.setUint32(16, crc, true);
                r.setUint32(20, data.length, true);
                r.setUint32(24, data.length, true);
                r.setUint32(42, offset, true);
                additions.push(header, data);
                offset += header.length + data.length;
                console.log("[Evil Egg] Lua 5.1 compatibility:", name);
            }
        }
        records.push(record);
        cursor += recordLength;
    }
    if (!additions.length) return bytes;
    var directorySize = records.reduce(function (sum, r) { return sum + r.length; }, 0);
    var footer = new Uint8Array(bytes.subarray(end));
    var f = new DataView(footer.buffer);
    f.setUint32(12, directorySize, true);
    f.setUint32(16, offset, true);
    var result = new Uint8Array(offset + directorySize + footer.length);
    result.set(bytes.subarray(0, start));
    var position = start;
    additions.concat(records, [footer]).forEach(function (part) { result.set(part, position); position += part.length; });
    return result;
}

var Module = {
    arguments: ["/game.love"],

    canvas: (function () {
        var canvas = document.getElementById("canvas");

        if (!canvas) {
            throw new Error("Evil Egg: #canvas was not found.");
        }

        canvas.addEventListener("webglcontextlost", function (e) {
            e.preventDefault();
            console.log("webglcontextlost");
            location.reload();
        }, false);

        return canvas;
    })(),

    printErr: function (text) {
        console.error("[LÖVE]", text);
    },

    setFocus: setFocus,

    setStatus: function (text, soFar, total) {
        drawLoadingStatus(text, soFar, total);
    },

    setExceptionMessage: onException,
    onAbort: onException,

    onRuntimeInitialized: function () {
        console.log("[Evil Egg] LÖVE runtime initialized.");

        window.addEventListener("focus", function () {
            if (typeof Module._love_setFocus === "function") {
                Module._love_setFocus(true);
            }
        });

        window.addEventListener("blur", function () {
            if (typeof Module._love_setFocus === "function") {
                Module._love_setFocus(false);
            }
        });
    }
};


/*
 * Emscripten calls preRun functions before starting the game.
 * We add a run dependency so it waits for game.data to arrive.
 */
Module.preRun = Module.preRun || [];

Module.preRun.push(function () {
    var dependency = "datafile_game.data";

    Module.addRunDependency(dependency);

    Module.setStatus("Downloading game data...");

    fetch("game.data", {
        cache: "no-store"
    })
    .then(function (response) {
        if (!response.ok) {
            throw new Error(
                "game.data returned HTTP " + response.status
            );
        }

        return response.arrayBuffer();
    })
    .then(async function (arrayBuffer) {
        console.log(
            "[Evil Egg] game.data received:",
            arrayBuffer.byteLength,
            "bytes"
        );

        var expected = 57602080;

        if (arrayBuffer.byteLength !== expected) {
            throw new Error(
                "Wrong game.data size: got " +
                arrayBuffer.byteLength +
                ", expected " +
                expected
            );
        }

        var bytes = await fixLua51Labels(fixTableModulePaths(new Uint8Array(arrayBuffer)));

        Module.FS_createDataFile(
            "/game.love",
            null,
            bytes,
            true,
            true,
            true
        );

        console.log("[Evil Egg] /game.love installed.");

        Module.setStatus("Starting Evil Egg...");

        // Only start the game after its archive has been installed.
        Module.removeRunDependency(dependency);
    })
    .catch(function (error) {
        console.error("[Evil Egg] game.data failed:", error);

        onException(error);
    });
});


/*
 * Start the LÖVE runtime.
 */
if (typeof Love !== "function") {
    throw new Error(
        "Evil Egg: love.js did not provide Love()."
    );
}

Love(Module).catch(onException);
