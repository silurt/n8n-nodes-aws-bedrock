/**
 * Signs this node's requests with n8n's OWN AWS credential, then recomputes the
 * SigV4 signature independently and compares. A match proves n8n signed exactly
 * the request the node built, over the right canonical form, with the right
 * service and region derived from the host.
 *
 *   npm run check:signing
 *
 * Needs an n8n install to borrow the credential from, which is why it is not part
 * of `npm test`. Point N8N_NODES_BASE at one, or let it find an npx-cached n8n.
 */
import { createHmac, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { globSync } from 'node:fs'
const base =
  process.env.N8N_NODES_BASE ??
  globSync(`${process.env.HOME}/.npm/_npx/*/node_modules/n8n/package.json`)[0]
if (!base) {
  console.log('skipped: no n8n install found. Set N8N_NODES_BASE to one.')
  process.exit(0)
}
const require = createRequire(base)
const { Aws } = require('n8n-nodes-base/dist/credentials/Aws.credentials.js')
const { AwsBedrock } = await import('../dist/nodes/AwsBedrock/AwsBedrock.node.js')

const SECRET = 'local-placeholder-not-a-real-key'
const CREDS = { region: 'eu-central-1', accessKeyId: 'AKIAEXAMPLEONLY', secretAccessKey: SECRET }

// 1. what the node builds
function build(params) {
  let captured
  const ctx = {
    getInputData: () => [{ json: {} }],
    getCredentials: async () => CREDS,
    getNode: () => ({ name: 'AWS Bedrock' }),
    continueOnFail: () => false,
    getNodeParameter: (n, _i, fb) => (n in params ? params[n] : fb !== undefined ? fb : (() => { throw new Error(n) })()),
    helpers: { httpRequestWithAuthentication: { async call(_c, type, req) { captured = { type, req }; return {} } } },
  }
  return AwsBedrock.prototype.execute.call(ctx).then(() => captured)
}

const hmac = (k, d) => createHmac('sha256', k).update(d, 'utf8').digest()
const sha256 = (d) => createHash('sha256').update(d, 'utf8').digest('hex')

function verify(signed, bodyText) {
  const auth = signed.headers?.Authorization ?? signed.headers?.authorization
  if (!auth) return { ok: false, why: 'no Authorization header produced' }
  const cred = /Credential=([^,]+)/.exec(auth)[1]
  const signedHeaders = /SignedHeaders=([^,]+)/.exec(auth)[1]
  const signature = /Signature=([0-9a-f]+)/.exec(auth)[1]
  const [, date, region, service] = cred.split('/')
  const raw = signed.url ?? signed.uri ?? ''
  const url = /^https?:\/\//.test(raw) ? new URL(raw) : new URL((signed.baseURL ?? '') + raw)
  const headers = Object.fromEntries(Object.entries(signed.headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]))
  const canonicalHeaders = signedHeaders.split(';').map((h) => `${h}:${headers[h]}\n`).join('')
  const canonicalRequest = ['POST', url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, sha256(bodyText)].join('\n')
  const scope = `${date}/${region}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', headers['x-amz-date'], scope, sha256(canonicalRequest)].join('\n')
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, date), region), service), 'aws4_request')
  const expected = createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex')
  return { ok: expected === signature, service, region, signedHeaders, scope }
}

const cases = [
  ['Retrieve', { resource: 'knowledgeBase', operation: 'retrieve', knowledgeBaseId: 'KB12345678', query: 'refund policy', options: { numberOfResults: 3 } }],
  ['RetrieveAndGenerate', { resource: 'knowledgeBase', operation: 'retrieveAndGenerate', knowledgeBaseId: 'KB12345678', query: 'refund policy', modelArn: 'arn:aws:bedrock:eu-central-1::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0', options: {} }],
  ['ApplyGuardrail', { resource: 'guardrail', operation: 'apply', guardrailIdentifier: 'gr-abc', guardrailVersion: 'DRAFT', text: 'answer text', source: 'OUTPUT', guardrailOptions: {} }],
]

const aws = new Aws()
for (const [name, params] of cases) {
  const { type, req } = await build(params)
  const bodyText = JSON.stringify(req.body)
  // n8n signs through the credential's authenticate(); give it the request as n8n would.
  const signed = await aws.authenticate(CREDS, { ...req, headers: {}, qs: {} })
  const v = verify(signed, typeof signed.body === 'string' ? signed.body : JSON.stringify(signed.body))
  console.log(`${name}`)
  console.log(`   credential type used by the node: ${type}`)
  console.log(`   signed url: ${/^https?:\/\//.test(signed.url ?? '') ? signed.url : (signed.baseURL ?? '') + (signed.url ?? '')}`)
  console.log(`   body signed: ${JSON.stringify(signed.body).slice(0, 90)}`)
  console.log(`   signature valid: ${v.ok ? 'YES' : 'NO'}   scope: ${v.scope ?? '-'}`)
  if (!v.ok) process.exitCode = 1
  console.log(`   signed headers: ${v.signedHeaders ?? '-'}`)
}
