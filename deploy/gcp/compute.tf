# Runs immutable API/worker revisions with a pinned worker secret and a separately privileged migration job.
locals {
  runtime_env = {
    NODE_ENV                      = "production", HOST = "0.0.0.0", PGHOST = "/cloudsql/${google_sql_database_instance.postgres.connection_name}", PGDATABASE = google_sql_database.app.name,
    PGUSER                        = google_sql_user.database["runtime"].name, PGPOOL_MAX = "3", PGSSLMODE = "disable", MEDIA_BUCKET = google_storage_bucket.media.name,
    FIREBASE_PROJECT_ID           = var.project_id, FIREBASE_API_KEY = data.google_firebase_web_app_config.client.api_key,
    FIREBASE_APP_ID               = google_firebase_web_app.client.app_id, FIREBASE_AUTH_DOMAIN = "${var.project_id}.firebaseapp.com",
    FIREBASE_AUTH_PROVIDERS       = join(",", compact(["password", var.google_web_client_id != "" ? "google.com" : "", var.apple_service_id != "" ? "apple.com" : ""])),
    FIREBASE_GOOGLE_WEB_CLIENT_ID = var.google_web_client_id, FIREBASE_GOOGLE_IOS_CLIENT_ID = var.google_ios_client_id,
    FIREBASE_APPLE_SERVICE_ID     = var.apple_service_id, FIREBASE_APPLE_REDIRECT_URI = "https://${var.project_id}.firebaseapp.com/__/auth/handler",
    ALLOWED_ORIGINS               = "https://littlesay.app,https://little-say.web.app,https://little-say.firebaseapp.com", AAC_AI_ENABLED = tostring(var.ai_enabled),
    TASKS_QUEUE                   = google_cloud_tasks_queue.ai.id, TASKS_INVOKER = google_service_account.service["tasks"].email

  }
  # Deterministic Cloud Run URL avoids a dependency cycle between the API and worker settings.
  worker_url = "https://little-say-worker-${data.google_project.app.number}.${var.region}.run.app"
}
resource "google_cloud_run_v2_service" "service" {
  for_each            = var.image == "" ? toset([]) : toset(["api", "worker"])
  name                = "little-say-${each.key}"
  location            = var.region
  deletion_protection = true
  ingress             = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = google_service_account.service[each.key].email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    timeout                          = each.key == "worker" ? "1800s" : "60s"
    max_instance_request_concurrency = each.key == "worker" ? 1 : 40
    scaling {
      min_instance_count = 0
      max_instance_count = each.key == "worker" ? 2 : 3

    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }

    }
    containers {
      image   = var.image
      command = ["node"]
      args    = [each.key == "worker" ? "server/worker.js" : "server/index.js"]
      ports {
        container_port = 8787
      }
      resources {
        limits = {
          cpu = "1", memory = "1Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true

      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"

      }
      dynamic "env" {
        for_each = merge(local.runtime_env, {
          WORKER_URL = local.worker_url, WORKER_MODE = each.key == "worker" ? "cloud" : "api", AAC_AI_WORKER_CONFIGURED = tostring(var.ai_enabled)
        })
        content {
          name  = env.key
          value = env.value

        }

      }
      env {
        name = "PGPASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secret["database-runtime"].secret_id
            version = google_secret_manager_secret_version.database["runtime"].version

          }

        }

      }
      dynamic "env" {
        for_each = each.key == "worker" && var.ai_provider_key_version != "" ? [1] : []
        content {
          name = "AAC_OPENAI_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secret["ai-provider-key"].secret_id
              version = var.ai_provider_key_version

            }

          }

        }

      }
      startup_probe {
        http_get {
          path = each.key == "worker" ? "/health" : "/api/ready"
        }
        initial_delay_seconds = 2
        period_seconds        = 5
        failure_threshold     = 20
        timeout_seconds       = 3

      }
      liveness_probe {
        http_get {
          path = each.key == "worker" ? "/health" : "/api/ready"
        }
        period_seconds  = 30
        timeout_seconds = 5

      }

    }

  }
  lifecycle {
    # Leave revision unset: retaining a release-created name prevents changing its immutable configuration.
    ignore_changes = [template[0].containers[0].image, client, client_version, traffic]
    precondition {
      condition     = !var.ai_enabled || var.ai_provider_key_version != ""
      error_message = "Provision and select an ai-provider-key secret version before enabling AI."
    }
  }
  depends_on = [google_project_iam_member.runtime, google_secret_manager_secret_iam_member.runtime]
}
resource "google_cloud_run_v2_service_iam_member" "api" {
  count    = var.image == "" ? 0 : 1
  name     = google_cloud_run_v2_service.service["api"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
resource "google_cloud_run_v2_service_iam_member" "worker" {
  for_each = var.image == "" ? toset([]) : toset(["tasks", "scheduler", "release"])
  name     = google_cloud_run_v2_service.service["worker"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.service[each.key].email}"
}
resource "google_cloud_run_v2_job" "migrate" {
  count               = var.image == "" ? 0 : 1
  name                = "little-say-migrate"
  location            = var.region
  deletion_protection = true
  template {
    template {
      service_account = google_service_account.service["migrator"].email
      max_retries     = 0
      timeout         = "600s"
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }

      }
      containers {
        image   = var.image
        command = ["node", "server/database-cli.js", "migrate"]
        resources {
          limits = {
            cpu = "1", memory = "512Mi"
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"

        }
        dynamic "env" {
          for_each = {
            NODE_ENV = "production", PGHOST = "/cloudsql/${google_sql_database_instance.postgres.connection_name}", PGDATABASE = google_sql_database.app.name, PGUSER = google_sql_user.database["migrator"].name, PGSSLMODE = "disable", PGPOOL_MAX = "1", RUNTIME_DB_USER = google_sql_user.database["runtime"].name
          }
          content {
            name  = env.key
            value = env.value

          }

        }
        env {
          name = "PGPASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secret["database-migrator"].secret_id
              version = google_secret_manager_secret_version.database["migrator"].version

            }

          }

        }

      }

    }

  }
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_secret_manager_secret_iam_member.runtime]
}
resource "google_cloud_tasks_queue" "ai" {
  name     = "little-say-ai"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 2
    max_dispatches_per_second = 2

  }
  retry_config {
    max_attempts       = 100
    max_retry_duration = "86400s"
    min_backoff        = "5s"
    max_backoff        = "300s"
    max_doublings      = 5

  }
}
resource "google_cloud_scheduler_job" "maintenance" {
  count            = var.image == "" ? 0 : 1
  name             = "little-say-maintenance"
  region           = var.region
  schedule         = "*/5 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "300s"
  http_target {
    http_method = "POST"
    uri         = "${local.worker_url}/internal/maintenance"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }
    oidc_token {
      service_account_email = google_service_account.service["scheduler"].email
      audience              = local.worker_url

    }

  }
  depends_on = [google_cloud_run_v2_service_iam_member.worker]
}
