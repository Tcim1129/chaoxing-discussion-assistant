import {readdirSync,readFileSync} from 'node:fs';
import {join,relative,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ignored=new Set(['.git','node_modules','dist','output']);
const textExtensions=/\.(?:js|mjs|json|md|html|css|yml|yaml|py|svg)$/;
const rules=[
 ['credential',/(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/],
 ['local-user-path',/[A-Za-z]:[\\/]Users[\\/][^\s"'<>]+/],
 ['authenticated-course-link',/[?&](?:enc|openc|cpi|courseid|clazzid|classid)=[A-Za-z0-9_-]{8,}/i],
 ['email',/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
];
const findings=[];
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
 if(ignored.has(e.name))continue;
 const full=join(dir,e.name),name=relative(root,full);
 if(e.isDirectory()){walk(full);continue;}
 if(/(?:^|[\\/])(?:\.env(?:\.|$)|Cookies$|Login Data$|History$)|\.(?:har|log|jsonl|csv|xlsx)$/i.test(name))findings.push([name,0,'private-file-type']);
 if(!textExtensions.test(name))continue;
 const lines=readFileSync(full,'utf8').split(/\r?\n/);
 for(let i=0;i<lines.length;i++)for(const [kind,pattern] of rules)if(pattern.test(lines[i]))findings.push([name,i+1,kind]);
}}
walk(root);
if(findings.length){for(const [name,line,kind]of findings)console.error(`${name}:${line}: ${kind}`);process.exit(1);}
console.log('Public source audit passed: no detected credentials, user paths, private data files or authenticated course links');
