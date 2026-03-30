#!/bin/bash

add-worktree() {
  local ticket="$1"
  local common_git_dir repo_root repo_name parent_dir worktree_path branch
  if [[ -z "$ticket" ]]; then
    printf 'Usage: add-worktree <ticket-nr>\n' >&2
    return 1
  fi
  common_git_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
    printf 'Not inside a git repository\n' >&2
    return 1
  }
  repo_root="$(dirname "$common_git_dir")"
  repo_name="$(basename "$repo_root")"
  parent_dir="$(dirname "$repo_root")"
  branch="$ticket"
  worktree_path="${parent_dir}/${repo_name}-${ticket}"
  if [[ -e "$worktree_path" ]]; then
    printf 'Target already exists: %s\n' "$worktree_path" >&2
    return 1
  fi
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git worktree add "$worktree_path" "$branch"
  else
    git worktree add "$worktree_path" "$branch" 2>/dev/null || git worktree add -b "$branch" "$worktree_path"
  fi
}

remove-worktree() {
  local ticket="$1"
  local delete_branch="$2"
  local common_git_dir repo_root repo_name parent_dir worktree_path branch
  if [[ -z "$ticket" ]]; then
    printf 'Usage: remove-worktree <ticket-nr> [--delete-branch]\n' >&2
    return 1
  fi
  common_git_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
    printf 'Not inside a git repository\n' >&2
    return 1
  }
  repo_root="$(dirname "$common_git_dir")"
  repo_name="$(basename "$repo_root")"
  parent_dir="$(dirname "$repo_root")"
  branch="$ticket"
  worktree_path="${parent_dir}/${repo_name}-${ticket}"
  git worktree remove "$worktree_path" || return 1
  if [[ "$delete_branch" == "--delete-branch" ]]; then
    git branch -d "$branch"
  fi
}
