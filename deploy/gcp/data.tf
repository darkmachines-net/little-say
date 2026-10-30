# Owns PostgreSQL, private media, credentials, Firebase account/guest authentication, and the image registry.
resource "google_firebase_project" "app" {
  provider = google-beta
}
resource "google_firebase_web_app" "client" {
  provider     = google-beta
  display_name = "Little Say clients"
  depends_on   = [google_firebase_project.app]
}
data "google_firebase_web_app_config" "client" {
  provider   = google-beta
  web_app_id = google_firebase_web_app.client.app_id
}
resource "google_identity_platform_config" "auth" {
  authorized_domains = ["littlesay.app", "little-say.firebaseapp.com", "little-say.web.app"]
  sign_in {
    anonymous {
      enabled = true
    }
    phone_number {
      enabled = false
    }
    email {
      enabled           = true
      password_required = true

    }

  }
  depends_on = [google_firebase_project.app]
}
resource "google_storage_bucket" "media" {
  name                        = "little-say-media-1003645384869"
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  soft_delete_policy {
    retention_duration_seconds = 604800
  }
  lifecycle {
    prevent_destroy = true
  }
}
resource "google_artifact_registry_repository" "application" {
  repository_id = "application"
  location      = var.region
  format        = "DOCKER"
  docker_config {
    immutable_tags = true
  }
}
resource "google_sql_database_instance" "postgres" {
  name                = "little-say-postgres"
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = true
  settings {
    edition                     = "ENTERPRISE"
    tier                        = "db-g1-small"
    availability_type           = "ZONAL"
    disk_size                   = 10
    disk_type                   = "PD_SSD"
    disk_autoresize             = true
    deletion_protection_enabled = true
    connector_enforcement       = "REQUIRED"
    ip_configuration {
      ipv4_enabled = true
    }
    backup_configuration {
      enabled                        = true
      start_time                     = "08:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
      }

    }
    maintenance_window {
      day          = 7
      hour         = 9
      update_track = "stable"

    }

  }
  lifecycle {
    prevent_destroy = true
  }
}
resource "google_sql_database" "app" {
  name     = "little_say"
  instance = google_sql_database_instance.postgres.name
}
resource "random_password" "database" {
  for_each = toset(["runtime", "migrator"])
  length   = 40
  special  = false
}
resource "google_sql_user" "database" {
  for_each = random_password.database
  instance = google_sql_database_instance.postgres.name
  name     = "little_say_${each.key}"
  password = each.value.result
}
resource "google_secret_manager_secret" "secret" {
  for_each  = toset(["database-runtime", "database-migrator", "ai-provider-key", "google-client-secret", "apple-private-key"])
  secret_id = each.key
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret_version" "database" {
  for_each    = random_password.database
  secret      = google_secret_manager_secret.secret["database-${each.key}"].id
  secret_data = each.value.result
}
