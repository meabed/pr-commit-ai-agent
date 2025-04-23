import { Octokit } from 'octokit';
import { Config, PullRequestResult } from '../types/index.js';
import { exec } from 'child_process';

/**
 * Service for interacting with GitHub API
 */
export class GitHubService {
  private octokit: Octokit;
  private config: Config;
  
  /**
   * Create a new GitHubService
   * @param config Configuration for GitHub API
   */
  constructor(config: Config) {
    this.config = config;
    this.octokit = new Octokit({ auth: config.github.token });
  }
  
  /**
   * Create a pull request
   * @param params Parameters for the pull request
   * @returns Created pull request information
   */
  async createPullRequest(params: {
    head: string;
    base?: string;
    title: string;
    body: string;
    owner?: string;
    repo?: string;
  }): Promise<PullRequestResult> {
    const {
      head,
      title,
      body,
      owner = this.config.github.owner,
      repo = this.config.github.repo,
      base = this.config.github.baseBranch
    } = params;
    
    try {
      const response = await this.octokit.rest.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base
      });
      
      return {
        url: response.data.html_url,
        number: response.data.number,
        title: response.data.title
      };
    } catch (error) {
      throw new Error(`Failed to create pull request: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get repository information
   * @param owner Repository owner
   * @param repo Repository name
   * @returns Repository information
   */
  async getRepository(owner: string = this.config.github.owner, repo: string = this.config.github.repo) {
    try {
      const response = await this.octokit.rest.repos.get({
        owner,
        repo
      });
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get repository information: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Check if a pull request already exists
   * @param branch Branch name to check for existing PRs
   * @returns True if a PR already exists for the branch
   */
  async pullRequestExists(branch: string): Promise<boolean> {
    try {
      const pulls = await this.octokit.rest.pulls.list({
        owner: this.config.github.owner,
        repo: this.config.github.repo,
        head: `${this.config.github.owner}:${branch}`,
        state: 'open'
      });
      
      return pulls.data.length > 0;
    } catch (error) {
      console.error(`Error checking for existing PRs: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Open the pull request in a browser
   * @param url Pull request URL
   */
  openPullRequest(url: string): void {
    // Choose the appropriate open command based on the platform
    let command;
    switch (process.platform) {
      case 'darwin':
        command = `open "${url}"`;
        break;
      case 'win32':
        command = `start "${url}"`;
        break;
      default:
        command = `xdg-open "${url}"`;
        break;
    }
    
    exec(command, (error: Error | null) => {
      if (error) {
        console.error(`Failed to open URL: ${error.message}`);
      }
    });
  }
}