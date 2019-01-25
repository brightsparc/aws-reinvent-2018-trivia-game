#!/usr/bin/env node
import codebuild = require('@aws-cdk/aws-codebuild');
import codepipeline = require('@aws-cdk/aws-codepipeline');
import iam = require('@aws-cdk/aws-iam');
import cdk = require('@aws-cdk/cdk');
import { TriviaGameGitRepoProps } from './pipeline';

class TriviaGameBackendBaseImagePipeline extends cdk.Stack {
    constructor(parent: cdk.App, name: string, props: TriviaGameGitRepoProps) {
        super(parent, name, props);

        const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
            pipelineName: 'reinvent-trivia-game-base-image',
        });

        // Source
        const githubAccessToken = new cdk.SecretParameter(this, 'GitHubToken', { ssmParameter: 'GitHubToken' });
        new codepipeline.GitHubSourceAction(this, 'GitHubSource', {
            stage: pipeline.addStage('Source'),
            owner: props.repoOwner,
            repo: props.repoName,
            oauthToken: githubAccessToken.value
        });

        // Build
        const buildStage = pipeline.addStage('Build');
        const project = new codebuild.PipelineProject(this, 'BuildBaseImage', {
            buildSpec: 'trivia-backend/base/buildspec.yml',
            environment: {
                buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_DOCKER_17_09_0,
                privileged: true
            }
        });
        project.addToRolePolicy(new iam.PolicyStatement()
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
        project.addToPipeline(buildStage, 'CodeBuild');
    }
}

const app = new cdk.App();
const repoOwner = (process.env.GIT_REPO_OWNER) ? process.env.GIT_REPO_OWNER : 'aws-samples';
const repoName = (process.env.GIT_REPO_NAME) ? process.env.GIT_REPO_NAME : 'aws-reinvent-2018-trivia-game';
new TriviaGameBackendBaseImagePipeline(app, 'TriviaGameBackendBaseImagePipeline', {
    repoOwner: repoOwner,
    repoName: repoName
});
app.run();