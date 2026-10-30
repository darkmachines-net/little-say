# Pins provider families and stores infrastructure state outside the application/media bucket.
terraform {
  required_version = ">= 1.5, < 2.0"
  backend "gcs" {
    bucket = "little-say-tfstate-1003645384869"
    prefix = "application"

  }
  required_providers {
    google = {
      source = "hashicorp/google", version = "~> 7.0"
    }
    google-beta = {
      source = "hashicorp/google-beta", version = "~> 7.0"
    }
    random = {
      source = "hashicorp/random", version = "~> 3.7"
    }

  }
}
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
data "google_project" "app" {}
check "project_identity" {
  assert {
    condition     = data.google_project.app.number == "1003645384869"
    error_message = "Refusing infrastructure changes outside the approved Little Say project."

  }
}
