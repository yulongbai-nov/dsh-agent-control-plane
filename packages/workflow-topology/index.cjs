'use strict';

// Static analysis only: neither this module nor its tests evaluate workflow source.
const HOOKS = new Set(['agent', 'parallel', 'pipeline', 'phase', 'log']);
const DEFAULT_LIMITS = Object.freeze({ maxScriptLength: 1_000_000, maxAstNodes: 100_000, maxNodes: 512, maxItems: 128, maxDepth: 80, maxExpansion: 4096 });

function children(node) {
  const out = [];
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === 'string') out.push(item);
    } else if (value && typeof value.type === 'string') out.push(value);
  }
  return out;
}
function visit(root, fn, limit = Infinity) {
  const stack = root ? [root] : [];
  let count = 0;
  while (stack.length) {
    const node = stack.pop();
    if (++count > limit) return false;
    fn(node);
    const list = children(node);
    for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
  }
  return true;
}
function namesInPattern(pattern, fn) {
  if (!pattern) return;
  if (pattern.type === 'Identifier') fn(pattern.name);
  else if (pattern.type === 'RestElement') namesInPattern(pattern.argument, fn);
  else if (pattern.type === 'AssignmentPattern') namesInPattern(pattern.left, fn);
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((x) => namesInPattern(x, fn));
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => namesInPattern(p.type === 'RestElement' ? p.argument : p.value, fn));
}
function hookCall(node, name, shadowed) {
  return node && node.type === 'CallExpression' && !node.optional && node.callee.type === 'Identifier' &&
    node.callee.name === name && !shadowed.has(name);
}
function containsHook(node, shadowed) {
  const stack = node ? [node] : [];
  while (stack.length) {
    const current = stack.pop();
    if (current.type === 'Identifier' && HOOKS.has(current.name) && !shadowed.has(current.name)) return true;
    const list = current.type === 'Property' && !current.computed ? [current.value] : children(current);
    for (const child of list) stack.push(child);
  }
  return false;
}
function containsPhase(node, shadowed) {
  let found = false;
  visit(node, (n) => { if (hookCall(n, 'phase', shadowed)) found = true; });
  return found;
}
function hasDynamicEffect(node) {
  let found = false;
  visit(node, (n) => { if (['CallExpression', 'NewExpression', 'ImportExpression', 'TaggedTemplateExpression', 'MemberExpression', 'SpreadElement', 'BinaryExpression', 'UpdateExpression', 'AssignmentExpression'].includes(n.type)) found = true; });
  return found;
}
function mayChangePhase(node, shadowed) {
  let uncertain = false;
  visit(node, (n) => {
    if ((n.type === 'VariableDeclarator' && n.id.type !== 'Identifier') ||
        ['NewExpression', 'ImportExpression', 'TaggedTemplateExpression', 'MemberExpression', 'SpreadElement', 'BinaryExpression', 'UpdateExpression', 'AssignmentExpression'].includes(n.type)) uncertain = true;
    if (n.type === 'CallExpression' && (!['agent', 'parallel', 'pipeline', 'log'].some((name) => hookCall(n, name, shadowed)) ||
        (hookCall(n, 'parallel', shadowed) && n.arguments.length > 1))) uncertain = true;
  });
  return uncertain;
}
function literal(node, depth = 0) {
  if (!node || depth > 40) return { known: false };
  if (node.type === 'Literal' && node.regex === undefined && typeof node.value !== 'bigint' &&
      (node.value === null || typeof node.value === 'string' || typeof node.value === 'boolean' ||
       (typeof node.value === 'number' && Number.isFinite(node.value)))) return { known: true, value: node.value };
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
    return { known: true, value: node.quasis[0].value.cooked };
  if (node.type === 'UnaryExpression' && (node.operator === '-' || node.operator === '+') && node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
    const value = node.operator === '-' ? -node.argument.value : +node.argument.value;
    return Number.isFinite(value) ? { known: true, value } : { known: false };
  }
  if (node.type === 'ArrayExpression') {
    const array = [];
    for (const el of node.elements) {
      const item = literal(el, depth + 1);
      if (!item.known) return { known: false };
      array.push(item.value);
    }
    return { known: true, value: array };
  }
  if (node.type === 'ObjectExpression') {
    const object = {};
    for (const p of node.properties) {
      if (p.type !== 'Property' || p.kind !== 'init' || p.computed || p.method || p.shorthand) return { known: false };
      const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' && typeof p.key.value === 'string' ? p.key.value : null;
      const item = literal(p.value, depth + 1);
      if (key === null || !item.known) return { known: false };
      Object.defineProperty(object, key, { value: item.value, enumerable: true, configurable: true, writable: true });
    }
    return { known: true, value: object };
  }
  return { known: false };
}
function staticOptionProperties(node) {
  if (!node) return {};
  if (node.type !== 'ObjectExpression') return null;
  const properties = Object.create(null);
  for (const property of node.properties) {
    if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.method || property.shorthand) return null;
    const key = property.key.type === 'Identifier' ? property.key.name : property.key.type === 'Literal' && typeof property.key.value === 'string' ? property.key.value : null;
    if (key === null) return null;
    Object.defineProperty(properties, key, { value: literal(property.value), enumerable: true, configurable: true, writable: true });
  }
  return properties;
}
function defaultLabel(prompt) {
  const first = prompt.split('\n', 1)[0];
  return first.length <= 48 ? first : `${first.slice(0, 47)}…`;
}
function offset(node) { return node && Number.isSafeInteger(node.start) ? node.start : 0; }
function safeLimit(value, fallback, max) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

