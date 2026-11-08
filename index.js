/**
 * Host half of @local/dsh-raccoon.
 *
 * Two jobs:
 *  1. Read the locally signed-in SenseTime Raccoon (商汤小浣熊) desktop login from
 *     %USERPROFILE%\.box-agent\config\auth.json (read-only, never written back),
 *     call the upstream account/catalog endpoints, and expose the result to the
 *     plugin's own Web UI through exact HTTP routes under /raccoon.
 *  2. Serve an OpenAI-compatible surface under /raccoon/v1 (models + streaming
 *     chat completions) so the model can be added in DSH through
 *     Settings -> Models -> Custom model API, without a second process.
 *
 * The upstream access token never leaves this process: /raccoon/v1 is guarded by
 * a locally generated API key kept in $DSH_HOME/raccoon-connect/secret.json.
 */
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

export const inject = ['webServer']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SECRET_DIR = join(DSH_HOME, 'raccoon-connect')
const SECRET_FILE = join(SECRET_DIR, 'secret.json')

const ORIGIN = 'https://xiaohuanxiong.com'
const API_BASE = (process.env.RACCOON_API_BASE || `${ORIGIN}/api/web/llm/v2`).replace(/\/+$/, '')
const POINTS_URL = process.env.RACCOON_POINTS_URL || `${ORIGIN}/api/web/points/v1/balance`
const CATALOG_URL = `${API_BASE}/model_catalog`
const CHAT_URL = `${API_BASE}/chat/completions`
const ORG_CODE = process.env.RACCOON_ORG_CODE || ''

const ROUTE_ROOT = '/raccoon'
const PROXY_HOST = process.env.RACCOON_PROXY_HOST || '127.0.0.1'
const PROXY_PORT = Number(process.env.RACCOON_PROXY_PORT || 8787)
const STATE_TTL_MS = 20_000
const JSON_TIMEOUT_MS = 20_000
const CHAT_TIMEOUT_MS = 300_000

/* ---------------------------------------------------------------- auth ---- */

function authFilePath() {
  const home = process.env.USERPROFILE || process.env.HOME || homedir()
  return join(home, '.box-agent', 'config', 'auth.json')
}

function decodeSegment(segment) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function decodeJwt(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  const payload = decodeSegment(parts[1])
  if (!payload || typeof payload !== 'object') return null
  return { header: decodeSegment(parts[0]), payload }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * Read the desktop login state. Only the fields the plugin needs are used; the
 * token stays inside this module and is never returned to the browser or logged.
 */
async function readAuth() {
  const file = authFilePath()
  let text
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (error) {
    const code = error && error.code === 'ENOENT' ? 'AUTH_FILE_MISSING' : 'AUTH_FILE_UNREADABLE'
    return {
      ok: false,
      code,
      message:
        code === 'AUTH_FILE_MISSING'
          ? `No Raccoon desktop login file at ${file}. Open the Raccoon client and sign in, then retry.`
          : `The Raccoon desktop login file at ${file} cannot be read.`,
      file,
    }
  }

  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, code: 'AUTH_FILE_INVALID', message: `${file} is not valid JSON.`, file }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: 'AUTH_FILE_INVALID', message: `${file} is not a JSON object.`, file }
  }

  const nested =
    raw.token && typeof raw.token === 'object'
      ? raw.token
      : raw.auth && typeof raw.auth === 'object'
        ? raw.auth
        : {}
  const token = firstString(raw.access_token, raw.accessToken, nested.access_token, nested.accessToken) || ''
  if (!token) {
    return { ok: false, code: 'AUTH_TOKEN_MISSING', message: `${file} carries no access_token.`, file }
  }

  const identity =
    firstString(raw.office_identity, raw.officeIdentity, nested.office_identity, nested.officeIdentity) || ''
  const orgName = firstString(raw.office_org_name, raw.officeOrgName, nested.office_org_name) || ''
  const orgRole = firstString(raw.office_org_role, raw.officeOrgRole, nested.office_org_role) || ''
  const refreshToken = firstString(raw.refresh_token, raw.refreshToken, nested.refresh_token) || ''

  const jwt = decodeJwt(token)
  const issuer = firstString(jwt && jwt.payload && jwt.payload.iss) || ''
  const isIam = /\/iam\b/i.test(issuer)
  const expiresAt = jwt && typeof jwt.payload.exp === 'number' ? jwt.payload.exp * 1000 : null
  const issuedAt = jwt && typeof jwt.payload.iat === 'number' ? jwt.payload.iat * 1000 : null

  return {
    ok: true,
    token,
    identity,
    personal: identity === 'personal' || identity === '',
    orgName,
    orgRole,
    isIam,
    issuer,
    canRefresh: Boolean(refreshToken) && !isIam,
    expiresAt,
    issuedAt,
    file,
  }
}

