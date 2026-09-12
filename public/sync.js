/* Optional encrypted synchronisation. No requests before explicit device pairing. */
(function(root){
  'use strict';
  const KEY='jeebtak.v1', CONFIG='jeebtak.sync.v1', RECOVERY='jeebtak.sync.recovery.v1';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const canonical=x=>JSON.stringify(sort(x));
  function sort(x){if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));return x;}
  function project(s){const out=copy(s);delete out.updatedAt;delete out.settings.pin;delete out.settings.theme;return out;}
  const same=(a,b)=>canonical(a)===canonical(b);
  function encode(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function decode(s){if(typeof s!=='string'||!/^[\w-]+$/.test(s))throw Error('رمز الربط غير صالح.');return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
  async function keys(secret){const bytes=decode(secret);if(bytes.length!==32)throw Error('مفتاح المحفظة غير صالح.');const material=await crypto.subtle.importKey('raw',bytes,'HKDF',false,['deriveBits','deriveKey']);const params=label=>({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('jeebtak-sync-v1'),info:new TextEncoder().encode(label)});return {aes:await crypto.subtle.deriveKey(params('encryption'),material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']),token:encode(new Uint8Array(await crypto.subtle.deriveBits(params('authentication'),material,256)))};}
  async function encrypt(value,key){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=new TextEncoder().encode(JSON.stringify(value));if(bytes.length>700000)throw Error('البيانات تجاوزت سعة المزامنة الحالية. صدّر نسخة JSON.');return {v:1,iv:encode(iv),data:encode(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('jeebtak-v1')},key,bytes)))};}
  async function decrypt(box,key){if(box?.v!==1||decode(box.iv).length!==12||typeof box.data!=='string'||box.data.length>1000000)throw Error('نسخة المزامنة غير صالحة.');try{return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(box.iv),additionalData:new TextEncoder().encode('jeebtak-v1')},key,decode(box.data))));}catch{throw Error('تعذّر التحقق من النسخة المشفّرة. لم تتغيّر بياناتك.');}}
  function pairing(endpoint,key){return 'JBT1.'+encode(new TextEncoder().encode(JSON.stringify({endpoint,key})));}
  function parsePairing(code){try{const s=code.trim();if(!s.startsWith('JBT1.')||s.length>3000)throw Error();const c=JSON.parse(new TextDecoder().decode(decode(s.slice(5)))),u=new URL(c.endpoint);if(u.protocol!=='https:'||!u.hostname.endsWith('.workers.dev')||u.username||u.password||u.search||u.hash||u.pathname!=='/'||decode(c.key).length!==32)throw Error();return {endpoint:u.origin,key:c.key};}catch{throw Error('رمز الربط غير صالح. انسخه كاملاً من جهازك الأساسي.');}}
  class Engine{
    constructor(options){this.o=options;this.storage=options.storage||localStorage;this.fetch=options.fetch||globalThis.fetch.bind(globalThis);this.busy=false;this.status='local';this.message='محفوظ على هذا الجهاز';this.timer=null;this.conflict=null;}
    config(){return JSON.parse(this.storage.getItem(CONFIG)||'null');}
    connected(){return !!this.storage.getItem(CONFIG);}
    current(c){const now=this.config();return !!now&&now.id===c.id&&now.key===c.key&&now.endpoint===c.endpoint;}
    read(){return this.o.validate(JSON.parse(this.storage.getItem(KEY)||'null'));}
    validateRemote(raw){return this.o.validate({...raw,settings:{...raw.settings,pin:null,theme:'system'},updatedAt:new Date().toISOString()});}
    notify(status,message){this.status=status;this.message=message;this.o.onStatus?.(status,message);}
    persist(c){this.storage.setItem(CONFIG,JSON.stringify(c));}
    backup(local,remote){this.storage.setItem(RECOVERY,JSON.stringify({at:new Date().toISOString(),local,remote}));}
    async request(c,method='GET',body){const k=await keys(c.key);const response=await this.fetch(c.endpoint+'/snapshot',{method,headers:{Authorization:'Bearer '+k.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});if(response.status===409)return {conflict:true};if(!response.ok)throw Error(response.status===401?'رمز الربط غير معتمد في خدمة المزامنة.':response.status===413?'النسخة أكبر من سعة المزامنة.':'تعذّر الاتصال بخدمة المزامنة. بياناتك محفوظة هنا.');const data=await response.json();if(!Number.isSafeInteger(data.revision)||data.revision<0)throw Error('رد خدمة المزامنة غير صالح.');return data;}
    async pair(code){if(this.connected())throw Error('افصل هذا الجهاز أولاً قبل تغيير المحفظة.');const c={...parsePairing(code),id:crypto.randomUUID(),revision:0,base:null};const remote=await this.request(c);if(remote.box){const k=await keys(c.key);this.validateRemote(await decrypt(remote.box,k.aes));}if(this.connected())throw Error('تم ربط المحفظة من نافذة أخرى.');this.backup(this.read(),null);this.persist(c);await this.tick();}
    disconnect(){if(this.busy)throw Error('انتظر انتهاء المزامنة ثم جرّب الفصل.');this.storage.removeItem(CONFIG);this.conflict=null;this.notify('local','تم فصل الجهاز؛ بياناته باقية هنا');}
    code(){const c=this.config();return c?pairing(c.endpoint,c.key):'';}
    recover(c){if(!c||!c.journal)return c;const raw=this.storage.getItem(KEY);if(raw===c.journal.after){c.base=c.journal.base;c.revision=c.journal.revision;}delete c.journal;this.persist(c);return c;}
    apply(c,remote,revision,expected){if(!this.o.active()||!this.connected()||this.storage.getItem(KEY)!==expected)return false;const local=expected?JSON.parse(expected):this.read(),next=this.validateRemote(remote);next.settings.pin=local.settings.pin;next.settings.theme=local.settings.theme;const after=JSON.stringify(next);c.journal={after,base:remote,revision};this.persist(c);this.storage.setItem(KEY,after);c.base=remote;c.revision=revision;delete c.journal;this.persist(c);this.o.onApply?.();return true;}
    async exchange(choice){let c=this.recover(this.config());if(!c)return;const expected=this.storage.getItem(KEY),local=project(this.read());const response=await this.request(c);if(!this.current(c)||!this.o.active())return;
      let remote=null;if(response.box){const k=await keys(c.key);remote=project(this.validateRemote(await decrypt(response.box,k.aes)));}
      if(response.revision<c.revision)throw Error('الخدمة أعادت نسخة أقدم. توقفت المزامنة لحماية البيانات.');
      if(!this.current(c)||this.storage.getItem(KEY)!==expected)return;
      if(remote&&same(local,remote)){c.base=remote;c.revision=response.revision;this.persist(c);this.conflict=null;this.notify('synced','كل الأجهزة على نفس النسخة');return;}
      const localChanged=c.base===null||!same(local,c.base),remoteChanged=remote!==null&&(c.base===null||!same(remote,c.base));
      if(localChanged&&remoteChanged&&!choice){this.conflict={local,remote,revision:response.revision};this.notify('conflict','نسختان مختلفتان — راجع قبل المزامنة');return;}
      if(choice){if(!this.conflict||this.conflict.revision!==response.revision||!same(this.conflict.local,local)||!same(this.conflict.remote,remote)){this.conflict=null;throw Error('تغيّرت إحدى النسختين. راجع التعارض من جديد.');}this.backup(this.read(),remote);}
      if(remote&&((!localChanged&&remoteChanged)||choice==='remote')){if(this.apply(c,remote,response.revision,expected)){this.conflict=null;this.notify('synced','وصلت أحدث التغييرات إلى هذا الجهاز');}return;}
      if(response.revision!==c.revision&&!remote)throw Error('بيانات الخدمة مفقودة. توقفت المزامنة لحماية النسخة المحلية.');
      if(localChanged||choice==='local'||!remote){const k=await keys(c.key),box=await encrypt(local,k.aes);if(!this.current(c)||!this.o.active()||this.storage.getItem(KEY)!==expected)return;const result=await this.request(c,'PUT',{revision:response.revision,box});if(!this.current(c))return;if(result.conflict){this.notify('pending','وصل تعديل من جهاز آخر؛ جارٍ المراجعة');return;}if(result.revision!==response.revision+1)throw Error('تعذّر تأكيد حفظ النسخة.');c.base=local;c.revision=result.revision;this.persist(c);this.conflict=null;this.notify('synced','تم حفظ التغييرات في المحفظة المشفّرة');}
    }
    async tick(choice){if(this.busy||!this.connected()||!this.o.active())return;if(!globalThis.navigator?.locks){this.notify('error','هذا المتصفح لا يدعم المزامنة الآمنة بين النوافذ. استخدم Safari أو Chrome حديثاً.');return;}this.busy=true;try{await navigator.locks.request('jeebtak-sync',{ifAvailable:true},async lock=>{if(!lock)return;this.notify('syncing','جارٍ مزامنة المحفظة…');await this.exchange(choice);});}catch(e){this.notify('error',e.message||'تعذّرت المزامنة. بياناتك محفوظة على الجهاز.');}finally{this.busy=false;}}
    start(){if(this.timer)return;this.timer=setInterval(()=>this.tick(),5000);this.tick();}
    stop(){clearInterval(this.timer);this.timer=null;}
  }
  const api={Engine,project,same,keys,encrypt,decrypt,pairing,parsePairing,encode,KEY,CONFIG,RECOVERY};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.JeebtakSync=api;
})(globalThis);
