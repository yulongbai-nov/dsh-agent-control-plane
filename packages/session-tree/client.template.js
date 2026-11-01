/* Browser client, in rc.5's ModuleLoader format. No imports beyond host React. */
window.__ModuleLoader__.load({
  id: 'dsh-session-tree',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ID = 'dsh-session-tree';
    const TYPES = ['lead', 'research', 'code', 'write', 'data', 'qa'];
    const TYPE_LABELS = { lead: '组长 / 默认', research: '调研', code: '开发', write: '写作', data: '数据', qa: '校验' };
    const DEFAULT_IMAGES = /* AVATAR_DATA */ null /* END_AVATAR_DATA */;
    const PREF_KEY = 'dsh-session-tree.avatar-types.v1';
    const IMAGE_KEY = 'dsh-session-tree.avatar-images.v1';
    const IMAGE_LIMIT = 250000;

    function validId(value) { return typeof value === 'string' && value.length > 0; }
    function readObject(storage, key) {
      try {
        const value = JSON.parse(storage?.getItem(key) ?? '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch { return {}; }
    }
    function readAvatarPrefs(storage) {
      return Object.fromEntries(Object.entries(readObject(storage, PREF_KEY)).filter(([id, type]) => validId(id) && TYPES.includes(type)));
    }
    function saveAvatarPrefs(storage, prefs) {
      try { if (!storage) return false; storage.setItem(PREF_KEY, JSON.stringify(prefs)); return true; } catch { return false; }
    }
    function validImage(value) {
      return typeof value === 'string' && value.length <= IMAGE_LIMIT && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value);
    }
    function readCustomImages(storage) {
      return Object.fromEntries(Object.entries(readObject(storage, IMAGE_KEY)).filter(([type, value]) => TYPES.includes(type) && validImage(value)));
    }
    function saveCustomImages(storage, images) {
      try { if (!storage) return false; storage.setItem(IMAGE_KEY, JSON.stringify(images)); return true; } catch { return false; }
    }
    function matchType(value) {
      if (typeof value !== 'string') return undefined;
      const text = value.toLowerCase();
      if (/校验|验证|测试|审查|审核|复核|\b(qa|test|testing|review|verify|verification|validate)\b/.test(text)) return 'qa';
      if (/调研|研究|搜索|调查|\b(research|researcher|search|investigate)\b/.test(text)) return 'research';
      if (/数据|采集|分析|统计|\b(data|analyst|analyze|analytics|collect)\b/.test(text)) return 'data';
      if (/写作|撰写|起草|文案|\b(write|writer|writing|draft|compose)\b/.test(text)) return 'write';
      if (/开发|代码|编程|实现|修复|\b(code|coding|developer|develop|implement|engineer)\b/.test(text)) return 'code';
      if (/组长|领导|总览|\b(lead|leader|manager)\b/.test(text)) return 'lead';
      return undefined;
    }
    function avatarType(row, prefs) {
      return prefs[row.id] ?? matchType(row.role) ?? matchType(row.agentPreset) ?? matchType(row.title) ?? 'lead';
    }
    function catalogOf(snapshot) {
      const entries = Array.isArray(snapshot?.values?.subagentCatalog) ? snapshot.values.subagentCatalog : undefined;
      const state = snapshot?.state;
      if (!snapshot) return { state: 'unloaded', entries: [] };
      if (state === 'migration-required') return { state: 'migration-required', entries: entries ?? [] };
      if (state === 'error') return { state: 'error', entries: entries ?? [], error: snapshot.error?.message ?? '读取目录失败' };
      if (state === 'loading') return { state: 'loading', entries: entries ?? [] };
      if (entries !== undefined) return { state: 'ready', entries };
      if (state === 'ready') return { state: 'unavailable', entries: [] };
      return { state: 'unloaded', entries: [] };
    }
    function rowStatus(summary, uiStatus, archived) {
      if (archived) return 'archived';
      if (uiStatus?.pendingInteraction) return 'waiting';
      const running = uiStatus?.running ?? summary?.running;
      if (running === true) return 'running';
      if (running === undefined) return 'unknown';
      if (summary?.projectionValues?.subagentTiming?.lastTurnCompleted === true) return 'completed';
      return 'inactive';
    }
    // Catalog membership comes solely from each direct parent's projection. The
    // recursion is guarded against malformed cycles, not capped by depth.
    function buildRows(list, expanded, archived, statuses) {
      const rows = [], byId = list.byId ?? {}, projections = list.projectionsBySession ?? {};
      const listed = new Set(list.ids ?? []);
      function visit(id, parentId, entry, level, ancestors) {
        if (!validId(id) || ancestors.has(id)) return;
        const summary = byId[id];
        const catalog = catalogOf(projections[id]);
        const mode = entry?.mode;
        const external = mode === 'external';
        const migrationRequired = summary?.formatStatus === 'migration-required' || catalog.state === 'migration-required';
        const knownLeaf = catalog.state === 'ready' && catalog.entries.length === 0;
        const isArchived = archived.has(id);
        const title = summary?.title?.trim() || entry?.label?.trim() || summary?.displayTitle || id;
        const sessionState = statuses.get(id);
        // Catalog fallback rows use running=false without establishing live status.
        const knownSummary = listed.has(id) ? summary : { ...summary, running: undefined };
        const row = {
          id, parentId, mode, level, title, external, archived: isArchived, migrationRequired,
          status: rowStatus(knownSummary, sessionState, isArchived),
          role: summary?.role, agentPreset: summary?.agentPreset ?? summary?.projectionValues?.agentPreset,
          model: summary?.agentModel,
          current: (summary?.retainedBy?.mainView ?? 0) > 0,
          catalogState: catalog.state, error: catalog.error,
          expandable: !external && !migrationRequired && !knownLeaf,
          expanded: expanded.has(id) && !external && !migrationRequired && !knownLeaf
        };
        rows.push(row);
        if (!row.expanded) return;
        const next = new Set(ancestors); next.add(id);
        for (const nextEntry of catalog.entries) visit(nextEntry?.id, id, nextEntry, level + 1, next);
      }
      for (const id of list.ids ?? []) {
        const row = byId[id];
        if (!row || row.origin === 'subagent' || (row.blank && !(row.retainedBy?.mainView > 0))) continue;
        visit(id, null, undefined, 1, new Set());
      }
      const siblings = new Map();
      for (const row of rows) {
        const group = siblings.get(row.parentId) ?? [];
        group.push(row);
        siblings.set(row.parentId, group);
      }
      for (const group of siblings.values()) group.forEach((row, index) => { row.posInSet = index + 1; row.setSize = group.length; });
      return rows;
    }
    function navigationTarget(row) {
      if (row.archived || row.external || !validId(row.id)) return null;
      if (row.parentId === null) return row.id;
      if (!validId(row.parentId) || !['continuable', 'one-shot', 'unknown'].includes(row.mode)) return null;
      return { parentSessionId: row.parentId, childSessionId: row.id, mode: row.mode };
    }
    async function toggleBranch(id, expanded, refresh, projections) {
      if (expanded.has(id)) {
        const closing = new Set();
        function visit(current) {
          if (closing.has(current)) return;
          closing.add(current);
          for (const child of catalogOf(projections[current]).entries) if (validId(child?.id)) visit(child.id);
        }
        visit(id);
        for (const current of closing) expanded.delete(current);
        return;
      }
      expanded.add(id);
      await refresh(id);
    }
    async function retryBranch(id, refresh) { await refresh(id); }

    const CSS = `
.dsh-st{box-sizing:border-box;height:100%;overflow:auto;padding:calc(20px + var(--dsh-frame-top-clearance,0px)) 24px 28px max(24px,var(--dsh-frame-leading-clearance,0px));color:var(--dsw-alias-label-primary,#222);background:var(--dsw-alias-bg-layer-1,#fff);font:13px/1.45 system-ui,sans-serif}.dsh-st *{box-sizing:border-box}.dsh-st h1{font-size:19px;margin:0 0 4px}.dsh-st .note{color:var(--dsw-alias-label-tertiary,#777);font-size:12px;margin:0 0 14px}.dsh-st .tree{max-width:900px}.dsh-st button,.dsh-st select,.dsh-st input{font:inherit;color:inherit}.dsh-st button{cursor:pointer}.dsh-st button:focus-visible,.dsh-st select:focus-visible,.dsh-st input:focus-visible{outline:2px solid #3485ee;outline-offset:2px}.dsh-st button:disabled{cursor:not-allowed;opacity:.5}.dsh-st .row{display:flex;align-items:center;gap:7px;min-height:46px;padding:4px 6px;border-radius:8px}.dsh-st .row:hover,.dsh-st .row:focus-within{background:var(--dsw-alias-interactive-bg-hover,#f0f0f4)}.dsh-st .caret{flex:none;width:22px;border:0;background:transparent;padding:3px;color:var(--dsw-alias-label-tertiary,#888)}.dsh-st .image{width:32px;height:32px;flex:none;border-radius:9px;object-fit:cover}.dsh-st .body{display:flex;align-items:center;gap:7px;flex:1;min-width:80px;border:0;background:transparent;text-align:left;padding:2px}.dsh-st .bodytext{display:flex;flex-direction:column;min-width:0}.dsh-st .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-st .meta{color:var(--dsw-alias-label-tertiary,#777);font-size:11px}.dsh-st .dot{width:8px;height:8px;border-radius:50%;flex:none;background:#b8b8bc}.dsh-st .dot.running{background:#428bfa}.dsh-st .dot.completed{background:#30a35d}.dsh-st .dot.waiting{background:#e9a12a}.dsh-st .dot.archived{background:#aaa}.dsh-st .avatar-select{max-width:100px;font-size:11px;border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:5px;background:transparent}.dsh-st .branch-note{font-size:12px;color:var(--dsw-alias-label-tertiary,#777);padding:4px 8px 8px}.dsh-st .error{color:var(--dsw-alias-state-error-primary,#a33)}.dsh-st .notice button,.dsh-st .branch-note button{margin-left:8px}.dsh-st details{margin:16px 0;color:var(--dsw-alias-label-secondary,#666)}.dsh-st details div{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}.dsh-st .notice{margin:8px 0;font-size:12px}.dsh-st .root-row .title{font-weight:600}.dsh-st .row[aria-disabled=true]{opacity:.65}@media(max-width:540px){.dsh-st{padding-left:12px;padding-right:12px}.dsh-st .avatar-select{max-width:70px}}
`;
    const STATUS_LABELS = { archived: '已归档', waiting: '等待交互', running: '运行中', completed: '最近一次已完成', inactive: '未运行', unknown: '状态未知' };
    function getStorage() { try { return window.localStorage; } catch { return undefined; } }
    function TreeIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
        h('rect', { x: 3, y: 2, width: 6, height: 6, rx: 1 }), h('rect', { x: 15, y: 10, width: 6, height: 6, rx: 1 }),
        h('rect', { x: 15, y: 18, width: 6, height: 4, rx: 1 }), h('path', { d: 'M6 8v5h9M6 13v7h9' }));
    }
    function TreePanel({ useSessions, useSessionStatus, useWorkspaces, refreshProjection, refreshSessions, openSession, expansion }) {
      const list = useSessions(value => value);
      const statuses = useSessionStatus(value => value);
      const archivedIds = useWorkspaces(value => value.archivedSessionIds);
      const [expanded, setExpanded] = React.useState(() => new Set(expansion));
      const [failures, setFailures] = React.useState({});
      const [prefs, setPrefs] = React.useState(() => readAvatarPrefs(getStorage()));
      const [images, setImages] = React.useState(() => readCustomImages(getStorage()));
      const [imageType, setImageType] = React.useState('lead');
      const [notice, setNotice] = React.useState('');
      const [focusId, setFocusId] = React.useState(null);
      const treeRef = React.useRef(null);
      const rows = buildRows(list, expanded, new Set(archivedIds ?? []), statuses);

      function fail(id, error) { setFailures(current => ({ ...current, [id]: error?.message ?? String(error) })); }
      function clearFailure(id) { setFailures(current => { const next = { ...current }; delete next[id]; return next; }); }
      function toggle(row) {
        if (!row.expandable) return;
        const next = new Set(expanded);
        clearFailure(row.id);
        const operation = toggleBranch(row.id, next, refreshProjection, list.projectionsBySession ?? {});
        expansion.clear();
        for (const id of next) expansion.add(id);
        setExpanded(next);
        operation.catch(error => fail(row.id, error));
      }
      function retry(id) {
        clearFailure(id);
        retryBranch(id, refreshProjection).catch(error => fail(id, error));
      }
      function navigate(row) {
        const target = navigationTarget(row);
        if (target === null) return;
        try {
          const result = openSession(target);
          Promise.resolve(result).catch(error => setNotice(`打开失败：${error?.message ?? String(error)}`));
        } catch (error) { setNotice(`打开失败：${error?.message ?? String(error)}`); }
      }
      function changeAvatar(id, type) {
        const next = { ...prefs };
        if (type === '') delete next[id]; else if (TYPES.includes(type)) next[id] = type;
        if (!saveAvatarPrefs(getStorage(), next)) { setNotice('头像偏好无法保存：浏览器存储不可用或空间不足。'); return; }
        setPrefs(next); setNotice('头像选择已保存在此浏览器。');
      }
      function changeImage(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (file.type !== 'image/png' || file.size > 180000) { setNotice('请选择不超过 180 KB 的 PNG 图片。'); return; }
        const reader = new FileReader();
        const selectedType = imageType;
        reader.onerror = () => setNotice('无法读取头像图片。');
        reader.onload = () => {
          if (!validImage(reader.result)) { setNotice('头像文件不是有效的 PNG 数据。'); return; }
          const next = { ...images, [selectedType]: reader.result };
          if (!saveCustomImages(getStorage(), next)) { setNotice('头像无法保存：浏览器存储不可用或空间不足。'); return; }
          setImages(next); setNotice(`${TYPE_LABELS[selectedType]}头像已保存在此浏览器。`);
        };
        reader.readAsDataURL(file);
      }
      function resetImage() {
        const next = { ...images }; delete next[imageType];
        if (!saveCustomImages(getStorage(), next)) { setNotice('头像无法保存：浏览器存储不可用或空间不足。'); return; }
        setImages(next); setNotice(`${TYPE_LABELS[imageType]}头像已恢复内置图。`);
      }
      function treeKeys(event, row) {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(row); return; }
        if (event.key === 'ArrowRight' && row.expandable && !row.expanded || event.key === 'ArrowLeft' && row.expanded) {
          event.preventDefault(); toggle(row); return;
        }
        const index = rows.findIndex(item => item.id === row.id);
        let next;
        if (event.key === 'ArrowRight' && row.expanded && rows[index + 1]?.parentId === row.id) next = index + 1;
        if (event.key === 'ArrowLeft' && !row.expanded && row.parentId !== null) next = rows.findIndex(item => item.id === row.parentId);
        if (event.key === 'ArrowDown') next = index + 1;
        if (event.key === 'ArrowUp') next = index - 1;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = rows.length - 1;
        if (next !== undefined && next >= 0) {
          event.preventDefault();
          const target = rows[Math.min(rows.length - 1, next)];
          setFocusId(target.id);
          [...(treeRef.current?.querySelectorAll('[role="treeitem"]') ?? [])].find(element => element.dataset.sessionId === target.id)?.focus();
        }
      }
      function renderRow(row) {
        const type = avatarType(row, prefs);
        const target = navigationTarget(row);
        const stateText = [STATUS_LABELS[row.status], row.migrationRequired && '需要迁移', row.external && '外部任务', row.mode === 'unknown' && '模式未知', row.model, `L${row.level - 1}`].filter(Boolean).join(' · ');
        const error = failures[row.id] ?? row.error;
        const label = row.title;
        const indicator = row.expanded && (error ? h('div', { className: 'branch-note error', role: 'alert', style: { marginLeft: `${row.level * 20}px` } }, `目录读取失败：${error}`, h('button', { type: 'button', onClick: () => retry(row.id) }, '重试'))
          : row.catalogState === 'unavailable' ? h('div', { className: 'branch-note', style: { marginLeft: `${row.level * 20}px` } }, '宿主未提供子代理目录投影。')
          : row.catalogState === 'loading' || row.catalogState === 'unloaded' ? h('div', { className: 'branch-note', role: 'status', style: { marginLeft: `${row.level * 20}px` } }, '正在读取子代理目录…', h('button', { type: 'button', onClick: () => retry(row.id) }, '重试')) : null);
        return h(React.Fragment, { key: row.id }, h('div', {
          className: `row ${row.level === 1 ? 'root-row' : ''}`,
          style: { marginLeft: `${(row.level - 1) * 20}px` }, role: 'treeitem',
          tabIndex: (rows.some(item => item.id === focusId) ? focusId : rows[0]?.id) === row.id ? 0 : -1,
          'data-session-id': row.id, 'aria-level': row.level, 'aria-posinset': row.posInSet, 'aria-setsize': row.setSize,
          'aria-expanded': row.expandable ? row.expanded : undefined,
          'aria-disabled': target === null || undefined, 'aria-label': `${label}，${stateText}`,
          onFocus: event => { if (event.target === event.currentTarget) setFocusId(row.id); },
          onKeyDown: event => treeKeys(event, row),
          onClick: event => { if (event.target === event.currentTarget) navigate(row); }
        }, h('button', { type: 'button', className: 'caret', tabIndex: -1, disabled: !row.expandable, 'aria-label': `${row.expanded ? '折叠' : '展开'} ${label}`, onClick: event => { toggle(row); event.currentTarget.closest('[role="treeitem"]')?.focus(); } }, row.expandable ? (row.expanded ? '▾' : '▸') : '·'),
        h('img', { className: 'image', src: images[type] ?? DEFAULT_IMAGES[type], alt: '' }),
        h('button', { type: 'button', className: 'body', tabIndex: -1, disabled: target === null, onClick: () => navigate(row) },
          h('span', { className: `dot ${row.status}`, 'aria-hidden': true }), h('span', { className: 'bodytext' }, h('span', { className: 'title' }, label), h('span', { className: 'meta' }, stateText))),
        h('select', { className: 'avatar-select', 'aria-label': `更改 ${label} 的头像`, value: prefs[row.id] ?? '', onChange: event => changeAvatar(row.id, event.target.value) },
          h('option', { value: '' }, '自动头像'), TYPES.map(value => h('option', { key: value, value }, TYPE_LABELS[value])))
        ), indicator);
      }
      return h('section', { className: 'dsh-st', 'aria-label': '会话树' }, h('style', null, CSS),
        h('h1', null, '会话树'), h('p', { className: 'note' }, '独立会话树面板；原生侧栏列表与页头目录不变。展开时读取该层目录。'),
        notice && h('div', { className: 'notice', role: 'status' }, notice),
        h('details', null, h('summary', null, '自定义头像（仅此浏览器）'),
          h('div', null, h('label', null, '头像类型 ', h('select', { value: imageType, onChange: event => setImageType(event.target.value) }, TYPES.map(type => h('option', { value: type, key: type }, TYPE_LABELS[type])))),
            h('label', null, '替换为 PNG ', h('input', { type: 'file', accept: 'image/png', onChange: changeImage })),
            h('button', { type: 'button', onClick: resetImage }, '恢复内置图')),
          h('p', { className: 'note' }, '建议 144×144；每张 ≤180 KB。保存在浏览器本地，清理站点数据会丢失。')),
        list.phase !== 'ready' && h('div', { className: 'notice', role: 'status' }, '会话列表尚未就绪。', h('button', { type: 'button', onClick: () => Promise.resolve().then(refreshSessions).catch(error => setNotice(`刷新失败：${error?.message ?? String(error)}`)) }, '重试')),
        list.phase === 'ready' && rows.length === 0 && h('div', { className: 'notice' }, '暂无可显示的根会话。'),
        h('div', { className: 'tree', role: 'tree', ref: treeRef, 'aria-label': '会话谱系' }, rows.map(renderRow)));
    }
    const inject = ['slots', 'sessions', 'uiWorkspace'];
    function apply(ctx) {
      const actions = {
        expansion: new Set(),
        refreshProjection: id => ctx.sessions.refreshProjections(id),
        refreshSessions: () => ctx.sessions.refresh(),
        openSession: target => ctx.uiWorkspace.openSession(target)
      };
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ID, inject: () => actions }, TreePanel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: ID, order: 55, label: '会话树' }, TreeIcon));
    }
    return { apply, inject, __test: { avatarType, readAvatarPrefs, saveAvatarPrefs, readCustomImages, saveCustomImages, validImage, buildRows, catalogOf, navigationTarget, toggleBranch, retryBranch } };
  }
});
