# Exposes non-secret release configuration and operational resource identifiers.
output "project_id" {
  value = var.project_id
}
output "registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/application/server"
}
output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}
output "release_service_account" {
  value = google_service_account.service["release"].email
}
output "sql_connection" {
  value = google_sql_database_instance.postgres.connection_name
}
output "media_bucket" {
  value = google_storage_bucket.media.name
}
output "worker_url" {
  value = local.worker_url
}
output "api_url" {
  value = try(google_cloud_run_v2_service.service["api"].uri, "")
}
output "firebase_app_id" {
  value = google_firebase_web_app.client.app_id
}
output "domain_dns" {
  value = google_firebase_hosting_custom_domain.app.required_dns_updates
}
