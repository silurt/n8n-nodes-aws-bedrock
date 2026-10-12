import type {
	IDataObject,
	JsonObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
// `NodeConnectionTypes` is the value; `NodeConnectionType` is type-only in
// n8n-workflow 2.x, which is why importing it as a value fails to compile.
import { NodeApiError, NodeConnectionTypes, jsonParse } from 'n8n-workflow';

/**
 * Amazon Bedrock, the parts n8n does not ship.
 *
 * The built-in nodes cover the chat model and embeddings. This one covers the two
 * operations an enterprise deployment actually needs next: querying a Bedrock
 * knowledge base, and running text through a guardrail.
 *
 * No AWS SDK. Requests go through n8n's own `aws` credential, which signs them
 * with SigV4, so the package has no runtime dependencies and stays eligible for
 * verification.
 */
export class AwsBedrock implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AWS Bedrock',
		name: 'awsBedrock',
		icon: 'file:awsBedrock.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Query Bedrock knowledge bases and apply Bedrock guardrails',
		defaults: { name: 'AWS Bedrock' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'aws', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'knowledgeBase',
				options: [
					{ name: 'Knowledge Base', value: 'knowledgeBase' },
					{ name: 'Guardrail', value: 'guardrail' },
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['knowledgeBase'] } },
				default: 'retrieve',
				options: [
					{
						name: 'Retrieve',
						value: 'retrieve',
						action: 'Retrieve passages from a knowledge base',
						description: 'Return the matching passages without calling a model',
					},
					{
						name: 'Retrieve and Generate',
						value: 'retrieveAndGenerate',
						action: 'Retrieve from a knowledge base and generate an answer',
						description: 'Retrieve passages and have a model answer from them',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['guardrail'] } },
				default: 'apply',
				options: [
					{
						name: 'Apply',
						value: 'apply',
						action: 'Apply a guardrail to text',
						description: 'Check text against a guardrail and return the assessment',
					},
				],
			},
			{
				displayName: 'Knowledge Base ID',
				name: 'knowledgeBaseId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'KB12345678',
				displayOptions: { show: { resource: ['knowledgeBase'] } },
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				typeOptions: { rows: 2 },
				displayOptions: { show: { resource: ['knowledgeBase'] } },
			},
			{
				displayName: 'Model ARN',
				name: 'modelArn',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'arn:aws:bedrock:eu-central-1::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0',
				description: 'The model that writes the answer from the retrieved passages',
				displayOptions: { show: { resource: ['knowledgeBase'], operation: ['retrieveAndGenerate'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { resource: ['knowledgeBase'] } },
				options: [
					{
						displayName: 'Number of Results',
						name: 'numberOfResults',
						type: 'number',
						default: 5,
						typeOptions: { minValue: 1, maxValue: 100 },
						description: 'How many passages to retrieve. The API allows 1 to 100.',
					},
					{
						displayName: 'User ID',
						name: 'userId',
						type: 'string',
						default: '',
						description:
							'Passed as userContext.userId, so Bedrock filters results to documents this user may see',
					},
					{
						displayName: 'Metadata Filter (JSON)',
						name: 'filter',
						type: 'json',
						default: '',
						placeholder: '{ "equals": { "key": "tenant", "value": "acme" } }',
						description:
							'A retrieval filter, passed through as vectorSearchConfiguration.filter',
					},
					{
						displayName: 'Next Token',
						name: 'nextToken',
						type: 'string',
						default: '',
						description: 'Page token from a previous Retrieve response',
						displayOptions: { show: { '/operation': ['retrieve'] } },
					},
					{
						displayName: 'Session ID',
						name: 'sessionId',
						type: 'string',
						default: '',
						description: 'Continue an existing retrieve-and-generate session',
						displayOptions: { show: { '/operation': ['retrieveAndGenerate'] } },
					},
					{
						displayName: 'Region',
						name: 'region',
						type: 'string',
						default: '',
						description: 'Overrides the region on the AWS credential',
					},
				],
			},
			{
				displayName: 'Guardrail ID',
				name: 'guardrailIdentifier',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['guardrail'] } },
			},
			{
				displayName: 'Guardrail Version',
				name: 'guardrailVersion',
				type: 'string',
				required: true,
				default: 'DRAFT',
				description: 'A version number, or DRAFT',
				displayOptions: { show: { resource: ['guardrail'] } },
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				required: true,
				default: '',
				typeOptions: { rows: 3 },
				displayOptions: { show: { resource: ['guardrail'] } },
			},
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				default: 'INPUT',
				description: 'Whether the text is going into a model or coming out of one',
				options: [
					{ name: 'Input', value: 'INPUT' },
					{ name: 'Output', value: 'OUTPUT' },
				],
				displayOptions: { show: { resource: ['guardrail'] } },
			},
			{
				displayName: 'Guardrail Options',
				name: 'guardrailOptions',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { resource: ['guardrail'] } },
				options: [
					{
						displayName: 'Output Scope',
						name: 'outputScope',
						type: 'options',
						default: 'INTERVENTIONS',
						description: 'FULL also returns what was checked and not flagged, which is easier to debug',
						options: [
							{ name: 'Interventions', value: 'INTERVENTIONS' },
							{ name: 'Full', value: 'FULL' },
						],
					},
					{
						displayName: 'Region',
						name: 'region',
						type: 'string',
						default: '',
						description: 'Overrides the region on the AWS credential',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('aws');
		const credentialRegion = (credentials.region as string) ?? '';

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				let request: IHttpRequestOptions;

				if (resource === 'knowledgeBase') {
					const options = this.getNodeParameter('options', i, {}) as {
						numberOfResults?: number;
						userId?: string;
						sessionId?: string;
						region?: string;
						filter?: string;
						nextToken?: string;
					};
					const filter = options.filter ? (jsonParse(options.filter) as IDataObject) : undefined;
					const region = options.region || credentialRegion;
					const host = `https://bedrock-agent-runtime.${region}.amazonaws.com`;
					const knowledgeBaseId = this.getNodeParameter('knowledgeBaseId', i) as string;
					const query = this.getNodeParameter('query', i) as string;

					// Shared by both knowledge base operations: on Retrieve it is the top-level
					// retrievalConfiguration, on RetrieveAndGenerate it sits inside
					// knowledgeBaseConfiguration. The members are the same either way.
					const vectorSearch: IDataObject = {};
					if (options.numberOfResults) vectorSearch.numberOfResults = options.numberOfResults;
					if (filter) vectorSearch.filter = filter;
					const retrievalConfiguration = Object.keys(vectorSearch).length
						? { vectorSearchConfiguration: vectorSearch }
						: undefined;

					if (operation === 'retrieve') {
						const body: Record<string, unknown> = { retrievalQuery: { text: query } };
						if (retrievalConfiguration) body.retrievalConfiguration = retrievalConfiguration;
						if (options.nextToken) body.nextToken = options.nextToken;
						if (options.userId) body.userContext = { userId: options.userId };
						request = {
							method: 'POST',
							baseURL: host,
							url: `/knowledgebases/${knowledgeBaseId}/retrieve`,
							qs: { service: 'bedrock' },
							body,
							json: true,
						};
					} else {
						const modelArn = this.getNodeParameter('modelArn', i) as string;
						const knowledgeBaseConfiguration: IDataObject = { knowledgeBaseId, modelArn };
						if (retrievalConfiguration) {
							knowledgeBaseConfiguration.retrievalConfiguration = retrievalConfiguration;
						}
						const body: Record<string, unknown> = {
							input: { text: query },
							retrieveAndGenerateConfiguration: {
								type: 'KNOWLEDGE_BASE',
								knowledgeBaseConfiguration,
							},
						};
						if (options.sessionId) body.sessionId = options.sessionId;
						if (options.userId) body.userContext = { userId: options.userId };
						request = {
							method: 'POST',
							baseURL: host,
							url: '/retrieveAndGenerate',
							qs: { service: 'bedrock' },
							body,
							json: true,
						};
					}
				} else {
					const options = this.getNodeParameter('guardrailOptions', i, {}) as {
						outputScope?: string;
						region?: string;
					};
					const region = options.region || credentialRegion;
					const host = `https://bedrock-runtime.${region}.amazonaws.com`;
					const identifier = this.getNodeParameter('guardrailIdentifier', i) as string;
					const version = this.getNodeParameter('guardrailVersion', i) as string;
					const body: Record<string, unknown> = {
						source: this.getNodeParameter('source', i) as string,
						content: [{ text: { text: this.getNodeParameter('text', i) as string } }],
					};
					if (options.outputScope) body.outputScope = options.outputScope;
					request = {
						method: 'POST',
						baseURL: host,
						url: `/guardrail/${identifier}/version/${version}/apply`,
						qs: { service: 'bedrock' },
						body,
						json: true,
					};
				}

				// The `aws` credential signs this with SigV4, which is why the package
				// needs no AWS SDK and no runtime dependencies. It composes
				// `baseURL + url` itself and reads the signing service and region off
				// that host, mapping bedrock-runtime and bedrock-agent-runtime to the
				// `bedrock` namespace, so the two must stay separate here. Passing one
				// combined `url` leaves baseURL undefined and signs "null/...".
				const response = await this.helpers.httpRequestWithAuthentication.call(this, 'aws', request);

				// Every one of these operations answers with a JSON object, but a proxy or a
				// future error path can return a string, and a bare string is not a valid item.
				const json =
					response !== null && typeof response === 'object' && !Array.isArray(response)
						? (response as IDataObject)
						: ({ data: response } as IDataObject);
				out.push({ json, pairedItem: { item: i } });
			} catch (error) {
				// NodeApiError, not NodeOperationError: AWS puts ValidationException and
				// AccessDeniedException text in the response body, and an axios error's
				// own message is only "Request failed with status code 400".
				const apiError = new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
				if (this.continueOnFail()) {
					out.push({
						json: { error: apiError.description ?? apiError.message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw apiError;
			}
		}

		return [out];
	}
}
