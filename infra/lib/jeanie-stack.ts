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

    // ── Basic Auth gate (optional) ─────────────────────────────────
    // For sharing a test deploy without going fully public: set BASIC_AUTH_USER
    // and BASIC_AUTH_PASS to gate the entire site (and API) behind a browser
    // login prompt. Implemented as a CloudFront Function — runs at the edge
    // before hitting S3 or API Gateway, effectively free at this volume.
    // Credentials are embedded in the function's code (visible to anyone with
    // CloudFront console access in this account), so treat this as a basic
    // "keep casual visitors out" gate, not cryptographic security. Leave both
    // env vars unset to deploy with no gate at all.
    const basicAuthUser = process.env.BASIC_AUTH_USER;
    const basicAuthPass = process.env.BASIC_AUTH_PASS;
    let basicAuthFn: cf.Function | undefined;
    if (basicAuthUser && basicAuthPass) {
      const token = Buffer.from(`${basicAuthUser}:${basicAuthPass}`).toString('base64');
      basicAuthFn = new cf.Function(this, 'BasicAuthFn', {
        runtime: cf.FunctionRuntime.JS_2_0,
        code: cf.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var expected = 'Basic ${token}';
  var auth = request.headers.authorization && request.headers.authorization.value;
  if (auth !== expected) {
    return {
      statusCode: 401,
      statusDescription: 'Unauthorized',
      headers: { 'www-authenticate': { value: 'Basic realm="Jeanie test access"' } },
    };
  }
  return request;
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
