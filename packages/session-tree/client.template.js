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
        migration: '需要迁移', external: '外部任务', unknownMode: '模式未知', ambiguous: '身份存在歧义', cannotOpen: '无法打开会话', depthLimit: '达到显示深度上限', rowLabel: '{title}，{state}', collapse: '折叠 {title}', expand: '展开 {title}', changeAvatar: '更改 {title} 的头像', autoAvatar: '自动头像',
        catalogError: '目录读取失败：{error}', catalogReadError: '读取目录失败', catalogUnavailable: '宿主未提供子代理目录投影。', catalogLoading: '正在读取子代理目录…', catalogUnknown: '目录状态未知，缓存暂不显示。', retry: '重试',
        openError: '打开失败：{error}', refreshError: '刷新失败：{error}', preferencesError: '头像偏好无法保存：浏览器存储不可用或空间不足。', preferencesSaved: '头像选择已保存在此浏览器。',
        imageInvalidSize: '请选择不超过 180 KB 的 PNG 图片。', imageDimensions: 'PNG 宽高各不能超过 2048 像素。', imageValidating: '正在验证头像…', imageReadError: '无法读取头像图片。', imageInvalid: '无法验证或解码此静态 PNG 图片。', imageSaveError: '头像无法保存：浏览器存储不可用、空间不足或原有数据无法安全保留。',
        imageSaved: '{type}头像已保存在此浏览器。', imageReset: '{type}头像已恢复内置图。', customAvatars: '自定义头像（仅此浏览器）', avatarType: '头像类型 ', replacePng: '替换为 PNG ', resetImage: '恢复内置图',
        imageHelp: '建议 144×144；静态 PNG ≤180 KB，宽高各 ≤2048 像素，不支持动画和压缩文本/ICC。保存在浏览器本地，清理站点数据会丢失。', listLoading: '会话列表尚未就绪。', noRoots: '暂无可显示的根会话。'
      },
      en: {
        panel: 'Session tree', intro: 'Independent session tree; the native sidebar and header directory are unchanged. Expanding loads that level.', lineage: 'Session lineage',
        'type.lead': 'Lead / default', 'type.research': 'Research', 'type.code': 'Development', 'type.write': 'Writing', 'type.data': 'Data', 'type.qa': 'Verification',
        'status.archived': 'Archived', 'status.waiting': 'Waiting for interaction', 'status.running': 'Running', 'status.completed': 'Last turn completed', 'status.inactive': 'Inactive', 'status.unknown': 'Status unknown',
        migration: 'Migration required', external: 'External task', unknownMode: 'Unknown mode', ambiguous: 'Ambiguous identity', cannotOpen: 'Cannot open session', depthLimit: 'Display depth limit reached', rowLabel: '{title}, {state}', collapse: 'Collapse {title}', expand: 'Expand {title}', changeAvatar: 'Change avatar for {title}', autoAvatar: 'Automatic avatar',
        catalogError: 'Failed to load catalog: {error}', catalogReadError: 'Failed to read catalog', catalogUnavailable: 'The host did not provide a subagent catalog projection.', catalogLoading: 'Loading subagent catalog…', catalogUnknown: 'Catalog status unknown; cached entries are hidden.', retry: 'Retry',
        openError: 'Failed to open: {error}', refreshError: 'Failed to refresh: {error}', preferencesError: 'Could not save avatar preferences: browser storage is unavailable or full.', preferencesSaved: 'Avatar selection saved in this browser.',
        imageInvalidSize: 'Choose a PNG image no larger than 180 KB.', imageDimensions: 'PNG width and height must each be at most 2048 pixels.', imageValidating: 'Validating avatar…', imageReadError: 'Could not read the avatar image.', imageInvalid: 'Could not validate or decode this static PNG image.', imageSaveError: 'Could not save the avatar: browser storage is unavailable, full, or contains data that cannot be safely preserved.',
        imageSaved: '{type} avatar saved in this browser.', imageReset: '{type} avatar restored to the built-in image.', customAvatars: 'Custom avatars (this browser only)', avatarType: 'Avatar type ', replacePng: 'Replace with PNG ', resetImage: 'Restore built-in image',
        imageHelp: 'Recommended: 144×144; static PNG ≤180 KB, width and height ≤2048 pixels. Animation and compressed text/ICC are unsupported. Stored locally in this browser; clearing site data removes them.', listLoading: 'The session list is not ready.', noRoots: 'No root sessions to display.'
      }
    };
    const DEFAULT_IMAGES = /* AVATAR_DATA */ null /* END_AVATAR_DATA */;
    const PREF_KEY = 'dsh-session-tree.avatar-types.v1';
    const IMAGE_KEY = 'dsh-session-tree.avatar-images.v1';
    const IMAGE_BYTE_LIMIT = 180000;
    const IMAGE_URL_LIMIT = 22 + 4 * Math.ceil(IMAGE_BYTE_LIMIT / 3);

    function validId(value) { return typeof value === 'string' && value.length > 0; }
    function ownValue(object, key) { return object != null && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined; }
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
    // Bounded structural admission, not full PNG/CRC validation or a decoder sandbox.
    function inspectImage(value) {
      const prefix = 'data:image/png;base64,';
      if (typeof value !== 'string' || value.length > IMAGE_URL_LIMIT || !value.startsWith(prefix)) return { error: 'invalid' };
      const encoded = value.slice(prefix.length);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return { error: 'invalid' };
      let bytes;
      try { bytes = atob(encoded); } catch { return { error: 'invalid' }; }
      if (bytes.length > IMAGE_BYTE_LIMIT || bytes.length < 33 || bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n') return { error: 'invalid' };
      const u32 = offset => ((bytes.charCodeAt(offset) * 0x1000000) + (bytes.charCodeAt(offset + 1) << 16) + (bytes.charCodeAt(offset + 2) << 8) + bytes.charCodeAt(offset + 3));
      if (u32(8) !== 13 || bytes.slice(12, 16) !== 'IHDR') return { error: 'invalid' };
      const width = u32(16), height = u32(20);
      if (!width || !height) return { error: 'invalid' };
      if (width > 2048 || height > 2048) return { error: 'dimensions' };
      for (let offset = 8; offset < bytes.length;) {
        if (bytes.length - offset < 12) return { error: 'invalid' };
        const length = u32(offset), type = bytes.slice(offset + 4, offset + 8);
        if (length > bytes.length - offset - 12) return { error: 'invalid' };
        if (type === 'IHDR' && offset !== 8) return { error: 'invalid' };
        if (['acTL', 'fcTL', 'fdAT', 'iCCP', 'zTXt', 'iTXt'].includes(type)) return { error: 'invalid' };
        offset += length + 12;
        if (type === 'IEND') return length === 0 && offset === bytes.length ? { width, height } : { error: 'invalid' };
      }
      return { error: 'invalid' };
    }
    function validImage(value) { return !inspectImage(value).error; }
    // JSON.parse has already validated syntax; only whitespace outside strings is ignored.
    function compactJsonWhitespace(text) {
      let compact = '', inString = false, escaped = false;
      for (const char of text) {
        if (inString) {
          compact += char;
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
        } else if (char === '"') { inString = true; compact += char; }
        else if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') compact += char;
      }
      return compact;
    }
    function readImageData(storage) {
      try {
        if (!storage) return { ok: false, raw: {} };
        const stored = storage.getItem(IMAGE_KEY);
        if (stored === null) return { ok: true, raw: {} };
        const raw = JSON.parse(stored);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, raw: {} };
        if (compactJsonWhitespace(stored) !== JSON.stringify(raw)) return { ok: false, raw: {} };
        return { ok: true, raw };
      } catch { return { ok: false, raw: {} }; }
    }
    function visibleImages(raw) {
      return Object.fromEntries(Object.entries(raw).filter(([type, value]) => TYPES.includes(type) && validImage(value)));
    }
    function readCustomImages(storage) { return visibleImages(readImageData(storage).raw); }
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
      return ownValue(prefs, row.id) ?? matchType(row.role) ?? matchType(row.agentPreset) ?? matchType(row.title) ?? 'lead';
    }
    /* LINEAGE_SOURCE */ null /* END_LINEAGE_SOURCE */
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
      const [imageData, setImageData] = React.useState(() => {
        const loaded = readImageData(getStorage());
        return { ...loaded, visible: visibleImages(loaded.raw) };
      });
      const images = imageData.visible;
      const [imageType, setImageType] = React.useState('lead');
      const [notice, setNotice] = React.useState(null);
      const [focusKey, setFocusKey] = React.useState(null);
      const treeRef = React.useRef(null);
      const [brokenImages, setBrokenImages] = React.useState({});
      const lifecycle = React.useRef({ active: false, generation: 0 });
      const refreshIntents = React.useRef(new Map());
      const imageOperations = React.useRef(null);
      if (!imageOperations.current) imageOperations.current = { data: imageData, versions: new Map(), revisions: new Map(), notice: 0 };
      React.useLayoutEffect(() => {
        const current = lifecycle.current;
        current.active = true;
        return () => {
          current.active = false; current.generation++; refreshIntents.current.clear();
          imageOperations.current.versions.clear(); imageOperations.current.notice++;
        };
      }, []);
      const rows = buildRows(list, expanded, new Set(archivedIds ?? []), statuses);
      const tabStop = rows.some(item => item.rowKey === focusKey) ? focusKey : rows[0]?.rowKey;

      function clearFailures(ids) {
        setFailures(current => { const next = { ...current }; for (const id of ids) delete next[id]; return next; });
      }
      function trackRefresh(id, operation) {
        const token = Symbol(), current = lifecycle.current, generation = current.generation;
        const valid = () => current.active && current.generation === generation && refreshIntents.current.get(id) === token;
        refreshIntents.current.set(id, token);
        clearFailures([id]);
        const result = Promise.resolve().then(() => { if (valid()) return operation(); });
        result.then(() => {
          if (valid()) refreshIntents.current.delete(id);
        }, error => {
          if (valid()) {
            refreshIntents.current.delete(id);
            setFailures(previous => ({ ...previous, [id]: error?.message ?? String(error) }));
          }
        }).catch(() => {});
      }
      function toggle(row) {
        if (!row.expandable) return;
        const next = new Set(expanded);
        // Apply the same visible-only Set updates without issuing a host request yet.
        toggleBranch(row, next, () => undefined, rows).catch(() => {});
        if (row.expanded) {
          const closed = new Set([...expanded].filter(id => !next.has(id)));
          const index = rows.findIndex(candidate => candidate.rowKey === row.rowKey);
          for (let i = index + 1; i < rows.length && rows[i].level > row.level; i++) {
            if (!rows[i].ambiguous) closed.add(rows[i].id);
          }
          for (const id of closed) refreshIntents.current.delete(id);
          clearFailures(closed);
        } else trackRefresh(row.id, () => retryBranch(row.id, refreshProjection));
        expansion.clear();
        for (const id of next) expansion.add(id);
        setExpanded(next);
      }
      function retry(id) {
        trackRefresh(id, () => retryBranch(id, refreshProjection));
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
        if (type === '') delete next[id]; else if (TYPES.includes(type)) Object.defineProperty(next, id, {value:type, enumerable:true, writable:true, configurable:true});
        if (!saveAvatarPrefs(getStorage(), next)) { setNotice({ key: 'preferencesError' }); return; }
        setPrefs(next); setNotice({ key: 'preferencesSaved' });
      }
      function beginImageOperation(type) {
        const current = imageOperations.current, life = lifecycle.current, generation = life.generation, version = Symbol();
        current.versions.set(type, version);
        const notice = ++current.notice;
        const valid = () => life.active && life.generation === generation && current.versions.get(type) === version;
        return { current, valid, tell: value => { if (valid() && current.notice === notice) setNotice(value); } };
      }
      function commitImage(operation, type, value, reset) {
        if (!operation.valid()) return;
        const current = operation.current;
        if (!current.data.ok) { operation.tell({ key: 'imageSaveError' }); return; }
        const raw = { ...current.data.raw };
        if (reset) delete raw[type]; else Object.defineProperty(raw, type, { value, enumerable: true, writable: true, configurable: true });
        if (!saveCustomImages(getStorage(), raw)) { operation.tell({ key: 'imageSaveError' }); return; }
        const visible = { ...current.data.visible };
        if (reset) delete visible[type]; else visible[type] = value;
        current.data = { ok: true, raw, visible };
        current.revisions.set(type, (current.revisions.get(type) ?? 0) + 1);
        setImageData(current.data);
        operation.tell({ key: reset ? 'imageReset' : 'imageSaved', type });
      }
      function changeImage(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const selectedType = imageType, operation = beginImageOperation(selectedType);
        operation.tell({ key: 'imageValidating' });
        if (file.type !== 'image/png' || file.size > IMAGE_BYTE_LIMIT) { operation.tell({ key: 'imageInvalidSize' }); return; }
        let settled = false;
        try {
          const reader = new FileReader();
          reader.onerror = () => { if (settled) return; settled = true; operation.tell({ key: 'imageReadError' }); };
          reader.onload = () => {
            if (settled) return;
            settled = true;
            if (!operation.valid()) return;
            const value = reader.result, info = inspectImage(value);
            if (info.error) { operation.tell({ key: info.error === 'dimensions' ? 'imageDimensions' : 'imageInvalid' }); return; }
            try {
              const image = new Image();
              image.src = value;
              if (typeof image.decode !== 'function') { operation.tell({ key: 'imageInvalid' }); return; }
              const decoded = image.decode();
              if (!decoded || typeof decoded.then !== 'function') { operation.tell({ key: 'imageInvalid' }); return; }
              Promise.resolve(decoded).then(() => {
                if (!operation.valid()) return;
                if (image.naturalWidth !== info.width || image.naturalHeight !== info.height) { operation.tell({ key: 'imageInvalid' }); return; }
                commitImage(operation, selectedType, value, false);
              }, () => operation.tell({ key: 'imageInvalid' })).catch(() => {});
            } catch { operation.tell({ key: 'imageInvalid' }); }
          };
          reader.readAsDataURL(file);
        } catch { if (!settled) { settled = true; operation.tell({ key: 'imageReadError' }); } }
      }
      function resetImage() {
        const operation = beginImageOperation(imageType);
        commitImage(operation, imageType, undefined, true);
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
        const customImage = images[type], imageRevision = imageOperations.current.revisions.get(type) ?? 0;
        const showCustom = Boolean(customImage) && brokenImages[type] !== imageRevision;
        const target = navigationTarget(row);
        const stateText = [t(`status.${row.status}`), row.migrationRequired && t('migration'), row.external && t('external'), row.unknownMode && t('unknownMode'), row.ambiguous && t('ambiguous'), target === null && t('cannotOpen'), row.depthLimit && t('depthLimit'), row.model, `L${row.level - 1}`].filter(Boolean).join(' · ');
        const error = ownValue(failures, row.id) ?? row.error ?? (row.catalogState === 'error' ? t('catalogReadError') : undefined);
        const label = row.title;
        const indicator = row.expanded && (error ? h('div', { className: 'branch-note error', role: 'alert', style: { marginLeft: `${row.level * 20}px` } }, t('catalogError', { error }), h('button', { type: 'button', onClick: () => retry(row.id) }, t('retry')))
          : row.catalogState === 'unavailable' ? h('div', { className: 'branch-note', style: { marginLeft: `${row.level * 20}px` } }, t('catalogUnavailable'))
          : row.catalogState === 'loading' || row.catalogState === 'unloaded' || row.catalogState === 'unknown' ? h('div', { className: 'branch-note', role: 'status', style: { marginLeft: `${row.level * 20}px` } }, t(row.catalogState === 'unknown' ? 'catalogUnknown' : 'catalogLoading'), h('button', { type: 'button', onClick: () => retry(row.id) }, t('retry'))) : null);
        return h(React.Fragment, { key: row.rowKey }, h('div', {
          className: `row ${row.level === 1 ? 'root-row' : ''}`,
          style: { marginLeft: `${(row.level - 1) * 20}px` }, role: 'treeitem',
          tabIndex: tabStop === row.rowKey ? 0 : -1,
          'data-session-id': row.id, 'data-row-key': row.rowKey, 'aria-level': row.level, 'aria-posinset': row.posInSet, 'aria-setsize': row.setSize,
          'aria-expanded': row.expandable ? row.expanded : undefined,
          'aria-disabled': row.ambiguous || undefined, 'aria-label': t('rowLabel', { title: label, state: stateText }),
          onFocus: event => { if (event.target === event.currentTarget) setFocusKey(row.rowKey); },
          onKeyDown: event => treeKeys(event, row),
          onClick: event => { if (event.target === event.currentTarget) navigate(row); }
        }, h('button', { type: 'button', className: 'caret', tabIndex: -1, disabled: !row.expandable, 'aria-label': t(row.expanded ? 'collapse' : 'expand', { title: label }), onClick: event => { toggle(row); event.currentTarget.closest('[role="treeitem"]')?.focus(); } }, row.expandable ? (row.expanded ? '▾' : '▸') : '·'),
        h('img', { key: `${type}:${imageRevision}:${showCustom ? 'custom' : 'default'}`, className: 'image', src: showCustom ? customImage : DEFAULT_IMAGES[type], alt: '',
          onError: showCustom ? () => {
            const current = imageOperations.current;
            if (!lifecycle.current.active || (current.revisions.get(type) ?? 0) !== imageRevision || current.data.visible[type] !== customImage) return;
            setBrokenImages(previous => ({ ...previous, [type]: imageRevision }));
          } : undefined }),
        h('button', { type: 'button', className: 'body', tabIndex: -1, disabled: target === null, onClick: () => navigate(row) },
          h('span', { className: `dot ${row.status}`, 'aria-hidden': true }), h('span', { className: 'bodytext' }, h('span', { className: 'title' }, label), h('span', { className: 'meta' }, stateText))),
        h('select', { className: 'avatar-select', disabled: row.ambiguous, 'aria-label': t('changeAvatar', { title: label }), value: ownValue(prefs, row.id) ?? '', onChange: event => changeAvatar(row.id, event.target.value) },
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
