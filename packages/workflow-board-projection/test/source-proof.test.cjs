'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectWorkflow } = require('../index.cjs');
const args = () => ({
  runId:'r',topology:{version:1,complete:true,nodes:[{id:'a',kind:'agent',label:'A',phase:null,occurrence:'single'}]},
  layout:{version:1,nodes:[],groups:[]},
  events:[{type:'tool-workflow/agent-start',data:{runId:'r',seq:1,label:'A',childId:'c'}}],
});

test('no binding without an explicit externally validated source association', () => {
  const board = projectWorkflow(args());
  assert.deepEqual(Object.keys(board.statusByNode),[]);
  assert.equal(board.unmatched[0].reason,'source-unverified');
});

test('source proof must carry the exact run id and valid kind, not name or nearest event', () => {
  for (const sourceBinding of [true,{runId:'other',status:'verified'},{runId:'r',name:'r'},{runId:'r',status:'guessed'},{runId:'r',status:'verified'}]) {
    const board = projectWorkflow({...args(),sourceBinding});
    assert.deepEqual(Object.keys(board.statusByNode),[]);
    assert.equal(board.unmatched[0].reason,'source-unverified');
  }
});

test('a same-run host assertion can permit otherwise unique binding', () => {
  const board = projectWorkflow({...args(),sourceBinding:{runId:'r',status:'verified',toolCallId:'call-1'}});
  assert.equal(board.statusByNode.a.childId,'c');
});
