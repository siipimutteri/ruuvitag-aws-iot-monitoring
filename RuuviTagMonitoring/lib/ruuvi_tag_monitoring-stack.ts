import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iot from "aws-cdk-lib/aws-iot";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cr from "aws-cdk-lib/custom-resources";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cw from "aws-cdk-lib/aws-cloudwatch";

export interface RuuviTagMonitoringStackProps extends cdk.StackProps {
  thingName: string;
  iotTopicPrefix: string;
  cloudWatchMetricNameSpace: string;
  ruuviTagId: string;
}

export class RuuviTagMonitoringStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: RuuviTagMonitoringStackProps
  ) {
    super(scope, id, props);

    const iotThing = new iot.CfnThing(this, props.thingName, {
      thingName: props.thingName,
    });

    const iotThingKeysAndCert = new cr.AwsCustomResource(
      this,
      "IotThingKeysAndCert",
      {
        functionName: this.stackName + "CreateIotThingKeysAndCert",
        onCreate: {
          service: "@aws-sdk/client-iot",
          action: "CreateKeysAndCertificateCommand",
          parameters: {
            setAsActive: true,
          },
          physicalResourceId:
            cr.PhysicalResourceId.fromResponse("certificateId"),
          outputPaths: [
            "certificateArn",
            "certificatePem",
            "keyPair.PrivateKey",
          ],
        },
        logRetention: logs.RetentionDays.SIX_MONTHS,
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        onDelete: {
          service: "@aws-sdk/client-iot",
          action: "DeleteCertificateCommand",
          parameters: {
            certificateId: new cr.PhysicalResourceIdReference(),
          },
        },
      }
    );

    const iotThingKeysAndCertSecret = new secretsmanager.Secret(
      this,
      "IotThingKeysAndCertSecret",
      {
        secretObjectValue: {
          certificatePem: cdk.SecretValue.unsafePlainText(
            iotThingKeysAndCert.getResponseField("certificatePem")
          ),
          privateKey: cdk.SecretValue.unsafePlainText(
            iotThingKeysAndCert.getResponseField("keyPair.PrivateKey")
          ),
        },
      }
    );

    const iotThingPrincipalAttachment = new iot.CfnThingPrincipalAttachment(
      this,
      "IotThingPrincipalAttachment",
      {
        principal: iotThingKeysAndCert.getResponseField("certificateArn"),
        thingName: props.thingName,
      }
    );
    iotThingPrincipalAttachment.addDependency(iotThing);

    const iotThingPolicy = new iot.CfnPolicy(this, `${props.thingName}Policy`, {
      policyName: `${props.thingName}Policy`,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["iot:Publish"],
            Resource: [
              `arn:aws:iot:${this.region}:${this.account}:topic/${props.iotTopicPrefix}/*`,
            ],
          },
          {
            Effect: "Allow",
            Action: ["iot:Connect"],
            Resource: [
              `arn:aws:iot:${this.region}:${this.account}:client/${iotThing.ref}`,
            ],
          },
        ],
      },
    });

    new iot.CfnPolicyPrincipalAttachment(
      this,
      "IotThingPolicyPrincipalAttachment",
      {
        principal: iotThingKeysAndCert.getResponseField("certificateArn"),
        policyName: iotThingPolicy.policyName!,
      }
    );

    const iotRuleErrorLog = new logs.LogGroup(this, "IotRuleErrorLog");

    const iotRuleRole = new iam.Role(this, "IotRuleRole", {
      assumedBy: new iam.ServicePrincipal("iot.amazonaws.com"),
      inlinePolicies: {
        putMetricsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["cloudwatch:PutMetricData"],
              resources: ["*"], // cloudwatch:PutMetricData supports only the all resources wildcard
            }),
          ],
        }),
      },
    });
    iotRuleErrorLog.grantWrite(iotRuleRole);

    const iotRule = new iot.CfnTopicRule(this, `IotRule_${props.ruuviTagId}`, {
      ruleName: `RuuviTagEvents_${props.ruuviTagId}`,
      topicRulePayload: {
        actions: [
          {
            cloudwatchMetric: {
              metricName: "Temperature",
              metricNamespace: `${props.cloudWatchMetricNameSpace}/${props.ruuviTagId}`,
              metricUnit: "None",
              metricValue: "${temperature}",
              roleArn: iotRuleRole.roleArn,
            },
          },
          {
            cloudwatchMetric: {
              metricName: "Humidity",
              metricNamespace: `${props.cloudWatchMetricNameSpace}/${props.ruuviTagId}`,
              metricUnit: "None",
              metricValue: "${humidity}",
              roleArn: iotRuleRole.roleArn,
            },
          },
        ],
        awsIotSqlVersion: "2016-03-23",
        sql: `SELECT temperature,humidity FROM '${props.iotTopicPrefix}/${props.ruuviTagId}'`,
        ruleDisabled: false,
        errorAction: {
          cloudwatchLogs: {
            logGroupName: iotRuleErrorLog.logGroupName,
            roleArn: iotRuleRole.roleArn,
          },
        },
      },
    });

    const dashboard = new cw.Dashboard(this, "Dashboard", {
      dashboardName: `${props.thingName}-Dashboard`,
      start: "-P7D", // 7 days
      widgets: [
        [
          new cw.GraphWidget({
            left: [
              new cw.Metric({
                namespace: `${props.cloudWatchMetricNameSpace}/${props.ruuviTagId}`,
                metricName: "Humidity",
                statistic: "Average",
                period: cdk.Duration.minutes(5),
              }),
            ],
            leftAnnotations: [
              {
                value: 53,
                color: "#ff0000",
                fill: cw.Shading.BELOW,
                label: "Low",
              },
              {
                value: 75,
                color: "#ff0000",
                fill: cw.Shading.ABOVE,
                label: "High",
              },
            ],
            leftYAxis: {
              max: 85,
              min: 45,
              showUnits: false,
            },
            legendPosition: cw.LegendPosition.HIDDEN,
            region: this.region,
            title: "Kosteus (%)",
            width: 6,
            height: 6,
          }),
        ],
      ],
    });
  }
}
