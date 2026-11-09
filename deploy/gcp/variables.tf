# Defines deployment identities, OpenAI federation mapping IDs, and independent AI activation.
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
  description = "Enable admission and execution after configuring the OpenAI workload identity mapping."
}
variable "openai_identity_provider_id" {
  type        = string
  default     = ""
  description = "ID of the OpenAI workload identity provider that trusts Google-issued worker tokens."
}
variable "openai_service_account_id" {
  type        = string
  default     = ""
  description = "OpenAI service account ID targeted by the worker's identity mapping."
}
variable "retain_legacy_ai_key_access" {
  type        = bool
  default     = false
  description = "Preserve secret access for the serving pre-federation worker revision during cutover."
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
