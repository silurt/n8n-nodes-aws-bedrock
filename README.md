# @silurt/n8n-nodes-aws-bedrock

An n8n node for the parts of Amazon Bedrock that n8n does not ship.

n8n gives you a Bedrock chat model and Bedrock embeddings. Neither one queries a
knowledge base and neither applies a guardrail, which are the next two things any
enterprise deployment reaches for. This node does both, with no runtime
dependencies: requests are signed by n8n's own AWS credential, so there is no AWS
SDK in the package.

**Status: verified against live AWS, 2026-10-12.** All three operations were
accepted by Bedrock: signature, permission and body, with only the deliberately
absent resource missing. Request shapes also check against AWS's own API model, and
signing against n8n's real credential. See [Validating this](#validating-this).

## Operations

**Knowledge Base.** *Retrieve* queries a knowledge base and returns the matching
passages with no model involved. Options: number of results (1 to 100), a metadata
filter as JSON, a page token, and a user ID passed as `userContext.userId` so
Bedrock filters results to documents that user may see. *Retrieve and Generate*
retrieves passages and has a model answer from them, taking a model ARN and
optionally a session ID, the same filter and result count, and the same user ID.

**Guardrail.** *Apply* runs text through a guardrail and returns the assessment.
Choose whether the text is model input or model output, and set the output scope to
FULL to see what was checked and not flagged.

Not in 0.1.0, each a small addition when someone needs it: automatic pagination
(pass `nextToken` yourself for now), `generationConfiguration` for prompt templates
and inference settings, guardrail `qualifiers` for contextual grounding checks, and
`externalSourcesConfiguration`.

## Credentials

Uses n8n's built-in **AWS** credential. The region comes from the credential and can
be overridden per operation. The IAM principal needs `bedrock:Retrieve` and
`bedrock:RetrieveAndGenerate` on the knowledge base, and `bedrock:ApplyGuardrail` on
the guardrail.

For a VPC endpoint, a FIPS endpoint or a private gateway, use the credential's own
**Bedrock endpoint** field. n8n swaps only the host and keeps the signing scope, so
an override cannot quietly change how a request is signed.

That works because every request here pins `service: 'bedrock'`. Without it n8n
reads the service off the host, gets `bedrock-agent-runtime`, and its endpoint
override never fires, since the override is checked before the name is normalised.

## Install

Not on npm yet. Until then:

```bash
git clone https://github.com/silurt/n8n-nodes-aws-bedrock
cd n8n-nodes-aws-bedrock && npm install && npm run build

mkdir -p ~/.n8n/custom && cd ~/.n8n/custom && npm init -y
npm install /path/to/n8n-nodes-aws-bedrock
```

Restart n8n and the node appears as **AWS Bedrock**.

## Example

`examples/answer-from-knowledge-base-guardrailed.json`, exported from a running n8n
rather than written by hand. A question goes to a knowledge base, the answer goes
through a guardrail, and an IF sends it to a human when the guardrail intervened and
to the customer when it did not. Both ends are No-Op nodes, so swap in Gmail, Slack
or whatever you actually send with.

Import it with **Workflows > Import from file**. It names the node
`@silurt/n8n-nodes-aws-bedrock.awsBedrock`, which is right for an installed package; a
custom-directory install registers it as `CUSTOM.awsBedrock` and the import will
show unknown nodes until you install the package properly.

## Validating this

Four levels, by what they cost and what they prove.

| Check | Needs | Proves |
| --- | --- | --- |
| `npm test` | nothing | method, URI and body match AWS's API model |
| `npm run check:signing` | an n8n install | n8n's signer produces a signature that independently recomputes |
| `npm run check:wire` | nothing | what goes on the wire is what was signed |
| `npm run check:live` | any AWS credentials | AWS itself accepts signature, permission and body |

**Request shapes.** The nine tests build each operation's request and assert it
against the operation definitions in botocore's `service-2.json` for
bedrock-agent-runtime 2023-07-26 and bedrock-runtime 2023-09-30 — the
machine-readable source the AWS SDKs are generated from, so required members,
nesting and enum values are all checked rather than eyeballed.

| Operation | Method and URI | Required members |
| --- | --- | --- |
| Retrieve | POST /knowledgebases/{knowledgeBaseId}/retrieve | knowledgeBaseId, retrievalQuery |
| RetrieveAndGenerate | POST /retrieveAndGenerate | input (input.text) |
| ApplyGuardrail | POST /guardrail/{guardrailIdentifier}/version/{guardrailVersion}/apply | guardrailIdentifier, guardrailVersion, source, content |

**Loading and wiring.** Checked against n8n 2.42.7 in Docker on 2026-10-12: the
package loads from the custom extensions directory, the node registers, all three
operations render with their subtitles, the example workflow saves, and attaching an
AWS credential clears the node's unconfigured state.

**Signing.** `npm run check:signing` borrows n8n's own AWS credential, signs the
requests this node builds, then recomputes the signature from the test secret and
compares. All three match, with scope `<date>/eu-central-1/bedrock/aws4_request`.
This is how the request-shape bug was found: n8n composes `baseURL + url` itself, so
a single combined `url` signs `null/knowledgebases/...` and never reaches AWS.

**The wire.** `npm run check:wire` starts a local HTTPS server under the real Bedrock
hostnames, sends each signed request with a real HTTP client, and recomputes the
signature from the bytes that arrive. All three come through valid. An offline
signature check cannot tell you this; it compares what was signed against what was
sent. The server uses a self-signed certificate, accepted for localhost only:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout test/wire/key.pem \
  -out test/wire/cert.pem -days 2 \
  -subj "/CN=bedrock-runtime.eu-central-1.amazonaws.com"
```

**The routes**, free and with no account: all three URIs answer 403 "Missing
Authentication Token" from the live service, which is what an existing operation
says when it wants auth. A deliberately wrong path answers `UnknownOperationException`
instead, so the check discriminates.

**A live call.** Run on 2026-10-12 against a real account, all three accepted:

    ApplyGuardrail       PASS   AWS said: The guardrail identifier or version provided in the request does not exist.
    Retrieve             PASS   AWS said: Knowledge Base with id AAAAAAAAAA does not exist
    RetrieveAndGenerate  PASS   AWS said: Knowledge Base with id AAAAAAAAAA does not exist

`npm run check:live` aims every operation at a resource that does not exist. AWS checks signature, then permission, then body, and only then looks the
resource up, so `ResourceNotFoundException` means everything this package controls
was accepted. Nothing is evaluated, so nothing is billed, and no Bedrock resource
has to exist. The IAM user needs `bedrock:ApplyGuardrail` and `bedrock:Retrieve` on
`*`.

| Response | Means |
| --- | --- |
| ResourceNotFoundException | signature, permission and body all accepted |
| ValidationException saying the resource does not exist | the same news; Bedrock answers a missing guardrail this way |
| ValidationException saying anything else | signature and permission fine, the body is wrong |
| AccessDeniedException | signature fine, the IAM policy is missing the action |
| InvalidSignatureException | signing is wrong |
| UnrecognizedClientException | the access key is not valid |

## Publishing

Submitting to n8n's Creator Portal needs no runtime dependencies (already true),
publishing from a GitHub Action with a provenance statement (see
`.github/workflows/publish.yml`), a package name starting with `n8n-nodes-`, and
`n8n-community-node-package` in the keywords. None of that is needed to install the
node on self-hosted n8n.

## Licence

Apache-2.0.
