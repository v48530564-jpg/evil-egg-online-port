/*
 * Evil Egg - web data loader
 *
 * This is a small replacement for the generated file-packager loader.
 * The LÖVE web runtime is started by Love(Module), while game.data is
 * assembled by the service worker from game.part1/2/3.
 */

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
        if (text) {
            drawLoadingStatus(text, soFar, total);
        }
    },

    setExceptionMessage: onException,

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
 * Emscripten calls preRun functions after the runtime has initialized.
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

        var bytes = new Uint8Array(arrayBuffer);

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
    })
    .catch(function (error) {
        console.error("[Evil Egg] game.data failed:", error);

        onException(error);
    })
    .finally(function () {
        Module.removeRunDependency(dependency);
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

Love(Module);
