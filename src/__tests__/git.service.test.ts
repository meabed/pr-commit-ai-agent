import { GitService } from '../services/git.service.js';
import { jest, describe, expect, it, beforeEach, afterEach } from '@jest/globals';

// Create mock implementation
const mockGit = {
  branch: jest.fn(),
  status: jest.fn(),
  getRemotes: jest.fn(),
  diff: jest.fn(),
  log: jest.fn(),
  add: jest.fn(),
  commit: jest.fn(),
  push: jest.fn(),
};

// Mock simpleGit function
jest.mock('simple-git', () => ({
  simpleGit: jest.fn().mockReturnValue(mockGit)
}));

// Import simpleGit after mocking
import { simpleGit } from 'simple-git';

describe('GitService', () => {
  let gitService: GitService;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a new GitService instance for each test
    gitService = new GitService();
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', async () => {
      mockGit.branch.mockResolvedValue({ current: 'feature-branch' });
      
      const result = await gitService.getCurrentBranch();
      
      expect(result).toBe('feature-branch');
      expect(mockGit.branch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getRepoInfo', () => {
    it('should extract owner and repo from HTTPS URL', async () => {
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://github.com/test-owner/test-repo.git' } }
      ]);
      
      const result = await gitService.getRepoInfo();
      
      expect(result).toEqual({
        owner: 'test-owner',
        repo: 'test-repo'
      });
    });

    it('should extract owner and repo from SSH URL', async () => {
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:test-owner/test-repo.git' } }
      ]);
      
      const result = await gitService.getRepoInfo();
      
      expect(result).toEqual({
        owner: 'test-owner',
        repo: 'test-repo'
      });
    });

    it('should throw error if origin remote not found', async () => {
      mockGit.getRemotes.mockResolvedValue([
        { name: 'upstream', refs: { fetch: 'https://github.com/test-owner/test-repo.git' } }
      ]);
      
      await expect(gitService.getRepoInfo()).rejects.toThrow('No remote named "origin" found');
    });

    it('should throw error if URL cannot be parsed', async () => {
      mockGit.getRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'invalid-url' } }
      ]);
      
      await expect(gitService.getRepoInfo()).rejects.toThrow('Could not parse owner and repo from remote URL');
    });
  });

  describe('getChanges', () => {
    it('should return git changes with uncommitted changes', async () => {
      // Set up mock responses
      mockGit.branch.mockResolvedValue({ current: 'feature-branch' });
      mockGit.status.mockResolvedValue({
        not_added: ['new-file.txt'],
        conflicted: [],
        created: ['created-file.js'],
        deleted: [],
        modified: ['modified-file.ts'],
        renamed: [{ from: 'old-name.js', to: 'new-name.js' }],
        isClean: () => false
      });
      mockGit.diff.mockResolvedValue('mock diff content');
      mockGit.log.mockResolvedValue({
        all: [
          { hash: 'abc123', message: 'Test commit', date: '2023-01-01', author_name: 'Test Author' }
        ]
      });

      const changes = await gitService.getChanges();

      expect(changes).toEqual({
        changedFiles: ['new-file.txt', 'created-file.js', 'modified-file.ts', 'new-name.js'],
        diff: 'mock diff content',
        branch: 'feature-branch',
        uncommittedChanges: true,
        unpushedCommits: [
          { hash: 'abc123', message: 'Test commit', date: '2023-01-01', author: 'Test Author' }
        ]
      });
    });

    it('should handle case with no unpushed commits', async () => {
      mockGit.branch.mockResolvedValue({ current: 'main' });
      mockGit.status.mockResolvedValue({
        not_added: [],
        conflicted: [],
        created: [],
        deleted: [],
        modified: [],
        renamed: [],
        isClean: () => true
      });
      mockGit.log.mockRejectedValue(new Error('No upstream branch'));

      const changes = await gitService.getChanges();

      expect(changes).toEqual({
        changedFiles: [],
        diff: '',
        branch: 'main',
        uncommittedChanges: false,
        unpushedCommits: []
      });
    });
  });

  describe('commit', () => {
    it('should stage and commit changes', async () => {
      const commitMessage = 'Test commit message';
      mockGit.add.mockResolvedValue(undefined);
      mockGit.commit.mockResolvedValue({ commit: 'abc123' });

      const result = await gitService.commit(commitMessage);

      expect(result).toBe('abc123');
      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).toHaveBeenCalledWith(commitMessage);
    });
  });

  describe('push', () => {
    it('should push current branch to remote', async () => {
      mockGit.branch.mockResolvedValue({ current: 'feature-branch' });
      mockGit.push.mockResolvedValue(undefined);

      await gitService.push();

      expect(mockGit.push).toHaveBeenCalledWith('origin', 'feature-branch');
    });

    it('should push specified branch to remote', async () => {
      mockGit.push.mockResolvedValue(undefined);

      await gitService.push('custom-branch');

      expect(mockGit.push).toHaveBeenCalledWith('origin', 'custom-branch');
      expect(mockGit.branch).not.toHaveBeenCalled();
    });
  });

  describe('isClean', () => {
    it('should return true for a clean repository', async () => {
      mockGit.status.mockResolvedValue({ isClean: () => true });

      const result = await gitService.isClean();

      expect(result).toBe(true);
    });

    it('should return false for a repository with changes', async () => {
      mockGit.status.mockResolvedValue({ isClean: () => false });

      const result = await gitService.isClean();

      expect(result).toBe(false);
    });
  });
});