/**
 * Parse a DSH workflow script body without evaluating it. `options.parse` is a
 * trusted Acorn-compatible parse function. If omitted, a normally-resolved
 * `acorn` peer is used. `meta` must be the workflow's plain JSON meta object.
 */
function extractTopology(script, meta = {}, options = {}) {
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([k, v]) => [k, safeLimit(options.limits?.[k], v, v)]));
  const graph = { version: 1, nodes: [], edges: [], groups: [], phases: [], warnings: [], complete: true };
  const warn = (code, node, message) => { graph.complete = false; graph.warnings.push({ code, offset: offset(node), message }); };
  const empty = () => graph;
  if (typeof script !== 'string') { warn('INVALID_SCRIPT', null, 'script must be a string'); return empty(); }
  if (script.length > limits.maxScriptLength) { warn('SCRIPT_LIMIT', null, 'script exceeds the analysis length limit'); return empty(); }
  let parse = options.parse;
  if (parse === undefined) {
    try { parse = require('acorn').parse; }
    catch { warn('PARSER_UNAVAILABLE', null, 'provide an Acorn-compatible parse function or install the acorn peer'); return empty(); }
  }
  if (typeof parse !== 'function') { warn('PARSER_UNAVAILABLE', null, 'parse must be a function'); return empty(); }
  const prefix = '(async () => {\n';
  let ast;
  try {
    const wrapped = parse(`${prefix}${script}\n})()`, { ecmaVersion: 'latest', sourceType: 'script' });
    const body = wrapped?.body?.[0]?.expression?.callee?.body;
    if (body?.type !== 'BlockStatement' || !Array.isArray(body.body)) throw new Error('parser did not return the workflow async body');
    ast = { body: body.body };
  } catch (error) {
    const start = Number.isSafeInteger(error.pos) ? Math.max(0, Math.min(script.length, error.pos - prefix.length)) : 0;
    warn('PARSE_ERROR', { start }, 'workflow script did not parse as an async body');
    return empty();
  }
  const shadowed = new Set();
  const isKnownCall = (node) => node.callee?.type === 'Identifier' && HOOKS.has(node.callee.name) && !node.optional;
  let unknownCall = false;
  const checkBinding = (name) => { if (HOOKS.has(name)) shadowed.add(name); };
  const checkGlobalMutation = (left) => {
    if (!left || left.type !== 'MemberExpression') return;
    const name = !left.computed && left.property.type === 'Identifier' ? left.property.name :
      left.computed && left.property.type === 'Literal' && typeof left.property.value === 'string' ? left.property.value : null;
    if (name && HOOKS.has(name)) checkBinding(name);
    else if (left.computed) for (const hook of HOOKS) shadowed.add(hook);
  };
  const underLimit = visit({ type: 'WorkflowBody', body: ast.body }, (node) => {
    if (typeof node.start === 'number') node.start -= prefix.length;
    if (typeof node.end === 'number') node.end -= prefix.length;
    if (node.type === 'VariableDeclarator') namesInPattern(node.id, checkBinding);
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      if (node.id) namesInPattern(node.id, checkBinding);
      for (const param of node.params) namesInPattern(param, checkBinding);
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') namesInPattern(node.id, checkBinding);
    if (node.type === 'CatchClause') namesInPattern(node.param, checkBinding);
    if (node.type === 'AssignmentExpression') { namesInPattern(node.left, checkBinding); checkGlobalMutation(node.left); }
    if (node.type === 'UpdateExpression') { namesInPattern(node.argument, checkBinding); checkGlobalMutation(node.argument); }
    if (node.type === 'UnaryExpression' && node.operator === 'delete') checkGlobalMutation(node.argument);
    if (node.type === 'CallExpression' && !isKnownCall(node)) unknownCall = true;
  }, limits.maxAstNodes);
  if (!underLimit) { warn('AST_LIMIT', null, 'script AST exceeds the analysis limit'); return empty(); }
  if (unknownCall && script.includes('globalThis')) for (const name of HOOKS) shadowed.add(name);
  for (const name of [...shadowed].sort()) warn('SHADOWED_HOOK', null, `${name} may be declared, assigned or mutated in the script; it is not recognized anywhere`);
  if (Array.isArray(meta?.phases)) {
    const seen = new Set();
    for (const phase of meta.phases) {
      if (typeof phase?.title !== 'string') { warn('INVALID_META_PHASE', null, 'meta.phases must contain objects with string titles'); continue; }
      if (seen.has(phase.title)) { warn('DUPLICATE_META_PHASE', null, 'duplicate phase title is ambiguous'); continue; }
      seen.add(phase.title);
      graph.phases.push(phase.title);
    }
  }
  const state = { phase: null, phaseKnown: true, truncated: false, expansion: 0 };
  const spendExpansion = (node) => {
    if (++state.expansion <= limits.maxExpansion) return true;
    warn('EXPANSION_LIMIT', node, 'static expansion work limit reached; topology is incomplete');
    state.truncated = true;
    return false;
  };
  const nodeById = new Map();
  const edgeSet = new Set();
  const connect = (from, to) => {
    for (const a of from) for (const b of to) {
      if (a === b || nodeById.get(a)?.occurrence === 'template' || nodeById.get(b)?.occurrence === 'template') continue;
      const key = `${a}\u0000${b}`;
      if (!edgeSet.has(key)) { edgeSet.add(key); graph.edges.push({ from: a, to: b }); }
    }
  };
  const group = (kind, call, ctx, fields) => {
    const g = { id: `${kind}@${offset(call)}${ctx.path}`, kind, members: [], ...fields };
    graph.groups.push(g);
    for (const parent of ctx.groups) parent.members.push(g.id);
    return g;
  };
  const addAgent = (call, ctx) => {
    if (graph.nodes.length >= limits.maxNodes) {
      if (!state.truncated) warn('NODE_LIMIT', call, 'node limit reached; topology is incomplete');
      state.truncated = true;
      return null;
    }
    const prompt = literal(call.arguments[0]);
    if (call.arguments.some((arg) => hasDynamicEffect(arg))) {
      warn('DYNAMIC_EFFECT', call, 'agent arguments may change control flow or the current phase');
      state.phaseKnown = false;
    }
    if (call.arguments[0] && containsHook(call.arguments[0], shadowed)) {
      warn('UNSUPPORTED_HOOK_CONTEXT', call.arguments[0], 'hook inside an agent argument is not analyzed');
      if (containsPhase(call.arguments[0], shadowed)) state.phaseKnown = false;
    }
    const optArg = call.arguments[1];
    const props = staticOptionProperties(optArg);
    const optsKnown = props !== null;
    const property = (key) => optsKnown ? props[key] : undefined;
    if (!optsKnown || Object.values(props).some((value) => !value.known)) warn('DYNAMIC_AGENT_OPTIONS', call, 'some agent options cannot be statically resolved');
    if (optArg && containsHook(optArg, shadowed)) {
      warn('UNSUPPORTED_HOOK_CONTEXT', optArg, 'hook inside agent options is not analyzed');
      if (containsPhase(optArg, shadowed)) state.phaseKnown = false;
    }
    let label = null;
    const labelProperty = property('label');
    if (labelProperty?.known && typeof labelProperty.value === 'string') label = labelProperty.value;
    else if (optsKnown && labelProperty === undefined && prompt.known && typeof prompt.value === 'string') label = defaultLabel(prompt.value);
    if (label === null) warn('DYNAMIC_AGENT_LABEL', call, 'agent label cannot be determined without evaluating the script');
    const phaseProperty = property('phase');
    const nodePhase = phaseProperty?.known && typeof phaseProperty.value === 'string' ? phaseProperty.value : phaseProperty !== undefined || !optsKnown || !state.phaseKnown || ctx.phaseUncertain ? null : state.phase;
    const provider = property('provider');
    const model = property('model');
    const schema = property('schema');
    const node = {
      id: `agent@${offset(call)}${ctx.path}`, kind: 'agent', label,
      phase: nodePhase,
      provider: provider?.known && typeof provider.value === 'string' ? provider.value : null,
      model: model?.known && typeof model.value === 'string' ? model.value : null,
      schema: schema?.known && schema.value && typeof schema.value === 'object' && !Array.isArray(schema.value) ? schema.value : null,
      occurrence: ctx.template ? 'template' : 'single',
      source: { start: offset(call), end: call.end }, statementIndex: ctx.statementIndex,
      ...(ctx.itemIndex === undefined ? {} : { itemIndex: ctx.itemIndex }),
      ...(ctx.stageIndex === undefined ? {} : { stageIndex: ctx.stageIndex }),
    };
    graph.nodes.push(node);
    nodeById.set(node.id, node);
    for (const parent of ctx.groups) parent.members.push(node.id);
    return node.id;
  };
  const merge = (fragments) => ({ entries: fragments.flatMap((f) => f.entries), exits: fragments.flatMap((f) => f.exits), opaque: fragments.some((f) => f.opaque), passthrough: fragments.some((f) => !f.opaque && (f.passthrough || f.exits.length === 0)) });
  const blank = (opaque = false) => ({ entries: [], exits: [], opaque });
  const childContext = (ctx, path, extra = {}) => ({ ...ctx, ...extra, path: `${ctx.path}${path}`, depth: ctx.depth + 1 });
  let analyzeExpression, analyzeSequence;
  const analyzeCallback = (callback, ctx) => {
    if (!spendExpansion(callback)) return blank(true);
    if (!callback || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') || callback.generator) {
      warn('DYNAMIC_CALLBACK', callback, 'callback is not an inline function');
      if (callback && containsHook(callback, shadowed)) warn('UNSUPPORTED_HOOK_CONTEXT', callback, 'hook inside dynamic callback is not analyzed');
      return blank(true);
    }
    if (ctx.depth > limits.maxDepth) { warn('DEPTH_LIMIT', callback, 'analysis nesting limit reached'); return blank(true); }
    if (callback.params.some((param) => param.type !== 'Identifier')) {
      warn('DYNAMIC_CALLBACK', callback, 'default or destructured parameters are not modeled');
      state.phaseKnown = false;
      return blank(true);
    }
    if (callback.body.type === 'BlockStatement') return analyzeSequence(callback.body.body, ctx, true);
    return analyzeExpression(callback.body, ctx, true);
  };
  const analyzeParallel = (call, ctx) => {
    const array = call.arguments[0];
    const extraArgs = call.arguments.length > 1;
    if (extraArgs) {
      warn('UNSUPPORTED_EXTRA_ARGUMENTS', call, 'extra parallel arguments are evaluated but not modeled');
      state.phaseKnown = false;
    }
    const g = group('parallel', call, ctx, { expansion: 'expanded' });
    if (!array || array.type !== 'ArrayExpression' || array.elements.length > limits.maxItems || array.elements.some((n) => !n || n.type === 'SpreadElement')) {
      warn('DYNAMIC_PARALLEL', call, 'parallel branches are not a bounded literal array');
      g.expansion = 'unknown';
      state.phaseKnown = false;
      if (array && containsHook(array, shadowed)) warn('UNSUPPORTED_HOOK_CONTEXT', array, 'hook inside unresolved parallel branches is not analyzed');
      return blank(true);
    }
    const changingPhase = mayChangePhase(array, shadowed) || array.elements.some((el) => (el.type !== 'ArrowFunctionExpression' && el.type !== 'FunctionExpression') || el.params.some((param) => param.type !== 'Identifier'));
    if (changingPhase) { warn('DYNAMIC_PHASE', call, 'phase changes in concurrent callbacks have nondeterministic scope'); state.phaseKnown = false; }
    const fragments = [];
    for (let i = 0; i < array.elements.length && !state.truncated; i++)
      fragments.push(analyzeCallback(array.elements[i], childContext(ctx, `/b${i}`, { groups: [...ctx.groups, g], phaseUncertain: ctx.phaseUncertain || changingPhase || extraArgs })));
    if (state.truncated) fragments.push(blank(true));
    const result = merge(fragments);
    if (extraArgs) { result.opaque = true; state.phaseKnown = false; }
    if (fragments.length === 0) result.passthrough = true;
    return result;
  };
  const analyzePipeline = (call, ctx) => {
    const items = call.arguments[0];
    const itemList = items && items.type === 'ArrayExpression' && items.elements.length <= limits.maxItems &&
      items.elements.every((el) => el && el.type !== 'SpreadElement' && literal(el).known) ? items.elements : null;
    const stages = call.arguments.slice(1);
    const g = group('pipeline', call, ctx, { expansion: itemList ? 'expanded' : 'template', itemCount: itemList ? itemList.length : null });
    if (!itemList) {
      warn('DYNAMIC_PIPELINE_ITEMS', call, 'pipeline item count or values cannot be determined statically');
      if (hasDynamicEffect(items)) { warn('DYNAMIC_EFFECT', items, 'pipeline items may alter control flow or the current phase'); state.phaseKnown = false; }
      if (containsHook(items, shadowed)) warn('UNSUPPORTED_HOOK_CONTEXT', items, 'hook inside pipeline items is not analyzed');
    }
    if (!stages.length) { warn('DYNAMIC_CALLBACK', call, 'pipeline has no stage callbacks'); return blank(true); }
    const changingPhase = stages.some((s) => mayChangePhase(s, shadowed) || (s.type !== 'ArrowFunctionExpression' && s.type !== 'FunctionExpression') || s.params.some((param) => param.type !== 'Identifier'));
    if (changingPhase) { warn('DYNAMIC_PHASE', call, 'phase changes in concurrent pipeline callbacks have nondeterministic scope'); state.phaseKnown = false; }
    const count = itemList ? itemList.length : 1;
    const instances = [];
    for (let i = 0; i < count && !state.truncated; i++) {
      let entries = [], exits = [], opaque = false;
      for (let j = 0; j < stages.length && !state.truncated; j++) {
        const subctx = childContext(ctx, `/i${itemList ? i : 'template'}s${j}`, {
          groups: [...ctx.groups, g], itemIndex: itemList ? i : undefined, stageIndex: j,
          template: ctx.template || !itemList, phaseUncertain: ctx.phaseUncertain || changingPhase,
        });
        const part = analyzeCallback(stages[j], subctx);
        if (!entries.length) entries = part.entries;
        if (itemList && !opaque && !part.opaque) connect(exits, part.entries);
        if (part.exits.length) exits = part.exits;
        opaque ||= part.opaque;
        if (part.abrupt) break;
      }
      instances.push({ entries, exits, opaque: opaque || !itemList });
    }
    if (state.truncated) instances.push(blank(true));
    return merge(instances);
  };
  analyzeExpression = (expr, ctx, completed = false) => {
    if (!expr) return blank();
    if (ctx.depth > limits.maxDepth) { warn('DEPTH_LIMIT', expr, 'analysis nesting limit reached'); return blank(true); }
    if (expr.type === 'AwaitExpression') return analyzeExpression(expr.argument, ctx, true);
    if (hookCall(expr, 'agent', shadowed)) {
      const id = addAgent(expr, ctx);
      if (!completed) warn('UNAWAITED_CALL', expr, 'agent promise is not awaited or returned');
      const opaque = expr.arguments.some((arg) => hasDynamicEffect(arg) || containsHook(arg, shadowed));
      return id ? { entries: [id], exits: completed ? [id] : [], opaque } : blank(true);
    }
    if (hookCall(expr, 'parallel', shadowed) || hookCall(expr, 'pipeline', shadowed)) {
      if (!spendExpansion(expr)) return blank(true);
      const result = hookCall(expr, 'parallel', shadowed) ? analyzeParallel(expr, ctx) : analyzePipeline(expr, ctx);
      if (!completed) { warn('UNAWAITED_CALL', expr, 'combinator promise is not awaited or returned'); result.exits = []; result.passthrough = true; }
      return result;
    }
    if (hookCall(expr, 'phase', shadowed)) {
      if (expr.arguments.some((arg) => containsHook(arg, shadowed))) {
        warn('UNSUPPORTED_HOOK_CONTEXT', expr, 'hook inside phase arguments is not analyzed');
        state.phaseKnown = false;
        return blank(true);
      }
      if (expr.arguments.some(hasDynamicEffect)) {
        warn('DYNAMIC_EFFECT', expr, 'phase arguments may alter control flow');
        state.phaseKnown = false;
        return blank(true);
      }
      const value = literal(expr.arguments[0]);
      if (ctx.phaseUncertain || !value.known || typeof value.value !== 'string' || !value.value) {
        state.phaseKnown = false;
        if (!ctx.phaseUncertain) warn('DYNAMIC_PHASE', expr, 'phase value is not a known nonempty string');
      } else { state.phase = value.value; state.phaseKnown = true; }
      return blank();
    }
    if (hookCall(expr, 'log', shadowed) && !expr.arguments.some((arg) => containsHook(arg, shadowed)) && expr.arguments.every((arg) => literal(arg).known)) return blank();
    if (containsHook(expr, shadowed)) {
      warn('UNSUPPORTED_HOOK_CONTEXT', expr, 'hook referenced in an unsupported expression');
      if (containsPhase(expr, shadowed)) state.phaseKnown = false;
      return blank(true);
    }
    if (hasDynamicEffect(expr)) {
      warn('DYNAMIC_EFFECT', expr, 'an unresolved expression may call hooks or alter control flow');
      state.phaseKnown = false;
      return blank(true);
    }
    return blank();
  };
  analyzeSequence = (statements, ctx, inCallback = false) => {
    let entries = [], frontier = [], uncertain = false, opaque = false, abrupt = false;
    for (let index = 0; index < statements.length && !state.truncated; index++) {
      const statement = statements[index];
      const local = inCallback ? ctx : { ...ctx, statementIndex: index };
      let fragments = [];
      let stop = false;
      if (statement.type === 'ExpressionStatement') fragments = [analyzeExpression(statement.expression, local)];
      else if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations) {
          fragments.push(analyzeExpression(declaration.init, local));
          if (declaration.id.type !== 'Identifier') {
            warn('UNSUPPORTED_BINDING_PATTERN', declaration.id, 'destructuring binding side effects are not modeled');
            state.phaseKnown = false;
            fragments.push(blank(true));
          }
        }
      }
      else if (statement.type === 'ReturnStatement') { fragments = [analyzeExpression(statement.argument, local, true)]; stop = true; }
      else if (statement.type === 'ThrowStatement') {
        fragments = [analyzeExpression(statement.argument, local), blank(true)];
        warn('ABRUPT_COMPLETION', statement, 'throw prevents normal completion of this path');
        abrupt = true;
        stop = true;
      }
      else if (statement.type === 'EmptyStatement' || statement.type === 'FunctionDeclaration') {
        if (containsHook(statement, shadowed)) { warn('UNSUPPORTED_HOOK_CONTEXT', statement, 'hook in a declared function is not analyzed'); uncertain = opaque = true; }
      } else {
        warn('UNSUPPORTED_CONTROL_FLOW', statement, 'control flow or statement is not statically modeled');
        if (containsPhase(statement, shadowed)) state.phaseKnown = false;
        uncertain = opaque = true;
      }
      for (const part of fragments) {
        if (!entries.length) entries = part.entries;
        if (!uncertain && !part.opaque) connect(frontier, part.entries);
        if (part.opaque) { frontier = []; uncertain = opaque = true; }
        else if (part.exits.length) { frontier = part.passthrough ? [...new Set([...frontier, ...part.exits])] : part.exits; uncertain = false; }
      }
      if (stop) break;
    }
    return { entries, exits: frontier, opaque, abrupt };
  };
  analyzeSequence(ast.body, { path: '', groups: [], depth: 0, statementIndex: 0, template: false, phaseUncertain: false });
  // Event payload has label/phase/seq but no source location or invocation id.
  // Duplicate labels and repeated templates therefore cannot be safely matched.
  const byLabel = new Map();
  for (const node of graph.nodes) if (node.label !== null) byLabel.set(node.label, (byLabel.get(node.label) || 0) + 1);
  if ([...byLabel.values()].some((count) => count > 1)) warn('AMBIGUOUS_LABEL', null, 'repeated labels cannot uniquely identify a runtime invocation');
  return graph;
}

