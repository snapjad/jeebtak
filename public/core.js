/* جيبتك — pure local accounting and calendar rules. No network calls. */
(function (root) {
  'use strict';
  const currencies = ['JOD', 'USD', 'IQD'];
  const categoryNames = {subscriptions:'اشتراكات',bills:'فواتير',debts:'التزامات',general:'مصاريف عامة',salary:'راتب',other:'دخل إضافي'};
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const month = (d=today()) => d.slice(0,7);
  const date = s => new Date(`${s}T12:00:00`);
  const validDate = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(date(s)) && `${date(s).getFullYear()}-${String(date(s).getMonth()+1).padStart(2,'0')}-${String(date(s).getDate()).padStart(2,'0')}`===s;
  const dayDiff = (a,b=today()) => Math.round((date(a)-date(b))/86400000);
  const addDays = (s,n) => {const d=date(s);d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  function addMonths(s,n,anchor=Number(s.slice(8,10))) {const d=date(s);const y=d.getFullYear(),m=d.getMonth()+n;const first=new Date(y,m,1,12);const last=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();return `${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,'0')}-${String(Math.min(anchor,last)).padStart(2,'0')}`;}
  const dueInMonth=(m,day)=>addMonths(`${m}-01`,0,day);
  const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const round=n=>Math.round((n+Number.EPSILON)*1000000)/1000000;
  function empty(){return {version:1,updatedAt:new Date().toISOString(),settings:{base:'JOD',rates:{JOD:1,USD:0.709,IQD:0.000541},ratesConfirmed:false,theme:'system',reminderDays:3,notifications:true,openingAmount:0,openingCurrency:'JOD',openingDate:today(),pin:null},salary:{amount:0,currency:'JOD',payDay:25,deductions:[]},subscriptions:[],bills:[],debts:[],transactions:[]};}
  function convert(s,amount,currency,to=s.settings.base){return round(Number(amount)*s.settings.rates[currency]/s.settings.rates[to]);}
  const hasPaid=(s,type,id,period)=>s.transactions.some(t=>t.sourceType===type&&t.sourceId===id&&t.period===period);
  function netSalary(s,m=month()){return Math.max(0,s.salary.amount-s.salary.deductions.filter(d=>d.recurring||d.month===m).reduce((a,d)=>a+d.amount,0));}
  function occurrences(s,until=addDays(today(),14)){
    const out=[];
    for(const x of s.subscriptions.filter(x=>x.status==='active')){let due=x.nextDate;for(let n=0;due<=until&&n<1200;n++,due=addMonths(due,x.cycle,x.anchorDay)){if(!hasPaid(s,'subscriptions',x.id,due))out.push({type:'subscriptions',id:x.id,name:x.name,amount:x.amount,currency:x.currency,date:due,period:due,reminder:x.reminder});}}
    for(const type of ['bills','debts']) for(const x of s[type].filter(x=>!x.archived&&(type!=='debts'||x.remaining>0))){const startMonth=month(x.startDate);let m=x.settledThrough&&x.settledThrough>startMonth?month(addMonths(`${x.settledThrough}-01`,1)):startMonth;let pending=0;for(let n=0;m<=month(until)&&n<1200;n++,m=month(addMonths(`${m}-01`,1))){const due=dueInMonth(m,x.dueDay);if(due<x.startDate||due>until||hasPaid(s,type,x.id,m)||(x.settledThrough&&m<=x.settledThrough))continue;const amount=type==='debts'?Math.min(x.installment,x.remaining-pending):x.amount;if(amount<=0)break;pending+=amount;out.push({type,id:x.id,name:x.name,amount,currency:x.currency,date:due,period:m,reminder:x.reminder});}}
    return out.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
  }
  function monthlyFixed(s){return {subscriptions:s.subscriptions.filter(x=>x.status==='active').reduce((a,x)=>a+convert(s,x.amount/x.cycle,x.currency),0),bills:s.bills.filter(x=>!x.archived).reduce((a,x)=>a+convert(s,x.amount,x.currency),0),debts:s.debts.filter(x=>!x.archived&&x.remaining>0).reduce((a,x)=>a+convert(s,Math.min(x.installment,x.remaining),x.currency),0)};}
  function summary(s,m=month()){
    const actual=s.transactions.filter(t=>month(t.date)===m&&t.date<=today());
    const income=actual.filter(t=>t.kind==='income').reduce((a,t)=>a+convert(s,t.amount,t.currency),0);
    const expense=actual.filter(t=>t.kind==='expense').reduce((a,t)=>a+convert(s,t.amount,t.currency),0);
    const balance=convert(s,s.settings.openingAmount,s.settings.openingCurrency)+s.transactions.filter(t=>t.date>=s.settings.openingDate&&t.date<=today()).reduce((a,t)=>a+convert(s,t.amount,t.currency)*(t.kind==='income'?1:-1),0);
    const end=addDays(addMonths(`${m}-01`,1),-1),due=occurrences(s,end);const reserved=due.reduce((a,x)=>a+convert(s,x.amount,x.currency),0);
    const fixed=monthlyFixed(s),totalFixed=Object.values(fixed).reduce((a,n)=>a+n,0),net=convert(s,netSalary(s,m),s.salary.currency);
    return {income,expense,balance,reserved,available:balance-reserved,fixed,totalFixed,net,ratio:net?totalFixed/net:0};
  }
  function record(s,t){if(t.sourceType&&hasPaid(s,t.sourceType,t.sourceId,t.period))throw new Error('هذه الدفعة مسجّلة بالفعل.');if(!Number.isFinite(t.amount)||t.amount<=0)throw new Error('أدخل مبلغاً أكبر من صفر.');if(!validDate(t.date)||t.date>today())throw new Error('تاريخ الدفع يجب أن يكون اليوم أو قبله.');if(!currencies.includes(t.currency))throw new Error('العملة غير مدعومة.');const entry={id:uid(),...t};s.transactions.unshift(entry);return entry;}
  function pay(s,o,amount=o.amount,paidDate=today()){
    const x=s[o.type]?.find(x=>x.id===o.id);if(!x)throw new Error('هذا البند لم يعد موجوداً.');
    if(o.type==='debts'&&amount>x.remaining)throw new Error('الدفعة أكبر من المبلغ المتبقي.');
    if(o.type==='subscriptions'&&x.nextDate!==o.period)throw new Error('سدّد أقدم تجديد أولاً.');
    const t=record(s,{kind:'expense',name:x.name,amount,currency:x.currency,date:paidDate,category:o.type,sourceType:o.type,sourceId:o.id,period:o.period,note:'دفعة مسجّلة من الاستحقاقات'});
    if(o.type==='subscriptions'){x.lastPaid=paidDate;x.nextDate=addMonths(x.nextDate,x.cycle,x.anchorDay);}
    if(o.type==='debts')x.remaining=round(Math.max(0,x.remaining-amount));
    return t;
  }
  function receiveSalary(s,m=month(),paidDate=today()){const amount=netSalary(s,m);return record(s,{kind:'income',name:'الراتب الصافي',amount,currency:s.salary.currency,date:paidDate,category:'salary',sourceType:'salary',sourceId:'salary',period:m,note:`راتب ${m} بعد الاستقطاعات`});}
  function cancelSubscription(s,id,when=today()){const x=s.subscriptions.find(x=>x.id===id);if(!x)return;x.status='cancelled';x.cancelledDate=when;x.cancelledNextDate=x.nextDate;x.cancelledAmount=x.amount;x.cancelledCurrency=x.currency;x.cancelledCycle=x.cycle;x.cancelledAnchorDay=x.anchorDay;}
  function savings(s,x,until=today()){if(x.status!=='cancelled')return 0;let d=x.cancelledNextDate||x.nextDate,n=0;for(let i=0;d<=until&&i<1200;i++,d=addMonths(d,x.cancelledCycle||x.cycle,x.cancelledAnchorDay||x.anchorDay)){if(d>=(x.cancelledDate||until))n++;}return convert(s,n*(x.cancelledAmount??x.amount),x.cancelledCurrency||x.currency);}
  function report(s,m){const buckets={subscriptions:0,bills:0,debts:0,general:0};for(const t of s.transactions.filter(t=>t.kind==='expense'&&month(t.date)===m&&t.date<=today()))buckets[t.category in buckets?t.category:'general']+=convert(s,t.amount,t.currency);return buckets;}
  function validate(raw){
    const fail=()=>{throw new Error('النسخة غير صالحة أو من إصدار غير مدعوم. لم تتغيّر بياناتك.');};
    if(!raw||raw.version!==1||!raw.settings||!raw.salary)fail();
    const s=JSON.parse(JSON.stringify(raw));const str=v=>typeof v==='string'&&v.length<=1000;const num=v=>Number.isFinite(v)&&v>=0&&v<=1e12;const positive=v=>num(v)&&v>0;const curr=v=>currencies.includes(v);const day=v=>Number.isInteger(v)&&v>=1&&v<=31;const rem=v=>Number.isInteger(v)&&v>=0&&v<=90;
    if(!curr(s.settings.base)||!curr(s.settings.openingCurrency)||!Number.isFinite(s.settings.openingAmount)||Math.abs(s.settings.openingAmount)>1e12||!validDate(s.settings.openingDate)||!['system','light','dark'].includes(s.settings.theme)||!rem(s.settings.reminderDays)||typeof s.settings.notifications!=='boolean'||!s.settings.rates||!currencies.every(c=>positive(s.settings.rates[c]))||s.settings.rates.JOD!==1)fail();
    // Backups never carry a PIN lock into a new device.
    s.settings.pin=null;
    if(!num(s.salary.amount)||!curr(s.salary.currency)||!day(s.salary.payDay)||!Array.isArray(s.salary.deductions)||s.salary.deductions.length>1000)fail();
    for(const d of s.salary.deductions)if(!str(d.id)||!str(d.name)||!num(d.amount)||typeof d.recurring!=='boolean'||!validDate(`${d.month}-01`))fail();
    const ids=new Set();
    for(const type of ['subscriptions','bills','debts','transactions']){if(!Array.isArray(s[type])||s[type].length>25000)fail();for(const x of s[type]){if(!str(x.id)||!x.id||ids.has(x.id)||!str(x.name)||!curr(x.currency))fail();ids.add(x.id);if(type==='subscriptions'){if(!positive(x.amount)||![1,3,6,12].includes(x.cycle)||!validDate(x.nextDate)||!day(x.anchorDay)||!['active','paused','cancelled'].includes(x.status)||!rem(x.reminder)||!str(x.category)||!validDate(x.lastUsed)|| (x.lastPaid&&!validDate(x.lastPaid)) || (x.cancelledDate&&!validDate(x.cancelledDate)) || (x.cancelledNextDate&&!validDate(x.cancelledNextDate)) || (x.cancelledAmount!==undefined&&!num(x.cancelledAmount)) || (x.cancelledCurrency!==undefined&&!curr(x.cancelledCurrency)) || (x.cancelledCycle!==undefined&&![1,3,6,12].includes(x.cancelledCycle)) || (x.cancelledAnchorDay!==undefined&&!day(x.cancelledAnchorDay)))fail();}else if(type==='transactions'){if(!positive(x.amount)||!validDate(x.date)||!['income','expense'].includes(x.kind)||!(x.category in categoryNames)||!str(x.note||'')||x.sourceType&&(!['salary','subscriptions','bills','debts'].includes(x.sourceType)||!str(x.sourceId)||!str(x.period)))fail();}else {if(!validDate(x.startDate)||!day(x.dueDay)||!rem(x.reminder)||typeof x.archived!=='boolean')fail();if(x.settledThrough!==undefined&&!(str(x.settledThrough)&&/^\d{4}-\d{2}$/.test(x.settledThrough)&&validDate(`${x.settledThrough}-01`)))fail();if(type==='bills'&&!positive(x.amount))fail();if(type==='debts'&&(!positive(x.total)||!num(x.remaining)||x.remaining>x.total||!positive(x.installment)))fail();}}}
    if(s.settings.ratesDate&&!validDate(s.settings.ratesDate))fail();
    if(s.updatedAt&&(!str(s.updatedAt)||isNaN(new Date(s.updatedAt))))fail();
    const keys=new Set();for(const t of s.transactions.filter(t=>t.sourceType)){if(t.sourceType==='subscriptions'?!validDate(t.period):!validDate(`${t.period}-01`))fail();if(t.sourceType==='salary'?(t.sourceId!=='salary'||t.kind!=='income'):(!s[t.sourceType].some(x=>x.id===t.sourceId)||t.kind!=='expense'))fail();const key=[t.sourceType,t.sourceId,t.period].join(':');if(keys.has(key))fail();keys.add(key);}return s;
  }
  function demo(){const s=empty(),now=today(),m=month();s.settings.openingAmount=420;s.settings.openingDate=`${m}-01`;s.salary={amount:1450,currency:'JOD',payDay:1,deductions:[{id:uid(),name:'الضمان الاجتماعي',amount:108.75,recurring:true,month:m},{id:uid(),name:'تأمين صحي',amount:35,recurring:true,month:m}]};
    const makeSub=(name,amount,currency,offset,category,cycle=1)=>({id:uid(),name,amount,currency,nextDate:addDays(now,offset),anchorDay:Number(addDays(now,offset).slice(8)),cycle,status:'active',lastPaid:addMonths(addDays(now,offset),-cycle),lastUsed:addDays(now,name==='اشتراك النادي'?-42:-4),reminder:3,category});
    s.subscriptions=[makeSub('Netflix',9.99,'USD',2,'ترفيه'),makeSub('Spotify',5.99,'USD',5,'ترفيه'),makeSub('iCloud+',2.99,'USD',9,'تخزين سحابي'),makeSub('اشتراك النادي',35,'JOD',12,'رياضة')];
    const makeBill=(name,amount,offset)=>{const due=addDays(now,offset);return {id:uid(),name,amount,currency:'JOD',dueDay:Number(due.slice(8)),startDate:due,reminder:3,archived:false};};s.bills=[makeBill('فاتورة الكهرباء',38,1),makeBill('الإنترنت المنزلي',25,6),makeBill('إيجار البيت',280,13)];s.debts=[{id:uid(),name:'قسط اللابتوب',currency:'JOD',total:900,remaining:450,installment:75,dueDay:Number(addDays(now,10).slice(8)),startDate:addDays(now,10),reminder:3,archived:false}];
    receiveSalary(s,m,`${m}-01`);
    const general=[['مشتريات البيت',62.5],['قهوة ولقمة',7.25],['بنزين',30]];general.forEach(([name,amount],i)=>record(s,{name,amount,currency:'JOD',kind:'expense',category:'general',note:'بيانات تجريبية',date:addDays(now,-Math.min(Number(now.slice(8))-1,i))}));
    for(let i=1;i<=5;i++){const mm=month(addMonths(now,-i));for(const [cat,v] of Object.entries({subscriptions:52+i*2,bills:280+18*(i%3),debts:75,general:180+24*i}))record(s,{name:categoryNames[cat],amount:v,currency:'JOD',kind:'expense',category:cat,note:'بيانات تجريبية للمقارنة',date:`${mm}-15`});}return s;}
  const api={currencies,categoryNames,today,month,date,validDate,dayDiff,addDays,addMonths,dueInMonth,uid,round,empty,convert,hasPaid,netSalary,occurrences,monthlyFixed,summary,record,pay,receiveSalary,cancelSubscription,savings,report,validate,demo};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;root.Jeebtak=api;
})(typeof window!=='undefined'?window:globalThis);
