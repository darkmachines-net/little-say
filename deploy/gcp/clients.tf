# Registers store/development Firebase identities, development signing fingerprints and managed HTTPS domain ownership.
resource "google_firebase_android_app" "android" {
  provider     = google-beta
  project      = var.project_id
  display_name = "Little Say Android"
  package_name = "net.darkmachines.littlesay"
  depends_on   = [google_firebase_project.app]
}
resource "google_firebase_apple_app" "ios" {
  provider     = google-beta
  project      = var.project_id
  display_name = "Little Say iOS"
  bundle_id    = "net.darkmachines.littlesay"
  app_store_id = "6826487372"
  depends_on   = [google_firebase_project.app]
}
resource "google_firebase_android_app" "android_development" {
  provider     = google-beta
  project      = var.project_id
  display_name = "Little Say Android Development"
  package_name = "net.darkmachines.littlesay.development"
  # EAS development keystore; update these public fingerprints when rotating its signing certificate.
  sha1_hashes   = ["36e0d4d5ac1a280d954ce39998a4a11fdf5249af"]
  sha256_hashes = ["86d10d9b3549dc3da76e17991c295296122744367ece7d6ad4ecfc6c104e6ae5"]
  depends_on    = [google_firebase_project.app]
}
resource "google_firebase_apple_app" "ios_development" {
  provider     = google-beta
  project      = var.project_id
  display_name = "Little Say iOS Development"
  bundle_id    = "net.darkmachines.littlesay.development"
  depends_on   = [google_firebase_project.app]
}
resource "google_firebase_hosting_custom_domain" "app" {
  provider      = google-beta
  project       = var.project_id
  site_id       = google_firebase_hosting_site.app.site_id
  custom_domain = "littlesay.app"
  depends_on    = [google_firebase_project.app]
}
resource "google_firebase_hosting_site" "app" {
  provider   = google-beta
  project    = var.project_id
  site_id    = var.project_id
  depends_on = [google_firebase_project.app]
}
