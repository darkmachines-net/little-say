# Restricts runtime credentials to attached identities and releases to immutable GitHub repository/environment identity.
resource "google_service_account" "service" {
  for_each     = toset(["api", "worker", "migrator", "tasks", "scheduler", "release"])
  account_id   = "little-say-${each.key}"
  display_name = "Little Say ${each.key}"
}
locals {
  project_roles = {
    api      = ["roles/cloudsql.client", "roles/firebaseauth.viewer", "roles/cloudtasks.enqueuer"]
    worker   = ["roles/cloudsql.client", "roles/firebaseauth.admin", "roles/cloudtasks.enqueuer"]
    migrator = ["roles/cloudsql.client"]
    release  = ["roles/run.developer", "roles/firebasehosting.admin", "roles/firebase.viewer", "roles/serviceusage.serviceUsageConsumer"]

  }
  memberships = merge([for identity, roles in local.project_roles : {
    for role in roles : "${identity}-${role}" => {
      identity = identity, role = role
    }
  }]...)
}
resource "google_project_iam_member" "runtime" {
  for_each = local.memberships
  project  = var.project_id
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.service[each.value.identity].email}"
}
resource "google_storage_bucket_iam_member" "media" {
  for_each = {
    api = "roles/storage.objectUser", worker = "roles/storage.objectUser"
  }
  bucket = google_storage_bucket.media.name
  role   = each.value
  member = "serviceAccount:${google_service_account.service[each.key].email}"
}
resource "google_artifact_registry_repository_iam_member" "release" {
  repository = google_artifact_registry_repository.application.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.service["release"].email}"
}
resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each = {
    api = "database-runtime", worker = "database-runtime", migrator = "database-migrator", provider = "ai-provider-key"
  }
  secret_id = google_secret_manager_secret.secret[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.service[each.key == "provider" ? "worker" : each.key].email}"
}
resource "google_service_account_iam_member" "dispatch" {
  for_each           = toset(["api", "worker"])
  service_account_id = google_service_account.service["tasks"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.service[each.key].email}"
}
resource "google_service_account_iam_member" "release_runtime" {
  for_each           = toset(["api", "worker", "migrator"])
  service_account_id = google_service_account.service[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.service["release"].email}"
}
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-release"
}
resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject" = "assertion.sub", "attribute.repository" = "assertion.repository"
  }
  # GitHub's immutable subject embeds owner/repository IDs; a same-name replacement must not inherit deployment access.
  attribute_condition = "assertion.repository == 'darkmachines-net/little-say' && assertion.ref == 'refs/heads/master' && assertion.sub == 'repo:darkmachines-net@347558273/little-say@1403932361:environment:gcp-production'"
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}
resource "google_service_account_iam_member" "federation" {
  service_account_id = google_service_account.service["release"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/darkmachines-net/little-say"
}
resource "google_project_iam_custom_role" "sessions" {
  role_id     = "littleSaySessionIssuer"
  title       = "Little Say session issuer"
  permissions = ["firebaseauth.users.createSession"]
}
resource "google_project_iam_member" "sessions" {
  project = var.project_id
  role    = google_project_iam_custom_role.sessions.name
  member  = "serviceAccount:${google_service_account.service["api"].email}"
}
