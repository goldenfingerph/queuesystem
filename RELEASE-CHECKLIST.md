# QueueSystem Final Release and Deployment Checklist

This checklist is the release gate for the commercial Windows 11 edition. A CI-built installer validation artifact is not a production release.

## Release blockers

- [ ] Complete the Windows 11 fresh-install test on a clean target PC (Master Checklist #17).
- [ ] Complete first-run setup and confirm the administrator password can be changed/used.
- [ ] Verify server startup, local browser access, LAN access, firewall scope, and health endpoint.
- [ ] Verify reception ticket generation and the target printer's paper size/alignment.
- [ ] Verify counter assignment, calling, completion, and ticket transfer.
- [ ] Verify English then Arabic announcements and TV display live updates/fullscreen startup.
- [ ] Verify PDF and Excel exports, and finish CSV export verification before advertising CSV support.
- [ ] Verify backup creation, off-device backup copy, restore, and rollback/data integrity.
- [ ] Verify Windows startup, server crash recovery, TV relaunch, and a controlled power-recovery test where hardware permits.
- [ ] Complete installer upgrade testing with existing customer data, TLS files, and local advertisement media preserved.
- [ ] Resolve all blocking CI failures and review the full and production dependency audit reports.
- [ ] Confirm the installer does not contain customer databases, backups, secrets, TLS private keys, or customer advertisement files.
- [ ] Set the final product version consistently in package metadata, installer metadata, and release notes.
- [ ] Build the final x64 installer and calculate SHA-256 checksums.
- [ ] Sign the final installer with an organization-controlled, trusted Windows code-signing certificate. Keep the signing key outside the repository and CI logs. If signing is not available, explicitly label the installer unsigned and do not represent it as a fully trusted commercial release.
- [ ] Prepare the final user manual, troubleshooting guide, upgrade/restore instructions, and support contact details.
- [ ] Prepare a rollback plan and confirm that a verified off-device database backup exists before upgrading any customer installation.

## Deployment sequence

1. Freeze the tested commit on the single `main` branch and record its full commit SHA.
2. Run the complete Windows CI workflow, including package staging, Setup Wizard compilation, and installer upgrade-preservation test.
3. Download the private CI validation artifact and verify its SHA-256 checksum.
4. Perform the fresh Windows 11 installation and operational test on a clean PC. Record results and evidence.
5. Fix any issue on `main`, rerun CI, and repeat affected Windows tests.
6. Once every release blocker is checked, build and sign the final installer from the approved commit.
7. Generate SHA-256 checksums and release notes. State the supported Windows architecture, runtime inclusion, network/security requirements, and known limitations.
8. Publish the production release only after explicit release approval and successful final verification.
9. For each customer deployment, preserve the existing database and customer files, schedule downtime, verify backups, install/upgrade, and run a post-install smoke test.

## Current release status

- The CI workflow can build a self-contained Windows x64 project bundle and Inno Setup EXE, then test whether an in-place upgrade preserves customer-owned data.
- The CI validation installer is unsigned and is not a production release.
- Fresh physical Windows 11 installation testing is still required.
- No public release or production deployment should be made until all blockers above are complete.
