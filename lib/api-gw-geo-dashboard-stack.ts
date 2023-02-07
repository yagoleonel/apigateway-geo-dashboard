import * as cdk from 'aws-cdk-lib';
import * as apigtw from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as destinations from 'aws-cdk-lib/aws-logs-destinations'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class ApiGwGeoDashboardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // api access logs group
    const logGroup = new logs.LogGroup(this, 'api-gateway-access-logs');
    logGroup.grantWrite(new iam.ServicePrincipal('apigateway.amazonaws.com'))

    // api gateway
    const geoRestApi = new apigtw.RestApi(this, 'geolocation-dash-api', {
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apigtw.LogGroupLogDestination(logGroup),
        accessLogFormat: apigtw.AccessLogFormat.jsonWithStandardFields({
          caller: false,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true
        }),
      }
    });

    const apigtwGeoResource = geoRestApi.root.addResource('geotest');
    apigtwGeoResource.addMethod('ANY', new apigtw.MockIntegration({
      passthroughBehavior: apigtw.PassthroughBehavior.NEVER,
      integrationResponses: [
        { 
          statusCode: '200',
          responseTemplates: {
            'application/json': `{
              "message": "Geolocation test successful request"
            }`
          }
        },
      ],
      requestTemplates: {
        'application/json': '{ "statusCode": 200 }',
      },
    }), {
      methodResponses: [
        { statusCode: '200' }
      ],
    })

    // lambda 
    const geolocationParseLambda = new lambda.Function(this, 'geolocation-parse-lambda', {
      code: lambda.Code.fromAsset('.dist/app'),
      functionName: 'geolocation-parse-lambda',
      handler: 'geolocation-parse-lambda.handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(5),
      environment: {
        OPEN_GEOLOCATION_API_URL: `http://ip-api.com`
      }
    })

    // lambda subscrition to access logs
    new logs.SubscriptionFilter(this, 'Subscription', {
      logGroup,
      destination: new destinations.LambdaDestination(geolocationParseLambda),
      filterPattern: logs.FilterPattern.allTerms(),
    });

    // lambda log group -> cloudwatch dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'api-geolocation-api-gateway-access', {
      dashboardName: 'api-geolocation-api-gateway-access',
      periodOverride: cloudwatch.PeriodOverride.AUTO,
    })

    const baseQuery = [
      `fields @timestamp, @message`,
      `filter @message like 'geo_api_data'`,
      `parse @message '{"country":"*","city":"*","timestamp":"*","ip":"*","path":"*","method":"*","status":"*"}' as @country, @city, @time, @ip, @path, @method, @status`,
      `sort @timestamp desc`,
    ]
    dashboard.addWidgets(new cloudwatch.LogQueryWidget({
      title: 'Api requests with geo location',
      logGroupNames: [geolocationParseLambda.logGroup.logGroupName],
      view: cloudwatch.LogQueryVisualizationType.TABLE,
      queryLines: [
        ...baseQuery,
        `display @timestamp, @ip, @path, @method, @status, @city, @country`,
        `limit 20`
      ],
      height: 6,
      width: 12
    }));
    dashboard.addWidgets(new cloudwatch.LogQueryWidget({
      title: 'Total requests by country',
      logGroupNames: [geolocationParseLambda.logGroup.logGroupName],
      view: cloudwatch.LogQueryVisualizationType.BAR,
      queryLines: [
        ...baseQuery,
        `stats sum(count(@country)) by @country as @total`,
        `limit 20`
      ],
      height: 6,
      width: 12
    }));
    dashboard.addWidgets(new cloudwatch.LogQueryWidget({
      title: 'Successful requests by country',
      logGroupNames: [geolocationParseLambda.logGroup.logGroupName],
      view: cloudwatch.LogQueryVisualizationType.PIE,
      queryLines: [
        ...baseQuery,
        `filter @status like '200'`,
        `stats sum(count(@status)) by @country as success`,
        `limit 20`
      ],
      height: 6,
      width: 6
    }));
    dashboard.addWidgets(new cloudwatch.LogQueryWidget({
      title: 'Error requests by country',
      logGroupNames: [geolocationParseLambda.logGroup.logGroupName],
      view: cloudwatch.LogQueryVisualizationType.PIE,
      queryLines: [
        ...baseQuery,
        `filter @status not like '200'`,
        `stats sum(count(@status)) by @country as errors`,
        `limit 20`
      ],
      height: 6,
      width: 6
    }));    
  }
}
