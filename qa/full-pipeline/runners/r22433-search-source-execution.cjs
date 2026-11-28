#!/usr/bin/env node
/* Run exact original Search V3 pure parser functions from the existing Hugo partial,
 * not an independently reimplemented search engine. No browser/Hugo/network. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const file=path.resolve(root,'../client-primadom-new/layouts/partials/home/search_engine.html');
const dep=path.resolve(root,'qa/full-pipeline/.tools/node_modules/typescript');
function output(v){process.stdout.write(JSON.stringify(v,null,2)+'\n');}
function quit(status,message){output({status,reason:message,source:file,full_search_execution:'NOT_VERIFIED'});process.exit(status==='BLOCKED'?2:1)}
if(!fs.existsSync(file))quit('BLOCKED','CURRENT_SEARCH_V3_SOURCE_NOT_FOUND');
if(!fs.existsSync(dep))quit('BLOCKED','TYPESCRIPT_AST_DEPENDENCY_NOT_FOUND; existing QA .tools dependency required');
const ts=require(dep),html=fs.readFileSync(file,'utf8');
const sha=crypto.createHash('sha256').update(html).digest('hex');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(a=>a[1]);
if(!scripts.length)quit('BLOCKED','SEARCH_SCRIPT_NOT_FOUND');
const asts=scripts.map((code,i)=>({code,i,ast:ts.createSourceFile('search-'+i+'.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)}));
const found=new Map();
for(const {code,ast} of asts){
 function walk(node){
  if((ts.isFunctionDeclaration(node)||ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name)){
   const name=node.name.text;
   if(['normalText','detectTypes','detectBedrooms','BED_WORDS'].includes(name))found.set(name,node.getText(ast));
  }
  ts.forEachChild(node,walk);
 }
 walk(ast);
}
let status='PASS',tests=[];
function actual(name){if(!found.has(name))quit('BLOCKED','EXACT_SOURCE_DECLARATION_NOT_FOUND:'+name);return found.get(name)}
try{
 const context=vm.createContext({});
 const script=[actual('normalText'),actual('BED_WORDS').replace(/^([A-Za-z]+)\s+/,'var '),actual('detectTypes'),actual('detectBedrooms'),
  'globalThis.__result={types:detectTypes("Show me 2-bedroom apartments in Dubai Hills under AED 5 million"),bedrooms:detectBedrooms("Show me 2-bedroom apartments in Dubai Hills under AED 5 million"),villa:detectTypes("Find villas in Dubai")};'].join('\n');
 vm.runInContext(script,context,{timeout:4000,filename:'ORIGINAL_SEARCH_V3_PURE_FUNCTIONS.js'});
 const r=context.__result;
 function check(name,pass,actual){tests.push({name,status:pass?'PASS':'FAIL',actual});if(!pass)status='FAIL'}
 check('source_search_apartments',Array.from(r.types).includes('apartment'),Array.from(r.types));
 check('source_search_bedrooms',Array.from(r.bedrooms).includes('2'),Array.from(r.bedrooms));
 check('source_search_villas',Array.from(r.villa).includes('villa'),Array.from(r.villa));
}catch(e){quit('BLOCKED','SOURCE_FUNCTION_DEPENDENCY_OR_EXECUTION:'+String(e.message).slice(0,250))}
const result={contract:'R22433_SEARCH_SOURCE_EXECUTION',status,source:'client-primadom-new/layouts/partials/home/search_engine.html',source_sha256:sha,
 execution:'EXACT_ORIGINAL_SOURCE_PURE_FUNCTIONS_IN_NODE_VM',tested_functions:['normalText','detectTypes','detectBedrooms'],tests,
 full_search_execution:'NOT_VERIFIED_DOM_AND_CATALOG_SEARCH_NOT_EXECUTED',search_context_provenance:'NOT_VERIFIED_NO_BROWSER_BRIDGE_RESULT',
 no_duplicate_engine:true,no_hugo:true,no_browser:true,no_supabase:true};
const target=path.resolve(root,'qa/full-pipeline/reports/r22433-search-source-execution.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n');output(result);process.exit(status==='PASS'?0:1);
