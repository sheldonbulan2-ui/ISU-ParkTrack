<?php
declare(strict_types=1);
require_once __DIR__ . '/config/database.php';

$error = '';
$done = false;
$adminCount = 0;

try {
    $pdo = db();
    $adminCount = (int)$pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn();
    if ($adminCount > 0) {
        $done = true;
    }
} catch (Throwable $e) {
    $error = 'Database connection failed. Please ensure your database is running and credentials in environment variables are correct.';
}

// If an admin already exists and requester is not local, block access
$isLocal = PHP_SAPI === 'cli' || in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
if ($adminCount > 0 && !$isLocal) {
    http_response_code(404);
    exit;
}

if (!$done && !$error) {
    session_name('parking_setup');
    session_start();
    if (empty($_SESSION['setup_token'])) {
        $_SESSION['setup_token'] = bin2hex(random_bytes(32));
    }
}

if (!$done && !$error && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($_SESSION['setup_token'] ?? '', (string)($_POST['setup_token'] ?? ''))) {
        $error = 'Setup session expired. Please reload the page and try again.';
    } else {
        $u = trim((string)($_POST['username'] ?? ''));
        $p = (string)($_POST['password'] ?? '');
        $confirm = (string)($_POST['confirm'] ?? '');

        if (!preg_match('/^[A-Za-z0-9._-]{4,80}$/', $u)) {
            $error = 'Username must be 4–80 alphanumeric characters (letters, numbers, dots, hyphens).';
        } elseif (strlen($p) < 12) {
            $error = 'Password must be at least 12 characters long for administrator security.';
        } elseif ($p !== $confirm) {
            $error = 'The passwords do not match. Please retype them carefully.';
        } else {
            $locked = false;
            try {
                $locked = (int)$pdo->query("SELECT GET_LOCK('motorcycle_parking_first_admin', 5)")->fetchColumn() === 1;
                if (!$locked) {
                    throw new RuntimeException('Could not acquire setup lock.');
                }
                if ((int)$pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn() > 0) {
                    throw new RuntimeException('An administrator already exists.');
                }
                $q = $pdo->prepare("INSERT INTO admins(username, password_hash, role) VALUES(?, ?, 'admin')");
                $q->execute([$u, password_hash($p, PASSWORD_DEFAULT)]);
                $done = true;
            } catch (Throwable $e) {
                $error = 'Setup could not be completed. Check if an administrator already exists.';
            } finally {
                if ($locked) {
                    $pdo->query("SELECT RELEASE_LOCK('motorcycle_parking_first_admin')");
                }
            }
        }
    }
}
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>First Admin Setup | ISU Motorcycle Parking</title>
  <link rel="icon" type="image/png" href="assets/images/isu-logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/app.css?v=20261021-webapp-v4">
  <script src="https://unpkg.com/lucide@latest"></script>
</head>
<body class="setup-body">
  <main class="setup-card">
    <div style="text-align: center; margin-bottom: 24px;">
      <img class="brand-logo-large" src="assets/images/isu-logo.png" alt="ISU Logo">
      <p class="eyebrow">ONE-TIME CONFIGURATION</p>
      <h1>Create First Administrator</h1>
      <p class="muted">Provision the initial security account to manage the motorcycle parking monitoring system.</p>
    </div>

    <?php if ($done): ?>
      <div class="notice success">
        <i data-lucide="check-circle" width="20" height="20"></i>
        <div>
          <strong>Administrator account created successfully!</strong>
          <p style="margin: 4px 0 0; font-size: 13px;">For security compliance, please delete <code>setup-admin.php</code> from your server root now.</p>
        </div>
      </div>
      <a class="button primary full" href="index.php" style="margin-top: 16px;">
        Go to Portal Selection <i data-lucide="arrow-right" width="16" height="16"></i>
      </a>
    <?php else: ?>
      <?php if ($error): ?>
        <div class="notice error">
          <i data-lucide="alert-triangle" width="20" height="20"></i>
          <div><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
        </div>
      <?php endif; ?>

      <form method="post">
        <input type="hidden" name="setup_token" value="<?= htmlspecialchars($_SESSION['setup_token'] ?? '', ENT_QUOTES, 'UTF-8') ?>">
        
        <label class="field">
          Admin Username
          <input name="username" minlength="4" maxlength="80" required autocomplete="username" placeholder="e.g. isu_admin" autofocus>
        </label>

        <label class="field">
          Password (minimum 12 characters)
          <input type="password" name="password" id="setup-pass" minlength="12" required autocomplete="new-password" placeholder="At least 12 characters">
        </label>

        <label class="field">
          Confirm Password
          <input type="password" name="confirm" id="setup-confirm" minlength="12" required autocomplete="new-password" placeholder="Re-type password">
        </label>

        <button class="button primary full" style="margin-top: 12px;">
          Create Administrator Account <i data-lucide="shield-check" width="16" height="16"></i>
        </button>
      </form>
    <?php endif; ?>
  </main>

  <script>
    if (window.lucide) lucide.createIcons();
  </script>
</body>
</html>
