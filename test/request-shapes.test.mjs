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

test('every request pins the signing service to bedrock', async () => {
	const cases = [
		{ resource: 'knowledgeBase', operation: 'retrieve', knowledgeBaseId: 'KB1', query: 'q', options: {} },
		{ resource: 'knowledgeBase', operation: 'retrieveAndGenerate', knowledgeBaseId: 'KB1', query: 'q', modelArn: 'arn:x', options: {} },
		{ resource: 'guardrail', operation: 'apply', guardrailIdentifier: 'g', guardrailVersion: '1', text: 't', source: 'INPUT', guardrailOptions: {} },
	]
	for (const params of cases) {
		const { request } = await run(params)
		// bedrock-agent-runtime and bedrock-runtime both sign under `bedrock`, and
		// pinning it here is also what switches on the credential's Bedrock endpoint
		// override for VPC and FIPS endpoints.
		assert.equal(request.qs.service, 'bedrock')
	}
})

test('RetrieveAndGenerate carries userContext and the retrieval configuration too', async () => {
	const { request } = await run({
		resource: 'knowledgeBase',
		operation: 'retrieveAndGenerate',
		knowledgeBaseId: 'KB1',
		query: 'q',
		modelArn: 'arn:x',
		options: { userId: 'user-7', numberOfResults: 9 },
	})
	// The API model allows userContext on this operation, and the retrieval
	// configuration moves inside knowledgeBaseConfiguration.
	assert.deepEqual(request.body.userContext, { userId: 'user-7' })
	assert.equal(
		request.body.retrieveAndGenerateConfiguration.knowledgeBaseConfiguration
			.retrievalConfiguration.vectorSearchConfiguration.numberOfResults,
		9,
	)
})

test('a metadata filter and a page token pass through on Retrieve', async () => {
	const { request } = await run({
		resource: 'knowledgeBase', operation: 'retrieve', knowledgeBaseId: 'KB1', query: 'q',
		options: { filter: '{"equals":{"key":"tenant","value":"acme"}}', nextToken: 'tok-1' },
	})
	assert.deepEqual(request.body.retrievalConfiguration.vectorSearchConfiguration.filter, {
		equals: { key: 'tenant', value: 'acme' },
	})
	assert.equal(request.body.nextToken, 'tok-1')
})

test('the per-operation region override beats the credential region', async () => {
	const { request } = await run({
		resource: 'knowledgeBase', operation: 'retrieve', knowledgeBaseId: 'KB1', query: 'q',
		options: { region: 'us-east-1' },
	}, { region: 'eu-central-1' })
	assert.equal(request.baseURL, 'https://bedrock-agent-runtime.us-east-1.amazonaws.com')
})

/**
 * Contextual grounding, added in 0.2.0.
 *
 * Bedrock only runs that policy when it can tell the grounding source and the
 * query apart from the text being judged, which it does by the `qualifiers`
 * array on each content block. A request without qualifiers is not a slightly
 * worse grounding check, it is no grounding check at all, so these assert the
 * labels and their order rather than just that the fields were passed through.
 */
test('ApplyGuardrail: a grounding source and query become labelled content blocks', async () => {
	const { request } = await run({
		resource: 'guardrail',
		operation: 'apply',
		guardrailIdentifier: 'gr-abc123',
		guardrailVersion: 'DRAFT',
		text: 'He led a team of forty engineers.',
		source: 'OUTPUT',
		groundingSource: 'Led a team of four developers across sprints.',
		groundingQuery: 'What team did he lead?',
		guardrailOptions: {},
	})

	// Model: GuardrailTextBlock carries text and an optional qualifiers list.
	assert.deepEqual(request.body.content, [
		{
			text: {
				text: 'Led a team of four developers across sprints.',
				qualifiers: ['grounding_source'],
			},
		},
		{ text: { text: 'What team did he lead?', qualifiers: ['query'] } },
		{ text: { text: 'He led a team of forty engineers.', qualifiers: ['guard_content'] } },
	])
	assert.equal(request.body.source, 'OUTPUT')
})

test('ApplyGuardrail: a grounding source alone still labels both blocks', async () => {
	const { request } = await run({
		resource: 'guardrail',
		operation: 'apply',
		guardrailIdentifier: 'gr-abc123',
		guardrailVersion: 'DRAFT',
		text: 'claim under test',
		source: 'OUTPUT',
		groundingSource: 'the passages',
		groundingQuery: '',
		guardrailOptions: {},
	})

	assert.deepEqual(request.body.content, [
		{ text: { text: 'the passages', qualifiers: ['grounding_source'] } },
		{ text: { text: 'claim under test', qualifiers: ['guard_content'] } },
	])
})

test('ApplyGuardrail: no grounding fields sends what every earlier version sent', async () => {
	// 0.1.0 compatibility. An existing workflow must not change shape on upgrade.
	const { request } = await run({
		resource: 'guardrail',
		operation: 'apply',
		guardrailIdentifier: 'gr-abc123',
		guardrailVersion: 'DRAFT',
		text: 'some generated answer',
		source: 'INPUT',
		groundingSource: '',
		groundingQuery: '',
		guardrailOptions: {},
	})

	assert.deepEqual(request.body.content, [{ text: { text: 'some generated answer' } }])
	for (const block of request.body.content) {
		assert.ok(!('qualifiers' in block.text), 'an unlabelled request must stay unlabelled')
	}
})

test('qualifier values match the API model', async () => {
	// Model: GuardrailContentQualifier enum is grounding_source | query | guard_content.
	const { request } = await run({
		resource: 'guardrail',
		operation: 'apply',
		guardrailIdentifier: 'gr-abc123',
		guardrailVersion: 'DRAFT',
		text: 'x',
		source: 'OUTPUT',
		groundingSource: 'y',
		groundingQuery: 'z',
		guardrailOptions: {},
	})

	const ALLOWED = new Set(['grounding_source', 'query', 'guard_content'])
	for (const block of request.body.content) {
		for (const q of block.text.qualifiers ?? []) {
			assert.ok(ALLOWED.has(q), `"${q}" is not a GuardrailContentQualifier`)
		}
	}
})
