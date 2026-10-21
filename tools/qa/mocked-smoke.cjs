// From the repair handoff (verification/ui-smoke.cjs), kept here unchanged apart from this note: it runs the
// redesigned UI against a MOCKED backend to cover two profiles on one task path, a failed and retried
// save, and a focus read racing newer typing. Usage: CHROMIUM_EXECUTABLE_PATH=... node tools/qa/mocked-smoke.cjs <repo>
// Optional browser smoke test: real UI, MOCKED backend; no emulator verification.
// Install Playwright outside the product, for example:
//   npm install --prefix /tmp/signal-noise-qa --no-save playwright
//   /tmp/signal-noise-qa/node_modules/.bin/playwright install chromium
// Then set NODE_PATH=/tmp/signal-noise-qa/node_modules and run:
//   node verification/ui-smoke.cjs /absolute/path/to/Signal-Noise-main
// Build app/dist first. CHROMIUM_EXECUTABLE_PATH optionally selects an existing browser.
// The harness writes only fixture state in memory and makes no real backend calls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.argv[2] || path.join(__dirname,'../Signal-Noise-main'));
const E=require(root+'/app/ui/src/story/engine.js');
const files=fs.readdirSync(root+'/content/story').filter(f=>f.endsWith('.story')).sort().map(name=>({name,text:fs.readFileSync(root+'/content/story/'+name,'utf8')}));
const story=E.parseStory(files),eng=new E.Engine(story); eng.start();
for(let i=0;i<150 && eng.state.wait?.type!=='task';i++){if(eng.state.wait?.type==='menu')eng.choose(eng.options()[0].i);else eng.advance();}
assert.equal(eng.state.wait?.id,'1.1');
const saves=new Map(['A','B'].map(profile=>[profile,JSON.stringify({format:'signal-noise-save',version:2,profile,story:story.hash,save:eng.serialize(),bench:{},settings:{size:'m'}})]));
const p='tasks/1.1/main.c',code=new Map(['A','B'].map(n=>[n,new Map([[p,'// '+n+' firmware\nint main(void) { return 0; }\n']]) ]));
const info={id:'1.1',title:'Follow the Button',pins:[{pin:0,name:'PA0',label:'BUTTON',dir:'in',note:'active high, external pull-down'},{pin:16,name:'PB0',label:'LED',dir:'out',note:'active high'}],startup:true,library:true,extra:null,rules:[],hidden_seeds:4};
let rejectWrites=false,readGate=null,readStarted=null;
const writes=[],errors=[];
async function api(cmd,a){
 if(cmd==='init')return {version:'0.1.0',profiles:[{name:'A'},{name:'B'}],levels:[info],toolchain:{ok:false,error:'UI test fixture — native compiler not running'},cflags:[]};
 if(cmd==='profile_list')return [...code.keys()].map(name=>({name}));
 if(cmd==='save_read')return saves.get(a.profile)||null;
 if(cmd==='save_write'){saves.set(a.profile,a.data);return true;}
 if(cmd==='task_prepare'||cmd==='ws_list')return {files:[...code.get(a.profile).keys()].map(p=>({path:p,name:path.basename(p),kind:'task',readonly:false}))};
 if(cmd==='ws_read'){const text=code.get(a.profile).get(a.path);if(readGate){readStarted();await readGate;readGate=null;}return {text,readonly:false};}
 if(cmd==='ws_write'){if(rejectWrites)throw new Error('fixture disk full');code.get(a.profile).set(a.path,a.text);writes.push({profile:a.profile,text:a.text});return true;}
 throw new Error('Unimplemented UI fixture command '+cmd);
}
(async()=>{
 const browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.CHROMIUM_EXECUTABLE_PATH} : {}), args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--use-gl=disabled','--disable-software-rasterizer']});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark'});
 const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://signalnoise.test/**',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname.startsWith('/api/')){try{const data=await api(url.pathname.slice(5),route.request().postDataJSON());await route.fulfill({json:{ok:true,data}});}catch(e){await route.fulfill({json:{ok:false,error:e.message}});}return;}
 const name=url.pathname==='/'?'index.html':url.pathname.slice(1),f=path.join(root,'app/dist',name);
 const mime=name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.woff2')?'font/woff2':'text/plain';
 if(fs.existsSync(f))await route.fulfill({body:fs.readFileSync(f),contentType:mime});else await route.fulfill({status:404,body:'Not found'});
 });
 await page.goto('http://signalnoise.test/');
 await page.getByRole('button',{name:'Continue',exact:true}).first().waitFor();
 await page.getByRole('button',{name:'Continue',exact:true}).first().click();
 await page.getByRole('button',{name:'Open the workbench',exact:true}).first().click();
 await page.locator('.cm-content[contenteditable=true]').waitFor();
 const edit=page.locator('.cm-content[contenteditable=true]');
 await edit.click();await page.keyboard.press('Control+End');await page.keyboard.type('// preserved A');
 rejectWrites=true;await page.locator('.etab .x').click();
 await page.waitForFunction(()=>document.querySelector('.bb-status')?.textContent.includes('Could not save'));
 assert.equal(await page.locator('.etab').count(),1);
 assert.match(await edit.textContent(),/preserved A/);
 rejectWrites=false;await page.locator('.etab .x').click();
 await page.waitForFunction(()=>!document.querySelector('.etab'));
 assert.match(code.get('A').get(p),/preserved A/);
 await page.locator('.fl li').first().click();
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 await page.locator('#profile-select').selectOption('B');
 await page.waitForFunction(()=>window.StoryBridge.profile()==='B');
 await page.getByRole('button',{name:'Continue',exact:true}).first().click();
 await page.getByRole('button',{name:'Open the workbench',exact:true}).first().click();
 await edit.waitFor();assert.match(await edit.textContent(),/B firmware/);assert.doesNotMatch(await edit.textContent(),/preserved A/);
 let release;readGate=new Promise(r=>release=r);const started=new Promise(r=>readStarted=r);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await started;
 await edit.click();await page.keyboard.press('Control+End');await page.keyboard.type('// newer B edit');
 release();await page.waitForTimeout(200);
 assert.match(await edit.textContent(),/newer B edit/);
 await page.waitForTimeout(650);
 assert.match(code.get('B').get(p),/newer B edit/);
 await page.getByRole('tab',{name:'Datasheet',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search the datasheet'}).fill('PCLKCR');
 await page.waitForFunction(()=>document.querySelectorAll('.ds-hit').length>0);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log(JSON.stringify({browser:browser.version(),backend:'mocked JSON API; no native/emulator verification',checks:['title/story/workbench render','failed close retains CodeMirror buffer','retry saves and closes','profile switch reloads B source','focus read preserves newer typing','datasheet search'],pageErrors:errors,writes:writes.map(w=>w.profile)},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
