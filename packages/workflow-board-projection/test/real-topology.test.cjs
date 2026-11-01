'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractTopology,layoutTopology } = require('../../workflow-topology/index.cjs');
const { projectWorkflow } = require('../index.cjs');
let parse;
try { ({parse} = require('acorn')); } catch {}

test('real topology output and projection retain byte-identical layout', {skip:!parse}, () => {
  const script = `phase('Build'); await parallel([() => agent('A'), () => agent('B')]);`;
  const skeleton = extractTopology(script,{phases:[{title:'Build'}]},{parse});
  assert.equal(skeleton.complete,true);
  const layout = layoutTopology(skeleton);
  const make = (events) => projectWorkflow({runId:'r',topology:skeleton,layout,sourceBinding:{runId:'r',status:'verified',toolCallId:'call'},events});
  const before = make([]);
  const after = make([{type:'tool-workflow/agent-start',seq:0,time:100,data:{runId:'r',seq:1,label:'B',phase:'Build',childId:'b'}}]);
  assert.equal(JSON.stringify(before.layout),JSON.stringify(after.layout));
  assert.equal(after.statusByNode[skeleton.nodes[1].id].childId,'b');
});
