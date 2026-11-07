window.__ModuleLoader__.load({
  id: '@local/dsh-computer-use-manager',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    // Lucide icon geometry is ISC licensed; see THIRD_PARTY_NOTICES.
    const paths = {
      refresh: [['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }], ['path', { d: 'M21 3v5h-5' }], ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }], ['path', { d: 'M8 16H3v5' }]],
      download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '7 10 12 15 17 10' }], ['line', { x1: 12, x2: 12, y1: 15, y2: 3 }]],
      check: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'm9 12 2 2 4-4' }]],
      warning: [['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }], ['path', { d: 'M12 9v4' }], ['path', { d: 'M12 17h.01' }]],
      close: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
      monitor: [['rect', { width: 20, height: 14, x: 2, y: 3, rx: 2 }], ['line', { x1: 8, x2: 16, y1: 21, y2: 21 }], ['line', { x1: 12, x2: 12, y1: 17, y2: 21 }]],
    };
    function Icon({ name, size = 14, ...props }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false, ...props },
        paths[name].map(([tag, attributes], key) => h(tag, { ...attributes, key })));
    }
    const icon = name => props => h(Icon, { ...props, name });
    function Button({ icon: leading, children, variant = 'outline', size, className = '', ...props }) {
      return h('button', { type: 'button', ...props, className: 'cum-button ' + className, 'data-variant': variant }, leading, children);
    }
    function Switch({ checked, disabled, label, onChange }) {
      return h('button', { type: 'button', className: 'cum-switch', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled, onClick: () => onChange(!checked) }, h('span', { 'aria-hidden': true }));
    }
    function Tooltip({ children, label }) {
      const id = React.useId();
      const [open, setOpen] = React.useState(false);
      const timer = React.useRef(null);
      const hide = () => { clearTimeout(timer.current); setOpen(false); };
      React.useEffect(() => () => clearTimeout(timer.current), []);
      return h('span', { className: 'cum-tooltip-anchor', onMouseEnter: () => { timer.current = setTimeout(() => setOpen(true), 400); }, onMouseLeave: hide, onFocus: () => { clearTimeout(timer.current); setOpen(true); }, onBlur: hide, onKeyDown: event => { if (event.key === 'Escape') hide(); } },
        React.cloneElement(children, { 'aria-describedby': open ? id : undefined }),
        open ? h('span', { className: 'cum-tooltip', id, role: 'tooltip' }, label) : null);
    }
    function Modal({ title, children, footer, onClose, closeLabel, returnFocus, className = '' }) {
      const dialog = React.useRef(null);
      const close = React.useRef(onClose);
      close.current = onClose;
      const titleId = React.useId();
      const descriptionId = React.useId();
      React.useLayoutEffect(() => {
        const previous = returnFocus || document.activeElement;
        const page = dialog.current.closest('.cum-page');
        const bodyOverflow = document.body.style.overflow;
        const pageOverflow = page.style.overflow;
        document.body.style.overflow = 'hidden';
        page.style.overflow = 'hidden';
        const focusable = () => [...dialog.current.querySelectorAll('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(element => element.getClientRects().length);
        const initial = () => dialog.current.querySelector('[data-modal-autofocus]') || focusable()[0] || dialog.current;
        initial().focus({ preventScroll: true });
        const keyboard = event => {
          if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close.current(); }
          if (event.key !== 'Tab') return;
          const items = focusable();
          const first = items[0] || dialog.current;
          const last = items.at(-1) || dialog.current;
          if (!dialog.current.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last) || (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current))) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
        };
        const focus = event => { if (dialog.current && !dialog.current.contains(event.target)) initial().focus({ preventScroll: true }); };
        document.addEventListener('keydown', keyboard, true);
        document.addEventListener('focusin', focus, true);
        return () => {
          document.removeEventListener('keydown', keyboard, true);
          document.removeEventListener('focusin', focus, true);
          document.body.style.overflow = bodyOverflow;
          page.style.overflow = pageOverflow;
          queueMicrotask(() => { if (previous?.isConnected && !previous.disabled) previous.focus({ preventScroll: true }); });
        };
      }, []);
      return h('div', { className: 'cum-backdrop', onClick: event => { if (event.target === event.currentTarget) close.current(); } },
        h('div', { ref: dialog, className: 'cum-modal ' + className, role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId, 'aria-describedby': descriptionId, tabIndex: -1 },
          h('header', { className: 'cum-modal-header' }, h('h2', { id: titleId }, title), h(Button, { className: 'cum-modal-close', 'aria-label': closeLabel, 'data-dialog-close': true, onClick: () => close.current(), icon: h(Icon, { name: 'close', size: 16 }) })),
          h('div', { id: descriptionId }, children), h('footer', { className: 'cum-modal-footer' }, footer)));
    }
    const UI = { Button, Switch, Tooltip, Modal,
      StateDot: ({ state }) => h('span', { className: 'cum-dot', 'data-state': state, 'aria-hidden': true }),
      IconRefreshOutlineRegular: icon('refresh'), IconDownloadOutlineRegular: icon('download'), IconCheckCircleFillRegular: icon('check'), IconWarningOutlineRegular: icon('warning'), IconPluginPinwheelOutlineRegular: icon('monitor'),
    };
    const NS = 'computerUseManager';
    const PANEL = 'computer-use-manager';
    const DICTS = {
      zh: {
        title: '电脑操作能力', refresh: '刷新状态', loading: '正在读取状态', retry: '重试',
        enabled: '已启用', disabled: '已停用', enable: '启用电脑操作能力', configured: '配置', runtime: '运行状态',
        running: '运行中', incompatible: '版本不兼容', failed: '运行失败', waiting: '等待服务', missing: '尚未安装', unknown: '未知',
        runtimeVersion: 'DSH 版本', platform: '平台', provider: '工具提供方', toolCount: '可用工具',
        updatedAt: '状态更新', never: '尚未检查', none: '无', service: '服务', packages: '组件版本',
        package: '组件', installed: '已安装', target: 'DSH 匹配版本', compatibility: '兼容性', compatible: '兼容',
        versionMismatch: '版本不一致', checkUpdates: '检查兼容组件', update: '安装匹配版本', unchecked: '尚未检查',
        checking: '正在检查', current: '已匹配当前 DSH', available: '有匹配版本可安装', unavailable: '暂不可用', error: '检查失败',
        updateStatus: '组件匹配状态', lastCheck: '上次检查', health: '健康自检', runHealth: '运行自检',
        ok: '正常', degraded: '部分异常', healthFailed: '异常', healthUnavailable: '自检不可用', noHealth: '尚未运行自检',
        check: '检查项', result: '结果', details: '详情', pass: '通过', fail: '失败', skip: '已跳过', warn: '警告',
        operation: '当前操作', history: '操作记录', noHistory: '暂无操作记录', time: '时间', action: '操作',
        setEnabled: '切换启用状态', checkUpdatesAction: '检查兼容组件', updateAction: '安装匹配版本', healthAction: '健康自检',
        done: '已完成', operationFailed: '失败', restartRequired: '需要重启 DSH', operationRunning: '进行中',
        logs: '操作日志', disableTitle: '停用电脑操作能力？', disableDescription: '停用会影响当前配置下的所有会话。',
        disableConfirm: '确认停用', updateTitle: '安装匹配当前 DSH 的组件？',
        updateDescription: '将组件对齐到当前 DSH 版本，影响当前配置下的所有会话；完成后可能需要重启 DSH。',
        updateConfirm: '确认安装', cancel: '取消', connectionError: '无法读取最新状态', stale: '保留上次读取的状态',
        requestFailed: '请求失败', noPackages: '暂无组件信息', noProvider: '未注册',
        enabledState: '启用状态', updateAt: '检查时间',
        activate: '启用电脑操作能力', warning: '需关注', needsConfirmation: '需要安装组件',
        phaseChecking: '正在检查本地组件', phaseInstalling: '正在安装组件', phaseEnabling: '正在启用服务', phaseWaiting: '等待服务就绪', phaseHealth: '正在运行自检',
        activateTitle: '安装组件并启用电脑操作能力？', activateDescription: '安装和启用将影响当前配置下的所有会话；完成后可能需要重启 DSH。',
        activateConfirm: '安装并启用', installVersion: '安装版本', installPackages: '安装组件',
      },
      en: {
        title: 'Computer Use Capability', refresh: 'Refresh status', loading: 'Loading status', retry: 'Retry',
        enabled: 'Enabled', disabled: 'Disabled', enable: 'Enable computer-use capability', configured: 'Configuration', runtime: 'Runtime status',
        running: 'Running', incompatible: 'Incompatible', failed: 'Failed', waiting: 'Waiting', missing: 'Not installed', unknown: 'Unknown',
        runtimeVersion: 'DSH version', platform: 'Platform', provider: 'Tool provider', toolCount: 'Available tools',
        updatedAt: 'Status updated', never: 'Not checked', none: 'None', service: 'Service', packages: 'Component versions',
        package: 'Component', installed: 'Installed', target: 'DSH-matching version', compatibility: 'Compatibility', compatible: 'Compatible',
        versionMismatch: 'Version mismatch', checkUpdates: 'Check compatible components', update: 'Install matching versions', unchecked: 'Not checked',
        checking: 'Checking', current: 'Matches current DSH', available: 'Matching versions available', unavailable: 'Unavailable', error: 'Check failed',
        updateStatus: 'Component alignment', lastCheck: 'Last checked', health: 'Health check', runHealth: 'Run health check',
        ok: 'Healthy', degraded: 'Degraded', healthFailed: 'Unhealthy', healthUnavailable: 'Unavailable', noHealth: 'No health check yet',
        check: 'Check', result: 'Result', details: 'Details', pass: 'Passed', fail: 'Failed', skip: 'Skipped', warn: 'Warning',
        operation: 'Current operation', history: 'Activity', noHistory: 'No activity yet', time: 'Time', action: 'Action',
        setEnabled: 'Change enablement', checkUpdatesAction: 'Check compatible components', updateAction: 'Install matching versions', healthAction: 'Health check',
        done: 'Completed', operationFailed: 'Failed', restartRequired: 'DSH restart required', operationRunning: 'In progress',
        logs: 'Operation log', disableTitle: 'Disable computer-use capability?', disableDescription: 'This affects every session in the current profile.',
        disableConfirm: 'Disable', updateTitle: 'Install components matching current DSH?',
        updateDescription: 'Align components with the current DSH version. This affects every session in the current profile and may require restarting DSH.',
        updateConfirm: 'Install', cancel: 'Cancel', connectionError: 'Unable to read the latest status', stale: 'Showing the last successful status',
        requestFailed: 'Request failed', noPackages: 'No component information', noProvider: 'Not registered',
        enabledState: 'Enablement', updateAt: 'Checked at',
        activate: 'Enable computer-use capability', warning: 'Needs attention', needsConfirmation: 'Component installation required',
        phaseChecking: 'Checking local components', phaseInstalling: 'Installing components', phaseEnabling: 'Enabling service', phaseWaiting: 'Waiting for readiness', phaseHealth: 'Running health check',
        activateTitle: 'Install components and enable computer use?', activateDescription: 'Installation and enablement affect every session in the current profile and may require restarting DSH.',
        activateConfirm: 'Install and enable', installVersion: 'Install version', installPackages: 'Components to install',
      },
    };
    const CSS = `
.cum-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;min-width:32px;max-width:100%;padding:5px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:center;overflow-wrap:anywhere;cursor:pointer;flex-shrink:0}
.cum-button>svg{flex:none}.cum-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.cum-button[data-variant=primary]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}.cum-button[data-variant=primary]:hover:not(:disabled){background:var(--dsw-alias-brand-primary)}.cum-button:disabled,.cum-switch:disabled{opacity:.5;cursor:default}.cum-button:focus-visible,.cum-switch:focus-visible,.cum-table-wrap:focus-visible,.cum-log summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.cum-switch{appearance:none;display:block;width:36px;height:20px;flex:none;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-state-idle-primary);cursor:pointer}.cum-switch>span{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .12s}.cum-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}.cum-switch[aria-checked=true]>span{transform:translateX(16px)}
.cum-dot{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:none}.cum-dot:before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}.cum-dot[data-state=ongoing]:before{width:10px;height:10px;background:none;border:1.5px solid var(--dsw-alias-border-l1);border-top-color:var(--dsw-alias-brand-primary);animation:cum-spin .8s linear infinite}@keyframes cum-spin{to{transform:rotate(360deg)}}
.cum-tooltip-anchor{position:relative;display:inline-flex;flex:none}.cum-tooltip{position:absolute;right:0;top:calc(100% + 7px);z-index:20;width:max-content;max-width:min(240px,calc(100vw - 32px));padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere;pointer-events:none}
.cum-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--dsw-alias-bg-overlay);overscroll-behavior:contain}.cum-modal{padding:22px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:none}.cum-modal-header{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;margin-bottom:14px}.cum-modal-header h2{font-size:17px;line-height:24px;font-weight:600;margin:0;min-width:0}.cum-modal-close{width:28px;min-width:28px;min-height:28px;height:28px;padding:0;border:0;flex:none}.cum-modal-footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:22px}.cum-modal-footer .cum-button{flex-shrink:1;min-width:60px}
@media(prefers-reduced-motion:reduce){.cum-switch>span{transition:none}.cum-dot[data-state=ongoing]:before{animation:none}}
.cum-page{height:100%;min-width:0;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.55;letter-spacing:0;box-sizing:border-box}
.cum-page *{box-sizing:border-box;letter-spacing:0}
.cum-inner{width:100%;max-width:1120px;margin:0 auto;padding:28px 32px 40px}
.cum-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:22px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.cum-header h1{margin:0;font-size:22px;line-height:30px;font-weight:600}.cum-subtle{color:var(--dsw-alias-label-secondary);font-size:12px}.cum-header-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:7px;min-height:20px}
.cum-section{padding:22px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.cum-section-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px}.cum-section h2{margin:0;font-size:15px;font-weight:600;line-height:24px}.cum-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.cum-service-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.cum-status{display:inline-flex;align-items:center;gap:7px;min-width:0;font-size:13px}.cum-status>span:last-child{overflow-wrap:anywhere}.cum-status[data-tone=success]{color:var(--dsw-alias-state-success-primary)}.cum-status[data-tone=error]{color:var(--dsw-alias-state-error-primary)}.cum-status[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}.cum-status[data-tone=idle]{color:var(--dsw-alias-label-secondary)}
.cum-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px 24px;margin:0}.cum-facts div{min-width:0}.cum-facts dt{margin:0 0 5px;color:var(--dsw-alias-label-secondary);font-size:12px}.cum-facts dd{margin:0;overflow-wrap:anywhere;font-size:13px}.cum-code{font-family:monospace;font-size:12px;overflow-wrap:anywhere}
.cum-note{display:flex;align-items:flex-start;gap:8px;margin-top:14px;overflow-wrap:anywhere}.cum-note>svg{flex:none;margin-top:3px}.cum-note[data-tone=error]{color:var(--dsw-alias-state-error-primary)}.cum-note[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}.cum-note p{margin:0}.cum-notice{padding:12px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.cum-table-wrap{max-width:100%;overflow:auto}.cum-table{width:100%;border-collapse:collapse;table-layout:fixed;text-align:left}.cum-table th{padding:9px 12px 9px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}.cum-table td{vertical-align:top;padding:12px 12px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-wrap:anywhere}.cum-table th:last-child,.cum-table td:last-child{padding-right:0}.cum-table tbody tr:last-child td{border-bottom:0}.cum-package-name{font-weight:500;margin-bottom:3px}.cum-table .cum-status{font-size:12px}.cum-packages th:first-child{width:43%}.cum-packages th:not(:first-child){width:19%}.cum-health th:first-child{width:27%}.cum-health th:nth-child(2){width:15%}.cum-history th:first-child{width:23%}.cum-history th:nth-child(2){width:18%}.cum-history th:nth-child(3){width:17%}
.cum-inline-facts{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;margin:0 0 14px;color:var(--dsw-alias-label-secondary);font-size:12px}.cum-inline-facts strong{font-weight:400;color:var(--dsw-alias-label-primary)}.cum-empty{margin:8px 0;color:var(--dsw-alias-label-secondary);font-size:13px}.cum-log{margin-top:12px}.cum-log summary{cursor:pointer;width:fit-content;color:var(--dsw-alias-label-secondary);font-size:12px}.cum-log pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);font-family:monospace;font-size:12px}.cum-dialog{width:min(480px,calc(100vw - 32px));max-width:100%;max-height:calc(100vh - 48px);overflow:auto;overflow-wrap:anywhere}.cum-dialog-message{margin:0;line-height:1.7}.cum-install-target{margin:16px 0 0;min-width:0}.cum-install-target dt{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:12px}.cum-install-target dd{margin:4px 0 0;min-width:0}.cum-install-list{margin:0;padding-left:18px}.cum-install-list li{padding:3px 0;overflow-wrap:anywhere}.cum-install-list code{white-space:normal;word-break:break-word}.cum-refresh{width:32px;height:32px;padding:0;flex:none}
@media(max-width:760px){.cum-inner{padding:22px 20px 32px}.cum-facts{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.cum-header{padding-bottom:18px}.cum-section{padding:18px 0}.cum-packages{min-width:590px}.cum-health{min-width:510px}.cum-history{min-width:620px}}
@media(max-width:400px){.cum-inner{padding:18px 14px 28px}.cum-service-row{gap:10px}.cum-header h1{font-size:20px}.cum-section-head{align-items:flex-start}.cum-actions{gap:6px}}
`;
    function useTexts(ctx) {
      React.useSyncExternalStore(callback => ctx.locale.subscribe(callback), () => ctx.locale.getSnapshot());
      return ctx.locale.bind(NS);
    }
    function formatTime(value, language) {
      if (value === null || value === undefined || value === '') return null;
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return String(value);
      return date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
    function tone(status) {
      if (['running', 'ok', 'pass', 'current', 'compatible', 'done'].includes(status)) return 'success';
      if (['failed', 'fail', 'error', 'incompatible'].includes(status)) return 'error';
      if (['degraded', 'warn', 'warning', 'needs-confirmation', 'available', 'restart-required', 'waiting'].includes(status)) return 'warn';
      return 'idle';
    }
    function Status({ status, children }) {
      const state = ['checking', 'ongoing'].includes(status) ? 'ongoing' : tone(status) === 'error' ? 'error' : 'idle';
      return h('span', { className: 'cum-status', 'data-tone': tone(status) }, h(UI.StateDot, { state, size: 12 }), h('span', null, children));
    }
    function Page({ ctx }) {
      const t = useTexts(ctx);
      const locale = ctx.locale.getSnapshot().active;
      const language = String(locale).startsWith('zh') ? 'zh' : 'en';
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState('');
      const [fetching, setFetching] = React.useState(false);
      const [confirmation, setConfirmation] = React.useState(null);
      const confirmationOpen = React.useRef(false);
      confirmationOpen.current = !!confirmation;
      const focusReturn = React.useRef(null);
      const root = React.useRef(null);
      const alive = React.useRef(false);
      const activeRequest = React.useRef(null);
      const activationAttempt = React.useRef(null);
      const showTime = value => formatTime(value, language) || t('never');
      const visible = () => document.visibilityState === 'visible' && !!root.current?.getClientRects().length;
      const request = React.useCallback(async (action, args = {}) => {
        if (!alive.current || activeRequest.current) return;
        const controller = new AbortController();
        activeRequest.current = controller;
        setFetching(true);
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const response = await fetch(new URL('api/computer-use-manager', document.baseURI), {
            credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
            ...(action ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DSH-Computer-Use-Manager': '1' }, body: JSON.stringify({ action, ...args }) } : {}),
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok || !payload.value || typeof payload.value !== 'object') throw new Error(payload.error || 'HTTP ' + response.status);
          if (alive.current) {
            if (action === 'activate' && payload.value.operation?.kind === 'activate') activationAttempt.current = payload.value.operation.id;
            setState(payload.value);
            setError('');
          }
        } catch (failure) {
          if (alive.current) setError(failure.name === 'AbortError' ? 'HTTP timeout' : String(failure.message || failure));
        } finally {
          clearTimeout(timeout);
          if (activeRequest.current === controller) activeRequest.current = null;
          if (alive.current) setFetching(false);
        }
      }, []);
      React.useEffect(() => {
        alive.current = true;
        const refresh = () => { if (!confirmationOpen.current && visible()) void request(); };
        refresh();
        const interval = setInterval(refresh, 3000);
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('focus', refresh);
        return () => {
          alive.current = false;
          clearInterval(interval);
          document.removeEventListener('visibilitychange', refresh);
          window.removeEventListener('focus', refresh);
          activeRequest.current?.abort();
          activationAttempt.current = null;
        };
      }, [request]);
      React.useEffect(() => {
        const operation = state?.operation;
        if (!activationAttempt.current) return;
        if (operation?.id !== activationAttempt.current || operation.kind !== 'activate') {
          activationAttempt.current = null;
          setConfirmation(current => current?.kind === 'activate' ? null : current);
          return;
        }
        const approval = operation.confirmation;
        if (operation.status === 'needs-confirmation' && approval?.approvalId && approval.version && Array.isArray(approval.packages) && approval.packages.length) {
          setConfirmation(current => current?.kind === 'activate' && current.operationId === operation.id && current.approval.approvalId === approval.approvalId ? current : { kind: 'activate', operationId: operation.id, approval });
        } else if (operation.status !== 'running') {
          activationAttempt.current = null;
          setConfirmation(current => current?.kind === 'activate' ? null : current);
        }
      }, [state]);
      const configuredEnabled = state?.configurationKnown === false ? null : state?.configuredEnabled;
      const operationRunning = state?.operation?.status === 'running';
      const locked = fetching || operationRunning || !state || !!error;
      const actionLabel = kind => t(({ activate: 'activate', setEnabled: 'setEnabled', checkUpdates: 'checkUpdatesAction', update: 'updateAction', health: 'healthAction' })[kind] || 'unknown');
      const operationLabel = status => t(({ running: 'operationRunning', failed: 'operationFailed', 'restart-required': 'restartRequired', 'needs-confirmation': 'needsConfirmation', warning: 'warning' })[status] || status || 'unknown');
      const healthLabel = status => t(({ failed: 'healthFailed', unavailable: 'healthUnavailable' })[status] || status || 'unknown');
      const button = (key, onClick, icon, extra = {}) => h(UI.Button, { variant: 'outline', size: 'sm', disabled: locked, onClick, ...(icon ? { icon: h(icon, { size: 14 }) } : {}), ...extra }, t(key));
      const fact = (key, value, code = false) => h('div', { key }, h('dt', null, t(key)), h('dd', { className: code ? 'cum-code' : undefined }, value ?? t('none')));
      const note = (text, status = 'warn') => text ? h('div', { className: 'cum-note', 'data-tone': status }, h(UI.IconWarningOutlineRegular, { size: 14, 'aria-hidden': true }), h('p', null, text)) : null;
      const begin = (action, args) => {
        activationAttempt.current = null;
        setConfirmation(null);
        void request(action, args);
      };
      const dismissConfirmation = () => {
        if (confirmation?.kind === 'activate') activationAttempt.current = null;
        setConfirmation(null);
      };
      const confirmAction = () => {
        if (confirmation?.kind === 'activate') {
          const approval = confirmation.approval;
          if (activationAttempt.current !== confirmation.operationId || state?.operation?.status !== 'needs-confirmation' || state.operation.confirmation?.approvalId !== approval.approvalId) return dismissConfirmation();
          begin('activate', { installVersion: approval.version, approvalId: approval.approvalId });
        } else if (confirmation?.kind === 'disable') begin('setEnabled', { enabled: false });
        else begin('update');
      };
      const phaseLabel = phase => t(({ checking: 'phaseChecking', installing: 'phaseInstalling', enabling: 'phaseEnabling', waiting: 'phaseWaiting', health: 'phaseHealth' })[phase] || 'operationRunning');
      const packages = Array.isArray(state?.packages) ? state.packages : [];
      const checks = Array.isArray(state?.health?.checks) ? state.health.checks : [];
      const history = Array.isArray(state?.history) ? state.history.slice(0, 12) : [];
      const update = state?.update || { status: 'unchecked' };
      const log = state?.operation?.log;
      const logText = Array.isArray(log) ? log.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n') : typeof log === 'string' ? log : log ? JSON.stringify(log, null, 2) : '';
      return h('div', { ref: root, className: 'cum-page', 'data-computer-use-manager': true },
        h('style', null, CSS),
        h('div', { className: 'cum-inner', inert: !!confirmation, 'aria-hidden': confirmation ? true : undefined, onFocusCapture: event => { if (!confirmationOpen.current) focusReturn.current = event.target; } },
          h('header', { className: 'cum-header' },
            h('div', null, h('h1', null, t('title')),
              h('div', { className: 'cum-header-meta' },
                state ? h(Status, { status: state.status }, t(state.status || 'unknown')) : h(Status, { status: 'checking' }, t('loading')),
                h('span', { className: 'cum-subtle' }, t('updatedAt') + ': ' + showTime(state?.checkedAt)))),
            h(UI.Tooltip, { label: t('refresh'), side: 'bottom', delayMs: 400, focusDelayMs: 400, portal: true },
              h(UI.Button, { variant: 'outline', size: 'sm', className: 'cum-refresh', 'aria-label': t('refresh'), 'aria-busy': fetching, disabled: fetching, onClick: () => request(), icon: h(UI.IconRefreshOutlineRegular, { size: 15 }) }))),
          error ? h('div', { className: 'cum-notice', role: 'alert' },
            h('div', null, h('div', { className: 'cum-status', 'data-tone': 'error' }, t(state ? 'stale' : 'connectionError')), h('div', { className: 'cum-subtle' }, error)),
            button('retry', () => request(), UI.IconRefreshOutlineRegular, { disabled: fetching })) : null,
          state?.restartRequired || state?.operation?.status === 'restart-required' ? note(t('restartRequired')) : null,
          state ? h(React.Fragment, null,
            h('section', { className: 'cum-section', 'aria-label': t('service') },
              h('div', { className: 'cum-section-head' }, h('h2', null, t('service'))),
              h('div', { className: 'cum-service-row' },
                h('div', { className: 'cum-actions' }, h('span', null, t('configured')), h(Status, { status: configuredEnabled === true ? 'ok' : configuredEnabled === false ? 'disabled' : 'unknown' }, t(configuredEnabled === true ? 'enabled' : configuredEnabled === false ? 'disabled' : 'unknown'))),
                h(UI.Switch, { checked: configuredEnabled === true, disabled: locked || configuredEnabled === null, label: t('enable'), onChange: enabled => enabled ? begin('activate') : setConfirmation({ kind: 'disable' }) })),
              h('dl', { className: 'cum-facts' },
                fact('runtimeVersion', state.runtimeVersion, true), fact('platform', state.platform, true), fact('provider', state.provider || t('noProvider'), true), fact('toolCount', state.toolCount ?? 0)),
              state.reason ? note(state.reason, tone(state.status) === 'error' ? 'error' : 'warn') : null),
            h('section', { className: 'cum-section', 'aria-label': t('packages') },
              h('div', { className: 'cum-section-head' }, h('h2', null, t('packages')),
                h('div', { className: 'cum-actions' },
                  button('checkUpdates', () => begin('checkUpdates'), UI.IconRefreshOutlineRegular),
                  button('update', () => setConfirmation({ kind: 'update' }), UI.IconDownloadOutlineRegular, { disabled: locked || update.status !== 'available' }))),
              h('div', { className: 'cum-inline-facts' },
                h('span', null, t('updateStatus') + ': ', h(Status, { status: update.status }, t(update.status || 'unchecked'))),
                h('span', null, t('lastCheck') + ': ', h('strong', null, showTime(update.checkedAt)))),
              packages.length ? h('div', { className: 'cum-table-wrap', tabIndex: 0, role: 'region', 'aria-label': t('packages') },
                h('table', { className: 'cum-table cum-packages' }, h('thead', null, h('tr', null, ...['package', 'installed', 'target', 'compatibility'].map(key => h('th', { key, scope: 'col' }, t(key))))),
                  h('tbody', null, packages.map(item => h('tr', { key: item.name },
                    h('td', null, h('div', { className: 'cum-package-name' }, item.label || item.name), h('div', { className: 'cum-code cum-subtle' }, item.name)),
                    h('td', { className: 'cum-code' }, item.version || t('missing')), h('td', { className: 'cum-code' }, item.targetVersion || update.targetVersion || t('unknown')),
                    h('td', null, h(Status, { status: item.compatible ? 'compatible' : 'incompatible' }, t(item.compatible ? 'compatible' : 'versionMismatch')))))))) : h('p', { className: 'cum-empty' }, t('noPackages')),
              update.reason ? note(update.reason, update.status === 'error' ? 'error' : 'warn') : null),
            h('section', { className: 'cum-section', 'aria-label': t('health') },
              h('div', { className: 'cum-section-head' }, h('h2', null, t('health')), button('runHealth', () => begin('health'), UI.IconCheckCircleFillRegular)),
              state.health ? h(React.Fragment, null,
                h('div', { className: 'cum-inline-facts' }, h(Status, { status: state.health.overall }, healthLabel(state.health.overall)), h('span', null, t('updateAt') + ': ', h('strong', null, showTime(state.health.checkedAt)))),
                checks.length ? h('div', { className: 'cum-table-wrap', tabIndex: 0, role: 'region', 'aria-label': t('health') },
                  h('table', { className: 'cum-table cum-health' }, h('thead', null, h('tr', null, ...['check', 'result', 'details'].map(key => h('th', { key, scope: 'col' }, t(key))))),
                    h('tbody', null, checks.map((check, index) => h('tr', { key: check.name + index }, h('td', { className: 'cum-code' }, check.name), h('td', null, h(Status, { status: check.status }, healthLabel(check.status))), h('td', null, check.message || t('none'))))))) : null) : h('p', { className: 'cum-empty' }, t('noHealth'))),
            state.operation ? h('section', { className: 'cum-section', 'aria-label': t('operation'), 'aria-live': 'polite' },
              h('div', { className: 'cum-section-head' }, h('h2', null, t('operation')), h(Status, { status: operationRunning ? 'ongoing' : state.operation.status }, operationLabel(state.operation.status))),
              h('div', { className: 'cum-inline-facts' }, h('strong', null, actionLabel(state.operation.kind)), operationRunning && state.operation.phase ? h(Status, { status: 'ongoing' }, phaseLabel(state.operation.phase)) : null, h('span', null, showTime(state.operation.finishedAt || state.operation.startedAt))),
              h('div', { 'data-operation-message': true }, state.operation.message || t('none')),
              logText ? h('details', { className: 'cum-log' }, h('summary', null, t('logs')), h('pre', null, logText)) : null) : null,
            h('section', { className: 'cum-section', 'aria-label': t('history') },
              h('div', { className: 'cum-section-head' }, h('h2', null, t('history'))),
              history.length ? h('div', { className: 'cum-table-wrap', tabIndex: 0, role: 'region', 'aria-label': t('history') },
                h('table', { className: 'cum-table cum-history' }, h('thead', null, h('tr', null, ...['time', 'action', 'result', 'details'].map(key => h('th', { key, scope: 'col' }, t(key))))),
                  h('tbody', null, history.map((item, index) => h('tr', { key: item.time + ':' + index }, h('td', { className: 'cum-subtle' }, showTime(item.time)), h('td', null, actionLabel(item.kind)), h('td', null, h(Status, { status: item.status }, operationLabel(item.status))), h('td', null, item.message || t('none'))))))) : h('p', { className: 'cum-empty' }, t('noHistory')))) : null),
        confirmation ? h(UI.Modal, {
          open: true, returnFocus: focusReturn.current, className: 'cum-dialog', title: t(confirmation.kind === 'activate' ? 'activateTitle' : confirmation.kind === 'disable' ? 'disableTitle' : 'updateTitle'), closeLabel: t('cancel'), onClose: dismissConfirmation,
          footer: h(React.Fragment, null,
            button('cancel', dismissConfirmation, null, { disabled: false, 'data-modal-autofocus': true }),
            button(confirmation.kind === 'activate' ? 'activateConfirm' : confirmation.kind === 'disable' ? 'disableConfirm' : 'updateConfirm', confirmAction, null, { variant: 'primary' })),
        }, h('p', { className: 'cum-dialog-message' }, t(confirmation.kind === 'activate' ? 'activateDescription' : confirmation.kind === 'disable' ? 'disableDescription' : 'updateDescription')),
        confirmation.kind === 'activate' ? h('dl', { className: 'cum-install-target' },
          h('dt', null, t('installVersion')), h('dd', { className: 'cum-code' }, confirmation.approval.version),
          h('dt', null, t('installPackages')), h('dd', null, h('ul', { className: 'cum-install-list' }, confirmation.approval.packages.map(name => h('li', { key: name }, h('code', { className: 'cum-code' }, name)))))) : null) : null);
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTS));
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 21, label: () => t('title') }, ({ size }) => h(UI.IconPluginPinwheelOutlineRegular, { size, 'aria-hidden': true })));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, () => h(Page, { ctx })));
      },
    };
  },
});
