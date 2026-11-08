/**
 * Client half of @local/dsh-raccoon.
 *
 * Registers three surfaces in the Harness Web UI:
 *  - `sidebar.panellist` id `raccoon` — the left sidebar entry (icon + label);
 *  - `main` key `raccoon` — the full page the entry opens;
 *  - `conversation.input.right` id `raccoon-credits` — the composer credit pill.
 *
 * All data comes from the plugin's own Host routes under /raccoon; the browser
 * never sees the Raccoon access token.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-raccoon',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'raccoonConnect'
    const PANEL_ID = 'raccoon'
    const API = '/raccoon'
    const POLL_MS = 120000

    /** The client context, captured in apply(); used by the pill to navigate. */
    let appCtx = null

    const STRINGS = {
      zh: {
        panel: '小浣熊',
        pageTitle: '小浣熊接入',
        subtitle: '读取本机小浣熊客户端的登录态，查看积分与模型目录，并提供 OpenAI 兼容端点。',
        refresh: '刷新',
        refreshing: '刷新中',
        updatedAt: '更新时间',
        credits: '积分',
        available: '可用积分',
        topup: '企业充值积分',
        daily: '每日',
        reward: '奖励',
        resetUnavailable: '上游未提供',
        hiddenModelsPrefix: '另有 ',
        hiddenModelsSuffix: ' 个模型未在客户端展示',
        resetDate: '重置日期',
        account: '账号',
        personal: '个人',
        enterprise: '企业',
        tokenKind: '令牌类型',
        expiresAt: '到期时间',
        expiresInDays: '剩余',
        days: '天',
        expired: '已过期',
        models: '模型目录',
        model: '模型',
        context: '上下文',
        maxOutput: '最大输出',
        multiplier: '倍率',
        billing: '计费',
        status: '状态',
        billingNormal: '常规',
        billingDiscount: '折扣',
        billingLimitedFree: '限免',
        noModels: '没有读取出可用的对话模型。',
        diagnostics: '连通性自检',
        probeCatalog: '模型目录',
        probeCredits: '积分',
        probeChat: '测试对话',
        probeChatHint: '会消耗少量积分',
        run: '检测',
        running: '检测中',
        probeOk: '正常',
        probeFail: '失败',
        endpoint: '接入配置',
        providerId: 'Provider ID',
        protocol: '协议',
        apiKey: '本地密钥',
        keyUnavailable: '本地密钥读取失败，点刷新重试。',
        copy: '复制',
        copied: '已复制',
        reveal: '显示',
        hide: '隐藏',
        endpointHint:
          '在「设置 → 模型 → 添加模型提供商 → 自定义模型 API」中填入以下值，保存后点击「获取可用模型」。',
        riskNote:
          '非官方客户端接入：只使用你自己的登录态与积分，不共享凭据、不绕过计费。上游策略可能变化，账号风险请自行评估。',
        authMissing: '没有找到小浣熊登录文件。请先打开小浣熊客户端并登录，然后点刷新。',
        reauthHint: '打开小浣熊客户端重新登录，然后点刷新。',
        loading: '加载中…',
        retry: '重试',
        pillTitle: '小浣熊可用积分，点击查看详情',
        points: '积分',
        unknown: '未知',
        errorTitle: '请求失败',
      },
      en: {
        panel: 'Raccoon',
        pageTitle: 'Raccoon connection',
        subtitle:
          'Reads the local Raccoon desktop login, shows credits and the model catalog, and exposes an OpenAI-compatible endpoint.',
        refresh: 'Refresh',
        refreshing: 'Refreshing',
        updatedAt: 'Updated',
        credits: 'Credits',
        available: 'Available',
        topup: 'Enterprise top-up',
        daily: 'Daily',
        reward: 'Reward',
        resetUnavailable: 'not reported',
        hiddenModelsPrefix: '',
        hiddenModelsSuffix: ' more models are hidden in the client',
        resetDate: 'Resets',
        account: 'Account',
        personal: 'Personal',
        enterprise: 'Enterprise',
        tokenKind: 'Token kind',
        expiresAt: 'Expires',
        expiresInDays: 'In',
        days: 'days',
        expired: 'Expired',
        models: 'Model catalog',
        model: 'Model',
        context: 'Context',
        maxOutput: 'Max output',
        multiplier: 'Multiplier',
        billing: 'Billing',
        status: 'Status',
        billingNormal: 'Normal',
        billingDiscount: 'Discount',
        billingLimitedFree: 'Limited free',
        noModels: 'No usable chat model was read.',
        diagnostics: 'Connectivity',
        probeCatalog: 'Model catalog',
        probeCredits: 'Credits',
        probeChat: 'Chat',
        probeChatHint: 'Uses a few credits',
        run: 'Test',
        running: 'Testing',
        probeOk: 'OK',
        probeFail: 'Failed',
        endpoint: 'Endpoint for DSH',
        providerId: 'Provider ID',
        protocol: 'Protocol',
        apiKey: 'Local key',
        keyUnavailable: 'The local key could not be read. Refresh to retry.',
        copy: 'Copy',
        copied: 'Copied',
        reveal: 'Show',
        hide: 'Hide',
        endpointHint:
          'Add a provider in Settings -> Models -> Custom model API with the values below, save, then fetch the available models.',
        riskNote:
          'Unofficial client: this uses only your own login and credits. It never shares credentials and never bypasses billing; upstream policy can change, so assess the account risk yourself.',
        authMissing: 'No Raccoon login file was found. Open the Raccoon client, sign in, then refresh.',
        reauthHint: 'Open the Raccoon client and sign in again, then refresh.',
        loading: 'Loading…',
        retry: 'Retry',
        pillTitle: 'Raccoon available credits. Click for details.',
        points: 'credits',
        unknown: 'unknown',
        errorTitle: 'Request failed',
      },
    }

    const CSS = [
      '.rc-root{box-sizing:border-box;min-height:100%;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;',
      'padding:calc(var(--dsh-frame-top-clearance, 0px) + 28px) 32px 64px calc(var(--dsh-frame-leading-clearance, 0px) + 32px);}',
      '.rc-wrap{max-width:920px;margin:0 auto;}',
      '.rc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px;}',
      '.rc-title{margin:0;font-size:18px;font-weight:600;letter-spacing:.2px;}',
      '.rc-sub{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;max-width:640px;}',
      '.rc-actions{display:flex;align-items:center;gap:8px;flex:none;}',
      '.rc-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);',
      'border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer;transition:background .12s ease,border-color .12s ease;}',
      '.rc-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);}',
      '.rc-btn[disabled]{opacity:.55;cursor:default;}',
      '.rc-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base);}',
      '.rc-btn-primary:hover{filter:brightness(1.06);background:var(--dsw-alias-brand-primary);}',
      '.rc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:16px 18px;margin-bottom:14px;}',
      '.rc-card-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px;font-size:13px;font-weight:600;}',
      '.rc-row{display:flex;flex-wrap:wrap;gap:28px;}',
      '.rc-metric{min-width:150px;}',
      '.rc-kv{margin:6px 0 0;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px;}',
      '.rc-kv dt{color:var(--dsw-alias-label-secondary);}',
      '.rc-kv dd{margin:0;overflow-wrap:anywhere;}',
      '.rc-metric-value{font-size:26px;font-weight:650;letter-spacing:.3px;}',
      '.rc-metric-label{color:var(--dsw-alias-label-secondary);font-size:12px;}',
      '.rc-mono{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;}',
      '.rc-table{width:100%;border-collapse:collapse;font-size:12px;}',
      '.rc-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1);padding:6px 8px;white-space:nowrap;}',
      '.rc-table td{border-bottom:1px solid var(--dsw-alias-border-l1);padding:7px 8px;vertical-align:top;}',
      '.rc-table tr:last-child td{border-bottom:none;}',
      '.rc-table-scroll{max-height:360px;overflow:auto;}',
      '.rc-badge{display:inline-block;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 7px;margin:0 4px 4px 0;font-size:11px;color:var(--dsw-alias-label-secondary);}',
      '.rc-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);}',
      '.rc-badge-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}',
      '.rc-badge-err{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}',
      '.rc-note{color:var(--dsw-alias-label-secondary);font-size:12px;}',
      '.rc-err{border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;padding:10px 12px;margin-bottom:12px;color:var(--dsw-alias-label-primary);}',
      '.rc-err-code{color:var(--dsw-alias-state-error-primary);font-size:11px;}',
      '.rc-probes{display:flex;flex-wrap:wrap;gap:8px;}',
      '.rc-probe{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;min-width:180px;flex:1 1 180px;}',
      '.rc-probe-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:500;}',
      '.rc-probe-detail{color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:4px;overflow-wrap:anywhere;}',
      '.rc-pill{appearance:none;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;',
      'border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;}',
      '.rc-pill:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}',
      '.rc-pill-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);}',
      '.rc-pill-dot-warn{background:var(--dsw-alias-state-warn-primary);}',
      '.rc-pill-dot-err{background:var(--dsw-alias-state-error-primary);}',
      '.rc-endpoint-row{display:grid;grid-template-columns:120px 1fr auto;gap:8px;align-items:center;padding:5px 0;}',
      '.rc-endpoint-row+.rc-endpoint-row{border-top:1px solid var(--dsw-alias-border-l1);}',
      '@media (max-width:760px){.rc-root{padding-left:20px;padding-right:20px;}.rc-endpoint-row{grid-template-columns:1fr auto;}}',
    ].join('')

    function Styles() {
      return h('style', null, CSS)
    }

    function getJson(path, signal) {
      return fetch(path, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
      }).then((response) => {
        if (!response.ok) {
          return response.text().then((text) => {
            throw new Error(text ? `HTTP ${response.status}: ${text.slice(0, 200)}` : `HTTP ${response.status}`)
          })
        }
        return response.json()
      })
    }

    function formatNumber(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      try {
        return new Intl.NumberFormat().format(value)
      } catch {
        return String(value)
      }
    }

    function formatDate(value, locale) {
      if (!value) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value)
      try {
        return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
      } catch {
        return date.toISOString()
      }
    }

    function compact(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 1000000) return `${Math.round(value / 10000) / 100}M`
      if (value >= 1000) return `${Math.round(value / 100) / 10}k`
      return String(value)
    }

    /** The active UI locale id, read from the live locale service. */
    function activeLocale() {
      try {
        const snapshot = appCtx && appCtx.locale && appCtx.locale.getSnapshot ? appCtx.locale.getSnapshot() : null
        return snapshot && typeof snapshot.active === 'string' ? snapshot.active : undefined
      } catch {
        return undefined
      }
    }

    function translate(locale) {
      const dictionary = STRINGS[locale] || STRINGS.en
      const fallback = STRINGS.en
      return (key) => (dictionary && dictionary[key] !== undefined ? dictionary[key] : fallback[key] !== undefined ? fallback[key] : key)
    }

    function useLived(storageKey) {
      const [value, setValue] = useState(() => {
        try {
          return window.localStorage.getItem(storageKey) === '1'
        } catch {
          return false
        }
      })
      const set = useCallback(
        (next) => {
          setValue(next)
          try {
            window.localStorage.setItem(storageKey, next ? '1' : '0')
          } catch {
            /* ignore */
          }
        },
        [storageKey],
      )
      return [value, set]
    }

    /* ------------------------------------------------------------- panel -- */

    function RaccoonPanel(props) {
      const t = props.t || translate('zh')
      const [state, setState] = useState({ status: 'loading', data: null, error: null })
      const [refreshing, setRefreshing] = useState(false)
      const [revealed, setRevealed] = useLived('raccoon:revealKey')
      const [probes, setProbes] = useState({})
      const [config, setConfig] = useState(null)
      const mounted = useRef(true)

      const load = useCallback((force) => {
        const controller = new AbortController()
        if (force) setRefreshing(true)
        setState((previous) => ({ ...previous, status: previous.data ? 'ready' : 'loading' }))
        getJson(`${API}/api/state${force ? '?refresh=1' : ''}`, controller.signal)
          .then((data) => {
            if (!mounted.current) return
            setState({ status: 'ready', data, error: null })
          })
          .catch((error) => {
            if (!mounted.current) return
            if (error && error.name === 'AbortError') return
            setState({ status: 'error', data: null, error: error && error.message ? error.message : String(error) })
          })
          .finally(() => {
            if (mounted.current && force) setRefreshing(false)
          })
        return controller
      }, [])

      useEffect(() => {
        mounted.current = true
        const controller = load(false)
        return () => {
          mounted.current = false
          controller.abort()
        }
      }, [load])

      /* The bulk state payload deliberately carries no secret; the local API key
         comes from its own route, and the refresh button re-reads it too. */
      const loadConfig = useCallback(() => {
        const controller = new AbortController()
        getJson(`${API}/api/config`, controller.signal)
          .then((payload) => {
            if (mounted.current && payload && payload.endpoint) setConfig(payload.endpoint)
          })
          .catch(() => {
            /* the endpoint card reports the missing key in place */
          })
        return controller
      }, [])

      useEffect(() => {
        const controller = loadConfig()
        return () => controller.abort()
      }, [loadConfig])

      const runProbe = useCallback(
        (target) => {
          setProbes((previous) => ({ ...previous, [target]: { status: 'running' } }))
          getJson(`${API}/api/probe?target=${encodeURIComponent(target)}`)
            .then((payload) => {
              if (!mounted.current) return
              setProbes((previous) => ({ ...previous, [target]: { status: 'done', result: payload && payload.result } }))
            })
            .catch((error) => {
              if (!mounted.current) return
              setProbes((previous) => ({
                ...previous,
                [target]: { status: 'done', result: { ok: false, code: 'REQUEST_FAILED', message: String(error && error.message ? error.message : error) } },
              }))
            })
        },
        [],
      )

      const data = state.data
      const auth = data && data.auth ? data.auth : null
      const models = data && Array.isArray(data.models) ? data.models : []
      const hiddenModels = data && typeof data.hiddenModels === 'number' ? data.hiddenModels : 0
      const credits = data && data.credits ? data.credits : null
      const errors = data && data.errors ? data.errors : {}
      const endpoint = data && data.endpoint ? data.endpoint : null
      const endpointView = endpoint
        ? { ...endpoint, apiKey: (config && config.apiKey) || endpoint.apiKey || '' }
        : null

      const copy = useCallback((text, key) => {
        const done = () => setProbes((previous) => ({ ...previous, [`copy:${key}`]: { status: 'done' } }))
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done))
        } else {
          fallbackCopy(text, done)
        }
      }, [])

      const locale = activeLocale()

      return h(
        'div',
        { className: 'rc-root' },
        h(Styles),
        h(
          'div',
          { className: 'rc-wrap' },
          h(
            'header',
            { className: 'rc-head' },
            h(
              'div',
              null,
              h('h1', { className: 'rc-title' }, t('pageTitle')),
              h('p', { className: 'rc-sub' }, t('subtitle')),
            ),
            h(
              'div',
              { className: 'rc-actions' },
              data && data.generatedAt
                ? h('span', { className: 'rc-note' }, `${t('updatedAt')} ${formatDate(data.generatedAt, locale)}`)
                : null,
              h(
                'button',
                { className: 'rc-btn rc-btn-primary', onClick: () => { load(true); loadConfig() }, disabled: refreshing },
                refreshing ? t('refreshing') : t('refresh'),
              ),
            ),
          ),
          state.status === 'error'
            ? h(
                'div',
                { className: 'rc-err' },
                h('div', { style: { fontWeight: 600 } }, t('errorTitle')),
                h('div', { className: 'rc-err-code' }, state.error || ''),
              )
            : null,
          auth && !auth.ok
            ? h(
                'div',
                { className: 'rc-err' },
                h('div', { style: { fontWeight: 600 } }, t('authMissing')),
                h('div', { className: 'rc-err-code' }, `${auth.code || ''} ${auth.file || ''}`),
                h('div', { className: 'rc-note', style: { marginTop: 6 } }, t('reauthHint')),
              )
            : null,
          errors.auth
            ? h(
                'div',
                { className: 'rc-err' },
                h('div', { className: 'rc-err-code' }, errors.auth.code || 'AUTH'),
                h('div', null, errors.auth.message || ''),
                h('div', { className: 'rc-note', style: { marginTop: 6 } }, t('reauthHint')),
              )
            : null,

          /* credits */
          h(
            'section',
            { className: 'rc-card' },
            h('h2', { className: 'rc-card-title' }, t('credits')),
            h(
              'div',
              { className: 'rc-row' },
              h(
                'div',
                { className: 'rc-metric' },
                h('div', { className: 'rc-metric-value' }, credits ? formatNumber(credits.available) : '—'),
                h('div', { className: 'rc-metric-label' }, t('available')),
              ),
              h(
                'div',
                { className: 'rc-metric' },
                h('div', { className: 'rc-metric-value' }, credits ? formatNumber(credits.topup) : '—'),
                h('div', { className: 'rc-metric-label' }, t('topup')),
              ),
              h(
                'dl',
                { className: 'rc-kv' },
                h('dt', null, t('daily')),
                h('dd', null, credits ? formatNumber(credits.daily) : '—'),
                h('dt', null, t('reward')),
                h('dd', null, credits ? formatNumber(credits.reward) : '—'),
                h('dt', null, t('topup')),
                h('dd', null, credits ? formatNumber(credits.topup) : '—'),
                h('dt', null, t('account')),
                h(
                  'dd',
                  null,
                  auth && auth.ok
                    ? auth.account === 'personal'
                      ? t('personal')
                      : `${t('enterprise')}${credits && credits.ownerType ? ` · ${credits.ownerType}` : ''}`
                    : '—',
                ),
                h('dt', null, t('tokenKind')),
                h('dd', null, auth && auth.ok ? `${auth.tokenKind || '—'}${auth.canRefresh ? ' · refreshable' : ''}` : '—'),
                h('dt', null, t('expiresAt')),
                h(
                  'dd',
                  null,
                  auth && auth.ok && auth.expiresAt
                    ? `${formatDate(auth.expiresAt, locale)}${
                        typeof auth.expiresInDays === 'number'
                          ? ` (${auth.expired ? t('expired') : `${t('expiresInDays')} ${auth.expiresInDays} ${t('days')}`})`
                          : ''
                      }`
                    : '—',
                ),
                h('dt', null, t('resetDate')),
                h(
                  'dd',
                  null,
                  credits && credits.resetDate ? formatDate(credits.resetDate, locale) : t('resetUnavailable'),
                ),
              ),
            ),
            errors.credits
              ? h('div', { className: 'rc-note', style: { marginTop: 10 } }, `${errors.credits.code}: ${errors.credits.message}`)
              : null,
          ),

          /* models */
          h(
            'section',
            { className: 'rc-card' },
            h(
              'h2',
              { className: 'rc-card-title' },
              t('models'),
              h(
                'span',
                { className: 'rc-note' },
                hiddenModels > 0
                  ? `${models.length} · ${t('hiddenModelsPrefix')}${hiddenModels}${t('hiddenModelsSuffix')}`
                  : String(models.length),
              ),
            ),
            models.length === 0
              ? h('div', { className: 'rc-note' }, t('noModels'))
              : h(
                  'div',
                  { className: 'rc-table-scroll' },
                  h(
                    'table',
                    { className: 'rc-table' },
                    h(
                      'thead',
                      null,
                      h(
                        'tr',
                        null,
                        h('th', null, t('model')),
                        h('th', null, t('context')),
                        h('th', null, t('maxOutput')),
                        h('th', null, t('multiplier')),
                        h('th', null, t('billing')),
                      ),
                    ),
                    h(
                      'tbody',
                      null,
                      models.map((model) =>
                        h(
                          'tr',
                          { key: model.id },
                          h(
                            'td',
                            null,
                            model.title ? h('div', { style: { fontWeight: 500 } }, model.title) : null,
                            h('div', { className: 'rc-mono' }, model.id),
                            model.description
                              ? h('div', { className: 'rc-note', style: { marginTop: 2 } }, model.description)
                              : null,
                            model.tags && model.tags.length
                              ? h(
                                  'div',
                                  { style: { marginTop: 4 } },
                                  model.tags.map((tag, index) =>
                                    h('span', { className: 'rc-badge', key: `${tag}-${index}` }, tag),
                                  ),
                                )
                              : null,
                          ),
                          h('td', { className: 'rc-mono' }, compact(model.contextWindow)),
                          h('td', { className: 'rc-mono' }, compact(model.maxTokens)),
                          h(
                            'td',
                            { className: 'rc-mono' },
                            model.multiplier === null || model.multiplier === undefined ? '—' : `x${model.multiplier}`,
                          ),
                          h(
                            'td',
                            null,
                            h(
                              'span',
                              {
                                className:
                                  model.billingStatus === 'discount'
                                    ? 'rc-badge rc-badge-ok'
                                    : model.billingStatus === 'limited_free'
                                      ? 'rc-badge rc-badge-warn'
                                      : 'rc-badge',
                              },
                              model.billingStatus === 'discount'
                                ? t('billingDiscount')
                                : model.billingStatus === 'limited_free'
                                  ? t('billingLimitedFree')
                                  : t('billingNormal'),
                            ),
                            model.billingEffectiveMultiplier !== null &&
                            model.multiplier !== null &&
                            model.billingEffectiveMultiplier !== model.multiplier
                              ? h('div', { className: 'rc-note' }, `x${model.billingEffectiveMultiplier}`)
                              : null,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            errors.catalog
              ? h('div', { className: 'rc-note', style: { marginTop: 10 } }, `${errors.catalog.code}: ${errors.catalog.message}`)
              : null,
            errors.network
              ? h('div', { className: 'rc-note', style: { marginTop: 10 } }, `${errors.network.code}: ${errors.network.message}`)
              : null,
          ),

          /* diagnostics */
          h(
            'section',
            { className: 'rc-card' },
            h('h2', { className: 'rc-card-title' }, t('diagnostics')),
            h(
              'div',
              { className: 'rc-probes' },
              probeCard(t, probes, 'catalog', t('probeCatalog'), null, runProbe),
              probeCard(t, probes, 'credits', t('probeCredits'), null, runProbe),
              probeCard(t, probes, 'chat', t('probeChat'), t('probeChatHint'), runProbe),
            ),
          ),

          /* endpoint */
          h(
            'section',
            { className: 'rc-card' },
            h('h2', { className: 'rc-card-title' }, t('endpoint')),
            h('p', { className: 'rc-note', style: { marginTop: 0 } }, t('endpointHint')),
            endpointView
              ? h(
                  'div',
                  null,
                  endpointRow(t, t('providerId'), endpointView.providerId, 'providerId', copy, probes),
                  endpointRow(t, t('protocol'), endpointView.protocol, 'protocol', copy, probes),
                  endpointRow(t, 'Base URL', endpointView.baseURL, 'baseURL', copy, probes),
                  endpointKeyRow(t, endpointView.apiKey || '', revealed, setRevealed, copy, probes),
                  endpointView.apiKey ? null : h('div', { className: 'rc-note' }, t('keyUnavailable')),
                )
              : null,
          ),

          h('p', { className: 'rc-note', style: { marginBottom: 0 } }, t('riskNote')),
        ),
      )
    }

    function endpointRow(t, label, value, key, copy, probes) {
      const copied = probes[`copy:${key}`] && probes[`copy:${key}`].status === 'done'
      return h(
        'div',
        { className: 'rc-endpoint-row', key },
        h('span', { className: 'rc-note' }, label),
        h('span', { className: 'rc-mono' }, value || '—'),
        h(
          'button',
          { className: 'rc-btn', onClick: () => copy(String(value || ''), key) },
          copied ? t('copied') : t('copy'),
        ),
      )
    }

    function endpointKeyRow(t, value, revealed, setRevealed, copy, probes) {
      const copied = probes['copy:apiKey'] && probes['copy:apiKey'].status === 'done'
      const shown = revealed || !value ? value || '—' : `${value.slice(0, 8)}${'•'.repeat(Math.max(0, Math.min(24, value.length - 8)))}`
      return h(
        'div',
        { className: 'rc-endpoint-row' },
        h('span', { className: 'rc-note' }, t('apiKey')),
        h('span', { className: 'rc-mono' }, shown),
        h(
          'span',
          { style: { display: 'flex', gap: 6 } },
          h('button', { className: 'rc-btn', onClick: () => setRevealed(!revealed) }, revealed ? t('hide') : t('reveal')),
          h('button', { className: 'rc-btn', onClick: () => copy(value, 'apiKey') }, copied ? t('copied') : t('copy')),
        ),
      )
    }

    function probeCard(t, probes, target, label, hint, runProbe) {
      const entry = probes[target]
      const result = entry && entry.result
      const running = entry && entry.status === 'running'
      return h(
        'div',
        { className: 'rc-probe', key: target },
        h(
          'div',
          { className: 'rc-probe-head' },
          h('span', null, label),
          h(
            'button',
            { className: 'rc-btn', disabled: running, onClick: () => runProbe(target) },
            running ? t('running') : t('run'),
          ),
        ),
        hint ? h('div', { className: 'rc-probe-detail' }, hint) : null,
        result
          ? h(
              'div',
              { className: 'rc-probe-detail' },
              h('span', { className: result.ok ? 'rc-badge rc-badge-ok' : 'rc-badge rc-badge-err' }, result.ok ? t('probeOk') : t('probeFail')),
              h('span', null, result.code || ''),
              result.detail || result.message ? h('div', null, String(result.detail || result.message)) : null,
            )
          : null,
      )
    }

    function fallbackCopy(text, done) {
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
        done()
      } catch {
        /* nothing else to try */
      }
    }

    /* -------------------------------------------------------------- pill -- */

    function CreditsPill(props) {
      const t = props.t || translate('zh')
      const [snapshot, setSnapshot] = useState(null)
      const [failed, setFailed] = useState(false)

      useEffect(() => {
        let alive = true
        let controller = new AbortController()
        const tick = () => {
          controller = new AbortController()
          getJson(`${API}/api/state`, controller.signal)
            .then((data) => {
              if (!alive) return
              setSnapshot(data)
              setFailed(false)
            })
            .catch((error) => {
              if (!alive || (error && error.name === 'AbortError')) return
              setFailed(true)
            })
        }
        tick()
        const timer = setInterval(tick, POLL_MS)
        return () => {
          alive = false
          clearInterval(timer)
          controller.abort()
        }
      }, [])

      const credits = snapshot && snapshot.credits ? snapshot.credits : null
      const auth = snapshot && snapshot.auth ? snapshot.auth : null
      const ready = Boolean(credits && typeof credits.available === 'number')
      const label = ready ? formatNumber(credits.available) : failed || (auth && !auth.ok) ? '—' : '…'
      const tone = failed || (auth && !auth.ok) ? 'rc-pill-dot rc-pill-dot-err' : ready ? 'rc-pill-dot' : 'rc-pill-dot rc-pill-dot-warn'

      return h(
        'button',
        {
          className: 'rc-pill',
          type: 'button',
          title: t('pillTitle'),
          onClick: () => {
            try {
              if (appCtx && appCtx.layout && typeof appCtx.layout.selectPanel === 'function') {
                appCtx.layout.selectPanel(PANEL_ID)
              }
            } catch {
              /* panel not registered yet */
            }
          },
        },
        h('span', { className: tone }),
        h('span', null, `${t('panel')} · ${label}`),
      )
    }

    /* ------------------------------------------------------------- icon -- */

    function RaccoonIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M4.2 8.1 6.6 4l2.9 2.3a9.7 9.7 0 0 1 4.9 0L17.3 4l2.5 4.1a8.2 8.2 0 0 1 1 3.9v2.6a6.6 6.6 0 0 1-6.6 6.6h-4.5A6.6 6.6 0 0 1 3.2 14.6V12a8.2 8.2 0 0 1 1-3.9Z',
          fill: 'currentColor',
          opacity: 0.22,
        }),
        h('path', {
          d: 'M4.2 8.1 6.6 4l2.9 2.3a9.7 9.7 0 0 1 4.9 0L17.3 4l2.5 4.1a8.2 8.2 0 0 1 1 3.9v2.6a6.6 6.6 0 0 1-6.6 6.6h-4.5A6.6 6.6 0 0 1 3.2 14.6V12a8.2 8.2 0 0 1 1-3.9Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M5.4 11.1c1.7-1.2 3.4-1.3 5.1-.4 1-.5 2-.5 3 0 1.7-.9 3.4-.8 5.1.4-.6 1.4-1.7 2.1-3.3 2.1-1.1 0-1.8-.4-2.3-1.1-.4.7-1 1.1-1.6 1.1s-1.2-.4-1.6-1.1c-.5.7-1.2 1.1-2.3 1.1-1.6 0-2.7-.7-3.3-2.1Z',
          fill: 'currentColor',
          opacity: 0.85,
        }),
        h('circle', { cx: 9.2, cy: 14.4, r: 1, fill: 'currentColor' }),
        h('circle', { cx: 14.8, cy: 14.4, r: 1, fill: 'currentColor' }),
        h('path', { d: 'M11 17.4h2', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    /* ------------------------------------------------------------- apply -- */

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        appCtx = ctx
        ctx.effect(() => ctx.locale.register(NS, STRINGS), 'raccoon-connect: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, RaccoonPanel),
        )

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 20,
              label: () => t('panel'),
              locale: NS,
            },
            RaccoonIcon,
          ),
        )

        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'raccoon-credits',
              order: 30,
              locale: NS,
            },
            CreditsPill,
          ),
        )
      },
    }
  },
})
