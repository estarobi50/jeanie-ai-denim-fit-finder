# Jeanie — AWS Deploy

Architecture: CloudFront → S3 (React build) and CloudFront → API Gateway → Lambda (Express server). API key in Secrets Manager. WAF rate-based rule + AWS managed common rules in front. Single stack in `us-east-1` (required for CloudFront WAF).

## One-time setup

1. **AWS CLI configured** with credentials that can create CloudFront, Lambda, API Gateway, S3, Secrets Manager, WAFv2, and IAM.
2. **CDK bootstrap** the account/region (only needed once per account):
   ```
   cd infra
   npm install
   npx cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
   ```
3. **Install runtime deps in the project root** (so the Lambda asset bundle includes node_modules):
   ```
   cd ..
   npm install
   ```

## Deploy

From the project root:

```
npm run deploy
```

That runs `react-scripts build`, then `cdk deploy` from `infra/`. First deploy takes ~10–15 min (CloudFront distribution creation).

Outputs printed at the end:
- **SiteUrl** — `https://dXXXX.cloudfront.net` (your live app)
- **ApiUrl** — API Gateway endpoint (you don't usually hit this directly; CloudFront proxies `/api/*` to it)
- **SecretName** — `JeanieAnthropicKey`
- **BucketName** — the S3 bucket holding the build

## Seed the Anthropic key (do this once, right after first deploy)

```
aws secretsmanager put-secret-value \
  --secret-id JeanieAnthropicKey \
  --secret-string '{"ANTHROPIC_API_KEY":"sk-ant-api03-..."}' \
  --region us-east-1
```

The Lambda caches the key in memory across invocations within a container, so changing the secret takes effect on the next cold start (or you can force one with `aws lambda update-function-configuration --function-name <fn> --description "rotate $(date)"`).

## Subsequent deploys

Just `npm run deploy` from the project root. CDK diffs and pushes only what changed. CloudFront invalidations on the static paths happen automatically via `BucketDeployment`.

## Custom domain (optional, do this after first successful deploy)

1. Request an ACM cert in `us-east-1` for your domain (e.g. `jeanie.app` and `www.jeanie.app`).
2. Add to `lib/jeanie-stack.ts` in the `Distribution` props:
   ```ts
   domainNames: ['jeanie.app', 'www.jeanie.app'],
   certificate: acm.Certificate.fromCertificateArn(this, 'Cert', 'arn:aws:acm:us-east-1:...'),
   ```
3. Redeploy, then create Route 53 A/AAAA alias records pointing at the distribution.

## Local dev still works

The Lambda wrapper is opt-in via `require.main`. Locally:
```
npm run dev
```
…runs `node server.js` (port 3001) + `react-scripts start` (port 3000) as before. `.env` provides the key locally; Secrets Manager provides it in Lambda.

## Cost expectation at low traffic

| Item | ~Monthly |
|---|---|
| CloudFront (PRICE_CLASS_100, low traffic) | $1–3 |
| Lambda + API Gateway (under 100k req) | <$1 |
| S3 (build artifacts ~5MB) | $0.01 |
| Secrets Manager | $0.40 |
| WAF (1 WebACL + 2 rules) | ~$6 |
| CloudWatch logs (1mo retention) | $0.50 |
| **Total infra** | **~$8–11/mo** |

Anthropic API costs are separate and scale with usage.

## Tear down

```
cd infra
npx cdk destroy
```

Note: the Anthropic secret is set to `RETAIN` on stack delete (so you don't lose it accidentally). Delete it manually if you really want it gone:
```
aws secretsmanager delete-secret --secret-id JeanieAnthropicKey --force-delete-without-recovery --region us-east-1
```
