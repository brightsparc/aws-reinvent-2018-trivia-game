#!/usr/bin/env node
import cdk = require('@aws-cdk/cdk');
import { TriviaGameCfnPipeline, TriviaGameGitRepoProps } from './pipeline';

class TriviaGameStaticSiteInfraPipelineStack extends cdk.Stack {
    constructor(parent: cdk.App, name: string, props: TriviaGameGitRepoProps) {
        super(parent, name, props);

        new TriviaGameCfnPipeline(this, 'Pipeline', {
            repoOwner: props.repoOwner,
            repoName: props.repoName,
            pipelineName: 'static-site-infra',
            stackName: 'StaticSiteInfra',
            templateName: 'StaticSiteInfra',
            directory: 'static-site/cdk'
        });
    }
}

const app = new cdk.App();
const repoOwner = (process.env.GIT_REPO_OWNER) ? process.env.GIT_REPO_OWNER : 'aws-samples';
const repoName = (process.env.GIT_REPO_NAME) ? process.env.GIT_REPO_NAME : 'aws-reinvent-2018-trivia-game';
new TriviaGameStaticSiteInfraPipelineStack(app, 'TriviaGameStaticSiteInfraPipeline', {
    repoOwner: repoOwner,
    repoName: repoName
});
app.run();