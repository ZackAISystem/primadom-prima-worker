'use strict';
// Browser-based exact PrimaSearchBridgeV1 transport exercise; no synthetic results.
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const repo=process.cwd();
const localPlaywright=path.join(repo,'qa/full-pipeline/.tools/node_modules/playwright-core');
if(!fs.existsSync(localPlaywright)){
 console.error('BLOCKED: playwright-core missing; npm install --prefix qa/full-pipeline/.tools --no-save --no-package-lock playwright-core');process.exit(2);
}
const {chromium}=require(localPlaywright);
const website=process.argv[2] || 'http://127.0.0.1:1329/en/';
const raw=fs.readFileSync(0,'utf8');
let request;try{request=JSON.parse(raw)}catch(e){console.error('BLOCKED invalid tool request');process.exit(2)}
if(request.version!=='PrimaToolRequestV1'||request.tool!=='prima_search'||request.language!=='en'||request.entity_type!=='project'|| !['search_projects','search_project_matches'].includes(request.action)){
 console.error('BLOCKED invalid PrimaToolRequestV1 contract');process.exit(2);
}
const port=4173;
const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store'});res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>PRIMA QA Search Bridge</title><body>QA origin only</body></html>')});
const log=[];let browser;
(async()=>{
 await new Promise((res,rej)=>server.once('error',rej).listen(port,'127.0.0.1',res));
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-first-run']});
 const page=await browser.newPage({viewport:{width:1200,height:800}});
 page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')log.push({type:'browser_console',message:m.text().slice(0,250)})});
 page.on('pageerror',e=>log.push({type:'page_error',message:String(e.message).slice(0,250)}));
 await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:20000});
 const start=Date.now();
 const result=await page.evaluate(async({url,request,requestId})=>{
   const frame=document.createElement('iframe');frame.style.display='none';frame.src=url;document.body.appendChild(frame);
   await new Promise((resolve,reject)=>{let done=false;const timeout=setTimeout(()=>{if(!done){done=true;reject(new Error('SEARCH_IFRAME_LOAD_TIMEOUT'))}},25000);frame.onload=()=>{if(!done){done=true;clearTimeout(timeout);resolve()}};frame.onerror=()=>{if(!done){done=true;clearTimeout(timeout);reject(new Error('SEARCH_IFRAME_LOAD_ERROR'))}}});
   const targetOrigin=new URL(url).origin;
   return await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{window.removeEventListener('message',onMessage);reject(new Error('SEARCH_BRIDGE_RESPONSE_TIMEOUT'))},30000);
     function onMessage(event){
       if(event.origin!==targetOrigin||event.source!==frame.contentWindow) return;
       const payload=event.data;
       if(!payload||payload.version!=='PrimaSearchBridgeV1'||payload.request_id!==requestId)return;
       clearTimeout(timer);window.removeEventListener('message',onMessage);
       if(payload.type==='prima:search_error')reject(new Error('SEARCH_BRIDGE_ERROR:'+String(payload.error||'unknown').slice(0,200)));
       else if(payload.type==='prima:search_result')resolve({type:payload.type,search_context:payload.search_context});
       else reject(new Error('SEARCH_BRIDGE_UNEXPECTED_TYPE'));
     }
     window.addEventListener('message',onMessage);
     frame.contentWindow.postMessage({version:'PrimaSearchBridgeV1',type:'prima:search_request',request_id:requestId,request},targetOrigin);
   });
 },{url:website,request,requestId:randomUUID()});
 const context=result.search_context;
 if(!context||context.version!=='SearchContextV1'||context.language!=='en'||context.entity_type!=='project'||!['results','empty'].includes(context.state)||!Array.isArray(context.results))throw new Error('SEARCH_CONTEXT_CONTRACT_INVALID');
 process.stdout.write(JSON.stringify({status:'PASS',transport:'PrimaSearchBridgeV1',source_url:website,elapsed_ms:Date.now()-start,search_context:context,browser_issues:log})+'\n');
})().catch(e=>{process.stdout.write(JSON.stringify({status:'FAIL',reason:String(e.message||e).slice(0,500),source_url:website,browser_issues:log})+'\n');process.exitCode=1}).finally(async()=>{if(browser)await browser.close().catch(()=>{});server.close()});
