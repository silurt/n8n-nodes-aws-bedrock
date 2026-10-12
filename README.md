# n8n-nodes-aws-bedrock

An n8n community node for the parts of Amazon Bedrock that n8n does not ship.

n8n includes an AWS Bedrock Chat Model node and an Embeddings AWS Bedrock node.
Neither of them queries a knowledge base, and neither applies a guardrail, which are
the two things an enterprise deployment reaches for next. This node does both.

It has **no runtime dependencies**. Requests are signed by n8n's own `aws`
credential, so there is no AWS SDK in the package.

## Operations

**Knowledge Base**

- *Retrieve*: query a Bedrock knowledge base and return the matching passages, with
  no model involved. Options: number of results, and a user ID passed as
  `userContext.userId` so Bedrock filters results to documents that user is allowed
  to see.
- *Retrieve and Generate*: retrieve passages and have a model answer from them.
  Takes a model ARN, and an optional session ID to continue a conversation.

**Guardrail**

- *Apply*: run text through a Bedrock guardrail and return the assessment. Choose
  whether the text is model input or model output, and set the output scope to FULL
  when you want to see what was checked and not flagged.

## Credentials

Uses n8n's built-in **AWS** credential. The region comes from the credential and can
be overridden per operation.

The IAM principal needs `bedrock:Retrieve` and `bedrock:RetrieveAndGenerate` on the
knowledge base, and `bedrock:ApplyGuardrail` on the guardrail.

## Install

On self-hosted n8n: **Settings > Community nodes > Install**, then
`n8n-nodes-aws-bedrock`.

## Example workflow

A support mailbox answered from internal documentation, with a compliance check
before anything is sent:

1. **Gmail Trigger** on a shared mailbox.
2. **AWS Bedrock**, Knowledge Base, *Retrieve and Generate*, with the question from
   the email body.
3. **AWS Bedrock**, Guardrail, *Apply*, source OUTPUT, on the generated answer.
4. **IF** on `action` being `GUARDRAIL_INTERVENED`: send the answer, or route it to a
   human.

## Development

```bash
npm install
npm run build          # tsc, then copies the icon into dist
npm link               # then `npm link n8n-nodes-aws-bedrock` in ~/.n8n/custom
```

Restart n8n and the node appears in the canvas.

## Status

Version 0.1.0. The API shapes follow the Bedrock Agent Runtime and Bedrock Runtime
API references. Before publishing, verify against a real account:

1. That a community node can use the built-in `aws` credential by name. If n8n
   rejects it, the fallback is a credential type in this package that signs SigV4
   itself, which is about a hundred lines and still no dependencies.
2. `Retrieve` and `RetrieveAndGenerate` against a knowledge base in your region.
3. `ApplyGuardrail` against a guardrail with at least one policy that fires.

## Verification

Submitting to the n8n Creator Portal requires no runtime dependencies (already the
case), publishing from a GitHub Action with a provenance statement (see
`.github/workflows/publish.yml`), a package name starting with `n8n-nodes-`, and
`n8n-community-node-package` in the keywords. None of that is needed to install the
node on self-hosted n8n.

## Licence

Apache-2.0.
