# Jeanie — AI Denim Fit Finder

Demo – digitalculture

---

## OVERVIEW

---

This project demonstrates the deployment of an **AI-powered body-shape and denim fit analyzer** on **AWS serverless infrastructure**.

The application is a **React single-page app** backed by an **Express API** that calls the **Anthropic Claude API** to analyze a user's uploaded photo, classify their body shape against five archetypes, and recommend jean cuts and brands matched to that shape. The goal is to validate that the full request path — photo upload, AI analysis, brand recommendation, and click tracking — works end-to-end on a CDN-fronted serverless backend.

We will build:
- A React frontend (Create React App) served as a static site
- An Express API wrapped for AWS Lambda
- A CloudFront distribution routing static assets and `/api/*` traffic
- API Gateway (HTTP API) in front of the Lambda
- Anthropic API key passed to Lambda as an encrypted-at-rest environment variable
- Optional WAF for public-facing rate limiting

### Request Routing Table

| Path | Target | Behavior |
|---|---|---|
| `/` , static assets | S3 (React build) | Serves the SPA |
| `/api/claude` | API Gateway → Lambda | Proxies to Anthropic API for body-shape analysis |
| `/api/r` | API Gateway → Lambda | Tracked redirect to brand shopping links |

---

## STEP-BY-STEP DEPLOYMENT

---

### 1. CONFIGURE AWS CREDENTIALS

We begin by configuring AWS CLI credentials with permissions to create CloudFront, Lambda, API Gateway, S3, and IAM resources.

```
aws configure --profile <your-profile>
```

### 2. BOOTSTRAP CDK

One-time per AWS account/region:

```
cd infra
npm install
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

### 3. INSTALL DEPENDENCIES

```
cd ..
npm install
```

Installs the frontend/backend runtime dependencies (React, Express, `serverless-http`, AWS SDK) and `esbuild`, which the CDK Lambda construct uses to bundle only the code the API actually needs.

### 4. BUILD THE REACT APP

```
npm run build
```

Produces the static `build/` directory that gets deployed to S3.

### 5. DEPLOY THE STACK

```
npm run deploy
```

This runs `react-scripts build` then `cdk deploy` from `infra/`. First deploy takes ~5–10 minutes (CloudFront distribution creation).

**Outputs:**

| Output | Description |
|---|---|
| `SiteUrl` | CloudFront URL — the live application |
| `ApiUrl` | API Gateway endpoint (proxied through CloudFront `/api/*`, not usually hit directly) |
| `BucketName` | S3 bucket holding the static build |

### Anthropic API key

The key is passed as a Lambda environment variable (encrypted at rest by Lambda by default) rather than Secrets Manager — this trades away key rotation/audit-trail features to avoid the flat $0.40/mo Secrets Manager fee, a reasonable trade only at genuinely low request volume. Set it in your shell before deploying:

```
export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY ../.env | cut -d= -f2)
npm run deploy
```

`cdk deploy` will fail fast with a clear error if `ANTHROPIC_API_KEY` isn't set in the environment.

---

## TESTING

---

After deployment, open the `SiteUrl` and validate:

| Test | Expected Result |
|---|---|
| Load `SiteUrl` | React app renders (hero, analyzer, shapes, brands) |
| Upload a photo → Analyze | Body-shape result returns with confidence score and traits |
| Wait for brand match | 6 brand + product recommendations render with working shop links |
| Click a brand "Shop" link | Opens the brand's site in a new tab; click logged via `/api/r` |
| Resize to mobile width | Layout reflows; camera capture button available on upload |

---

## KEY LEARNINGS

---

**Serverless Express**
Wrapping an existing Express app with `serverless-http` lets the same `server.js` run locally (`node server.js`) and inside Lambda without code changes — the app only calls `app.listen()` when *not* running under Lambda.

**Lambda Bundle Size**
Naively zipping the whole project for a Lambda asset pulls in unrelated frontend tooling (React, its build chain) and can blow past Lambda's 250MB unzipped limit. Using CDK's `NodejsFunction` with esbuild traces the real dependency graph from the handler and bundles only what's actually imported.

**Secrets Never Touch the Client**
The Anthropic API key is read server-side inside the Lambda (as an encrypted-at-rest environment variable) — the browser never sees it. The proxy pattern (client → own backend → third-party API) keeps the key private while still letting the SPA call an LLM.

**CDN + API Behind One Origin**
Routing both the static site and `/api/*` through the same CloudFront distribution avoids CORS entirely for same-origin requests, simplifying the client fetch calls.

**Cost Control via Feature Flags**
WAF is gated behind an `ENABLE_WAF` environment variable so a cheap test deploy can skip it (~$6/mo saved) while a production deploy can flip it on with no code changes.

**Right-Sizing Secret Storage for Volume**
Secrets Manager costs a flat $0.40/mo per secret regardless of usage — real money at near-zero request volume. A Lambda environment variable is encrypted at rest by default and free, at the cost of losing rotation and a dedicated access audit trail. Below a couple hundred requests/month, that trade is worth making; above it, or for a production/public deploy, Secrets Manager's rotation support earns its cost back.

---

## TOOLS & SERVICES USED

---

AWS Lambda, API Gateway (HTTP API), CloudFront, S3, WAFv2 (optional), CloudWatch Logs, AWS CDK (TypeScript), React, Express, Anthropic Claude API, esbuild

---

## SUMMARY

---

This project successfully demonstrates how to:

- Deploy a React SPA + Express API as a serverless application on AWS
- Proxy calls to a third-party LLM API without exposing credentials client-side
- Bundle a Lambda correctly to avoid oversized deployment packages
- Front both static and dynamic traffic through a single CloudFront distribution
- Gate optional security controls (WAF) behind cost-conscious feature flags