function upstreamHeaders(auth, extra) {
  const headers = {
    authorization: `Bearer ${auth.token}`,
    accept: 'application/json',
    'user-agent': 'raccoon-connect/0.1 (dsh plugin)',
    ...extra,
  }
  if (ORG_CODE && !auth.personal) headers['x-org-code'] = ORG_CODE
  return headers
}

async function fetchJson(url, auth, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || JSON_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: upstreamHeaders(auth, options.headers),
      body: options.body,
      signal: controller.signal,
    })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: response.status, ok: response.ok, json, text }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------ catalog ----- */

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function mapModel(model) {
  const params = model && typeof model.params === 'object' && model.params ? model.params : {}
  const discounts = Array.isArray(model && model.billing_discounts) ? model.billing_discounts : []
  const billingMultiplier = num(model && model.billing_multiplier)
  const effectiveMultiplier = num(model && model.billing_effective_multiplier)
  return {
    id: firstString(model && model.name, model && model.model_name, model && model.id) || '',
    title: firstString(model && model.description) || '',
    description: firstString(model && model.display_description) || '',
    tags: Array.isArray(model && model.tags) ? model.tags.filter((tag) => typeof tag === 'string') : [],
    abilityLevel: num(model && model.ability_level),
    contextWindow: num(params.context_window),
    maxTokens: num(params.max_tokens),
    multiplier: effectiveMultiplier ?? billingMultiplier ?? null,
    billingMultiplier,
    billingEffectiveMultiplier: effectiveMultiplier,
    billingStatus: firstString(model && model.billing_status) || 'normal',
    billingStatusNote: firstString(model && model.billing_status_note) || '',
    discounts: discounts.map((entry) => ({
      name: firstString(entry && entry.name) || '',
      multiplier: num(entry && entry.multiplier),
      effectiveMultiplier: num(entry && entry.effective_multiplier),
      startAt: firstString(entry && entry.start_at) || null,
      endAt: firstString(entry && entry.end_at) || null,
    })),
    visible: !(model && model.visible === false),
  }
}

function pickModels(json) {
  const data = json && typeof json === 'object' && json.data && typeof json.data === 'object' ? json.data : json
  const categories = Array.isArray(data && data.categories) ? data.categories : []
  let chosen = null
  for (const category of categories) {
    const kind = String((category && (category.type || category.key || category.name)) || '').toLowerCase()
    if (kind === 'chat' || kind === 'llm' || kind === 'text') {
      chosen = category
      break
    }
  }
  if (!chosen) chosen = categories.find((category) => Array.isArray(category && category.models)) || null
  const list =
    chosen && Array.isArray(chosen.models)
      ? chosen.models
      : Array.isArray(data && data.models)
        ? data.models
        : []
  return list
    .filter((model) => model && typeof model === 'object')
    .map(mapModel)
    .filter((model) => model.id)
}

