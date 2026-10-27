"""Check the actual bundled game archive using Python's ZIP reader and Node."""
import io
import subprocess
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPLACEMENTS = {
    "table.clear.lua": "table/clear.lua",
    "table.new.lua": "table/new.lua",
}
NORMALIZE = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('game.js', 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(0, source.indexOf('var Module =')), context);
const bytes = fs.readFileSync(0);
process.stdout.write(context.fixTableModulePaths(bytes));
"""


class ArchiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = b"".join(
            (ROOT / f"game.part{i}").read_bytes() for i in range(1, 4)
        )
        cls.repaired = cls.normalize(cls.original)

    @staticmethod
    def normalize(data):
        return subprocess.run(
            ["node", "-e", NORMALIZE], input=data, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, cwd=ROOT, check=True,
        ).stdout

    def test_lua_modules_have_require_compatible_paths(self):
        with zipfile.ZipFile(io.BytesIO(self.repaired)) as archive:
            names = set(archive.namelist())
            for old, new in REPLACEMENTS.items():
                self.assertIn(new, names)
                self.assertNotIn(old, names)
            # Reading verifies local filenames agree with directory records.
            self.assertIn(b"table.clear=clear", archive.read("table/clear.lua"))
            self.assertIn(b"table.new=new", archive.read("table/new.lua"))

    def test_all_game_contents_and_archive_size_are_preserved(self):
        self.assertEqual(len(self.repaired), len(self.original))
        with zipfile.ZipFile(io.BytesIO(self.original)) as before:
            with zipfile.ZipFile(io.BytesIO(self.repaired)) as after:
                expected = {REPLACEMENTS.get(n, n) for n in before.namelist()}
                self.assertEqual(set(after.namelist()), expected)
                for entry in before.infolist():
                    repaired = after.getinfo(REPLACEMENTS.get(entry.filename, entry.filename))
                    self.assertEqual(repaired.CRC, entry.CRC)
                    self.assertEqual(repaired.file_size, entry.file_size)
                    self.assertEqual(repaired.compress_size, entry.compress_size)
                self.assertIsNone(after.testzip())

    def test_already_corrected_archives_are_unchanged(self):
        self.assertEqual(self.normalize(self.repaired), self.repaired)

    def test_invalid_archives_are_rejected(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.normalize(b"not a zip")

    @staticmethod
    def lua_fixture():
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(ArchiveTests.original)) as original:
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as fixture:
                for name in ["lib/tabley.lua", "table.clear.lua", "table.new.lua"]:
                    fixture.writestr(name, original.read(name))
                fixture.writestr("conf.lua", """
function love.conf(t)
    t.window = false
    for name in pairs(t.modules) do t.modules[name] = false end
end
""")
                fixture.writestr("main.lua", """
local tabley = require 'lib.tabley'
assert(type(table.clear) == 'function')
assert(type(table.new) == 'function')
local t = tabley.new(4, 2)
t[1] = 'one'; t.key = 'value'; tabley.clear(t)
assert(next(t) == nil)
assert(tabley.length({1, 2, 3}) == 3)
print('PASS: table modules load and work in the bundled Lua runtime')
function love.run() return function() return 0 end end
""")
        return output.getvalue()

    def run_love(self, data):
        return subprocess.run(
            ["node", "tests/love-modules.cjs"], input=data,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            cwd=ROOT, timeout=30,
        )

    def test_original_paths_reproduce_the_browser_error(self):
        result = self.run_love(self.lua_fixture())
        self.assertIn(b"module 'table.clear' not found", result.stdout)

    def test_corrected_paths_load_in_the_actual_love_runtime(self):
        result = self.run_love(self.normalize(self.lua_fixture()))
        self.assertEqual(result.returncode, 0, result.stdout.decode(errors="replace"))
        self.assertIn(b"PASS: table modules load and work", result.stdout)

    def test_full_archive_through_production_loader(self):
        # Retain every real archive entry. Only replace the game entry points
        # with the graphics-disabled smoke test so Node can run it.
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.original)) as original:
            with zipfile.ZipFile(io.BytesIO(self.lua_fixture())) as fixture:
                with zipfile.ZipFile(output, "w") as smoke:
                    for entry in original.infolist():
                        data = fixture.read(entry.filename) if entry.filename in ("conf.lua", "main.lua") else original.read(entry)
                        smoke.writestr(entry, data)
        result = subprocess.run(
            ["node", "tests/love-modules.cjs", "--loader"],
            input=output.getvalue(), stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, cwd=ROOT, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout.decode(errors="replace"))
        self.assertIn(b"/game.love installed", result.stdout)
        self.assertIn(b"PASS: table modules load and work", result.stdout)


    def test_lua51_archive_integrity(self):
        repair = NORMALIZE.replace("const context = {};", "const context = {Blob, Response, DecompressionStream, TextEncoder, TextDecoder};")
        repair = repair.replace("process.stdout.write(context.fixTableModulePaths(bytes));", "context.fixLua51Labels(context.fixTableModulePaths(bytes)).then(b => process.stdout.write(b));")
        result = subprocess.run(["node", "-e", repair], input=self.original,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, check=True)
        changed = {"filesystem.lua", "graphics.lua", "lib/anim.lua", "world/GameWorld.lua", "lib/gen/curry.lua", "shader/shader.lua", "shader/decode_palette.frag", "shader/decode_palette_with_image.frag", "shader/bloom.frag", "usersettings.lua"}
        with zipfile.ZipFile(io.BytesIO(self.original)) as before, zipfile.ZipFile(io.BytesIO(result.stdout)) as after:
            self.assertIsNone(after.testzip())
            self.assertEqual(len(after.infolist()), len(before.infolist()))
            for entry in before.infolist():
                old = before.read(entry)
                new = after.read(REPLACEMENTS.get(entry.filename, entry.filename))
                if entry.filename not in changed:
                    self.assertEqual(new, old, entry.filename)
                elif entry.filename in ("filesystem.lua", "graphics.lua", "lib/anim.lua", "world/GameWorld.lua"):
                    import re
                    expected = re.sub(rb"^[\t ]*::continue::[\t ]*\r?$", lambda m: re.sub(rb"[^\r\n]", b" ", m[0]), old, flags=re.M)
                    if entry.filename == "graphics.lua":
                        expected = expected.replace(b"local try_readback = true", b"local try_readback = false")
                    self.assertEqual(new, expected, entry.filename)
                elif entry.filename == 'usersettings.lua':
                    self.assertIn(b'fullscreen = false,', new)
                    self.assertIn(b'self.fullscreen = false -- Start in the tab', new)
                elif entry.filename.startswith('shader/'):
                    self.assertNotEqual(new, old)
                    if entry.filename.endswith('.lua'): self.assertIn(b'shader.prepare', new)
                    else: self.assertIn(b'float(', new)
                else:
                    self.assertIn(b"make_curry", new)

    def test_all_lua_sources_compile_and_compatibility_helpers_work(self):
        main = r"""
