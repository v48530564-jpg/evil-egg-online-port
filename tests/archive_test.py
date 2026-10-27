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


if __name__ == "__main__":
    unittest.main()
