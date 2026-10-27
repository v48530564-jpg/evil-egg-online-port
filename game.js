/*
 * Evil Egg - web data loader
 *
 * This is a small replacement for the generated file-packager loader.
 * The LÖVE web runtime is started by Love(Module), while game.data is
 * assembled by the service worker from game.part1/2/3.
 */

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
    .then(function (arrayBuffer) {
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

        var bytes = fixTableModulePaths(new Uint8Array(arrayBuffer));

        var ptr = Module._malloc(bytes.length);

        Module.HEAPU8.set(bytes, ptr);

        var data = Module.HEAPU8.subarray(
            ptr,
            ptr + bytes.length
        );

        Module.FS_createDataFile(
            "/game.love",
            null,
            data,
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
