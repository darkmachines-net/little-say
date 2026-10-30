# Registers existing native package/bundle identities and managed HTTPS domain ownership in Firebase.
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
