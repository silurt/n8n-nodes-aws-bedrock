/**
 * A stand-in for Bedrock that checks the request instead of answering it blindly.
 *
 * It recomputes the SigV4 signature from the known test secret and compares it to
 * the Authorization header n8n sent. A match proves n8n signed exactly the request
 * we built, over the right canonical form, with the right service and region.
 */
import { createServer } from 'node:https'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHmac, createHash } from 'node:crypto'

const SECRET = 'local-placeholder-not-a-real-key'
const log = []

const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest()
const sha256 = (d) => createHash('sha256').update(d, 'utf8').digest('hex')

function recompute(req, bodyText, auth) {
  // Authorization: AWS4-HMAC-SHA256 Credential=AK/20261012/eu-central-1/bedrock/aws4_request, SignedHeaders=..., Signature=...
  const cred = /Credential=([^,]+)/.exec(auth)?.[1] ?? ''
  const signedHeaders = /SignedHeaders=([^,]+)/.exec(auth)?.[1] ?? ''
  const signature = /Signature=([0-9a-f]+)/.exec(auth)?.[1] ?? ''
  const [, date, region, service] = cred.split('/')
  const amzDate = req.headers['x-amz-date']

  const url = new URL(req.url, 'https://x')
  const canonicalHeaders = signedHeaders
    .split(';')
    .map((h) => `${h}:${String(req.headers[h]).trim()}\n`)
    .join('')
  const canonicalRequest = [
    req.method, url.pathname, url.searchParams.toString(),
    canonicalHeaders, signedHeaders, sha256(bodyText),
  ].join('\n')
  const scope = `${date}/${region}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const kDate = hmac(`AWS4${SECRET}`, date)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')
  const expected = createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex')
  return { region, service, date, signedHeaders, matches: expected === signature, got: signature, expected }
}

const RESPONSES = {
  retrieve: { retrievalResults: [{ content: { text: 'Refunds are available within 14 days for EU customers.', type: 'TEXT' }, score: 0.82, location: { type: 'S3', s3Location: { uri: 's3://policies/refunds.pdf' } } }] },
  retrieveAndGenerate: { output: { text: 'EU customers can request a refund within 14 days of purchase.' }, sessionId: 'mock-session', citations: [] },
  applyGuardrail: { action: 'GUARDRAIL_INTERVENED', actionReason: 'Policy matched', outputs: [{ text: '[redacted by guardrail]' }], assessments: [{ topicPolicy: { topics: [{ name: 'Legal advice', type: 'DENY', action: 'BLOCKED', detected: true }] } }] },
}

createServer({ key: readFileSync(new URL('key.pem', import.meta.url)), cert: readFileSync(new URL('cert.pem', import.meta.url)) }, (req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const auth = req.headers.authorization ?? ''
    const sig = auth.startsWith('AWS4-HMAC-SHA256') ? recompute(req, body, auth) : { matches: false, error: 'no SigV4 header' }
    const entry = { host: req.headers.host, method: req.method, path: req.url, body: JSON.parse(body || '{}'), sigv4: sig }
    log.push(entry)
    writeFileSync(new URL('requests.json', import.meta.url), JSON.stringify(log, null, 2))
    console.log(`${req.method} ${req.url} host=${req.headers.host} sigv4=${sig.matches ? 'VALID' : 'INVALID'} service=${sig.service ?? '?'} region=${sig.region ?? '?'}`)

    const key = req.url.includes('/retrieve') ? 'retrieve' : req.url.includes('/retrieveAndGenerate') ? 'retrieveAndGenerate' : 'applyGuardrail'
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(RESPONSES[key]))
  })
}).listen(8443, '127.0.0.1', () => console.log('mock bedrock listening on 127.0.0.1:8443'))