function pickCredits(json) {
  const data = json && typeof json === 'object' && json.data && typeof json.data === 'object' ? json.data : json
  if (!data || typeof data !== 'object') return null
  return {
    available: num(data.available_points ?? data.availablePoints ?? data.balance),
    daily: num(data.daily_points),
    monthly: num(data.monthly_points),
    reward: num(data.reward_points),
    topup: num(data.topup_points),
    enterpriseTopup: num(data.enterprise_topup_points ?? data.enterpriseTopupPoints),
    totalChargeable: num(data.total_chargeable_points),
    ownerType: firstString(data.owner_type, data.user_category, data.userCategory) || null,
    resetDate: firstString(data.pro_reset_date, data.proResetDate, data.reset_date) || null,
    keys: Object.keys(data).slice(0, 40),
  }
}

/* ------------------------------------------------------------ secrets ----- */

let cachedKey = null
async function localKey() {
  if (cachedKey) return cachedKey
  try {
    const parsed = JSON.parse(await fsp.readFile(SECRET_FILE, 'utf8'))
    if (parsed && typeof parsed.key === 'string' && parsed.key.length >= 16) {
      cachedKey = parsed.key
      return cachedKey
    }
  } catch {
    /* create below */
  }
  const key = `rcc_${randomBytes(24).toString('base64url')}`
  try {
    await fsp.mkdir(SECRET_DIR, { recursive: true })
    await fsp.writeFile(
      SECRET_FILE,
      `${JSON.stringify({ key, createdAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    )
  } catch {
    /* keep the in-memory key for this process */
  }
  cachedKey = key
  return key
}

function sameSecret(supplied, key) {
  if (typeof supplied !== 'string' || supplied.length !== key.length) return false
  try {
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(key))
  } catch {
    return false
  }
}

async function hasAccess(request, key) {
  const header = (request.headers.get('authorization') || '').trim()
  return sameSecret(header.replace(/^Bearer\s+/i, ''), key)
}

/* --------------------------------------------------------------- state ---- */

function expiredMessage(expiresAt) {
  return expiresAt && Date.now() >= expiresAt
    ? 'The Raccoon access token has expired. Open the Raccoon desktop client and sign in again.'
    : null
}

function shapeAuth(auth) {
  if (!auth.ok) {
    return {
      present: auth.code === 'AUTH_FILE_INVALID' || auth.code === 'AUTH_FILE_UNREADABLE' || auth.code === 'AUTH_TOKEN_MISSING',
      ok: false,
      code: auth.code,
      message: auth.message,
      file: auth.file,
    }
  }
  return {
    present: true,
    ok: true,
    account: auth.personal ? 'personal' : 'enterprise',
    identity: auth.identity || '',
    orgName: auth.orgName,
    orgRole: auth.orgRole,
    tokenKind: auth.isIam ? 'iam' : 'legacy',
    issuer: auth.issuer,
    expiresAt: auth.expiresAt ? new Date(auth.expiresAt).toISOString() : null,
    expiresInDays: auth.expiresAt ? Math.round(((auth.expiresAt - Date.now()) / 86_400_000) * 10) / 10 : null,
    expired: Boolean(auth.expiresAt && Date.now() >= auth.expiresAt),
    canRefresh: auth.canRefresh,
    file: auth.file,
  }
}

export function apply(ctx) {
  let cache = null
  let cacheAt = 0
  let inflight = null

  function endpoint() {
    let origin = ''
    try {
      origin = ctx.webServer.getOrigin()
    } catch {
      origin = ''
    }
    const fixed = `http://${PROXY_HOST}:${PROXY_PORT}`
    return {
      providerId: 'raccoon',
      protocol: 'openai-completions',
      baseURL: `${fixed}/v1`,
      modelsURL: `${fixed}/v1/models`,
      chatURL: `${fixed}/v1/chat/completions`,
      fixedPort: PROXY_PORT,
      dshBaseURL: origin ? `${origin}${ROUTE_ROOT}/v1` : `${ROUTE_ROOT}/v1`,
    }
  }

  function modelListPayload(state) {
    return {
      object: 'list',
      data: state.models.map((model) => ({
        id: model.id,
        object: 'model',
        created: 0,
        owned_by: 'raccoon',
        name: model.multiplier === null ? model.id : `${model.id} · x${model.multiplier}`,
        title: model.title,
        input: Array.isArray(model.tags) && model.tags.includes('vision') ? ['text', 'image'] : ['text'],
        context_window: model.contextWindow,
        max_tokens: model.maxTokens,
        multiplier: model.multiplier,
        billing_status: model.billingStatus,
      })),
    }
  }

  async function buildState(force) {
    if (!force && cache && Date.now() - cacheAt < STATE_TTL_MS) return cache
    if (inflight) return inflight
    inflight = (async () => {
      const auth = await readAuth()
      const state = {
        ok: auth.ok,
        generatedAt: new Date().toISOString(),
        auth: shapeAuth(auth),
        credits: null,
        models: [],
        hiddenModels: 0,
        endpoint: endpoint(),
        errors: {},
      }

      if (!auth.ok) {
        state.error = { code: auth.code, message: auth.message }
        return state
      }

      const expired = expiredMessage(auth.expiresAt)
      if (expired) state.errors.auth = { code: 'AUTH_EXPIRED', message: expired }

      const results = await Promise.allSettled([
        fetchJson(CATALOG_URL, auth).then((result) => ({ kind: 'catalog', result })),
        fetchJson(POINTS_URL, auth).then((result) => ({ kind: 'credits', result })),
      ])

      for (const settled of results) {
        if (settled.status !== 'fulfilled') {
          state.errors.network = {
            code: 'NETWORK_ERROR',
            message: settled.reason && settled.reason.message ? settled.reason.message : String(settled.reason),
          }
          continue
        }
        const { kind, result } = settled.value
        if (!result.ok) {
          const rejected = result.status === 401 || result.status === 403
          state.errors[kind] = {
            code: rejected ? 'AUTH_REJECTED' : `UPSTREAM_${result.status}`,
            message: rejected
              ? 'The upstream rejected this token. Open the Raccoon client and sign in again; an IAM token cannot refresh itself.'
              : `Upstream returned HTTP ${result.status}.`,
            status: result.status,
            detail: typeof result.text === 'string' ? result.text.slice(0, 400) : '',
          }
          continue
        }
        try {
          if (kind === 'catalog') {
            const all = pickModels(result.json)
            state.models = all.filter((model) => model.visible)
            state.hiddenModels = all.length - state.models.length
            if (state.models.length === 0) {
              state.errors.catalog = {
                code: 'CATALOG_EMPTY',
                message: 'The model catalog answered but no chat model could be read from it.',
              }
            }
          } else {
            state.credits = pickCredits(result.json)
            if (!state.credits) {
              state.errors.credits = {
                code: 'CREDITS_UNREADABLE',
                message: 'The points response carried no readable balance.',
              }
            }
          }
        } catch (error) {
          state.errors[kind] = {
            code: 'PARSE_ERROR',
            message: error && error.message ? error.message : String(error),
          }
        }
      }

      return state
    })()
    try {
      cache = await inflight
      cacheAt = Date.now()
      return cache
    } finally {
      inflight = null
    }
  }

  async function probe(kind) {
    const auth = await readAuth()
    if (!auth.ok) return { ok: false, code: auth.code, message: auth.message }
    const expired = expiredMessage(auth.expiresAt)
    if (expired) return { ok: false, code: 'AUTH_EXPIRED', message: expired }

    if (kind === 'catalog') {
      const result = await fetchJson(CATALOG_URL, auth)
      if (!result.ok) return { ok: false, code: `UPSTREAM_${result.status}`, message: `HTTP ${result.status}` }
      const models = pickModels(result.json)
      const visible = models.filter((model) => model.visible).length
      return {
        ok: visible > 0,
        code: visible ? 'OK' : 'CATALOG_EMPTY',
        detail: `${visible} visible / ${models.length} total`,
      }
    }
    if (kind === 'credits') {
      const result = await fetchJson(POINTS_URL, auth)
      if (!result.ok) return { ok: false, code: `UPSTREAM_${result.status}`, message: `HTTP ${result.status}` }
      const credits = pickCredits(result.json)
      return { ok: Boolean(credits), code: credits ? 'OK' : 'CREDITS_UNREADABLE', detail: credits ? String(credits.available) : '' }
    }
    if (kind === 'chat') {
      const state = await buildState(true)
      const model = state.models[0] && state.models[0].id
      if (!model) return { ok: false, code: 'NO_MODEL', message: 'No chat model is available to probe.' }
      const result = await fetchJson(CHAT_URL, auth, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
        timeoutMs: 60_000,
      })
      if (!result.ok) {
        return {
          ok: false,
          code: `UPSTREAM_${result.status}`,
          message: `HTTP ${result.status}`,
          detail: typeof result.text === 'string' ? result.text.slice(0, 300) : '',
        }
      }
      const choice = result.json && Array.isArray(result.json.choices) ? result.json.choices[0] : null
      return {
        ok: Boolean(choice),
        code: choice ? 'OK' : 'NO_CHOICE',
        detail: choice ? `model=${model}` : typeof result.text === 'string' ? result.text.slice(0, 300) : '',
      }
    }
    return { ok: false, code: 'UNKNOWN_PROBE', message: `Unknown probe "${kind}".` }
  }

  const jsonResponse = (payload, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })

  function route(path, handler) {
    return ctx.webServer.register({
      kind: 'exact',
      path,
      resource: async (request) => {
        try {
          return await handler(request)
        } catch (error) {
          return jsonResponse(
            { ok: false, code: 'INTERNAL', message: error && error.message ? error.message : String(error) },
            500,
          )
        }
      },
    })
  }

  function query(request, name) {
    try {
      return new URL(request.url, 'http://127.0.0.1').searchParams.get(name) || ''
    } catch {
      return ''
    }
  }

  async function handleChat(req, res) {
    const key = await localKey()
    const header = String(req.headers.authorization || '').trim()
    if (!sameSecret(header.replace(/^Bearer\s+/i, ''), key)) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { message: 'Invalid raccoon api key', type: 'unauthorized' } }))
      return
    }

    const auth = await readAuth()
    if (!auth.ok) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { message: auth.message, type: 'raccoon_auth_unavailable', code: auth.code } }))
      return
    }
    const expired = expiredMessage(auth.expiresAt)
    if (expired) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { message: expired, type: 'raccoon_token_expired', code: 'AUTH_EXPIRED' } }))
      return
    }

    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
    const onClose = () => controller.abort()
    res.on('close', onClose)
    try {
      const upstream = await fetch(CHAT_URL, {
        method: 'POST',
        headers: upstreamHeaders(auth, {
          'content-type': 'application/json',
          accept: req.headers.accept || 'text/event-stream',
        }),
        body,
        signal: controller.signal,
      })

      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
        'x-raccoon-upstream-status': String(upstream.status),
      })
      if (!upstream.body) {
        res.end()
        return
      }
      const reader = upstream.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) res.write(Buffer.from(value))
      }
      res.end()
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: { message, type: 'raccoon_upstream_error' } }))
      } else {
        res.end()
      }
    } finally {
      clearTimeout(timer)
      res.off('close', onClose)
    }
  }

  function bearerOf(req) {
    return String(req.headers.authorization || '').trim().replace(/^Bearer\s+/i, '')
  }

  function writeJson(res, status, payload) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }

  /**
   * The OpenAI-compatible surface on a fixed loopback port. It lives outside the
   * Harness Web server so the DSH port — which the desktop app reassigns on every
   * launch — never invalidates the model provider's base URL.
   */
  function startProxyServer() {
    const server = createServer(async (req, res) => {
      try {
        const path = new URL(req.url || '/', `http://${PROXY_HOST}:${PROXY_PORT}`).pathname

        if (path === '/v1/chat/completions') {
          if (String(req.method || '').toUpperCase() !== 'POST') {
            writeJson(res, 405, { error: { message: 'method not allowed', type: 'method_not_allowed' } })
            return
          }
          await handleChat(req, res)
          return
        }

        if (path === '/v1/models' || path === '/v1/health' || path === '/health') {
          const key = await localKey()
          if (!sameSecret(bearerOf(req), key)) {
            writeJson(res, 401, { error: { message: 'Invalid raccoon api key', type: 'unauthorized' } })
            return
          }
          if (path === '/v1/models') {
            writeJson(res, 200, modelListPayload(await buildState(false)))
            return
          }
          const auth = await readAuth()
          writeJson(res, 200, {
            ok: auth.ok,
            account: auth.ok ? (auth.personal ? 'personal' : 'enterprise') : null,
          })
          return
        }

        writeJson(res, 404, { error: { message: 'not found', type: 'not_found' } })
      } catch (error) {
        if (!res.headersSent) {
          writeJson(res, 500, {
            error: { message: error && error.message ? error.message : String(error), type: 'proxy_error' },
          })
        } else {
          res.end()
        }
      }
    })
    server.on('error', (error) => {
      console.warn(
        `[raccoon] fixed-port proxy ${PROXY_HOST}:${PROXY_PORT} unavailable: ${error && error.message ? error.message : error}`,
      )
    })
    server.listen(PROXY_PORT, PROXY_HOST)
    console.log(`[raccoon] OpenAI-compatible proxy on http://${PROXY_HOST}:${PROXY_PORT}/v1`)
    return server
  }

  ctx.effect(() => {
    const disposers = []
    const add = (dispose) => {
      disposers.push(dispose)
      return dispose
    }
    add(
      route(`${ROUTE_ROOT}/api/state`, async (request) =>
        jsonResponse(await buildState(query(request, 'refresh') === '1')),
      ),
    )

    add(
      route(`${ROUTE_ROOT}/api/probe`, async (request) => {
        const target = query(request, 'target') || 'catalog'
        return jsonResponse({ ok: true, target, result: await probe(target), at: new Date().toISOString() })
      }),
    )

    add(
      route(`${ROUTE_ROOT}/api/config`, async () =>
        jsonResponse({ ok: true, endpoint: { ...endpoint(), apiKey: await localKey() } }),
      ),
    )

    add(
      route(`${ROUTE_ROOT}/v1/models`, async (request) => {
        const key = await localKey()
        if (!(await hasAccess(request, key))) {
          return jsonResponse({ error: { message: 'Invalid raccoon api key', type: 'unauthorized' } }, 401)
        }
        return jsonResponse(modelListPayload(await buildState(false)))
      }),
    )

    add(
      route(`${ROUTE_ROOT}/v1/health`, async (request) => {
        const key = await localKey()
        if (!(await hasAccess(request, key))) return jsonResponse({ ok: false }, 401)
        const auth = await readAuth()
        return jsonResponse({ ok: auth.ok, account: auth.ok ? (auth.personal ? 'personal' : 'enterprise') : null })
      }),
    )

    add(
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE_ROOT}/v1/chat/completions`,
        handler: handleChat,
      }),
    )

    const proxyServer = startProxyServer()
    add(() => {
      try {
        if (typeof proxyServer.closeAllConnections === 'function') proxyServer.closeAllConnections()
        proxyServer.close()
      } catch {
        /* already closed */
      }
    })

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* already removed */
        }
      }
    }
  }, 'raccoon-connect: http routes')
}
