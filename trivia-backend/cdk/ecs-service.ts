#!/usr/bin/env node
import { Certificate } from '@aws-cdk/aws-certificatemanager';
import { VpcNetwork } from '@aws-cdk/aws-ec2';
import { Repository } from '@aws-cdk/aws-ecr';
import { Cluster, ContainerImage, LoadBalancedFargateService } from '@aws-cdk/aws-ecs';
import {
  ApplicationProtocol,
  ApplicationTargetGroup,
  HttpCodeTarget,
  IApplicationLoadBalancerTarget,
  LoadBalancerTargetProps,
  TargetType
} from '@aws-cdk/aws-elasticloadbalancingv2';
import { HostedZoneProvider } from '@aws-cdk/aws-route53';
import { Alarm } from '@aws-cdk/aws-cloudwatch';
import cdk = require('@aws-cdk/cdk');

interface TriviaBackendStackProps extends cdk.StackProps {
  repositoryName: string;
  imageTag: string;
  domainName: string;
  domainZone: string;
}

class TriviaBackendStack extends cdk.Stack {
  constructor(parent: cdk.App, name: string, props: TriviaBackendStackProps) {
    super(parent, name, props);

    // Network infrastructure
    const vpc = new VpcNetwork(this, 'VPC', { maxAZs: 2 });
    const cluster = new Cluster(this, 'Cluster', { vpc });

    // Configuration parameters
    const domainZone = new HostedZoneProvider(this, { domainName: props.domainZone }).findAndImport(this, 'Zone');
    const certParam = new cdk.SSMParameterProvider(this, { parameterName: 'CertificateArn-' + props.domainName });
    const certificate = Certificate.import(this, 'Certificate', { certificateArn: certParam.parameterValue() });
    const imageRepo = Repository.import(this, 'Repo', { repositoryName: props.repositoryName });
    const image = ContainerImage.fromEcrRepository(imageRepo, props.imageTag)

    // Fargate service + load balancer
    const service = new LoadBalancedFargateService(this, 'Service', {
      cluster: cluster,
      image: image,
      desiredCount: 3,
      domainName: props.domainName,
      domainZone: domainZone,
      certificate: certificate
    });

    // Second listener for testing
    let testListener = service.loadBalancer.addListener('TestListener', {
      port: 9002, // port for testing
      protocol: ApplicationProtocol.Https,
      open: true,
      certificateArns: [certificate.certificateArn]
    });
    const tg2 = testListener.addTargets('ECS2', {
      port: 80,
      targets: [ // empty to begin with
        new (class EmptyIpTarget implements IApplicationLoadBalancerTarget {
          attachToApplicationTargetGroup(_: ApplicationTargetGroup): LoadBalancerTargetProps {
            return { targetType: TargetType.Ip };
          }
        })()
      ]
    });

    // Alarms: monitor 500s and unhealthy hosts on target groups
    new Alarm(this, 'TargetGroupUnhealthyHosts', {
      metric: service.targetGroup.metricUnhealthyHostCount(),
      threshold: 1,
      evaluationPeriods: 2,
    });

    new Alarm(this, 'TargetGroup5xx', {
      metric: service.targetGroup.metricHttpCodeTarget(HttpCodeTarget.Target5xxCount),
      threshold: 1,
      evaluationPeriods: 2,
    });

    new Alarm(this, 'TargetGroup2UnhealthyHosts', {
      metric: tg2.metricUnhealthyHostCount(),
      threshold: 1,
      evaluationPeriods: 2,
    });

    new Alarm(this, 'TargetGroup25xx', {
      metric: tg2.metricHttpCodeTarget(HttpCodeTarget.Target5xxCount),
      threshold: 1,
      evaluationPeriods: 2,
    });

    // TODO add logging, tracing, autoscaling
  }
}

const app = new cdk.App();
const repositoryName = (process.env.IMAGE_REPO_NAME) ? process.env.IMAGE_REPO_NAME : 'reinvent-trivia-backend';
const imageTag = (process.env.IMAGE_TAG) ? process.env.IMAGE_TAG : 'latest';
const domainTest = (process.env.DOMAIN_TEST) ? process.env.DOMAIN_TEST : 'api-test.reinvent-trivia.com';
const domainProd = (process.env.DOMAIN_PROD) ? process.env.DOMAIN_PROD : 'api.reinvent-trivia.com';
const domainZone = (process.env.DOMAIN_ZONE) ? process.env.DOMAIN_ZONE : 'reinvent-trivia.com';
new TriviaBackendStack(app, 'TriviaBackendTest', {
  repositoryName: repositoryName,
  imageTag: imageTag,
  domainName: domainTest,
  domainZone: domainZone,
});
new TriviaBackendStack(app, 'TriviaBackendProd', {
  repositoryName: repositoryName,
  imageTag: imageTag,
  domainName: domainProd,
  domainZone: domainZone,
});
app.run();