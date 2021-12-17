import { Octokit } from "@octokit/rest";
import { createPullRequest } from "octokit-plugin-create-pull-request";

Octokit.plugin(createPullRequest);
const octokit = new Octokit({
  auth: process.env.OCTOKIT_TOKEN,
});

export { octokit };