local count = 0
local function scan(path)
    for _, name in ipairs(love.filesystem.getDirectoryItems(path)) do
        local p = path == '' and name or path .. '/' .. name
        if love.filesystem.getInfo(p).type == 'directory' then scan(p)
        elseif p:sub(-4) == '.lua' then
            assert(loadstring(love.filesystem.read(p), '@' .. p))
            count = count + 1
        end
    end
end
scan('')
local filesystem = require 'filesystem'
assert(type(filesystem.get_modules) == 'function')
require 'lib.gen.curry'
local branch = curry3(function(...) return select('#', ...), ... end)(1)
local n, a, b, c = branch(nil)(3)
assert(n == 3 and a == 1 and b == nil and c == 3)
assert(branch(4)(5) == 3)
local n, a, b, c, d = curry2(function(...) return select('#', ...), ... end)(nil)(2, nil, 4)
assert(n == 4 and a == nil and b == 2 and c == nil and d == 4)
local step = curry59(function(...) local sum=0; for i=1,select('#',...) do sum=sum+select(i,...) end; return sum end)
for i=1,59 do step=step(i) end
assert(step == 1770)
print('PASS: compiled ' .. count .. ' Lua files and tested filesystem/curry helpers')
function love.run() return function() return 0 end end
"""
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.original)) as original, zipfile.ZipFile(output, "w") as smoke:
            for entry in original.infolist():
                data = original.read(entry)
                if entry.filename == 'main.lua': data = main.encode()
                if entry.filename == 'conf.lua': data = b'function love.conf(t) t.window=false; for k in pairs(t.modules) do t.modules[k]=false end end'
                smoke.writestr(entry, data)
        result = subprocess.run(["node", "tests/love-modules.cjs", "--loader"], input=output.getvalue(),
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=ROOT, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout.decode(errors='replace'))
        self.assertIn(b'PASS: compiled 351 Lua files', result.stdout)


    def test_web_starts_windowed_with_old_saved_fullscreen_and_allows_toggle(self):
        main = r"""
local requested, saved
package.preload['_usersettings'] = function() return {fullscreen=true} end
conf = {should_platform_force_fullscreen=function() return false end}
love.window = {
 setFullscreen=function(value) requested=value end,
 setVSync=function() end
}
local settings = require 'usersettings'
settings.save = function(self) saved=self.fullscreen end
settings:initial_load()
assert(settings.fullscreen == false, 'Saved fullscreen must not force startup fullscreen')
assert(requested == false and saved == false)
settings.fullscreen=true
settings:apply_settings()
assert(requested == true, 'Explicit fullscreen must remain available')
settings.fullscreen=false
settings:apply_settings()
assert(requested == false)
print('PASS: windowed startup and optional fullscreen')
function love.run() return function() return 0 end end
"""
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.original)) as original, zipfile.ZipFile(output, 'w') as smoke:
            for entry in original.infolist():
                data=original.read(entry)
                if entry.filename=='main.lua': data=main.encode()
                if entry.filename=='conf.lua': data=b'function love.conf(t) t.window=false; for k in pairs(t.modules) do t.modules[k]=false end end'
                smoke.writestr(entry,data)
        result=subprocess.run(['node','tests/love-modules.cjs','--loader'], input=output.getvalue(),
                              stdout=subprocess.PIPE,stderr=subprocess.STDOUT,cwd=ROOT,timeout=30)
        self.assertEqual(result.returncode,0,result.stdout.decode(errors='replace'))
        self.assertIn(b'PASS: windowed startup and optional fullscreen',result.stdout)


if __name__ == "__main__":
    unittest.main()
