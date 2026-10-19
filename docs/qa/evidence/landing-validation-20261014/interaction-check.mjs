import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const OUT='C:/Users/Rune W. Monrad/CascadeProjects/PunkGrid/.scratch/landing-validation-20261014/after-copy-fix';
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9334',`--user-data-dir=${mkdtempSync(join(tmpdir(),'pgqa-'))}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let ws; const report={steps:[],errors:[],networkFailures:[]}; let phase='startup';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try {
  await new Promise((resolve,reject)=>{let buf='';const timer=setTimeout(()=>reject(Error('Chrome start timeout')),15000);chrome.stderr.on('data',b=>{buf+=b;if(buf.includes('DevTools listening on')){clearTimeout(timer);resolve();}});chrome.on('error',reject);});
  const pages=await (await fetch('http://127.0.0.1:9334/json')).json();
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.onopen=r);
  let id=0; const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown'){report.errors.push({phase,event:m.params});}else if(m.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(m.params.type)){report.errors.push({phase,event:m.params});}else if(m.method==='Network.loadingFailed'){report.networkFailures.push({phase,event:m.params});}else if(m.method==='Network.responseReceived'&&m.params.response.status>=400){report.networkFailures.push({phase,url:m.params.response.url,status:m.params.response.status});}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const navigate=async()=>{await call('Page.navigate',{url:'http://127.0.0.1:4310/'});for(let n=0;n<150;n++){if(await evaluate("!!document.querySelector('#heroHud')"))return;await delay(100);}throw Error('Landing DOM not ready');};
  const shot=async name=>{const {data}=await call('Page.captureScreenshot',{format:'png'});writeFileSync(join(OUT,name+'.png'),Buffer.from(data,'base64'));};
  const state=async()=>evaluate(`(() => {const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};return {time:performance.now(),width:innerWidth,height:innerHeight,scrollY,url:location.href,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,loaded:document.body.classList.contains('loaded'),preloader:{display:getComputedStyle(document.querySelector('.preloader')).display,opacity:getComputedStyle(document.querySelector('.preloader')).opacity,visibility:getComputedStyle(document.querySelector('.preloader')).visibility},title:[...document.querySelectorAll('#heroTitle .line>span')].map(e=>({text:e.textContent,opacity:getComputedStyle(e).opacity,transform:getComputedStyle(e).transform,rect:rect(e)})),tagline:getComputedStyle(document.querySelector('.hero-tagline')).opacity,buttons:getComputedStyle(document.querySelector('.hero-buttons')).opacity,canvas:getComputedStyle(document.querySelector('canvas')).display,navLinks:getComputedStyle(document.querySelector('.nav-links')).display,overflow:document.documentElement.scrollWidth-innerWidth,brokenImages:[...document.images].filter(i=>i.complete&&!i.naturalWidth).map(i=>i.src),hud:document.querySelector('#hudScene').textContent};})()`);
  const log=async name=>{const s=await state();report.steps.push({name,...s});console.log(name,JSON.stringify(s));return s;};
  const click=async selector=>{const p=await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing element');const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:document.elementFromPoint(x,y)?.closest('a')===e,text:e.innerText,href:e.getAttribute('href')};})()`);if(!p.hit)throw Error('Link not pointer reachable '+selector+' '+JSON.stringify(p));await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await call('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});return p;};
  const nav=async(selector,target,name)=>{phase=name;const link=await click(selector);await delay(2300);await log(name);const detail=await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(target)}),h=e.querySelector('h1,h2'),r=h.getBoundingClientRect();return {targetTop:e.getBoundingClientRect().top,heading:h.innerText,headingTop:r.top,headingBottom:r.bottom,headingOpacity:getComputedStyle(h).opacity,contentOpacity:getComputedStyle(h.closest('[data-content]')||h).opacity,navBottom:document.querySelector('nav').getBoundingClientRect().bottom};})()`);Object.assign(report.steps.at(-1),{link,target:detail});console.log('target',JSON.stringify(detail));await shot(name);};
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  phase='intro-normal';await navigate();
  for(const [wait,name] of [[120,'intro-early'],[360,'intro-mid'],[650,'intro-late'],[1500,'intro-settled']]){await delay(wait);await log(name);await shot(name);}
  for(const [id,label] of [['engine','engine'],['worlds','worlds'],['characters','cast'],['choices','choices'],['gallery','art'],['cta','download']]){await nav(`nav a[href="#${id}"]`,`#${id}`,`nav-${label}`);}
  await nav('nav .nav-logo','#hero','nav-home');
  await nav('.hero-buttons a[href="#manifesto"]','#manifesto','hero-enter-grid');
  await nav('nav .nav-logo','#hero','hero-return-home');
  await nav('.hero-buttons a[href="#cta"]','#cta','hero-release-status');
  phase='release-status';
  const release=await evaluate(`(() => ({text:document.querySelector('#cta').innerText,stores:[...document.querySelectorAll('.store-btn')].map(e=>({tag:e.tagName,text:e.innerText,tabIndex:e.tabIndex,role:e.getAttribute('role'),cursor:getComputedStyle(e).cursor})),emptyLinks:document.querySelectorAll('a[href="#"]').length,brokenAnchors:[...document.querySelectorAll('a[href^="#"]')].filter(e=>!document.getElementById(e.getAttribute('href').slice(1))).map(e=>e.outerHTML),schemas:[...document.querySelectorAll('script[type="application/ld+json"]')].map(e=>JSON.parse(e.textContent)),status:document.querySelector('#hudTick').textContent}))()`);
  report.steps.push({name:'release-status',...release});
  assert.ok(release.text.includes('Store downloads are not available yet.'));
  assert.equal(release.stores.length,2);
  for(const store of release.stores){assert.equal(store.tag,'DIV');assert.equal(store.tabIndex,-1);assert.equal(store.role,null);assert.notEqual(store.cursor,'pointer');assert.ok(store.text.toLowerCase().includes('not yet available'));}
  assert.equal(release.emptyLinks,0);assert.deepEqual(release.brokenAnchors,[]);assert.equal(release.status,'IN DEVELOPMENT');
  assert.ok(release.schemas.every(s=>!s.aggregateRating&&!s.offers&&s['@type']!=='FAQPage'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  phase='mobile';await navigate();await delay(2400);
  await nav('.hero-buttons a[href="#manifesto"]','#manifesto','mobile-enter-grid');
  await nav('nav .nav-logo','#hero','mobile-home');
  await nav('nav .nav-cta','#cta','mobile-download');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  phase='reduced-mobile';await navigate();await delay(150);await log('reduced-mobile-early');await shot('reduced-mobile-early');await delay(900);await log('reduced-mobile-settled');await shot('reduced-mobile-settled');
  await nav('.hero-buttons a[href="#manifesto"]','#manifesto','reduced-mobile-enter');
  const worlds=async width=>{
    phase='reduced-worlds-'+width;
    assert.equal(await evaluate("document.querySelectorAll('.world-card').length"),4);
    for(let i=0;i<4;i++){
      await evaluate(`document.querySelectorAll('.world-card')[${i}].scrollIntoView({block:'center',behavior:'instant'})`);
      await delay(150);
      const data=await evaluate(`(() => {const e=document.querySelectorAll('.world-card')[${i}],r=e.getBoundingClientRect();return {text:e.querySelector('h3').innerText,x:r.x,y:r.y,right:r.right,bottom:r.bottom,navBottom:document.querySelector('nav').getBoundingClientRect().bottom,width:innerWidth,height:innerHeight,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),transform:getComputedStyle(document.querySelector('#worldsTrack')).transform,overflow:document.documentElement.scrollWidth-innerWidth}})()`);
      report.steps.push({name:phase+'-'+i,...data});
      assert.ok(data.x>=0&&data.right<=data.width&&data.y>=data.navBottom&&data.bottom<=data.height&&data.hit,JSON.stringify(data));
      assert.equal(data.transform,'none');assert.equal(data.overflow,0);
      await shot(phase+'-'+i);
    }
  };
  await worlds(390);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  phase='reduced-desktop';await navigate();await delay(1100);await log('reduced-desktop');await shot('reduced-desktop');await nav('nav a[href="#engine"]','#engine','reduced-desktop-engine');
  await worlds(1440);
  for(const s of report.steps.filter(s=>s.name.startsWith('intro-')&&s.loaded))assert.equal(s.preloader.display,'none',s.name);
  const early=report.steps.find(s=>s.name==='reduced-mobile-early');assert.equal(early.tagline,'1');assert.equal(early.buttons,'1');
  assert.equal(await evaluate("document.querySelectorAll('.preloader img').length"),0);
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.networkFailures,[]);
  console.log('PASS intro overlap, reduced-motion content, eight world-card checks and navigation');
} catch(e) {report.harnessError=e.stack;process.exitCode=1;console.error(e);} finally {writeFileSync(join(OUT,'interaction-results.json'),JSON.stringify(report,null,2));ws?.close();chrome.kill();}
