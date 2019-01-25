#!/usr/bin/env node
import codebuild = require('@aws-cdk/aws-codebuild');
import codepipeline = require('@aws-cdk/aws-codepipeline');
import ecr = require('@aws-cdk/aws-ecr');
import cfn = require('@aws-cdk/aws-cloudformation');
import iam = require('@aws-cdk/aws-iam');
import cdk = require('@aws-cdk/cdk');
import { TriviaGameGitRepoProps } from './pipeline';

export interface TriviaGameBackendPipelineStackProps extends TriviaGameGitRepoProps {
    domainTest: string;
    domainProd: string;
    domainZone: string;
}

class TriviaGameBackendPipelineStack extends cdk.Stack {
    constructor(parent: cdk.App, name: string, props: TriviaGameBackendPipelineStackProps) {
        super(parent, name, props);

        const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
            pipelineName: 'reinvent-trivia-game-trivia-backend-cfn-deploy',
        });

        pipeline.addToRolePolicy(new iam.PolicyStatement()
            .addAllResources()
            .addActions("ecr:DescribeImages"));

        // Source
        const sourceStage = pipeline.addStage('Source');

        const githubAccessToken = new cdk.SecretParameter(this, 'GitHubToken', { ssmParameter: 'GitHubToken' });
        const sourceAction = new codepipeline.GitHubSourceAction(this, 'GitHubSource', {
            stage: sourceStage,
            owner: props.repoOwner,
            repo: props.repoName,
            oauthToken: githubAccessToken.value,
            outputArtifactName: 'Source'
        });

        const baseImageRepo = ecr.Repository.import(this, 'BaseRepo', { repositoryName: 'reinvent-trivia-backend-base' });
        const dockerImageSourceAction = new ecr.PipelineSourceAction(this, 'BaseImage', {
            stage: sourceStage,
            repository: baseImageRepo, 
            imageTag: 'release', 
            outputArtifactName: 'BaseImage'
        });

        // Build
        const buildProject = new codebuild.Project(this, 'BuildProject', {
            source: new codebuild.CodePipelineSource(),
            buildSpec: 'trivia-backend/cdk/buildspec.yml',
            environment: {
              buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_NODEJS_10_1_0,
              environmentVariables: {
                'ARTIFACTS_BUCKET': { value: pipeline.artifactBucket.bucketName },
                'DOMAIN_TEST': { value: props.domainTest },
                'DOMAIN_PROD': { value: props.domainProd },
                'DOMAIN_ZONE': { value: props.domainZone },
              },
              privileged: true
            },
            artifacts: new codebuild.CodePipelineBuildArtifacts(),
        });        

        buildProject.addToRolePolicy(new iam.PolicyStatement()
            .addAllResources()
            .addAction('ec2:DescribeAvailabilityZones')
            .addAction('route53:ListHostedZonesByName'));
        buildProject.addToRolePolicy(new iam.PolicyStatement()
            .addAction('ssm:GetParameter')
            .addResource(cdk.arnFromComponents({
                service: 'ssm',
                resource: 'parameter',
                resourceName: 'CertificateArn-*'
            }, this)));
        buildProject.addToRolePolicy(new iam.PolicyStatement()
            .addAllResources()
            .addActions("ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:GetRepositoryPolicy",
                "ecr:DescribeRepositories",
                "ecr:ListImages",
                "ecr:DescribeImages",
                "ecr:BatchGetImage",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload",
                "ecr:PutImage"));
        buildProject.addToRolePolicy(new iam.PolicyStatement()
            .addAction('cloudformation:DescribeStackResources')
            .addResource(cdk.arnFromComponents({
                service: 'cloudformation',
                resource: 'stack',
                resourceName: 'Trivia*'
            }, this)));

        const buildStage = pipeline.addStage('Build');
        const buildAction = buildProject.addToPipeline(buildStage, 'CodeBuild', {
            inputArtifact: sourceAction.outputArtifact,
            outputArtifactName: 'Build',
            additionalInputArtifacts: [dockerImageSourceAction.outputArtifact]
        });

        // Test
        const testStage = pipeline.addStage('Test');
        const templatePrefix =  'TriviaBackend';
        const testStackName = 'TriviaBackendTest';
        const changeSetName = 'StagedChangeSet';

        new cfn.PipelineCreateReplaceChangeSetAction(this, 'PrepareChangesTest', {
            stage: testStage,
            stackName: testStackName,
            changeSetName,
            runOrder: 1,
            adminPermissions: true,
            templatePath: buildAction.outputArtifact.atPath(templatePrefix + 'Test.template.yaml'),
        });

        new cfn.PipelineExecuteChangeSetAction(this, 'ExecuteChangesTest', {
            stage: testStage,
            stackName: testStackName,
            changeSetName,
            runOrder: 2
        });

        // Prod
        const prodStage = pipeline.addStage('Prod');
        const prodStackName = 'TriviaBackendProd';

        new codepipeline.ManualApprovalAction(this, 'Approve', {
            stage: prodStage,
        });

        new cfn.PipelineCreateReplaceChangeSetAction(this, 'PrepareChanges', {
            stage: prodStage,
            stackName: prodStackName,
            changeSetName,
            runOrder: 1,
            adminPermissions: true,
            templatePath: buildAction.outputArtifact.atPath(templatePrefix + 'Prod.template.yaml'),
        });

        new cfn.PipelineExecuteChangeSetAction(this, 'ExecuteChangesProd', {
            stage: prodStage,
            stackName: prodStackName,
            changeSetName,
            runOrder: 2
        });
    }
}

const app = new cdk.App();
const domainTest = (process.env.DOMAIN_TEST) ? process.env.DOMAIN_TEST : 'api-test.reinvent-trivia.com';
const domainProd = (process.env.DOMAIN_PROD) ? process.env.DOMAIN_PROD : 'api.reinvent-trivia.com';
const domainZone = (process.env.DOMAIN_ZONE) ? process.env.DOMAIN_ZONE : 'reinvent-trivia.com';
const repoOwner = (process.env.GIT_REPO_OWNER) ? process.env.GIT_REPO_OWNER : 'aws-samples';
const repoName = (process.env.GIT_REPO_NAME) ? process.env.GIT_REPO_NAME : 'aws-reinvent-2018-trivia-game';
new TriviaGameBackendPipelineStack(app, 'TriviaGameBackendPipeline', {
    domainTest: domainTest,
    domainProd: domainProd,
    domainZone: domainZone,
    repoOwner: repoOwner,
    repoName: repoName,
});
app.run();