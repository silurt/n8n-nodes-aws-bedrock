/**
 * Sends the node's signed requests over a real HTTP client to a server that
 * recomputes the SigV4 signature from the bytes that arrive. This is the one
 * thing the offline checks cannot answer: whether what goes on the wire is what
 * was signed.
 */
import { createRequire } from 'node:module'
import { globSync } from 'node:fs'
import { AwsBedrock } from '../../dist/nodes/AwsBedrock/AwsBedrock.node.js'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // the mock uses a self-signed cert
const base = globSync(`${process.env.HOME}/.npm/_npx/*/node_modules/n8n/package.json`)[0]
const require = createRequire(base)
const { Aws } = require('n8n-nodes-base/dist/credentials/Aws.credentials.js')
const axios = require('axios')

const creds = { region: 'eu-central-1', accessKeyId: 'AKIAEXAMPLEONLY', secretAccessKey: 'local-placeholder-not-a-real-key' }
const aws = new Aws()

const CASES = [
  ['Retrieve', { resource: 'knowledgeBase', operation: 'retrieve', knowledgeBaseId: 'KB12345678', query: 'refund policy', options: { numberOfResults: 3, userId: 'u1' } }],
  ['RetrieveAndGenerate', { resource: 'knowledgeBase', operation: 'retrieveAndGenerate', knowledgeBaseId: 'KB12345678', query: 'refund policy', modelArn: 'arn:aws:bedrock:eu-central-1::foundation-model/x', options: {} }],
  ['ApplyGuardrail', { resource: 'guardrail', operation: 'apply', guardrailIdentifier: 'gr-abc', guardrailVersion: 'DRAFT', text: 'answer', source: 'OUTPUT', guardrailOptions: { outputScope: 'FULL' } }],
]

for (const [name, params] of CASES) {
  let request
  const ctx = {
    getInputData: () => [{ json: {} }],
    getCredentials: async () => creds,
    getNode: () => ({ name: 'AWS Bedrock' }),
    continueOnFail: () => false,
    getNodeParameter: (n, _i, fb) => (n in params ? params[n] : fb !== undefined ? fb : (() => { throw new Error(n) })()),
    helpers: { httpRequestWithAuthentication: { async call(_c, _t, req) { request = req; return {} } } },
  }
  await AwsBedrock.prototype.execute.call(ctx)

  const signed = await aws.authenticate(creds, { ...request, headers: {} })
  const real = /^https?:\/\//.test(signed.url ?? '') ? signed.url : (signed.baseURL ?? '') + (signed.url ?? '')
  const target = new URL(real)

  // Same request, same headers (host included and signed), sent to the local mock.
  const res = await axios({
    method: 'POST',
    url: `https://127.0.0.1:8443${target.pathname}`,
    headers: { ...signed.headers, host: target.host },
    data: signed.body,
    transformRequest: [(d) => (typeof d === 'string' ? d : JSON.stringify(d))],
    validateStatus: () => true,
  })
  console.log(`${name.padEnd(20)} HTTP ${res.status}  body keys: ${Object.keys(res.data).join(', ').slice(0, 60)}`)
}
