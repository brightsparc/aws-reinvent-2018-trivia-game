#!/usr/bin/env node
import cdk = require('@aws-cdk/cdk');
import codebuild = require('@aws-cdk/aws-codebuild');
import iam = require('@aws-cdk/aws-iam');
import { TriviaGameCfnPipeline, TriviaGameGitRepoProps } from './pipeline';

class TriviaGameChatBotPipelineStack extends cdk.Stack {
    constructor(parent: cdk.App, name: string, props: TriviaGameGitRepoProps) {
        super(parent, name, props);

        const pipelineConstruct = new TriviaGameCfnPipeline(this, 'Pipeline', {
            repoOwner: props.repoOwner,
            repoName: props.repoName,
            pipelineName: 'chat-bot',
            stackName: 'ChatBot',
            templateName: 'ChatBot',
            directory: 'chat-bot'
        });
        const pipeline = pipelineConstruct.pipeline;

        // Use CodeBuild to run script that deploys the Lex model
        const lexProject = new codebuild.Project(this, 'LexProject', {
            source: new codebuild.CodePipelineSource(),
            buildSpec: 'chat-bot/lex-model/buildspec.yml',
            environment: {
                buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_NODEJS_10_1_0
            },
            artifacts: new codebuild.CodePipelineBuildArtifacts()
        });

        lexProject.addToRolePolicy(new iam.PolicyStatement()
            .addActions('lex:StartImport', 'lex:GetImport')
            .addActions('lex:GetIntent', 'lex:PutIntent')
            .addActions('lex:GetSlotType', 'lex:PutSlotType')
            .addActions('lex:GetBot', 'lex:PutBot', 'lex:PutBotAlias')
            .addAllResources());
        lexProject.addToRolePolicy(new iam.PolicyStatement()
            .addAction('cloudformation:DescribeStackResource')
            .addResource(cdk.arnFromComponents({
                service: 'cloudformation',
                resource: 'stack',
                resourceName: 'TriviaGameChatBot*'
            }, this)));

        const deployLexStage = pipeline.addStage('DeployLexBot');
        lexProject.addToPipeline(deployLexStage, 'Deploy',
            { inputArtifact: pipelineConstruct.sourceAction.outputArtifact });
    }
}

const app = new cdk.App();
const repoOwner = (process.env.GIT_REPO_OWNER) ? process.env.GIT_REPO_OWNER : 'aws-samples';
const repoName = (process.env.GIT_REPO_NAME) ? process.env.GIT_REPO_NAME : 'aws-reinvent-2018-trivia-game';
new TriviaGameChatBotPipelineStack(app, 'TriviaGameChatBotPipeline', {
    repoOwner: repoOwner,
    repoName: repoName
});
app.run();