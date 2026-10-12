/**
 * Asks AWS to validate this node's requests without billing anything.
 *
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=eu-central-1 \
 *     npm run check:live
 *
 * It aims every call at a resource that does not exist. AWS checks the signature,
 * then the permission, then the body, and only then looks the resource up, so a
 * ResourceNotFoundException means everything this package controls was accepted.
 * Nothing is evaluated, so nothing is charged: no guardrail runs, no model is
 * invoked, no knowledge base is queried. You do not need to create any Bedrock
 * resource at all.
 *
 * The IAM user needs bedrock:ApplyGuardrail and bedrock:Retrieve on "*". Reading
 * the error name is the whole test:
 *
 *   ResourceNotFoundException  everything we control is correct
 *   ValidationException        signature and permission fine, our body is wrong
 *   AccessDeniedException      signature fine, the IAM policy is missing the action
 *   InvalidSignatureException  our signing is wrong
 *   UnrecognizedClientException  the access key is not valid
 */
import { createRequire } from 'node:module'
import { globSync } from 'node:fs'
import { AwsBedrock } from '../dist/nodes/AwsBedrock/AwsBedrock.node.js'

const base = process.env.N8N_NODES_BASE ?? globSync(`${process.env.HOME}/.npm/_npx/*/node_modules/n8n/package.json`)[0]
if (!base) { console.log('skipped: no n8n install found to borrow the AWS credential from'); process.exit(0) }
const require = createRequire(base)
const { Aws } = require('n8n-nodes-base/dist/credentials/Aws.credentials.js')

const creds = {
	region: process.env.AWS_REGION ?? 'eu-central-1',
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
}
if (!creds.accessKeyId || !creds.secretAccessKey) {
	console.log('skipped: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY')
	process.exit(0)
}

// Deliberately absent resources. Nothing here exists, and that is the point.
const CASES = [
	['ApplyGuardrail', { resource: 'guardrail', operation: 'apply', guardrailIdentifier: 'doesnotexist', guardrailVersion: 'DRAFT', text: 'hello', source: 'INPUT', guardrailOptions: {} }],
	['Retrieve', { resource: 'knowledgeBase', operation: 'retrieve', knowledgeBaseId: 'AAAAAAAAAA', query: 'hello', options: { numberOfResults: 1 } }],
	['RetrieveAndGenerate', { resource: 'knowledgeBase', operation: 'retrieveAndGenerate', knowledgeBaseId: 'AAAAAAAAAA', query: 'hello', modelArn: `arn:aws:bedrock:${creds.region}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`, options: {} }],
]

const VERDICTS = {
	ResourceNotFoundException: 'PASS   signature, permission and body all accepted',
	ValidationException: 'FAIL   our request body is wrong',
	AccessDeniedException: 'PARTIAL  signature accepted, IAM policy missing the action',
	InvalidSignatureException: 'FAIL   signing is wrong',
	UnrecognizedClientException: 'SETUP  the access key is not valid',
	IncompleteSignature: 'FAIL   signing is wrong',
}

const aws = new Aws()
let failed = false

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
	const url = /^https?:\/\//.test(signed.url ?? '') ? signed.url : (signed.baseURL ?? '') + (signed.url ?? '')
	const res = await fetch(url, {
		method: 'POST',
		headers: signed.headers,
		body: typeof signed.body === 'string' ? signed.body : JSON.stringify(signed.body),
	})
	const text = await res.text()
	let errName = res.headers.get('x-amzn-errortype')?.split(':')[0] ?? ''
	if (!errName) { try { errName = JSON.parse(text).__type?.split('#').pop() ?? JSON.parse(text).message ?? '' } catch {} }
	const verdict = VERDICTS[errName] ?? `UNKNOWN  HTTP ${res.status} ${errName || text.slice(0, 80)}`
	if (verdict.startsWith('FAIL')) failed = true
	console.log(`${name.padEnd(20)} ${errName.padEnd(28)} ${verdict}`)
}

process.exitCode = failed ? 1 : 0
