<?php
require_once __DIR__ . '/includes/security.php';
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0e3d27">
  <meta name="description" content="ISU San Mariano Campus Motorcycle Parking Slot Monitoring and Verification System">
  <title>Motorcycle Parking | Isabela State University</title>
  <link rel="icon" type="image/png" href="assets/images/isu-logo.png">
  <link rel="apple-touch-icon" href="assets/images/isu-logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/app.css?v=20261021-webapp-v15">
  <script src="https://unpkg.com/lucide@latest"></script>
</head>
<body>
  <div id="app"></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script>
    window.APP_CSRF = <?= json_encode(csrf_token(), JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP) ?>;
  </script>
  <script src="assets/js/app.js?v=20261021-webapp-v15" defer></script>
</body>
</html>
