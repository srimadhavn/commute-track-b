# Git workflow

This project uses a small, strict workflow so every change is reviewable and traceable.

## Branches
- `main` is always deployable. Nothing is committed to it directly.
- Work happens on short-lived branches named `<type>/<short-description>`:
  `feat/alertmanager`, `fix/loki-healthcheck`, `chore/dependabot`, `docs/readme`, `ci/trivy-scan`, `infra/terraform-vm`.
- Each branch is merged into `main` through a **pull request**. CI must pass before merging.

## Commit messages (Conventional Commits)
`<type>(<scope>): <summary>`, for example `feat(api): reject out-of-area locations`.

| Type | Use for |
|---|---|
| `feat` | new behaviour |
| `fix` | bug fix |
| `ci` | pipelines and automation |
| `infra` | Terraform, Ansible, Kubernetes manifests |
| `docs` | documentation only |
| `chore` | tooling, dependencies |
| `test` | tests only |

## Releases
Milestones are tagged with annotated tags (`v0.1.0` = local stack + monitoring). Tags are what get deployed.

## Never commit
Secrets (`.env`, keys, tokens, Terraform state, `*.tfvars`). They are in `.gitignore`, and CI scans history for leaked secrets.
