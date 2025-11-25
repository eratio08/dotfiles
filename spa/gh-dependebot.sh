#!/bin/bash

repos=(
  # "sportalliance/fi-perdix"
  "sportalliance/setup-mvnd-action"
  "sportalliance/spa-download-workflow-artifacts-action"
  "sportalliance/spa-typescript-action-template"
  "sportalliance/setup-gh-cli-action"
  "sportalliance/spa-datadog-downtime-action"
  "sportalliance/fc-jira-release-action"
  "sportalliance/spa-wiz-actions"
  "sportalliance/terraform-provider-netbird"
  "eratio08/vitest-mock-extended"
  "eratio08/vitest-teamcity-reporter"
)

approve_prs() {
  # Set repository as script argument
  local repository=$1

  # If no repository is supplied, exit with error message
  if [ -z "$repository" ]; then
    echo "Error: No repository provided. Please provide a repository as an argument in the format 'owner/repo'."
    exit 1
  fi

  echo "Fetching pull requests from $repository by dependabot..."

  # Fetch all pull requests from dependabot that are not already approved
  prs=$(gh pr list -R "$repository" --json number,author,reviewDecision,isDraft -q '.[] | select(.author.login == "app/dependabot" and .author.is_bot == true and .reviewDecision != "APPROVED" and .isDraft == false) | .number')

  # Check if PRs by dependabot were found
  if [ -z "$prs" ]; then
    echo "No unapproved pull requests by dependabot found."
  else
    echo "Found the following unapproved PR numbers by dependabot:"
    echo "$prs"

    # Loop through all the PRs
    for pr in $prs
    do
      echo "Approving PR #$pr..."
      # Approve the PR with the review comment
      gh pr review "$pr" --approve --body "@dependabot squash and merge" -R "$repository"
      echo "PR #$pr approved with comment."
    done

    echo "All unapproved dependabot PRs now approved."
  fi
}

for i in "${repos[@]}"
do
  echo "Inspecting $i..."
  approve_prs $i
  echo ""
done
