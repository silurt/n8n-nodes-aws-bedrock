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
  no model involved. Options: number of results (1 to 100), a metadata filter as
  JSON, a page token, and a user ID passed as `userContext.userId` so Bedrock
  filters results to documents that user is allowed to see.
- *Retrieve and Generate*: retrieve passages and have a model answer from them.
  Takes a model ARN, and optionally a session ID, the same metadata filter and
  result count, and the same user ID.

Not in 0.1.0, and each is a small addition when someone needs it: automatic
pagination (pass `nextToken` yourself for now), `generationConfiguration` for prompt
templates and inference settings, guardrail `qualifiers` for contextual grounding
checks, and `externalSourcesConfiguration`.

**Guardrail**

- *Apply*: run text through a Bedrock guardrail and return the assessment. Choose
  whether the text is model input or model output, and set the output scope to FULL
  when you want to see what was checked and not flagged.

## Credentials

Uses n8n's built-in **AWS** credential. The region comes from the credential and can
be overridden per operation.

For a VPC endpoint, a FIPS endpoint or a private gateway, use the credential's own
**Bedrock endpoint** field. n8n swaps only the host and keeps the signing scope, so
an override cannot quietly change how a request is signed.

This works because each request pins `service: 'bedrock'`. Without that, n8n reads
the service off the host, gets `bedrock-agent-runtime`, and its endpoint override
never fires, since the override is checked before the name is normalised. Verified
both ways on 2026-10-12: with the field set, the host becomes the VPC endpoint and
the scope stays `eu-central-1/bedrock`.

The IAM principal needs `bedrock:Retrieve` and `bedrock:RetrieveAndGenerate` on the
knowledge base, and `bedrock:ApplyGuardrail` on the guardrail.

## Install

On self-hosted n8n: **Settings > Community nodes > Install**, then
`n8n-nodes-aws-bedrock`.

## Example workflow

`examples/answer-from-knowledge-base-guardrailed.json`, which ships in this repo:

1. **Manual trigger**, so you can run it while you are setting it up.
2. **Set**, holding the customer question.
3. **AWS Bedrock**, Knowledge Base, *Retrieve and Generate*.
4. **AWS Bedrock**, Guardrail, *Apply*, source OUTPUT, on the generated answer.
5. **IF** on `action` being `GUARDRAIL_INTERVENED`. The true branch goes to a human,
   the false branch replies to the customer. Both ends are No-Op nodes, so swap in
   Gmail, Slack or whatever you actually send with.

Import it with **Workflows > Import from file**. It references the node as
`n8n-nodes-aws-bedrock.awsBedrock`, which is right for an installed package. A
custom-directory install registers the node as `CUSTOM.awsBedrock` instead, and the
import will show unknown nodes until you install the package properly.

## Development

```bash
npm install
npm run build          # tsc, then copies the icon into dist
npm link               # then `npm link n8n-nodes-aws-bedrock` in ~/.n8n/custom
```

Restart n8n and the node appears in the canvas.

## Status

Version 0.1.0. The API shapes follow the Bedrock Agent Runtime and Bedrock Runtime
API references.

Checked on 2026-10-12 against n8n 2.42.7 running in Docker:

- The package loads from the custom extensions directory and the node registers as
  `CUSTOM.awsBedrock` alongside n8n's 997 built-in types.
- A community node can use the built-in `aws` credential by name. Attaching an AWS
  credential to the node clears its "credentials not set" state, so the fallback of
  shipping a SigV4 credential type in this package is not needed.
- All three operations render on the canvas with their subtitles, and the example
  workflow in `examples/` builds and saves.

Still to verify against a real AWS account, which needs credentials this machine
does not have:

1. `Retrieve` and `RetrieveAndGenerate` against a knowledge base in your region.
2. `ApplyGuardrail` against a guardrail with at least one policy that fires.

## Example

The example workflow was exported from a running n8n, not written by hand.

## Validating this

