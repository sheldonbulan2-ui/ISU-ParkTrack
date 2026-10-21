# Motorcycle Parking Slot Monitoring System

Responsive PHP 8.2+ and MySQL application for student motorcycle parking submissions with administrator photo verification. There is no advance booking or student account system. Students submit only a selected slot and an image after parking.

## Requirements

- XAMPP with Apache, PHP 8.2+ and MySQL/MariaDB
- PHP extensions: PDO MySQL, fileinfo, and GD (GD is used by the browser-side image workflow only when available; server validates image signatures)
- A modern browser with camera access for live capture; HTTPS is required for camera access outside localhost

## Install on XAMPP

1. Copy this folder into `C:\xampp\htdocs\ISU-ParkingSlotRS`.
2. Start Apache and MySQL from the XAMPP Control Panel.
3. Open phpMyAdmin, import `database/schema.sql`, or run it in the MySQL console. The SQL creates `motorcycle_parking_system` and 20 sample parking slots.
4. Review database connection values in `config/database.php`. Defaults are XAMPP's local `root` user with an empty password. For production, set `PARKING_DB_HOST`, `PARKING_DB_NAME`, `PARKING_DB_USER`, and `PARKING_DB_PASSWORD` in the PHP/Apache environment and use a least-privilege database account.
5. Open `http://localhost/ISU-ParkingSlotRS/setup-admin.php`. Create an administrator with a unique username and a password of at least 12 characters. The password is stored with `password_hash()`.
6. Delete `setup-admin.php` after the initial account is created. Do not leave first-admin setup available on a public server.
7. Open `http://localhost/ISU-ParkingSlotRS/`. Choose **Student** or **Admin** on the opening screen; Admin opens the sign-in form.

## Private photo storage

By default uploaded images are stored at `C:\xampp\private_storage\motorcycle_parking`, outside `htdocs`, with randomized names and restrictive directory permissions. The API validates file signatures and accepted JPEG, PNG, and WebP MIME types, enforces an 8 MB limit, and serves photos only to authenticated administrators. To choose another private location, set `PARKING_PRIVATE_STORAGE` to a path outside the web root. Back up and restrict that directory as sensitive personal data.

Student submissions are anonymous in the application and require no name, ID, plate, phone number, or email. The application does not claim that an image independently proves physical presence. Set a documented retention period that matches the institution's policy, then periodically remove expired photos and records using a controlled operational process. HTTPS is required in production.

## Included functionality

- Live student map and database-backed counts; status refreshes every seven seconds
- Camera capture with rear-camera preference, preview/retake, mobile file chooser fallback, and client-side image optimization
- Transactional submission with row locking to prevent two submissions from claiming the same slot concurrently
- Admin session authentication, password verification, CSRF tokens, login throttling, and session ID rotation
- Pending photo review, approval/rejection with optional reason, manual exit confirmation, private photo viewing, and audit logs
- Searchable history and authorized CSV export
- Slot creation, label and row/column arrangement, restriction, disable, and re-enable controls

## Deployment notes

The SQL uses InnoDB and foreign keys. Use an isolated MySQL account, HTTPS, secure backups, monitoring, and a private writable storage directory for deployment. Configure PHP upload limits to at least 8 MB (`upload_max_filesize`) and `post_max_size`. Review Apache/PHP error logs when a generic API error is shown; detailed errors are deliberately kept out of student-facing responses. The application can be hosted below a URL prefix; camera access requires HTTPS or localhost.

Some operational items require deployment-specific choices: institutional retention/deletion schedule, HTTPS certificate, database account/secrets, backup policy, and administrator provisioning. The supplied local environment does not seed any credentials.
