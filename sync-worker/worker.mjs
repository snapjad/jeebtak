// A single personal wallet. The server receives ciphertext, never the encryption key.
const MAX=1000000;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin');
    if(origin&&origin!==env.ALLOWED_ORIGIN)return json({error:'origin'},403);
    const cors={'Access-Control-Allow-Origin':env.ALLOWED_ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Cache-Control':'no-store'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    const path=new URL(request.url).pathname;
    if(path==='/health'&&request.method==='GET')return new Response(JSON.stringify({protocol:1,ready:!!env.SYNC_AUTH_HASH}),{headers:{...cors,'Content-Type':'application/json'}});
    if(path!=='/snapshot'||!['GET','PUT'].includes(request.method))return new Response(null,{status:404,headers:cors});
    const token=request.headers.get('Authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1];
    const digest=token?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join(''):'';
    if(!env.SYNC_AUTH_HASH||digest!==env.SYNC_AUTH_HASH)return new Response(null,{status:401,headers:cors});
    try{const response=await env.WALLET.get(env.WALLET.idFromName('personal-wallet')).fetch(request);const headers=new Headers(response.headers);for(const [name,value] of Object.entries(cors))headers.set(name,value);return new Response(response.body,{status:response.status,headers});}catch{return new Response(null,{status:503,headers:cors});}
  }
};
export class Wallet {
  constructor(ctx){this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS snapshots (revision INTEGER PRIMARY KEY, box TEXT NOT NULL)');}
  async fetch(request){
    let input;
    if(request.method==='PUT'){
      if(Number(request.headers.get('Content-Length'))>MAX)return json({error:'size'},413);
      const reader=request.body?.getReader();if(!reader)return json({error:'body'},400);const chunks=[];let length=0;
      while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX){await reader.cancel();return json({error:'size'},413);}chunks.push(value);}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'json'},400);}
      if(!Number.isSafeInteger(input.revision)||input.revision<0||input.box?.v!==1||!/^[\w-]{16}$/.test(input.box.iv)||typeof input.box.data!=='string'||!/^[\w-]{22,}$/.test(input.box.data))return json({error:'schema'},400);
    }
    // No await between reading revision and INSERT: one Durable Object serialises CAS.
    const current=this.sql.exec('SELECT revision, box FROM snapshots ORDER BY revision DESC LIMIT 1').toArray()[0];
    const revision=current?.revision||0;
    if(request.method==='GET')return json({revision,box:current?JSON.parse(current.box):null});
    if(input.revision!==revision)return json({error:'conflict'},409);
    this.sql.exec('INSERT INTO snapshots (revision, box) VALUES (?, ?)',revision+1,JSON.stringify(input.box));
    this.sql.exec('DELETE FROM snapshots WHERE revision < ?',Math.max(1,revision-3));
    return json({revision:revision+1});
  }
}
