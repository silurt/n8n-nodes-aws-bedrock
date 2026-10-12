import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
// `NodeConnectionTypes` is the value; `NodeConnectionType` is type-only in
// n8n-workflow 2.x, which is why importing it as a value fails to compile.
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

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
						description: 'How many passages to retrieve',
						displayOptions: { show: { '/operation': ['retrieve'] } },
					},
					{
						displayName: 'User ID',
						name: 'userId',
						type: 'string',
						default: '',
						description:
							'Passed as userContext.userId, so Bedrock filters results to documents this user may see',
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
					};
					const region = options.region || credentialRegion;
					const host = `https://bedrock-agent-runtime.${region}.amazonaws.com`;
					const knowledgeBaseId = this.getNodeParameter('knowledgeBaseId', i) as string;
					const query = this.getNodeParameter('query', i) as string;

					if (operation === 'retrieve') {
						const body: Record<string, unknown> = { retrievalQuery: { text: query } };
						if (options.numberOfResults) {
							body.retrievalConfiguration = {
								vectorSearchConfiguration: { numberOfResults: options.numberOfResults },
							};
						}
						if (options.userId) body.userContext = { userId: options.userId };
						request = {
							method: 'POST',
							url: `${host}/knowledgebases/${knowledgeBaseId}/retrieve`,
							body,
							json: true,
						};
					} else {
						const modelArn = this.getNodeParameter('modelArn', i) as string;
						const body: Record<string, unknown> = {
							input: { text: query },
							retrieveAndGenerateConfiguration: {
								type: 'KNOWLEDGE_BASE',
								knowledgeBaseConfiguration: { knowledgeBaseId, modelArn },
							},
						};
						if (options.sessionId) body.sessionId = options.sessionId;
						request = {
							method: 'POST',
							url: `${host}/retrieveAndGenerate`,
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
					const identifier = this.getNodeParameter('guardrailIdentifier', i) as string;
					const version = this.getNodeParameter('guardrailVersion', i) as string;
					const body: Record<string, unknown> = {
						source: this.getNodeParameter('source', i) as string,
						content: [{ text: { text: this.getNodeParameter('text', i) as string } }],
					};
					if (options.outputScope) body.outputScope = options.outputScope;
					request = {
						method: 'POST',
						url: `https://bedrock-runtime.${region}.amazonaws.com/guardrail/${identifier}/version/${version}/apply`,
						body,
						json: true,
					};
				}

				// The `aws` credential signs this with SigV4, which is why the package
				// needs no AWS SDK and no runtime dependencies.
				const response = await this.helpers.httpRequestWithAuthentication.call(this, 'aws', request);

				out.push({ json: response as IDataObject, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [out];
	}
}
