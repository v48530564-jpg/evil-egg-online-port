
const P=["game.part1","game.part2","game.part3"];
self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{
 const u=new URL(e.request.url);
 if(u.origin!==location.origin||!u.pathname.endsWith("/game.data")) return;
 e.respondWith((async()=>{
  const rs=await Promise.all(P.map(x=>fetch(new URL(x,self.location.href))));
  if(rs.some(r=>!r.ok)) return new Response("Missing game part",{status:404});
  const bs=await Promise.all(rs.map(r=>r.arrayBuffer()));
  const a=new Uint8Array(bs.reduce((n,b)=>n+b.byteLength,0)); let o=0;
  for(const b of bs){a.set(new Uint8Array(b),o);o+=b.byteLength}
  return new Response(a,{headers:{"Content-Type":"application/octet-stream"}});
 })());
});
