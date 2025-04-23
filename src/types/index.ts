/**
 * Configuration for the CLI tool
 */
export interface Config {
  // GitHub configuration
  github: {
    token: string;
    owner: string;
    repo: string;
    baseBranch: string;
  };
  // LLM configuration
  llm: {
    provider: 'openai' | 'azure' | 'anthropic' | 'custom';
    apiKey: string;
    model: string;
    endpoint?: string;
  };
  // Git configuration
  git: {
    authorName?: string;
    authorEmail?: string;
  };
}

/**
 * Type for commit data
 */
export interface CommitData {
  hash: string;
  message: string;
  date: string;
  author: string;
}

/**
 * Result of analyzing git changes
 */
export interface GitChanges {
  changedFiles: string[];
  diff: string;
  branch: string;
  uncommittedChanges: boolean;
  unpushedCommits: CommitData[];
}

/**
 * Result from the LLM analysis
 */
export interface LLMResult {
  commitMessage?: string;
  prTitle?: string;
  prDescription?: string;
}

/**
 * Pull request creation result
 */
export interface PullRequestResult {
  url: string;
  number: number;
  title: string;
}

/**
 * Command options for the CLI
 */
export interface CommandOptions {
  configPath?: string;
  branch?: string;
  dryRun?: boolean;
  verbose?: boolean;
  autoCommit?: boolean;
  autoPush?: boolean;
  openPr?: boolean;
}