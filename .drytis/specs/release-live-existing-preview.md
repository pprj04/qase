# #11554 Replace production and release the current preview to qase.drytis.com

Promote the exact application version currently represented by the project 3542
worktree and preview to the `LIVE` branch, fully delete the existing production
deployment and persistent volume, then create a fresh production deployment for
the user-provided `qase.drytis.com` domain. Preserve unrelated worktree content.

## Acceptance criteria

- [x] The board ticket is In Progress and incoming remote changes were checked.
- [ ] The complete worktree is reviewed, contains no accidental credentials or
      corruption artifacts, and is captured in a reproducible release commit.
- [ ] Unit/integration tests and the repository verification command pass.
- [ ] The production command, background services, root proxy, setup script,
      environment registration, and preview HTTP health pass the infrastructure
      gate.
- [ ] Independent code review and browser testing approve the release candidate.
- [ ] The verified release commit is published from `LIVE` without a force update.
- [ ] The existing production deployment and persistent volume are deleted only
      after the replacement inputs and release commit are ready.
- [ ] A fresh production deployment is created from that commit and
      `https://qase.drytis.com` serves the expected Qase application over HTTPS.
- [ ] The release ticket records the commit, deployment action, and test evidence
      before moving to In Review.

## Safety constraints

- The user explicitly authorized deletion of the existing production deployment
  and persistent volume for this replacement.
- Do not delete production until the required domain, certificate contact email,
  verified release commit, and project-selection control plane are ready.
- Do not force-update shared branches or overwrite unrelated worktree changes.
- Do not claim success from HTTP status alone; verify the served application
  identity and production health after deployment.
