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
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export class JeanieStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Secret: Anthropic API key ─────────────────────────────────
    // Seed the value AFTER `cdk deploy` via:
    //   aws secretsmanager put-secret-value --secret-id JeanieAnthropicKey \
    //     --secret-string '{"ANTHROPIC_API_KEY":"sk-ant-..."}'
    const anthropicSecret = new secrets.Secret(this, 'AnthropicKey', {
      secretName: 'JeanieAnthropicKey',
      description: 'Anthropic API key for Jeanie backend',
      removalPolicy: cdk.RemovalPolicy.RETAIN, // don't nuke the secret on stack delete
    });

    // ── Lambda: Express server wrapped with serverless-http ───────
    // esbuild traces the real require graph from handler.js (server.js + express +
    // express-rate-limit + serverless-http) instead of zipping the whole repo —
    // the old Code.fromAsset approach included react/react-scripts's node_modules
    // and blew past Lambda's 250MB unzipped limit.
    const apiFn = new NodejsFunction(this, 'ApiFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', '..', 'lambda', 'handler.js'),
      handler: 'handler',
      projectRoot: path.join(__dirname, '..', '..'),
      depsLockFilePath: path.join(__dirname, '..', '..', 'package-lock.json'),
      bundling: {
        // AWS SDK v3 ships built into the Node 18/20 Lambda runtime already.
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ANTHROPIC_SECRET_NAME: anthropicSecret.secretName,
        NODE_ENV: 'production',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    anthropicSecret.grantRead(apiFn);

    // ── API Gateway HTTP API in front of the Lambda ───────────────
    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'jeanie-api',
      corsPreflight: {
        // CloudFront fronts both the static site and the API on the same origin,
        // so same-origin requests don't need CORS. We allow * only for /api/r
        // (brand redirects open in a new tab). Tighten if you split domains later.
        allowOrigins: ['*'],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.OPTIONS],
        allowHeaders: ['content-type'],
      },
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

    // ── WAF: rate-based rule (CloudFront scope must be us-east-1) ─
    // Opt-in via ENABLE_WAF=true — costs ~$6/mo. Off by default for cheap testing;
    // turn on before going live/public (Express layer still rate-limits either way).
    const enableWaf = process.env.ENABLE_WAF === 'true';
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

    // ── CloudFront: static site default, /api/* routes to API Gateway ──
    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`,
      { protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY },
    );

    const distribution = new cf.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        'api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cf.AllowedMethods.ALLOW_ALL,
          cachePolicy: cf.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.minutes(1) },
      ],
      webAclId: webAcl?.attrArn,
      priceClass: cf.PriceClass.PRICE_CLASS_100, // US/EU/Canada/Israel only — cheapest tier
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
    new cdk.CfnOutput(this, 'SecretName', { value: anthropicSecret.secretName });
    new cdk.CfnOutput(this, 'BucketName', { value: siteBucket.bucketName });
  }
}
