import { simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import { GitChanges, CommitData } from '../types/index.js';

/**
 * Service for handling Git operations
 */
export class GitService {
  private git: SimpleGit;
  
  /**
   * Create a new GitService
   * @param repoPath Path to the git repository (defaults to current directory)
   */
  constructor(repoPath: string = process.cwd()) {
    this.git = simpleGit(repoPath);
  }
  
  /**
   * Get the current branch name
   * @returns Current branch name
   */
  async getCurrentBranch(): Promise<string> {
    return (await this.git.branch()).current;
  }
  
  /**
   * Get the repository owner and name from remote URL
   * @returns Object with owner and repo name
   */
  async getRepoInfo(): Promise<{ owner: string; repo: string }> {
    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find(remote => remote.name === 'origin');
    
    if (!origin) {
      throw new Error('No remote named "origin" found');
    }

    // Parse owner and repo from the URL
    // Handle different formats of remote URLs:
    // - https://github.com/owner/repo.git
    // - git@github.com:owner/repo.git
    const url = origin.refs.fetch;
    let match;
    
    if (url.startsWith('https://')) {
      match = url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?/);
    } else {
      match = url.match(/git@github\.com:([^\/]+)\/([^\/\.]+)(\.git)?/);
    }
    
    if (!match) {
      throw new Error(`Could not parse owner and repo from remote URL: ${url}`);
    }
    
    return {
      owner: match[1],
      repo: match[2]
    };
  }
  
  /**
   * Get uncommitted changes and diffs
   * @returns Object with changes information
   */
  async getChanges(): Promise<GitChanges> {
    const branch = await this.getCurrentBranch();
    const status = await this.git.status();
    
    // Check if there are uncommitted changes
    const uncommittedChanges = 
      status.not_added.length > 0 || 
      status.conflicted.length > 0 ||
      status.created.length > 0 || 
      status.deleted.length > 0 || 
      status.modified.length > 0 || 
      status.renamed.length > 0;
    
    // Get list of all changed files
    const changedFiles = [
      ...status.not_added,
      ...status.conflicted,
      ...status.created,
      ...status.deleted,
      ...status.modified,
      ...status.renamed.map(file => file.to)
    ];
    
    // Get diff of uncommitted changes
    const diff = uncommittedChanges 
      ? await this.git.diff() 
      : '';
    
    // Get unpushed commits
    const currentBranchCommits = await this.git.log({ from: 'origin/' + branch, to: branch }).catch(() => ({ all: [] }));
    const unpushedCommits: CommitData[] = currentBranchCommits.all.map(c => ({ 
      hash: c.hash,
      message: c.message,
      date: c.date,
      author: c.author_name
    }));
    
    return {
      changedFiles,
      diff,
      branch,
      uncommittedChanges,
      unpushedCommits
    };
  }
  
  /**
   * Commit changes
   * @param message Commit message
   * @returns Result of the commit operation
   */
  async commit(message: string): Promise<string> {
    await this.git.add('.'); // Stage all changes
    const result = await this.git.commit(message);
    return result.commit;
  }
  
  /**
   * Push changes to remote
   * @param branch Branch to push (defaults to current branch)
   */
  async push(branch?: string): Promise<void> {
    const currentBranch = branch || await this.getCurrentBranch();
    await this.git.push('origin', currentBranch);
  }
  
  /**
   * Check if the repository is clean (no uncommitted changes)
   */
  async isClean(): Promise<boolean> {
    const status = await this.git.status();
    return status.isClean();
  }
}