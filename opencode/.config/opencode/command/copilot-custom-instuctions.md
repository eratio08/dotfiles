---
description: Create Copilot custom instructions following GitHubs best practices
model: github-copilot/claude-opus-4.5
---

Your task is to "onboard" this repository to a coding agent by adding a .github/copilot-instructions.md file. It should contain information describing how the agent, seeing the repo for the first time, can work most efficiently.

You will do this task only one time per repository, and doing a good job can SIGNIFICANTLY improve the quality of the agent's work, so take your time, think carefully, and search thoroughly before writing the instructions.

## Goals

- Document existing project structure and tech stack.
- Ensure established practices are followed.
- Minimize bash command and build failures.

## Limitations
- Instructions must be no longer than 2 pages.
- Instructions should be broadly applicable to the entire project.

## Guidance

Ensure you include the following:

- A summary of what the app does.
- The tech stack in use
- Coding guidelines
- Project structure
- Existing tools and resources

## Steps to follow

- Perform a comprehensive inventory of the codebase. Search for and view:
  - README.md, CONTRIBUTING.md, and all other documentation files.
  - Search the codebase for indications of workarounds like 'HACK', 'TODO', etc.
- All scripts, particularly those pertaining to build and repo or environment setup.
- All project files.
- All configuration and linting files.
- Document any other steps or information that the agent can use to reduce time spent exploring or trying and failing to run bash commands.

## Validation

Use the newly created instructions file to implement a sample feature. Use the learnings from any failures or errors in building the new feature to further refine the instructions file.
