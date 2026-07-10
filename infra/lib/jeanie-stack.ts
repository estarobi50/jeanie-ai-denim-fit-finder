import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export class JeanieStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Anthropic API key ──────────────────────────────────────────
    // Passed directly as a Lambda environment variable (encrypted at rest by
    // Lambda by default) instead of Secrets Manager — saves the flat $0.40/mo
    // secret fee, which only makes sense to trade away at genuinely low volume
    // where key rotation / audit trail aren't needed. Set it in the shell
    // before `cdk deploy`, e.g.:
    //   export ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY ../.env | cut -d= -f2)
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY env var must be set before deploying (see infra/lib/jeanie-stack.ts)');
    }

    // ── Site key ─────────────────────────────────────────────────
    // Shared header value the frontend sends on /api/claude calls (checked in
    // server.js's requireSiteKey middleware). Not real auth — it ships inside
    // the client bundle — but it stops naive/scripted bots hitting the
    // endpoint directly without ever loading the page. Same value must be set
    // as REACT_APP_JEANIE_SITE_KEY when running `npm run build`.
    const siteKey = process.env.JEANIE_SITE_KEY;
    if (!siteKey) {
      throw new Error('JEANIE_SITE_KEY env var must be set before deploying (see infra/lib/jeanie-stack.ts)');
    }

    // ── Lambda: Express server wrapped with serverless-http ───────
    // esbuild traces the real require graph from handler.js (server.js + express +
    // express-rate-limit + serverless-http) instead of zipping the whole repo —
    // the old Code.fromAsset approach included react/react-scripts's node_modules
    // and blew past Lambda's 250MB unzipped limit.
    const apiFn = new NodejsFunction(this, 'ApiFn', {
      // Node 20.x reached AWS Lambda end-of-life — bumped to 24.x (matches
      // local dev's Node version too, so behavior stays consistent between
      // `node server.js` locally and the deployed Lambda).
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '..', '..', 'lambda', 'handler.js'),
      handler: 'handler',
      projectRoot: path.join(__dirname, '..', '..'),
      depsLockFilePath: path.join(__dirname, '..', '..', 'package-lock.json'),
      bundling: {
        // AWS SDK v3 ships built into the Node Lambda runtime already.
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ANTHROPIC_API_KEY: anthropicApiKey,
        JEANIE_SITE_KEY: siteKey,
        NODE_ENV: 'production',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // ── API Gateway HTTP API in front of the Lambda ───────────────
    // No CORS config: CloudFront fronts both the static site and /api/* on the
    // same origin, so every real request here is same-origin and never
    // triggers a CORS preflight. The previous `allowOrigins: ['*']` was
    // unnecessary — anchor-tag navigations (the brand "Shop" links) aren't
    // subject to CORS at all, and the one /api/r fetch call is also
    // same-origin. Removing it closes off cross-site scripted access entirely.
    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'jeanie-api',
    });

    const lambdaIntegration = new integrations.HttpLambdaIntegration('LambdaInt', apiFn);
    httpApi.addRoutes({ path: '/{proxy+}', methods: [apigw.HttpMethod.ANY], integration: lambdaIntegration });
    httpApi.addRoutes({ path: '/', methods: [apigw.HttpMethod.ANY], integration: lambdaIntegration });

    // ── S3 bucket: React build artifacts (private, OAC) ───────────
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ok to recreate; build is regenerable
      autoDeleteObjects: true,
    });

    // ── WAF ────────────────────────────────────────────────────────
    // If this distribution is enrolled in a CloudFront flat-rate pricing plan
    // (Free/Pro/Business/Premium, set via the console), AWS requires a WAF Web
    // ACL to stay associated with it — that Web ACL is auto-created by
    // CloudFront and CANNOT be removed while the plan is active. Leaving
    // webAclId unset here would make CDK try to strip it on the next deploy,
    // which AWS will reject (or worse, disrupt the plan). Set
    // CLOUDFRONT_WEB_ACL_ID to that existing ARN (find it via
    // `aws cloudfront get-distribution-config --id <ID> --query
    // DistributionConfig.WebACLId`) to make CDK reference it instead of
    // trying to manage its own.
    //
    // If you're NOT on a flat-rate plan, the old opt-in path still works:
    // ENABLE_WAF=true creates a separate pay-as-you-go Web ACL (~$6/mo).
    const existingWebAclId = process.env.CLOUDFRONT_WEB_ACL_ID;
    const enableWaf = !existingWebAclId && process.env.ENABLE_WAF === 'true';
    const webAcl = enableWaf ? new wafv2.CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'JeanieWebAcl',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'RateLimit',
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 1000, // requests per 5 min per IP
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'CommonRules',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRules',
            sampledRequestsEnabled: true,
          },
        },
      ],
    }) : undefined;

    // ── Custom sign-in gate (optional) ──────────────────────────────
    // For sharing a test deploy without going fully public: set BASIC_AUTH_PASS
    // to gate the entire site (and API) behind a branded sign-in page (Jeanie
    // logo, single access-code field) instead of the browser's native Basic
    // Auth dialog. Implemented as a CloudFront Function — runs at the edge
    // before hitting S3 or API Gateway, effectively free at this volume.
    //
    // Flow: no/invalid `jeanie_auth` cookie → serve the branded HTML page
    // (401, no www-authenticate header, so no native browser prompt appears).
    // The page's <form> GETs /__unlock?key=... ; a matching key sets the
    // cookie (24h) and redirects to /. Every request after that carries the
    // cookie automatically (same-origin fetch includes cookies by default).
    //
    // The access code is embedded in the function's code (visible to anyone
    // with CloudFront console access in this account) and sent as a URL query
    // param on unlock, so treat this as a "keep casual visitors out" gate,
    // not cryptographic security — same trust model as the Basic Auth version
    // it replaces. Leave BASIC_AUTH_PASS unset to deploy with no gate at all.
    const basicAuthPass = process.env.BASIC_AUTH_PASS;
    let basicAuthFn: cf.Function | undefined;
    if (basicAuthPass) {
      const escaped = basicAuthPass.replace(/'/g, "\\'");
      basicAuthFn = new cf.Function(this, 'SignInFn', {
        runtime: cf.FunctionRuntime.JS_2_0,
        code: cf.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var expected = '${escaped}';
  var cookies = request.cookies || {};
  var authed = cookies.jeanie_auth && cookies.jeanie_auth.value === expected;

  if (authed) {
    return request;
  }

  if (request.uri === '/__unlock') {
    var qs = request.querystring || {};
    var key = qs.key && qs.key.value;
    if (key === expected) {
      return {
        statusCode: 302,
        statusDescription: 'Found',
        headers: { location: { value: '/' } },
        cookies: {
          jeanie_auth: { value: expected, attributes: 'Path=/; Max-Age=10800; Secure; HttpOnly; SameSite=Lax' },
        },
      };
    }
  }

  var failed = request.uri === '/__unlock';
  var errBlock = failed
    ? '<div class="err">Incorrect access code. Try again.</div>'
    : '';
  var html = '<!DOCTYPE html><html lang="en"><head>'
    + '<meta charset="utf-8"/>'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"/>'
    + '<title>jeanie &middot; Sign in</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">'
    + '<style>'
    + '*{box-sizing:border-box}'
    + 'html{-webkit-text-size-adjust:100%;}'
    + 'body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#f7f4ef;font-family:\\'JetBrains Mono\\',monospace;padding:20px;}'
    + '.card{background:#fff;border:1px solid rgba(28,18,8,0.09);border-radius:20px;padding:48px 40px;max-width:360px;width:100%;box-shadow:0 4px 24px -4px rgba(0,0,0,0.07),0 1px 3px rgba(0,0,0,0.05);text-align:center;}'
    + '.logo{display:flex;align-items:baseline;justify-content:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;}'
    + '.logo .wordmark{font-family:\\'Cormorant Garamond\\',serif;font-weight:600;font-style:italic;font-size:34px;letter-spacing:-0.04em;color:#18110a;}'
    + '.logo .tag{font-family:\\'JetBrains Mono\\',monospace;font-size:9px;font-weight:500;letter-spacing:0.22em;color:#9a7828;text-transform:uppercase;border-left:1px solid rgba(28,18,8,0.09);padding-left:8px;}'
    + '.sub{font-size:11px;color:#8a7060;letter-spacing:0.14em;margin-bottom:32px;text-transform:uppercase;}'
    // 16px avoids iOS Safari's auto-zoom-on-focus for inputs under 16px.
    + 'input[type=password]{width:100%;padding:14px 16px;border-radius:12px;border:1px solid rgba(28,18,8,0.14);font-family:\\'JetBrains Mono\\',monospace;font-size:16px;letter-spacing:0.06em;margin-bottom:16px;background:#f7f4ef;color:#18110a;outline:none;-webkit-appearance:none;appearance:none;}'
    + 'input[type=password]:focus{border-color:#9a7828;}'
    + 'button{width:100%;padding:15px;border-radius:12px;border:none;background:#9a7828;color:#fff;font-family:\\'JetBrains Mono\\',monospace;font-size:12px;letter-spacing:0.10em;text-transform:uppercase;font-weight:500;cursor:pointer;-webkit-appearance:none;appearance:none;}'
    + '@media (max-width:420px){.card{padding:36px 24px;border-radius:16px;}.logo .wordmark{font-size:28px;}.sub{font-size:10px;margin-bottom:26px;}}'
    + 'button:hover{background:#c8a64b;}'
    + '.err{color:#b8302c;font-size:11px;letter-spacing:0.05em;margin:-8px 0 16px;}'
    + '</style></head><body>'
    + '<div class="card">'
    + '<div class="logo"><span class="wordmark">jeanie</span><span class="tag">Fit&middot;AI</span></div>'
    + '<div class="sub">Private preview &middot; enter access code</div>'
    + errBlock
    + '<form method="GET" action="/__unlock">'
    + '<input type="password" name="key" placeholder="Access code" autofocus required/>'
    + '<button type="submit">Enter</button>'
    + '</form></div></body></html>';

  return {
    statusCode: 401,
    statusDescription: 'Unauthorized',
    headers: { 'content-type': { value: 'text/html; charset=utf-8' } },
    body: { encoding: 'text', data: html },
  };
}
        `.trim()),
      });
    }

    // ── CloudFront: static site default, /api/* routes to API Gateway ──
    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`,
      { protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY },
    );

    const basicAuthAssociation = basicAuthFn
      ? [{ function: basicAuthFn, eventType: cf.FunctionEventType.VIEWER_REQUEST }]
      : undefined;

    const distribution = new cf.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: basicAuthAssociation,
      },
      additionalBehaviors: {
        'api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cf.AllowedMethods.ALLOW_ALL,
          cachePolicy: cf.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: basicAuthAssociation,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(1) },
      ],
      webAclId: existingWebAclId || webAcl?.attrArn,
      // CloudFront flat-rate pricing plans (Free/Pro/Business/Premium) control edge
      // coverage themselves and reject an explicit priceClass ("Distributions with
      // the Free pricing plan can't have the following features: Price class").
      // Only set it when NOT on a plan (existingWebAclId unset).
      ...(existingWebAclId ? {} : { priceClass: cf.PriceClass.PRICE_CLASS_100 }), // US/EU/Canada/Israel only — cheapest tier
    });

    // ── Deploy React build/ to S3 on every `cdk deploy` ───────────
    // Requires you to run `npm run build` in the project root first.
    new s3deploy.BucketDeployment(this, 'DeployStatic', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'build'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    // ── Outputs ───────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'BucketName', { value: siteBucket.bucketName });
  }
}
