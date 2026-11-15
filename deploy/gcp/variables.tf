# Defines deployment identities, OpenAI federation, and shared limits for accounts, workers, and image calls.
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
variable "ai_limits" {
  description = "Hosted AI limits shared by the API, worker, and Cloud Tasks queues. See apps/server/src/hosting/README.md."
  type = object({
    account_board_starts_per_minute = optional(number, 2)
    account_board_outstanding       = optional(number, 2)
    account_board_concurrency       = optional(number, 1)
    account_job_starts_per_minute   = optional(number, 30)
    account_job_outstanding         = optional(number, 2)
    service_foreground_concurrency  = optional(number, 8)
    service_speech_concurrency      = optional(number, 4)
    account_image_concurrency       = optional(number, 9)
    service_image_concurrency       = optional(number, 50)
  })
  default  = {}
  nullable = false
  validation {
    condition = alltrue([
      var.ai_limits.account_board_concurrency <= var.ai_limits.account_board_outstanding,
      alltrue([for name, maximum in {
        account_board_starts_per_minute = 120
        account_board_outstanding       = 24
        account_board_concurrency       = 8
        account_job_starts_per_minute   = 240
        account_job_outstanding         = 24
        service_foreground_concurrency  = 16
        service_speech_concurrency      = 8
        account_image_concurrency       = 24
        service_image_concurrency       = 100
      } : var.ai_limits[name] >= 1 && var.ai_limits[name] <= maximum && floor(var.ai_limits[name]) == var.ai_limits[name]])
    ])
    error_message = "AI limits must be whole numbers within their documented ranges. Board concurrency cannot exceed outstanding board work."
  }
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
