import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(readFileSync(join(root,'extension/manifest.json'),'utf8'));
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
if(manifest.version!==pkg.version)throw Error('Package and extension versions must match');
const referenced=[manifest.background.service_worker,manifest.options_page,...manifest.content_scripts.flatMap(x=>x.js)];
for(const path of referenced)if(!existsSync(join(root,'extension',path)))throw Error('Missing extension file: '+path);
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);}
const checks=[...walk(join(root,'extension')).filter(p=>p.endsWith('.js')).map(p=>['--check',p]),
 ...walk(join(root,'tests')).filter(p=>p.endsWith('.test.js')).sort().map(p=>[p]),[join(root,'scripts/audit-public.mjs')]];
for(const args of checks){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
console.log(`Passed ${checks.length} public-source checks`);
