// Dependency-free browser smoke tests via Chromium DevTools Protocol.
// All browser profiles, downloads and screenshots stay in this workspace.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=fs.realpathSync(path.join(__dirname,'..'));
const qa=path.join(root,'.browser-qa');
fs.mkdirSync(qa,{recursive:true});
if(fs.realpathSync(qa)!==qa)throw Error('QA directory must not be a link');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser,ws;
async function main(){
  console.log('Starting browser verification');
  browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
    '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-component-update','--disable-extensions',
    '--disable-crash-reporter','--remote-debugging-port=9238',
    '--user-data-dir='+path.join(qa,'chrome-profile'),'--disk-cache-dir='+path.join(qa,'chrome-cache'),
    'about:blank'
  ],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe']});
  let diagnostics='';browser.stderr.on('data',data=>{diagnostics=(diagnostics+data.toString()).slice(-2000);});
  let spawnError;browser.on('error',e=>spawnError=e);
  let targets;
  for(let i=0;i<40;i++){if(spawnError)throw spawnError;try{targets=await fetch('http://127.0.0.1:9238/json').then(r=>r.json());if(targets.some(t=>t.type==='page'))break;}catch{}await sleep(250);}
  assert.ok(targets,'Browser did not start: '+diagnostics);
  console.log('Browser target:',targets.find(t=>t.type==='page').url);
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('WebSocket connection timed out')),10000);ws.onopen=()=>{clearTimeout(timer);res();};ws.onerror=rej;});
  let serial=0;const pending=new Map(),errors=[];
  ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(JSON.stringify(data.error))):p.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const waitFor=async expression=>{for(let i=0;i<60;i++){if(await evaluate(expression))return;await sleep(100);}throw Error('Timed out: '+expression);};
  const input=async(id,value)=>{await evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(150);};
  const click=async id=>{await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);await sleep(150);};
  await send('Page.enable');await send('Runtime.enable');
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:qa});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8000'});
  await waitFor(`document.getElementById('qMagnitude')?.textContent !== '—' && !!document.getElementById('qMagnitude')`);
  await click('reset');
  const baseline=await evaluate(`({q:document.getElementById('qMagnitude').textContent,points:document.querySelectorAll('#momentumMap circle').length,overflow:document.documentElement.scrollWidth>innerWidth})`);
  assert.equal(baseline.points,2+Number(await evaluate(`document.getElementById('pointCount').textContent`)));assert.equal(baseline.overflow,false);assert.ok(+baseline.q>.9);
  assert.equal(await evaluate(`document.getElementById('edge')===null`),true);
  await input('dimension',3);await evaluate(`document.getElementById('allZones').click()`);await sleep(150);
  assert.ok(+await evaluate(`document.getElementById('momentumMap').getAttribute('data-zone-count')`)>1);
  const initialCamera=await evaluate(`document.getElementById('momentumMap').getAttribute('data-camera')`);
  const mapBox=await evaluate(`(()=>{const r=document.getElementById('momentumMap').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:mapBox.x,y:mapBox.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:mapBox.x+70,y:mapBox.y+35,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:mapBox.x+70,y:mapBox.y+35,button:'left',clickCount:1});
  assert.notEqual(await evaluate(`document.getElementById('momentumMap').getAttribute('data-camera')`),initialCamera);
  await evaluate(`document.getElementById('units').value='rlu';document.getElementById('units').dispatchEvent(new Event('input'))`);await sleep(150);
  assert.equal(await evaluate(`document.getElementById('scalarReadouts').hidden`),true);
  assert.equal(await evaluate(`document.getElementById('vectorLabel').textContent`),'(H, K, L)');
  await click('reset');
  await input('incidence',75);await input('loss',0);
  assert.equal(await evaluate(`document.getElementById('qParallel').textContent`),'0.0000');
  await input('incidence',180);assert.equal(await evaluate(`document.getElementById('error').hidden`),false);assert.equal(await evaluate(`document.getElementById('scanDownload').disabled`),true);assert.equal(await evaluate(`document.querySelectorAll('#momentumMap circle').length`),0);
  await input('incidence',25);assert.equal(await evaluate(`document.getElementById('error').hidden`),true);
  await evaluate(`document.getElementById('lattice').value='hexagonal';document.getElementById('lattice').dispatchEvent(new Event('input'))`);await sleep(150);
  await evaluate(`document.getElementById('units').value='rlu';document.getElementById('units').dispatchEvent(new Event('input'));document.querySelector('[data-view="xy"]').click()`);await sleep(150);
  assert.equal(await evaluate(`document.getElementById('b').disabled`),true);
  assert.ok(await evaluate(`document.getElementById('momentumMap').textContent.includes('r.l.u.')`));
  await input('edgeSearch','Cu');assert.equal(await evaluate(`document.querySelectorAll('#edgeTable tr').length`),3);
  await evaluate(`document.querySelector('button[data-element="O"]').click();document.getElementById('edgeSearch').value='';document.getElementById('edgeSearch').dispatchEvent(new Event('input'));document.querySelector('#edgeTable button').click()`);await sleep(150);
  assert.equal(await evaluate(`document.getElementById('energy').value`),'531');
  await input('energy',530.5);await send('Page.reload');await waitFor(`document.getElementById('energy')?.value==='530.5'`);
  await click('reset');await click('scanDownload');await click('spectrumDownload');await click('heatmapDownload');await click('saveSettings');await click('mapDownload');
  for(let i=0;i<40&&!fs.existsSync(path.join(qa,'rixs-momentum-map.svg'));i++)await sleep(150);
  for(const name of ['rixs-scan.csv','rixs-spectrum.csv','rixs-intensity-map.csv','rixs-settings.json','rixs-momentum-map.svg'])assert.ok(fs.existsSync(path.join(qa,name)),name);
  const scan=fs.readFileSync(path.join(qa,'rixs-scan.csv'),'utf8').trim().split('\n').filter(l=>!l.startsWith('#'));assert.equal(scan.length,1+Number(await evaluate(`document.getElementById('pointCount').textContent`)));assert.equal(scan[0].split(',').length,18);assert.equal(scan[1].split(',').length,18);
  const settings=JSON.parse(fs.readFileSync(path.join(qa,'rixs-settings.json'),'utf8'));assert.equal(settings.settings.energy,932.7);
  await input('energy',1000);
  const dom=await send('DOM.getDocument'),inputNode=await send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#loadSettings'});
  await send('DOM.setFileInputFiles',{nodeId:inputNode.nodeId,files:[path.join(qa,'rixs-settings.json')]});await waitFor(`document.getElementById('energy').value==='932.7'`);
  await evaluate(`document.getElementById('message').hidden=true`);
  const desktop=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(qa,'desktop.png'),Buffer.from(desktop.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(150);
  assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false);
  const mobile=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(qa,'mobile.png'),Buffer.from(mobile.data,'base64'));
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log('PASS: live geometry, invalid input clearing, hexagonal/rlu, edge filtering, persistence, 5 downloads, JSON import, desktop/mobile layout; no runtime exceptions.');
  await send('Browser.close');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(ws)ws.close();if(browser)browser.kill();});
