"""Exercise the real Lua shader loader, then compile its output as GLSL ES 3."""
import ctypes as C
import io
import re
import subprocess
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class WebGLTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = b''.join((ROOT / f'game.part{i}').read_bytes() for i in range(1, 4))
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as original, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as fixture:
            for name in original.namelist():
                if name.startswith('shader/'):
                    fixture.writestr(name, original.read(name))
            fixture.writestr('conf.lua', 'function love.conf(t) t.window=false; for k in pairs(t.modules) do t.modules[k]=false end end')
            fixture.writestr('main.lua', r'''
local current, defaults, sends = '', {}, 0
filesystem = {
 get_files_of_type = function()
  local paths = {}
  for _, name in ipairs(love.filesystem.getDirectoryItems('shader')) do
   if name:sub(-5) == '.frag' then paths[#paths+1]='shader/'..name end
  end
  return paths
 end,
 filename_to_asset_name = function(path)
  current = path
  defaults = {}
  local source = love.filesystem.read(path)
  for kind,key,value in source:gmatch('uniform%s+(%w+)%s+([%w_]+)%s*=%s*([%+%-]?[%d%.]+)%s*;') do
   defaults[key]=tonumber(value)
  end
  return path:match('([^/]+)%.frag$')
 end
}
love.graphics = { new_shader = function(code)
 assert(not code:match('uniform%s+%w+%s+[%w_]+%s*='))
 local hex = code:gsub('.', function(c) return string.format('%02x', c:byte()) end)
 print('SHADER '..current..' '..hex)
 return {
  hasUniform = function(_,key) return key ~= 'rgb_amount' end,
  send = function(_,key,value)
   assert(key ~= 'rgb_amount') -- An optimized-out uniform must not be sent.
   assert(defaults[key] == value, 'Changed shader default: '..key)
   defaults[key]=nil; sends=sends+1
  end
 }
end }
local shader = require 'shader.shader'
shader.load()
print('PASS: shader defaults sent '..sends)
function love.run() return function() return 0 end end
''')
        result = subprocess.run(['node', 'tests/love-modules.cjs', '--loader'], input=output.getvalue(),
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=ROOT, timeout=30)
        text = result.stdout.decode(errors='replace')
        if result.returncode or 'PASS: shader defaults sent' not in text:
            raise AssertionError(text)
        cls.shaders = {name: bytes.fromhex(code).decode() for name,code in re.findall(r'^SHADER (\S+) ([0-9a-f]+)$', text, re.M)}
        cls.output = text

    def test_all_shaders_are_prepared_and_defaults_preserved(self):
        self.assertEqual(len(self.shaders), 23)
        self.assertRegex(self.output, r'PASS: shader defaults sent [1-9]\d*')

    def test_palette_math_has_explicit_float_conversions(self):
        self.assertIn('float(palette_offset)', self.shaders['shader/decode_palette.frag'])
        self.assertIn('i / float(palette_size)', self.shaders['shader/decode_palette_with_image.frag'])

    def test_actual_gles3_compilation(self):
        try:
            E=C.CDLL('libEGL.so.1');G=C.CDLL('libGL.so.1')
            def api(lib,n,ret,*args):
                f=getattr(lib,n);f.restype=ret;f.argtypes=list(args);return f
            I=C.c_int;U=C.c_uint;P=C.c_void_p
            getproc=api(E,'eglGetProcAddress',P,C.c_char_p)
            getdisplay=C.CFUNCTYPE(P,U,P,C.POINTER(I))(getproc(b'eglGetPlatformDisplayEXT'))
            display=getdisplay(0x31DD,None,None)
            if not api(E,'eglInitialize',U,P,C.POINTER(I),C.POINTER(I))(display,None,None):
                self.skipTest('No surfaceless EGL display')
            self.assertTrue(api(E,'eglBindAPI',U,U)(0x30A0))
            attrs=(I*9)(0x3033,1,0x3040,0x40,0x3024,8,0x3025,0,0x3038)
            cfg=P();num=I()
            self.assertTrue(api(E,'eglChooseConfig',U,P,C.POINTER(I),C.POINTER(P),I,C.POINTER(I))(display,attrs,C.byref(cfg),1,C.byref(num)))
            context=api(E,'eglCreateContext',P,P,P,P,C.POINTER(I))(display,cfg,None,(I*3)(0x3098,3,0x3038))
            self.assertTrue(context)
            self.assertTrue(api(E,'eglMakeCurrent',U,P,P,P,P)(display,None,None,context))
        except (OSError, AttributeError) as error:
            self.skipTest(str(error))
        create=api(G,'glCreateShader',U,U)
        source=api(G,'glShaderSource',None,U,I,C.POINTER(C.c_char_p),P)
        compile_=api(G,'glCompileShader',None,U)
        status=api(G,'glGetShaderiv',None,U,U,C.POINTER(I))
        log=api(G,'glGetShaderInfoLog',None,U,I,P,C.c_char_p)
        delete=api(G,'glDeleteShader',None,U)
        prefix='#version 300 es\nprecision highp float;\nprecision highp int;\n#define Image sampler2D\nvec4 Texel(sampler2D image,vec2 uv){return texture(image,uv);}\n'
        suffix='\nuniform sampler2D input_image;\nout vec4 pixel;\nvoid main(){pixel=effect(vec4(1.0),input_image,vec2(0.5),vec2(0.5));}'
        for name, code in self.shaders.items():
            with self.subTest(shader=name):
                handle=create(0x8B30)
                text=C.c_char_p((prefix+code+suffix).encode())
                source(handle,1,C.byref(text),None);compile_(handle)
                ok=I();status(handle,0x8B81,C.byref(ok))
                message=C.create_string_buffer(10000);log(handle,10000,None,message)
                delete(handle)
                self.assertTrue(ok.value, message.value.decode())
        api(E,'eglMakeCurrent',U,P,P,P,P)(display,None,None,None)
        api(E,'eglDestroyContext',U,P,P)(display,context)
        api(E,'eglTerminate',U,P)(display)

if __name__ == '__main__':
    unittest.main()
