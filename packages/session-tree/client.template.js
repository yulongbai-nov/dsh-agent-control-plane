/* Browser client, in rc.5's ModuleLoader format. No imports beyond host React. */
window.__ModuleLoader__.load({
  id: 'dsh-session-tree',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ID = 'dsh-session-tree';
    const TYPES = ['lead', 'research', 'code', 'write', 'data', 'qa'];
    const DICTIONARIES = {
      zh: {
        panel: '会话树', intro: '独立会话树面板；原生侧栏列表与页头目录不变。展开时读取该层目录。', lineage: '会话谱系',
        'type.lead': '组长 / 默认', 'type.research': '调研', 'type.code': '开发', 'type.write': '写作', 'type.data': '数据', 'type.qa': '校验',
        'status.archived': '已归档', 'status.waiting': '等待交互', 'status.running': '运行中', 'status.completed': '最近一次已完成', 'status.inactive': '未运行', 'status.unknown': '状态未知',
        migration: '需要迁移', external: '外部任务', unknownMode: '模式未知', ambiguous: '身份存在歧义', depthLimit: '达到显示深度上限', rowLabel: '{title}，{state}', collapse: '折叠 {title}', expand: '展开 {title}', changeAvatar: '更改 {title} 的头像', autoAvatar: '自动头像',
        catalogError: '目录读取失败：{error}', catalogReadError: '读取目录失败', catalogUnavailable: '宿主未提供子代理目录投影。', catalogLoading: '正在读取子代理目录…', retry: '重试',
        openError: '打开失败：{error}', refreshError: '刷新失败：{error}', preferencesError: '头像偏好无法保存：浏览器存储不可用或空间不足。', preferencesSaved: '头像选择已保存在此浏览器。',
        imageInvalidSize: '请选择不超过 180 KB 的 PNG 图片。', imageReadError: '无法读取头像图片。', imageInvalid: '头像文件不是有效的 PNG 数据。', imageSaveError: '头像无法保存：浏览器存储不可用或空间不足。',
        imageSaved: '{type}头像已保存在此浏览器。', imageReset: '{type}头像已恢复内置图。', customAvatars: '自定义头像（仅此浏览器）', avatarType: '头像类型 ', replacePng: '替换为 PNG ', resetImage: '恢复内置图',
        imageHelp: '建议 144×144；每张 ≤180 KB。保存在浏览器本地，清理站点数据会丢失。', listLoading: '会话列表尚未就绪。', noRoots: '暂无可显示的根会话。'
      },
      en: {
        panel: 'Session tree', intro: 'Independent session tree; the native sidebar and header directory are unchanged. Expanding loads that level.', lineage: 'Session lineage',
        'type.lead': 'Lead / default', 'type.research': 'Research', 'type.code': 'Development', 'type.write': 'Writing', 'type.data': 'Data', 'type.qa': 'Verification',
        'status.archived': 'Archived', 'status.waiting': 'Waiting for interaction', 'status.running': 'Running', 'status.completed': 'Last turn completed', 'status.inactive': 'Inactive', 'status.unknown': 'Status unknown',
        migration: 'Migration required', external: 'External task', unknownMode: 'Unknown mode', ambiguous: 'Ambiguous identity', depthLimit: 'Display depth limit reached', rowLabel: '{title}, {state}', collapse: 'Collapse {title}', expand: 'Expand {title}', changeAvatar: 'Change avatar for {title}', autoAvatar: 'Automatic avatar',
        catalogError: 'Failed to load catalog: {error}', catalogReadError: 'Failed to read catalog', catalogUnavailable: 'The host did not provide a subagent catalog projection.', catalogLoading: 'Loading subagent catalog…', retry: 'Retry',
        openError: 'Failed to open: {error}', refreshError: 'Failed to refresh: {error}', preferencesError: 'Could not save avatar preferences: browser storage is unavailable or full.', preferencesSaved: 'Avatar selection saved in this browser.',
        imageInvalidSize: 'Choose a PNG image no larger than 180 KB.', imageReadError: 'Could not read the avatar image.', imageInvalid: 'The avatar file is not valid PNG data.', imageSaveError: 'Could not save the avatar: browser storage is unavailable or full.',
        imageSaved: '{type} avatar saved in this browser.', imageReset: '{type} avatar restored to the built-in image.', customAvatars: 'Custom avatars (this browser only)', avatarType: 'Avatar type ', replacePng: 'Replace with PNG ', resetImage: 'Restore built-in image',
        imageHelp: 'Recommended: 144×144; ≤180 KB each. Stored locally in this browser; clearing site data removes them.', listLoading: 'The session list is not ready.', noRoots: 'No root sessions to display.'
      }
    };
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
      if (state === 'error') return { state: 'error', entries: entries ?? [], error: snapshot.error?.message };
      if (state === 'loading') return { state: 'loading', entries: entries ?? [] };
      // An idle empty catalog may be a stale cache hint, not a known leaf.
      if (state === 'idle' && entries?.length === 0) return { state: 'unloaded', entries };
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
    // Inspect only already-cached catalogs reachable from visible roots; do not fetch.
    function buildRows(list, expanded, archived, statuses) {
      const rows = [], byId = list.byId ?? {}, projections = list.projectionsBySession ?? {};
      const listed = new Set(list.ids ?? []);
      const roots = (list.ids ?? []).filter(id => {
        const row = byId[id];
        return validId(id) && row && row.origin !== 'subagent' && !(row.blank && !(row.retainedBy?.mainView > 0));
      });
      const incoming = new Map(), pending = [...new Set(roots)], scanned = new Set();
      for (let i = 0; i < pending.length; i++) {
        const id = pending[i];
        if (scanned.has(id)) continue;
        scanned.add(id);
        const catalog = catalogOf(projections[id]);
        if (catalog.state === 'migration-required' || byId[id]?.formatStatus === 'migration-required') continue;
        for (const entry of catalog.entries) {
          if (!validId(entry?.id)) continue;
          incoming.set(entry.id, (incoming.get(entry.id) ?? 0) + 1);
          if (entry.mode === 'one-shot' || entry.mode === 'continuable') pending.push(entry.id);
        }
      }
      const rootCounts = new Map();
      for (const id of roots) rootCounts.set(id, (rootCounts.get(id) ?? 0) + 1);
      function visit(id, parentId, entry, level, ancestors, rowKey, parentKey) {
        if (!validId(id)) return;
        const summary = byId[id];
        const catalog = catalogOf(projections[id]);
        const mode = entry?.mode;
        const external = mode === 'external';
        const unknownMode = parentId !== null && !external && mode !== 'one-shot' && mode !== 'continuable';
        const ambiguous = ancestors.has(id) || (parentId === null ? rootCounts.get(id) > 1 || (incoming.get(id) ?? 0) > 0 : (incoming.get(id) ?? 0) > 1 || rootCounts.has(id));
        const migrationRequired = summary?.formatStatus === 'migration-required' || catalog.state === 'migration-required';
        const knownLeaf = catalog.state === 'ready' && catalog.entries.length === 0;
        const isArchived = archived.has(id);
        const title = summary?.title?.trim() || entry?.label?.trim() || summary?.displayTitle || id;
        const sessionState = statuses.get(id);
        // Catalog fallback rows use running=false without establishing live status.
        const knownSummary = listed.has(id) ? summary : { ...summary, running: undefined };
        const canExpand = !ambiguous && !unknownMode && !external && !migrationRequired && !knownLeaf;
        const depthLimit = canExpand && level >= 128;
        const expandable = canExpand && !depthLimit;
        const row = {
          id, parentId, rowKey, parentKey, mode, level, title, external, unknownMode, ambiguous, archived: isArchived, migrationRequired,
          status: rowStatus(knownSummary, sessionState, isArchived),
          role: summary?.role, agentPreset: summary?.agentPreset ?? summary?.projectionValues?.agentPreset,
          model: summary?.agentModel,
          current: (summary?.retainedBy?.mainView ?? 0) > 0,
          catalogState: catalog.state, error: catalog.error, depthLimit,
          expandable, expanded: expanded.has(id) && expandable
        };
        rows.push(row);
        if (!row.expanded) return;
        const next = new Set(ancestors); next.add(id);
        const occurrences = new Map();
        for (const nextEntry of catalog.entries) {
          if (!validId(nextEntry?.id)) continue;
          const ordinal = occurrences.get(nextEntry.id) ?? 0;
          occurrences.set(nextEntry.id, ordinal + 1);
          const childKey = `${rowKey}/${nextEntry.id.length}:${nextEntry.id}:${ordinal}`;
          visit(nextEntry.id, id, nextEntry, level + 1, next, childKey, rowKey);
        }
      }
      const rootOccurrences = new Map();
      for (const id of roots) {
        const ordinal = rootOccurrences.get(id) ?? 0;
        rootOccurrences.set(id, ordinal + 1);
        visit(id, null, undefined, 1, new Set(), `${id.length}:${id}:${ordinal}`, null);
      }
      const siblings = new Map();
      for (const row of rows) {
        const group = siblings.get(row.parentKey) ?? [];
        group.push(row);
        siblings.set(row.parentKey, group);
      }
      for (const group of siblings.values()) group.forEach((row, index) => { row.posInSet = index + 1; row.setSize = group.length; });
      return rows;
    }
    function navigationTarget(row) {
      if (row.archived || row.external || row.ambiguous || row.unknownMode || !validId(row.id)) return null;
      if (row.parentId === null) return row.id;
      if (!validId(row.parentId) || !['continuable', 'one-shot'].includes(row.mode)) return null;
      return { parentSessionId: row.parentId, childSessionId: row.id, mode: row.mode };
    }
    async function toggleBranch(row, expanded, refresh, rows) {
      const index = rows.findIndex(candidate => candidate.rowKey === row.rowKey);
      if (index < 0 || !row.expandable) return;
      if (row.expanded) {
        expanded.delete(row.id);
        for (let i = index + 1; i < rows.length && rows[i].level > row.level; i++) {
          const descendant = rows[i];
          if (!descendant.ambiguous && descendant.expandable && descendant.expanded) expanded.delete(descendant.id);
        }
        return;
      }
      expanded.add(row.id);
      await refresh(row.id);
    }
    async function retryBranch(id, refresh) { await refresh(id); }

    const CSS = `
.dsh-st{box-sizing:border-box;height:100%;overflow:auto;padding:calc(20px + var(--dsh-frame-top-clearance,0px)) 24px 28px max(24px,var(--dsh-frame-leading-clearance,0px));color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);font:13px/1.45 system-ui,sans-serif}.dsh-st *{box-sizing:border-box}.dsh-st h1{font-size:19px;margin:0 0 4px}.dsh-st .note{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0 0 14px}.dsh-st .tree{max-width:900px}.dsh-st button,.dsh-st select,.dsh-st input{font:inherit;color:inherit}.dsh-st button{cursor:pointer}.dsh-st button:focus-visible,.dsh-st select:focus-visible,.dsh-st input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dsh-st button:disabled{cursor:not-allowed;opacity:.5}.dsh-st .row{display:flex;align-items:center;gap:7px;min-height:46px;padding:4px 6px;border-radius:8px}.dsh-st .row:hover,.dsh-st .row:focus-within{background:var(--dsw-alias-interactive-bg-hover)}.dsh-st .caret{flex:none;width:22px;border:0;background:transparent;padding:3px;color:var(--dsw-alias-label-tertiary)}.dsh-st .image{width:32px;height:32px;flex:none;border-radius:9px;object-fit:cover}.dsh-st .body{display:flex;align-items:center;gap:7px;flex:1;min-width:80px;border:0;background:transparent;text-align:left;padding:2px}.dsh-st .bodytext{display:flex;flex-direction:column;min-width:0}.dsh-st .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-st .meta{color:var(--dsw-alias-label-tertiary);font-size:11px}.dsh-st .dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}.dsh-st .dot.running{background:var(--dsw-alias-state-business-primary)}.dsh-st .dot.completed{background:var(--dsw-alias-state-success-primary)}.dsh-st .dot.waiting{background:var(--dsw-alias-state-warn-primary)}.dsh-st .dot.archived{background:var(--dsw-alias-state-idle-primary)}.dsh-st .avatar-select{max-width:100px;font-size:11px;border:1px solid var(--dsw-alias-border-l3);border-radius:5px;background:transparent}.dsh-st .branch-note{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:4px 8px 8px}.dsh-st .error{color:var(--dsw-alias-state-error-primary)}.dsh-st .notice button,.dsh-st .branch-note button{margin-left:8px}.dsh-st details{margin:16px 0;color:var(--dsw-alias-label-secondary)}.dsh-st details div{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}.dsh-st .notice{margin:8px 0;font-size:12px}.dsh-st .root-row .title{font-weight:600}.dsh-st .row[aria-disabled=true]{opacity:.65}@media(max-width:540px){.dsh-st{padding-left:12px;padding-right:12px}.dsh-st .avatar-select{max-width:70px}}
`;
    function getStorage() { try { return window.localStorage; } catch { return undefined; } }
    function TreeIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
        h('rect', { x: 3, y: 2, width: 6, height: 6, rx: 1 }), h('rect', { x: 15, y: 10, width: 6, height: 6, rx: 1 }),
        h('rect', { x: 15, y: 18, width: 6, height: 4, rx: 1 }), h('path', { d: 'M6 8v5h9M6 13v7h9' }));
    }
    function TreePanel({ t, useSessions, useSessionStatus, useWorkspaces, refreshProjection, refreshSessions, openSession, expansion }) {
      const list = useSessions(value => value);
      const statuses = useSessionStatus(value => value);
      const archivedIds = useWorkspaces(value => value.archivedSessionIds);
      const [expanded, setExpanded] = React.useState(() => new Set(expansion));
      const [failures, setFailures] = React.useState({});
      const [prefs, setPrefs] = React.useState(() => readAvatarPrefs(getStorage()));
      const [images, setImages] = React.useState(() => readCustomImages(getStorage()));
      const [imageType, setImageType] = React.useState('lead');
      const [notice, setNotice] = React.useState(null);
      const [focusKey, setFocusKey] = React.useState(null);
      const treeRef = React.useRef(null);
      const imageOperations = React.useRef(null);
      if (!imageOperations.current) imageOperations.current = { images, versions: new Map(), notice: 0, active: false };
      React.useEffect(() => {
        const current = imageOperations.current;
        current.active = true;
        return () => { current.active = false; current.versions.clear(); current.notice++; };
      }, []);
      const rows = buildRows(list, expanded, new Set(archivedIds ?? []), statuses);
      const tabStop = rows.some(item => item.rowKey === focusKey) ? focusKey : rows[0]?.rowKey;

      function fail(id, error) { setFailures(current => ({ ...current, [id]: error?.message ?? String(error) })); }
      function clearFailure(id) { setFailures(current => { const next = { ...current }; delete next[id]; return next; }); }
      function toggle(row) {
        if (!row.expandable) return;
        const next = new Set(expanded);
        clearFailure(row.id);
        const operation = toggleBranch(row, next, refreshProjection, rows);
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
          Promise.resolve(result).catch(error => setNotice({ key: 'openError', params: { error: error?.message ?? String(error) } }));
        } catch (error) { setNotice({ key: 'openError', params: { error: error?.message ?? String(error) } }); }
      }
      function changeAvatar(id, type) {
        const next = { ...prefs };
        if (type === '') delete next[id]; else if (TYPES.includes(type)) next[id] = type;
        if (!saveAvatarPrefs(getStorage(), next)) { setNotice({ key: 'preferencesError' }); return; }
        setPrefs(next); setNotice({ key: 'preferencesSaved' });
      }
      function beginImageOperation(type) {
        const current = imageOperations.current, version = Symbol();
        current.versions.set(type, version);
        const notice = ++current.notice;
        return {
          current,
          valid: () => current.active && current.versions.get(type) === version,
          tell: value => { if (current.active && current.versions.get(type) === version && current.notice === notice) setNotice(value); }
        };
      }
      function changeImage(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const selectedType = imageType, operation = beginImageOperation(selectedType);
        if (file.type !== 'image/png' || file.size > 180000) { operation.tell({ key: 'imageInvalidSize' }); return; }
        let settled = false;
        try {
          const reader = new FileReader();
          reader.onerror = () => { if (settled) return; settled = true; operation.tell({ key: 'imageReadError' }); };
          reader.onload = () => {
            if (settled) return;
            settled = true;
            if (!operation.valid()) return;
            if (!validImage(reader.result)) { operation.tell({ key: 'imageInvalid' }); return; }
            const next = { ...operation.current.images, [selectedType]: reader.result };
            if (!saveCustomImages(getStorage(), next)) { operation.tell({ key: 'imageSaveError' }); return; }
            operation.current.images = next;
            setImages(next); operation.tell({ key: 'imageSaved', type: selectedType });
          };
          reader.readAsDataURL(file);
        } catch { if (!settled) { settled = true; operation.tell({ key: 'imageReadError' }); } }
      }
      function resetImage() {
        const operation = beginImageOperation(imageType), next = { ...operation.current.images };
        delete next[imageType];
        if (!saveCustomImages(getStorage(), next)) { operation.tell({ key: 'imageSaveError' }); return; }
        operation.current.images = next;
        setImages(next); operation.tell({ key: 'imageReset', type: imageType });
      }
      function treeKeys(event, row) {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(row); return; }
        if (event.key === 'ArrowRight' && row.expandable && !row.expanded || event.key === 'ArrowLeft' && row.expanded) {
          event.preventDefault(); toggle(row); return;
        }
        const index = rows.findIndex(item => item.rowKey === row.rowKey);
        let next;
        if (event.key === 'ArrowRight' && row.expanded && rows[index + 1]?.parentKey === row.rowKey) next = index + 1;
        if (event.key === 'ArrowLeft' && !row.expanded && row.parentKey !== null) next = rows.findIndex(item => item.rowKey === row.parentKey);
        if (event.key === 'ArrowDown') next = index + 1;
        if (event.key === 'ArrowUp') next = index - 1;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = rows.length - 1;
        if (next !== undefined && next >= 0) {
          event.preventDefault();
          const target = rows[Math.min(rows.length - 1, next)];
          setFocusKey(target.rowKey);
          [...(treeRef.current?.querySelectorAll('[role="treeitem"]') ?? [])].find(element => element.dataset.rowKey === target.rowKey)?.focus();
        }
      }
      function renderRow(row) {
        const type = avatarType(row, prefs);
        const target = navigationTarget(row);
        const stateText = [t(`status.${row.status}`), row.migrationRequired && t('migration'), row.external && t('external'), row.unknownMode && t('unknownMode'), row.ambiguous && t('ambiguous'), row.depthLimit && t('depthLimit'), row.model, `L${row.level - 1}`].filter(Boolean).join(' · ');
        const error = failures[row.id] ?? row.error ?? (row.catalogState === 'error' ? t('catalogReadError') : undefined);
        const label = row.title;
        const indicator = row.expanded && (error ? h('div', { className: 'branch-note error', role: 'alert', style: { marginLeft: `${row.level * 20}px` } }, t('catalogError', { error }), h('button', { type: 'button', onClick: () => retry(row.id) }, t('retry')))
          : row.catalogState === 'unavailable' ? h('div', { className: 'branch-note', style: { marginLeft: `${row.level * 20}px` } }, t('catalogUnavailable'))
          : row.catalogState === 'loading' || row.catalogState === 'unloaded' ? h('div', { className: 'branch-note', role: 'status', style: { marginLeft: `${row.level * 20}px` } }, t('catalogLoading'), h('button', { type: 'button', onClick: () => retry(row.id) }, t('retry'))) : null);
        return h(React.Fragment, { key: row.rowKey }, h('div', {
          className: `row ${row.level === 1 ? 'root-row' : ''}`,
          style: { marginLeft: `${(row.level - 1) * 20}px` }, role: 'treeitem',
          tabIndex: tabStop === row.rowKey ? 0 : -1,
          'data-session-id': row.id, 'data-row-key': row.rowKey, 'aria-level': row.level, 'aria-posinset': row.posInSet, 'aria-setsize': row.setSize,
          'aria-expanded': row.expandable ? row.expanded : undefined,
          'aria-disabled': target === null || undefined, 'aria-label': t('rowLabel', { title: label, state: stateText }),
          onFocus: event => { if (event.target === event.currentTarget) setFocusKey(row.rowKey); },
          onKeyDown: event => treeKeys(event, row),
          onClick: event => { if (event.target === event.currentTarget) navigate(row); }
        }, h('button', { type: 'button', className: 'caret', tabIndex: -1, disabled: !row.expandable, 'aria-label': t(row.expanded ? 'collapse' : 'expand', { title: label }), onClick: event => { toggle(row); event.currentTarget.closest('[role="treeitem"]')?.focus(); } }, row.expandable ? (row.expanded ? '▾' : '▸') : '·'),
        h('img', { className: 'image', src: images[type] ?? DEFAULT_IMAGES[type], alt: '' }),
        h('button', { type: 'button', className: 'body', tabIndex: -1, disabled: target === null, onClick: () => navigate(row) },
          h('span', { className: `dot ${row.status}`, 'aria-hidden': true }), h('span', { className: 'bodytext' }, h('span', { className: 'title' }, label), h('span', { className: 'meta' }, stateText))),
        h('select', { className: 'avatar-select', disabled: row.ambiguous, 'aria-label': t('changeAvatar', { title: label }), value: prefs[row.id] ?? '', onChange: event => changeAvatar(row.id, event.target.value) },
          h('option', { value: '' }, t('autoAvatar')), TYPES.map(value => h('option', { key: value, value }, t(`type.${value}`))))
        ), indicator);
      }
      return h('section', { className: 'dsh-st', 'aria-label': t('panel') }, h('style', null, CSS),
        h('h1', null, t('panel')), h('p', { className: 'note' }, t('intro')),
        notice && h('div', { className: 'notice', role: 'status' }, t(notice.key, notice.type ? { type: t(`type.${notice.type}`) } : notice.params)),
        h('details', null, h('summary', null, t('customAvatars')),
          h('div', null, h('label', null, t('avatarType'), h('select', { value: imageType, onChange: event => setImageType(event.target.value) }, TYPES.map(type => h('option', { value: type, key: type }, t(`type.${type}`))))),
            h('label', null, t('replacePng'), h('input', { type: 'file', accept: 'image/png', onChange: changeImage })),
            h('button', { type: 'button', onClick: resetImage }, t('resetImage'))),
          h('p', { className: 'note' }, t('imageHelp'))),
        list.phase !== 'ready' && h('div', { className: 'notice', role: 'status' }, t('listLoading'), h('button', { type: 'button', onClick: () => Promise.resolve().then(refreshSessions).catch(error => setNotice({ key: 'refreshError', params: { error: error?.message ?? String(error) } })) }, t('retry'))),
        list.phase === 'ready' && rows.length === 0 && h('div', { className: 'notice' }, t('noRoots')),
        h('div', { className: 'tree', role: 'tree', ref: treeRef, 'aria-label': t('lineage') }, rows.map(renderRow)));
    }
    const inject = ['slots', 'locale', 'sessions', 'uiWorkspace'];
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(ID, DICTIONARIES), 'session-tree: dictionaries');
      const t = ctx.locale.bind(ID);
      const actions = {
        expansion: new Set(),
        refreshProjection: id => ctx.sessions.refreshProjections(id),
        refreshSessions: () => ctx.sessions.refresh(),
        openSession: target => ctx.uiWorkspace.openSession(target)
      };
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ID, locale: ID, inject: () => actions }, TreePanel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: ID, order: 55, label: () => t('panel'), locale: ID }, TreeIcon));
    }
    return { apply, inject, __test: { avatarType, readAvatarPrefs, saveAvatarPrefs, readCustomImages, saveCustomImages, validImage, buildRows, catalogOf, navigationTarget, toggleBranch, retryBranch } };
  }
});
