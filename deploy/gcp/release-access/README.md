# Terraform release access

This Terraform root owns the Google identities used by the workflow to plan and apply the application state. Run it with an operator credential using Terraform 1.13.5 and the committed provider lockfile. Initialize `deploy/gcp/release-access`, save and review a plan, then apply that saved plan. The root uses the `release-access` prefix in the existing production state bucket.

The `provider` and `service_account` outputs contain the values for each GitHub environment. The planner can read application state and create or delete its lock. The applier can also write application state and perform the operational changes listed in [main.tf](main.tf). Each identity trusts only the immutable GitHub repository subject for its own environment on `master`. [GCP release protection](../README.md#release-protection) describes the matching GitHub settings and secrets.