/** Layout is a pure function of static skeleton + declared phase titles. */
function layoutTopology(graph) {
  const phaseIndex = new Map(graph.phases.map((name, index) => [name, index]));
  const columns = new Map();
  const outputNodes = graph.nodes.map((node, row) => {
    let column;
    if (phaseIndex.size && node.phase !== null && phaseIndex.has(node.phase)) column = phaseIndex.get(node.phase);
    else if (phaseIndex.size) {
      const key = node.phase;
      if (!columns.has(key)) columns.set(key, phaseIndex.size + columns.size);
      column = columns.get(key);
    } else column = node.statementIndex;
    return { id: node.id, column, row, x: 80 + column * 320, y: 80 + row * 120, width: 220, height: 72 };
  });
  const positioned = new Map(outputNodes.map((node) => [node.id, node]));
  const groupMap = new Map(graph.groups.map((g) => [g.id, g]));
  const groups = graph.groups.map((g) => {
    const pending = [...g.members];
    const seen = new Set();
    const members = [];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      if (positioned.has(id)) members.push(positioned.get(id));
      else if (groupMap.has(id)) pending.push(...groupMap.get(id).members);
    }
    if (!members.length) return { id: g.id, bounds: null };
    const left = Math.min(...members.map((p) => p.x)) - 24;
    const top = Math.min(...members.map((p) => p.y)) - 24;
    const right = Math.max(...members.map((p) => p.x + p.width)) + 24;
    const bottom = Math.max(...members.map((p) => p.y + p.height)) + 24;
    return { id: g.id, bounds: { x: left, y: top, width: right - left, height: bottom - top } };
  });
  return { version: 1, nodes: outputNodes, groups };
}

module.exports = { extractTopology, layoutTopology };