Three levels, in order of what they cost and what they prove.

**1. Request shapes, no account needed.** `npm test` builds each operation's
request through the node and asserts the method, URI and body against AWS's own API
model: the operation definitions in botocore's `service-2.json` for
bedrock-agent-runtime 2023-07-26 and bedrock-runtime 2023-09-30. That is the
machine-readable source the SDKs are generated from, so it checks the required
members, the nesting and the enum values rather than someone's reading of a docs
page. Six tests, no credentials, no network.

What was checked against the model on 2026-10-12, and matched:

| Operation | Method and URI | Required members |
|---|---|---|
| Retrieve | POST /knowledgebases/{knowledgeBaseId}/retrieve | knowledgeBaseId, retrievalQuery |
| RetrieveAndGenerate | POST /retrieveAndGenerate | input (input.text) |
| ApplyGuardrail | POST /guardrail/{guardrailIdentifier}/version/{guardrailVersion}/apply | guardrailIdentifier, guardrailVersion, source, content |

Endpoint prefixes `bedrock-agent-runtime` and `bedrock-runtime`, protocol rest-json,
and the enums `KNOWLEDGE_BASE`, `INPUT`/`OUTPUT`, `INTERVENTIONS`/`FULL` all match.

**2. Loading and wiring, no account needed.** Done on 2026-10-12 against n8n 2.42.7
in Docker: the package loads from the custom extensions directory, the node
registers, both operations render on the canvas with their subtitles, the example
workflow saves, and attaching an AWS credential clears the node's unconfigured
state.

**2b. Signing, no account needed.** `npm run check:signing` borrows n8n's own AWS
credential, signs the requests this node builds, then recomputes the SigV4
signature from the test secret and compares. All three operations match, with scope
`<date>/eu-central-1/bedrock/aws4_request` and the host n8n resolved the service
from. This is how the request-shape bug below was found: it is a real signing path,
not a stub.

**3a. The routes, free and with no account at all.** Probed on 2026-10-12: all three
URIs answer 403 "Missing Authentication Token" from the live service, which is what
an existing operation says when it wants auth. A deliberately wrong path answers
`UnknownOperationException` instead, so the check discriminates.

**3b. Signature, permission and body, free, on any account you already have.**
`npm run check:live` aims every operation at a resource that does not exist. AWS
checks the signature, then the permission, then the body, and only then looks the
resource up, so `ResourceNotFoundException` means everything this package controls
was accepted. Nothing is evaluated, so nothing is billed: no guardrail runs, no
model is invoked, no knowledge base is queried, and no Bedrock resource has to
exist. The IAM user needs `bedrock:ApplyGuardrail` and `bedrock:Retrieve` on `*`.

The error name is the whole result:

| Response | Means |
|---|---|
| ResourceNotFoundException | signature, permission and body all accepted |
| ValidationException | signature and permission fine, the body is wrong |
| AccessDeniedException | signature fine, the IAM policy is missing the action |
| InvalidSignatureException | signing is wrong |
| UnrecognizedClientException | the access key is not valid |

**3c. A real evaluation, which costs money.** Nothing above proves AWS accepts the
request. The cheapest honest proof is the guardrail path, because a guardrail costs
nothing to create and ApplyGuardrail costs a fraction of a cent per call, while a
knowledge base needs a vector store behind it. Create a guardrail with one policy
that fires, point the node at it with text that trips the policy, and check the
response comes back with `action: GUARDRAIL_INTERVENED`. Then the knowledge base
operations, if there is one to point at.

Use a personal or sandbox AWS account for this, not a client's.

## Verification

Submitting to the n8n Creator Portal requires no runtime dependencies (already the
case), publishing from a GitHub Action with a provenance statement (see
`.github/workflows/publish.yml`), a package name starting with `n8n-nodes-`, and
`n8n-community-node-package` in the keywords. None of that is needed to install the
node on self-hosted n8n.

## Licence

Apache-2.0.
