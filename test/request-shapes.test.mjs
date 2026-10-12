/**
 * What this proves, and what it does not.
 *
 * It proves the node builds exactly the HTTP request each Bedrock operation
 * expects: method, URI, and body shape, checked against the operation
 * definitions in AWS's own API model (botocore service-2.json for
 * bedrock-agent-runtime 2023-07-26 and bedrock-runtime 2023-09-30), not against
 * a reading of the documentation page.
 *
 * It does not prove AWS accepts the request. Only a signed call to a real
 * account does that, and these tests run without credentials on purpose.
 *
 *   npm test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AwsBedrock } from '../dist/nodes/AwsBedrock/AwsBedrock.node.js'

/** A stand-in for n8n's execute context that records the request instead of sending it. */
function context(params, { region = 'eu-central-1' } = {}) {
	const sent = []
	return {
		sent,
		getInputData: () => [{ json: {} }],
		getCredentials: async () => ({ region }),
		getNode: () => ({ name: 'AWS Bedrock' }),
		continueOnFail: () => false,
		getNodeParameter(name, _i, fallback) {
			if (name in params) return params[name]
			if (fallback !== undefined) return fallback
			throw new Error(`test asked for an unset parameter: ${name}`)
		},
		helpers: {
			httpRequestWithAuthentication: {
				async call(_ctx, credentialType, request) {
					sent.push({ credentialType, request })
					return { ok: true }
				},
			},
		},
	}
}

const run = async (params, opts) => {
	const ctx = context(params, opts)
	await AwsBedrock.prototype.execute.call(ctx)
	return ctx.sent[0]
}

test('Retrieve: POST /knowledgebases/{id}/retrieve on bedrock-agent-runtime', async () => {
	const { credentialType, request } = await run({
		resource: 'knowledgeBase',
		operation: 'retrieve',
		knowledgeBaseId: 'KB12345678',
		query: 'what is the refund policy',
		options: { numberOfResults: 5, userId: 'user-42' },
	})

	assert.equal(credentialType, 'aws', 'signs with n8n\'s built-in AWS credential')
	assert.equal(request.method, 'POST')
	// baseURL and url stay separate: n8n's aws credential joins them and reads the
	// signing service and region off the host.
	assert.equal(request.baseURL, 'https://bedrock-agent-runtime.eu-central-1.amazonaws.com')
	assert.equal(request.url, '/knowledgebases/KB12345678/retrieve')
	// Required by the model: knowledgeBaseId (in the URI) and retrievalQuery.
	assert.deepEqual(request.body.retrievalQuery, { text: 'what is the refund policy' })
	assert.equal(request.body.retrievalConfiguration.vectorSearchConfiguration.numberOfResults, 5)
	assert.deepEqual(request.body.userContext, { userId: 'user-42' })
	assert.equal(request.json, true)
})

test('Retrieve: optional members are left out when unset', async () => {
	const { request } = await run({
		resource: 'knowledgeBase',
		operation: 'retrieve',
		knowledgeBaseId: 'KB12345678',
		query: 'hello',
		options: {},
	})
	assert.deepEqual(Object.keys(request.body), ['retrievalQuery'])
})

test('RetrieveAndGenerate: POST /retrieveAndGenerate with a KNOWLEDGE_BASE config', async () => {
	const { request } = await run({
		resource: 'knowledgeBase',
		operation: 'retrieveAndGenerate',
		knowledgeBaseId: 'KB12345678',
		query: 'summarise the policy',
		modelArn: 'arn:aws:bedrock:eu-central-1::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0',
		options: { sessionId: 'sess-1' },
	})

	assert.equal(request.baseURL, 'https://bedrock-agent-runtime.eu-central-1.amazonaws.com')
	assert.equal(request.url, '/retrieveAndGenerate')
	// Model: `input` is required and requires `text`; the config requires `type`,
	// and KNOWLEDGE_BASE requires knowledgeBaseId and modelArn.
	assert.deepEqual(request.body.input, { text: 'summarise the policy' })
	assert.equal(request.body.retrieveAndGenerateConfiguration.type, 'KNOWLEDGE_BASE')
	assert.equal(
		request.body.retrieveAndGenerateConfiguration.knowledgeBaseConfiguration.knowledgeBaseId,
		'KB12345678',
	)
	assert.ok(request.body.retrieveAndGenerateConfiguration.knowledgeBaseConfiguration.modelArn)
	assert.equal(request.body.sessionId, 'sess-1', 'sessionId is top level, not inside the config')
})

test('ApplyGuardrail: POST /guardrail/{id}/version/{version}/apply on bedrock-runtime', async () => {
	const { request } = await run({
		resource: 'guardrail',
		operation: 'apply',
		guardrailIdentifier: 'gr-abc123',
		guardrailVersion: 'DRAFT',
		text: 'some generated answer',
		source: 'OUTPUT',
		guardrailOptions: { outputScope: 'FULL' },
	})

	assert.equal(request.baseURL, 'https://bedrock-runtime.eu-central-1.amazonaws.com')
	assert.equal(request.url, '/guardrail/gr-abc123/version/DRAFT/apply')
	// Model: source and content are required; a content block carries text.text.
	assert.equal(request.body.source, 'OUTPUT')
	assert.deepEqual(request.body.content, [{ text: { text: 'some generated answer' } }])
	assert.equal(request.body.outputScope, 'FULL')
})

test('enum values match the API model', async () => {
	const sources = ['INPUT', 'OUTPUT']
	for (const source of sources) {
		const { request } = await run({
			resource: 'guardrail', operation: 'apply', guardrailIdentifier: 'g', guardrailVersion: '1',
			text: 't', source, guardrailOptions: {},
		})
		assert.equal(request.body.source, source)
	}
})

test('the per-operation region override beats the credential region', async () => {
	const { request } = await run({
		resource: 'knowledgeBase', operation: 'retrieve', knowledgeBaseId: 'KB1', query: 'q',
		options: { region: 'us-east-1' },
	}, { region: 'eu-central-1' })
	assert.equal(request.baseURL, 'https://bedrock-agent-runtime.us-east-1.amazonaws.com')
})
