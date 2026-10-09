# Little Say privacy policy — incomplete, unpublished draft

**Not a finalized legal policy. Do not publish or use this document as an App Store policy URL.** It contains source-grounded preparation and unresolved owner decisions; it makes no compliance claim.

Little Say can be used without an account. Guest boards, photos, pictures and downloaded speech remain on the device. Optional Firebase sign-in enables backup to the selected server after verification. Backups include personal photos and saved voices and can be accessed by the server administrator; they are not end-to-end encrypted.

AI actions send prompts, voice recordings and necessary board words through the selected server to OpenAI. Picture matching/generation can also send descriptions and library/generated picture pixels. Personal photos are never sent to AI. Generated picture/speech caches remain on the server without automatic expiry. The application server does not retain microphone recordings. Provider processing and retention must be assessed separately; `store: false` is not a blanket zero-retention commitment.

Sign-out keeps local copies. Account deletion removes the shared Firebase identity and selected-server backup, with durable retries and a minimal anti-recreation tombstone. Backups on other servers require separate cleanup. Downloaded copies and shared AI caches remain.

Before this becomes a policy, the owner must supply and approve:

- Legal operator, privacy/support contact and authorized public policy location.
- Applicable service/hosting regions, subprocessors, operational logs and database backups.
- Actual retention/deletion schedules, cache and tombstone policy, other-server cleanup process and request handling.
- Intended audience and any child-data handling, jurisdictional obligations, rights/complaint process and effective date.
- Provider terms/retention and the actual production configuration; store labels, category, age rating, tracking and export answers are separate decisions.

See [the source inventory](PRIVACY_INVENTORY.md) for implementation references and evidence limits. No operator, contact, region, duration or legal assurance is inferred here.
