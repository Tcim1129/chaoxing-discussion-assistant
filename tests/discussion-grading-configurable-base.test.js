const assert=require('node:assert/strict'),A=require('../extension/analysis/engine.js'),Q=require('../extension/analysis/grading.js');
const c=Q.config({base:70});assert.equal(c.base,70);assert.equal(Object.values(c.weights).reduce((a,b)=>a+b,0),30);assert.throws(()=>Q.config({base:39}),/基础分/);assert.throws(()=>Q.config({base:101}),/基础分/);
const d=A.createDataset({complete:true,comments:[{id:'s',classId:'c',authorId:'s',role:'student',content:'财政投入可以分担教育成本。'}]}),doc=Q.material(d,{classId:'c'},{mode:'class'},c),p=doc.people[0],row=doc.rows[0],ref=[{id:row.code,quote:row.content}];
const raw={people:[{person:p.code,covered:[row.code],base:40,reason:'模型错误降低基础分',evidence:ref,axes:Object.fromEntries(Q.AXES.map(a=>[a.id,{level:3,reason:'有相关解释',evidence:ref}])),issues:[]}]};
const validated=Q.validate(raw,doc,c).people[0];assert.equal(validated.base,70);assert.equal(Q.score(validated,c).bonus,15);assert.equal(Q.score(validated,c).final,85);
validated.axes.reflection.level=null;assert.equal(Q.score(validated,c).bonus,15);assert.equal(Q.score(validated,c).final,85,'缺项折算使用30分质量上限');
const low=Q.config({base:40});for(const a of Q.AXES)validated.axes[a.id].level=1;validated.issues=[{id:'x',kind:'severe',automatic:true,evidence:validated.evidence}];const floor=Q.score(validated,low);assert.equal(floor.base,40);assert.equal(floor.final,40);assert.equal(floor.deduction,0);
const scaled=Q.rescaleBase(Q.config(),80);assert.equal(scaled.base,80);assert.equal(Object.values(scaled.weights).reduce((a,b)=>a+b,0),20);assert.equal(Q.currentConfig(c).base,70);
const full=Q.config({base:100});assert.equal(Object.values(full.weights).reduce((a,b)=>a+b,0),0);assert.equal(Q.score(validated,full).final,70,'100分基础减30分行为扣分');
assert.ok(Q.prompt(doc,c).messages[0].content.includes('70'));assert.ok(!Q.prompt(doc,c).messages[0].content.includes('基础分固定为60'));
console.log('ok - teacher base, quality cap, proportional weights, null axes, deduction floor and model base override');

(async()=>{const e=(await Q.run({doc,cfg:c,modelKey:'fixture',request:async()=>({content:JSON.stringify(raw)})})).entry;Q.validateArchive({config:c,entries:[e]});assert.ok(Q.csvCompact([e]).includes('"70"'));})();
