# Manages release federation, application state access, and the applier's production image access.
terraform {
  required_version = "= 1.13.5"
  backend "gcs" {
    bucket = "little-say-tfstate-1003645384869"
    prefix = "release-access"
  }
  required_providers {
    google = { source = "hashicorp/google", version = "7.46.2" }
  }
}

provider "google" { project = "little-say" }

locals {
  environments   = { plan = "gcp-terraform-plan", apply = "gcp-terraform-apply" }
  subject        = "repo:darkmachines-net@347558273/little-say@1403932361:environment:"
  state_bucket   = "little-say-tfstate-1003645384869"
  state_resource = "projects/_/buckets/${local.state_bucket}"
  state_file     = "${local.state_resource}/objects/application/default.tfstate"
  lock_file      = "${local.state_resource}/objects/application/default.tflock"

  # Only the reads used by existing resources and data sources in deploy/gcp.
  read_permissions = [
    "artifactregistry.repositories.get", "artifactregistry.repositories.getIamPolicy",
    "billing.resourcebudgets.read", "cloudscheduler.jobs.get", "cloudsql.databases.get",
    "cloudsql.instances.get", "cloudsql.users.list", "cloudtasks.queues.get",
    "firebase.clients.get", "firebase.clients.list", "firebase.projects.get", "firebaseauth.configs.get",
    "firebasehosting.sites.get", "iam.roles.get", "iam.serviceAccounts.get",
    "iam.serviceAccounts.getIamPolicy", "iam.workloadIdentityPools.get", "iam.workloadIdentityPools.getAttestationRules", "iam.workloadIdentityPoolProviders.get",
    "monitoring.alertPolicies.get", "monitoring.notificationChannels.get", "monitoring.uptimeCheckConfigs.get",
    "resourcemanager.projects.get", "resourcemanager.projects.getIamPolicy", "run.jobs.get", "run.operations.get",
    "run.services.get", "run.services.getIamPolicy", "secretmanager.secrets.get", "secretmanager.secrets.getIamPolicy",
    "secretmanager.versions.get", "serviceusage.services.use", "storage.buckets.get", "storage.buckets.getIamPolicy",
  ]

  # Operational changes in the application module. Identity and database lifecycle changes use the operator's approval path.
  write_permissions = [
    "cloudscheduler.jobs.create", "cloudscheduler.jobs.update",
    "cloudtasks.queues.create", "cloudtasks.queues.update",
    "firebaseauth.configs.update", "monitoring.alertPolicies.create", "monitoring.alertPolicies.update",
    "monitoring.notificationChannels.create", "monitoring.notificationChannels.update",
    "monitoring.uptimeCheckConfigs.create", "monitoring.uptimeCheckConfigs.update",
    "run.jobs.update", "run.services.update",
  ]
}

resource "google_service_account" "terraform" {
  for_each     = local.environments
  account_id   = "little-say-tf-${each.key}"
  display_name = "Little Say Terraform ${each.key}"
}
resource "google_iam_workload_identity_pool" "terraform" {
  workload_identity_pool_id = "little-say-terraform"
  display_name              = "Little Say Terraform"
}
resource "google_iam_workload_identity_pool_provider" "terraform" {
  for_each                           = local.environments
  workload_identity_pool_id          = google_iam_workload_identity_pool.terraform.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-${each.key}"
  attribute_mapping                  = { "google.subject" = "assertion.sub" }
  attribute_condition                = "assertion.repository == 'darkmachines-net/little-say' && assertion.ref == 'refs/heads/master' && assertion.environment == '${each.value}' && assertion.sub == '${local.subject}${each.value}'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
resource "google_service_account_iam_member" "terraform" {
  for_each           = local.environments
  service_account_id = google_service_account.terraform[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.terraform.name}/subject/${local.subject}${each.value}"
}

resource "google_project_iam_custom_role" "read" {
  role_id     = "littleSayTerraformRead"
  title       = "Little Say Terraform refresh"
  permissions = local.read_permissions
}
resource "google_project_iam_custom_role" "write" {
  role_id     = "littleSayTerraformWrite"
  title       = "Little Say Terraform operational changes"
  permissions = local.write_permissions
}
resource "google_project_iam_member" "read" {
  for_each = local.environments
  project  = "little-say"
  role     = google_project_iam_custom_role.read.name
  member   = google_service_account.terraform[each.key].member
}
resource "google_project_iam_member" "write" {
  project = "little-say"
  role    = google_project_iam_custom_role.write.name
  member  = google_service_account.terraform["apply"].member
}

resource "google_project_iam_custom_role" "state_read" {
  role_id     = "littleSayTerraformStateRead"
  title       = "Little Say Terraform state read"
  permissions = ["storage.objects.get", "storage.objects.list"]
}
resource "google_project_iam_custom_role" "state_write" {
  role_id     = "littleSayTerraformStateWrite"
  title       = "Little Say Terraform state lock or write"
  permissions = ["storage.objects.create", "storage.objects.delete"]
}
resource "google_storage_bucket_iam_member" "state_read" {
  for_each = local.environments
  bucket   = local.state_bucket
  role     = google_project_iam_custom_role.state_read.name
  member   = google_service_account.terraform[each.key].member
  condition {
    title      = "read-application-state-and-lock"
    expression = "resource.name == '${local.state_resource}' || resource.name == '${local.state_file}' || resource.name == '${local.lock_file}'"
  }
}
resource "google_storage_bucket_iam_member" "state_write" {
  for_each = local.environments
  bucket   = local.state_bucket
  role     = google_project_iam_custom_role.state_write.name
  member   = google_service_account.terraform[each.key].member
  condition {
    title      = each.key == "apply" ? "write-application-state-and-lock" : "write-application-lock"
    expression = "resource.name == '${local.lock_file}'${each.key == "apply" ? " || resource.name == '${local.state_file}'" : ""}"
  }
}

resource "google_service_account_iam_member" "act_as" {
  for_each           = toset(["api", "worker", "migrator", "scheduler"])
  service_account_id = "projects/little-say/serviceAccounts/little-say-${each.key}@little-say.iam.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.terraform["apply"].member
}

resource "google_artifact_registry_repository_iam_member" "applier" {
  location   = "us-central1"
  repository = "application"
  role       = "roles/artifactregistry.reader"
  member     = google_service_account.terraform["apply"].member
}

output "provider" { value = { for mode, provider in google_iam_workload_identity_pool_provider.terraform : mode => provider.name } }
output "service_account" { value = { for mode, account in google_service_account.terraform : mode => account.email } }
