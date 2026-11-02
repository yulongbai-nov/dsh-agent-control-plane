// Illustrative protocol model only; not wired to DSH Host or transport.
const {test}=require('node:test');const assert=require('node:assert/strict');
class Model {
  constructor(){this.generation=0;this.epoch='';this.cut=-1;this.rows=new Map();this.buffer=[];this.ready=false}
  reset(generation,epoch){this.generation=generation;this.epoch=epoch;this.cut=-1;this.rows.clear();this.buffer=[];this.ready=false}
  delta(frame){if(frame.generation!==this.generation||frame.epoch!==this.epoch)return;if(!this.ready){this.buffer.push(frame);return}if(frame.seq<=this.cut)return;if(frame.seq!==this.cut+1){this.rows.clear();this.ready=false;this.buffer=[];return}this.cut=frame.seq;frame.remove?this.rows.delete(frame.id):this.rows.set(frame.id,frame.label)}
  snapshot(frame){if(frame.generation!==this.generation||frame.epoch!==this.epoch)return;this.rows=new Map(frame.rows);this.cut=frame.cut;this.ready=true;const buffered=this.buffer;this.buffer=[];for(const event of buffered.sort((a,b)=>a.seq-b.seq))this.delta(event)}
}
test('snapshot cut and contiguous buffered events preserve a later removal',()=>{const m=new Model();m.reset(1,'a');m.delta({generation:1,epoch:'a',seq:2,id:'x',remove:true});m.snapshot({generation:1,epoch:'a',cut:1,rows:[['x','synthetic']]});assert.equal(m.ready,true);assert.equal(m.rows.has('x'),false)})
test('revocation discards prior-generation snapshot and event',()=>{const m=new Model();m.reset(1,'a');m.delta({generation:1,epoch:'a',seq:1,id:'x',label:'synthetic'});m.reset(2,'a');m.snapshot({generation:1,epoch:'a',cut:1,rows:[['x','synthetic']]});m.delta({generation:1,epoch:'a',seq:2,id:'x',label:'synthetic'});assert.equal(m.rows.size,0);assert.equal(m.ready,false)})
test('gap fails closed and duplicate does not reopen a removed row',()=>{const m=new Model();m.reset(1,'a');m.snapshot({generation:1,epoch:'a',cut:1,rows:[]});m.delta({generation:1,epoch:'a',seq:1,id:'x',label:'synthetic'});assert.equal(m.rows.size,0);m.delta({generation:1,epoch:'a',seq:3,id:'x',label:'synthetic'});assert.equal(m.ready,false);assert.equal(m.rows.size,0)})
