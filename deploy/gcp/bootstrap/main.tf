# Establishes billing/API prerequisites and a versioned, private Terraform state bucket for the existing project.
terraform {
  required_version = ">= 1.5, < 2.0"
  required_providers {
    google = {
      source = "hashicorp/google", version = "~> 7.0"
    }
  }
}
provider "google" {
  project = "little-say"
}
resource "google_project" "app" {
  project_id      = "little-say"
  name            = "Little Say"
  billing_account = "01E081-A8027C-EC4F62"
  deletion_policy = "PREVENT"
  lifecycle {
    prevent_destroy = true
  }
}
import {
  to = google_project.app
  id = "little-say"
}
resource "google_project_service" "api" {
  for_each           = toset(["serviceusage.googleapis.com", "cloudresourcemanager.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "storage.googleapis.com", "firebase.googleapis.com", "firebasehosting.googleapis.com", "identitytoolkit.googleapis.com", "run.googleapis.com", "sqladmin.googleapis.com", "cloudtasks.googleapis.com", "cloudscheduler.googleapis.com", "artifactregistry.googleapis.com", "secretmanager.googleapis.com", "monitoring.googleapis.com", "logging.googleapis.com", "billingbudgets.googleapis.com"])
  project            = google_project.app.project_id
  service            = each.value
  disable_on_destroy = false
}
resource "google_storage_bucket" "state" {
  name                        = "little-say-tfstate-1003645384869"
  location                    = "US-CENTRAL1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning {
    enabled = true
  }
  lifecycle {
    prevent_destroy = true
  }
  depends_on = [google_project_service.api]
}
