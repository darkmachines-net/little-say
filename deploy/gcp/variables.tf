# Defines deployment identities, a pinned provider-key version, and independent AI activation; key values stay in Secret Manager.
variable "project_id" {
  type    = string
  default = "little-say"
  validation {
    condition     = var.project_id == "little-say"
    error_message = "This deployment is scoped to the approved little-say project."
  }
}
variable "region" {
  type    = string
  default = "us-central1"
}
variable "image" {
  type        = string
  default     = ""
  description = "Verified Artifact Registry image@sha256 digest. Empty provisions foundations only."
  validation {
    condition     = var.image == "" || can(regex("^us-central1-docker.pkg.dev/little-say/application/server@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Deploy an immutable image from the approved registry."

  }
}
variable "alert_email" {
  type        = string
  description = "Operator email for readiness, SQL, job-failure and spending alerts."
}
variable "ai_enabled" {
  type        = bool
  default     = false
  description = "Enable admission and execution only after configuring ai_provider_key_version and completing hosted acceptance."
}
variable "ai_provider_key_version" {
  type        = string
  default     = ""
  description = "Numeric ai-provider-key Secret Manager version to attach only to the worker; empty leaves it unconfigured. This is not the API key."
  validation {
    condition     = var.ai_provider_key_version == "" || can(regex("^[1-9][0-9]*$", var.ai_provider_key_version))
    error_message = "Use an explicit numeric Secret Manager version, or an empty string before provisioning."
  }
}
variable "google_web_client_id" {
  type    = string
  default = ""
}
variable "google_ios_client_id" {
  type    = string
  default = ""
}
variable "apple_service_id" {
  type    = string
  default = ""
}
variable "apple_team_id" {
  type    = string
  default = ""
}
variable "apple_key_id" {
  type    = string
  default = ""
}
