// Synthetic Chromium policy probes; no actual DSH, profiles, or external requests.
const assert=require('node:assert/strict');const {chromium}=require(process.env.PLAYWRIGHT_PATH);
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND']});try{
 const ctx=await browser.newContext(),requests=[];await ctx.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
 const page=await ctx.newPage();await page.setContent('<!doctype html><title>synthetic</title>');
 const outcome=await page.evaluate(async()=>{const url=URL.createObjectURL(new Blob([`onmessage=async()=>{try{await fetch('https://r7-worker.invalid/synthetic');postMessage('unexpected')}catch{postMessage('blocked')}}`],{type:'text/javascript'}));const worker=new Worker(url);try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),3000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data)};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message))};worker.postMessage('go')})}finally{worker.terminate();URL.revokeObjectURL(url)}});
 assert.equal(outcome,'blocked');assert.deepEqual(requests,['https://r7-worker.invalid/synthetic']);
 const deny=await ctx.newPage();await deny.setContent(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; worker-src 'none'">`);
 const result=await deny.evaluate(async()=>{const url=URL.createObjectURL(new Blob(['postMessage("unexpected")'],{type:'text/javascript'}));try{const w=new Worker(url);try{return await new Promise(resolve=>{const timer=setTimeout(()=>resolve('timeout'),3000);w.onmessage=()=>{clearTimeout(timer);resolve('message')};w.onerror=()=>{clearTimeout(timer);resolve('error')}})}finally{w.terminate()}}catch{return 'throw'}finally{URL.revokeObjectURL(url)}});
 assert.ok(result==='error'||result==='throw',`unexpected worker-src result ${result}`);assert.equal(requests.length,1);
 console.log('Synthetic dedicated Worker fetch was intercepted and aborted; worker-src none blocked blob Worker:',result);await ctx.close();
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
