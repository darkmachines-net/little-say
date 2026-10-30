# Sends operator alerts for public readiness, database growth, interrupted jobs, and spending thresholds.
resource "google_monitoring_notification_channel" "operator" {
  display_name = "Little Say operator"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}
resource "google_billing_budget" "launch" {
  billing_account = "01E081-A8027C-EC4F62"
  display_name    = "Little Say launch spending"
  budget_filter {
    projects = ["projects/1003645384869"]
  }
  amount {
    specified_amount {
      currency_code = "USD"
      units         = "100"

    }

  }
  dynamic "threshold_rules" {
    for_each = [0.25, 0.5, 1]
    content {
      threshold_percent = threshold_rules.value
    }

  }
  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.operator.name]
  }
}
resource "google_monitoring_uptime_check_config" "readiness" {
  display_name = "Little Say HTTPS readiness"
  timeout      = "10s"
  period       = "300s"
  http_check {
    path         = "/api/ready"
    port         = 443
    use_ssl      = true
    validate_ssl = true

  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id, host = "littlesay.app"
    }

  }
}
resource "google_monitoring_alert_policy" "readiness" {
  display_name          = "Little Say readiness failing"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.operator.name]
  conditions {
    display_name = "Readiness fails for five minutes"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.readiness.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"

      }

    }

  }
}
resource "google_monitoring_alert_policy" "storage" {
  display_name          = "Little Say SQL storage above 80 percent"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.operator.name]
  conditions {
    display_name = "Database storage pressure"
    condition_threshold {
      filter          = "metric.type=\"cloudsql.googleapis.com/database/disk/utilization\" AND resource.type=\"cloudsql_database\" AND resource.label.database_id=\"${var.project_id}:${google_sql_database_instance.postgres.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"

      }

    }

  }
}
resource "google_monitoring_alert_policy" "jobs" {
  display_name          = "Little Say interrupted AI or maintenance"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.operator.name]
  conditions {
    display_name = "Worker failure log"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"little-say-worker\" AND severity>=ERROR"
    }

  }
  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
    auto_close = "1800s"

  }
}
