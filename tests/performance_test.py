"""Run performance regressions against the actual patched game data in Lua."""
import io
import subprocess
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

MAIN = r'''
local graphics_source = assert(love.filesystem.read('graphics.lua'))
conf={}
require 'lib.keyprocess'
local original_bump = assert(loadstring(love.filesystem.read('baseline/bump.lua')))()
local optimized_bump = require 'lib.bump'
local bit = require 'bit'
local raw_band, band_calls = bit.band, 0
bit.band = function(...) band_calls=band_calls+1; return raw_band(...) end
local old, new = original_bump.newWorld(32), optimized_bump.newWorld(32)
local items = {}
for i=1,16 do
 local layer=2^((i-1)%5)
 local item={bump_layer=layer};items[i]=item
 old:add(item,i*8,i*5,6,6,layer,31);new:add(item,i*8,i*5,6,6,layer,31)
end
local masks={0,1,2,3,5,16,31,4294967295,-1,2147483648}
for _,mask in ipairs(masks) do
 for i=1,40 do
  local a,na=old:queryRect(i*3,i*2,30,40,nil,nil,mask)
  local b,nb=new:queryRect(i*3,i*2,30,40,nil,nil,mask)
  assert(na==nb,'Changed collision result count')
  local found={};for _,v in ipairs(a) do found[v]=true end
  for _,v in ipairs(b) do assert(found[v],'Changed collision item') end
 end
end
-- Exercise cache eviction as well as unsigned/signed masks.
for mask=1,300 do
 local a,na=old:queryRect(0,0,200,200,nil,nil,mask)
 local b,nb=new:queryRect(0,0,200,200,nil,nil,mask)
 assert(na==nb)
end
for _,world in ipairs({old,new}) do world:remove(items[1]);world:remove(items[2]) end
local _,a=old:queryRect(0,0,200,200)
local _,b=new:queryRect(0,0,200,200)
assert(a==b)
local function bench(world)
 band_calls=0;local start=os.clock()
 for i=1,1500 do world:queryRect(20,20,40,40) end
 return os.clock()-start, band_calls
end
local old_time,old_calls=bench(old)
local new_time,new_calls=bench(new)
assert(old_calls>0 and new_calls==0,'Optimized masks still call the slow bit interpreter')
print(string.format('BENCH collision queries: old=%.6fs new=%.6fs band_calls=%d -> %d',old_time,new_time,old_calls,new_calls))

local set_shaders=assert(graphics_source:match('(function graphics%.set_screen_shaders.-\nend)'))
local set_preset=assert(graphics_source:match('(function graphics%.set_screen_shader_from_preset.-\nend)'))
local released, initialized=0,0
local g={screen_shader_canvases={ {release=function() released=released+1 end} }}
g.initialize_screen_shader_presets=function() initialized=initialized+1;g.screen_shader_presets={{'shader_preset_soft',{shader='effect'}}} end
assert(loadstring('local graphics=...\n'..set_shaders..'\n'..set_preset..'\nreturn graphics'))(g)
g.set_screen_shader_from_preset('shader_preset_none')
assert(g.screen_shaders==nil and released==1 and initialized==0)
g.set_screen_shader_from_preset('shader_preset_none')
assert(released==1 and initialized==0)
g.set_screen_shader_from_preset('shader_preset_soft')
assert(initialized==1 and g.screen_shaders[2].shader=='effect')

local function extend() return {super={draw=function() end}} end
World={extend=extend};GameObject2D={extend=extend}
package.preload['obj']=function() return {} end
package.preload['obj.Menu.GamerHealthTimer']=function() return {} end
Palette=function(t) return t end;Color={black=0,darkgrey=1};fonts={greenoid={}}
GAME_VERSION='1.4.8'
local drawn
graphics={set_font=function() end,printp_right_aligned=function(text,font,palette,offset,x,y)
 drawn=text;assert(x==114 and y==-41)
end}
local menu=require 'world.MainMenuWorld'
menu.draw({drawing_version=true,draw_background=function() end})
assert(drawn=='1.4.8 (online port by flight)')
assert(GAME_VERSION=='1.4.8','Display credit must not change game/leaderboard version metadata')
print('PASS: collision equivalence, optional effects and menu credit')
function love.run() return function() return 0 end end
'''

class PerformanceTests(unittest.TestCase):
    def test_runtime_performance_and_credit(self):
        original = b''.join((ROOT/f'game.part{i}').read_bytes() for i in range(1,4))
        output=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(original)) as before, zipfile.ZipFile(output,'w') as fixture:
            baseline_bump=before.read('lib/bump.lua')
            for entry in before.infolist():
                data=before.read(entry)
                if entry.filename=='conf.lua': data=b'function love.conf(t) t.window=false; for k in pairs(t.modules) do t.modules[k]=false end end'
                if entry.filename=='main.lua': data=MAIN.encode()
                fixture.writestr(entry,data)
            fixture.writestr('baseline/bump.lua',baseline_bump)
        result=subprocess.run(['node','tests/love-modules.cjs','--loader'],input=output.getvalue(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,cwd=ROOT,timeout=60)
        text=result.stdout.decode(errors='replace')
        self.assertEqual(result.returncode,0,text)
        self.assertIn('PASS: collision equivalence',text)
        print('\n'+ '\n'.join(line for line in text.splitlines() if line.startswith(('BENCH','PASS'))))

if __name__=='__main__': unittest.main()
