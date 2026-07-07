# Jeanie — AWS Deploy

Architecture: CloudFront → S3 (React build) and CloudFront → API Gateway → Lambda (Express server). Anthropic API key passed to Lambda as an encrypted-at-rest environment variable. WAF is optional (opt-in via `ENABLE_WAF=true`) — off by default for low-volume testing. Single stack in `us-east-1` (required for CloudFront WAF, even when WAF is disabled, to keep the option available without restructuring).

## One-time setup

1. **AWS CLI configured** with credentials that can create CloudFront, Lambda, API Gateway, S3, and IAM (add WAFv2 too if you plan to enable `ENABLE_WAF=true`).
2. **CDK bootstrap** the account/region (only needed once per account):
   ```
   cd infra
   npm install
   npx cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
   ```
3. **Install runtime deps in the project root** (`esbuild` bundles the Lambda from `lambda/handler.js` tracing its real require graph — this does *not* zip the whole repo, so React's toolchain never ends up in the Lambda package):
   ```
   cd ..
   npm install
   ```

## Deploy

The Anthropic key must be set in your shell environment before deploying — CDK reads `process.env.ANTHROPIC_API_KEY` at synth time and fails fast with a clear error if it's missing:

```
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY .env | cut -d= -f2)
npm run deploy
```

That runs `react-scripts build`, then `cdk deploy` from `infra/`. First deploy takes ~5–10 min (CloudFront distribution creation); subsequent deploys are much faster since most resources already exist.

Outputs printed at the end:
- **SiteUrl** — `https://dXXXX.cloudfront.net` (your live app)
- **ApiUrl** — API Gateway endpoint (you don't usually hit this directly; CloudFront proxies `/api/*` to it)
- **BucketName** — the S3 bucket holding the build

No post-deploy secret-seeding step is needed — the key goes in with the same deploy.

## Subsequent deploys

Same command each time:
```
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY .env | cut -d= -f2)
npm run deploy
```
CDK diffs and pushes only what changed. CloudFront invalidations on the static paths happen automatically via `BucketDeployment`. Changing the key value and redeploying updates the running Lambda's environment immediately (no cold-start wait needed, unlike the old Secrets Manager caching behavior).

## Custom domain (optional, do this after first successful deploy)

1. Request an ACM cert in `us-east-1` for your domain (e.g. `jeanie.app` and `www.jeanie.app`).
2. Add to `lib/jeanie-stack.ts` in the `Distribution` props:
   ```ts
   domainNames: ['jeanie.app', 'www.jeanie.app'],
   certificate: acm.Certificate.fromCertificateArn(this, 'Cert', 'arn:aws:acm:us-east-1:...'),
   ```
3. Redeploy, then create Route 53 A/AAAA alias records pointing at the distribution.

## Enabling WAF (recommended before going live/public)

WAF is off by default to keep testing cheap. Turn it on with:
```
export ENABLE_WAF=true
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY .env | cut -d= -f2)
npm run deploy
```
Adds a rate-based rule (1000 req/5min/IP) and AWS's managed common rule set, at ~$6/mo.

## Local dev still works

The Lambda wrapper is opt-in via `require.main`. Locally:
```
npm run dev
```
…runs `node server.js` (port 3001) + `react-scripts start` (port 3000) as before. `.env` provides the key locally and in the deployed Lambda alike — same env var, same code path.

## Cost expectation

At genuinely low volume (a couple hundred requests/month or less), most of the AWS free tier absorbs everything:

| Item | ~Monthly |
|---|---|
| CloudFront (PRICE_CLASS_100, free tier: 1TB + 10M req/mo) | $0 |
| Lambda (free tier: 1M req + 400,000 GB-s/mo) | $0 |
| API Gateway HTTP API (low volume) | ~$0 |
| S3 (build artifacts ~5MB) | $0.01 |
| CloudWatch logs (1mo retention, low volume) | ~$0.01–0.05 |
| WAF (only if `ENABLE_WAF=true`) | ~$6 |
| **Total infra (WAF off)** | **~$0.01–0.10/mo** |
| **Total infra (WAF on)** | **~$6–8/mo** |

Anthropic API costs are separate and scale with usage. At higher production traffic, Lambda/API Gateway/CloudFront costs scale up from these near-zero figures — re-check via AWS Cost Explorer once real usage accrues rather than trusting this table at scale.

## Tear down

```
cd infra
npx cdk destroy
```

No secrets to clean up manually — the Anthropic key only ever lived in the Lambda's environment config, which is deleted along with the function.
