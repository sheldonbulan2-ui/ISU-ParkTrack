<?php
require_once __DIR__ . '/includes/security.php';
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#0e3d27">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="ISU Park">
  <meta name="application-name" content="ISU Park">
  <meta name="description" content="ISU San Mariano Campus Motorcycle Parking Slot Monitoring and Reservation Web App">
  <title>Motorcycle Parking | Isabela State University</title>
  
  <!-- PWA Web App Manifest -->
  <link rel="manifest" href="manifest.json">
  <link rel="icon" type="image/png" sizes="192x192" href="assets/images/icon-192.png">
  <link rel="icon" type="image/png" href="assets/images/isu-logo.png">
  <link rel="apple-touch-icon" href="assets/images/icon-192.png">
  
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..700&family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/app.css?v=20261021-mobile-v4">
  <script src="https://unpkg.com/lucide@latest"></script>
</head>
<body>
  <div id="app"></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  
  <!-- PWA Install Banner (For Android & Supported Browsers) -->
  <div id="pwa-install-banner" class="pwa-banner" style="display:none;" role="dialog" aria-label="Install App">
    <img src="assets/images/icon-192.png" alt="ISU Logo" class="pwa-banner-icon">
    <div class="pwa-banner-text">
      <strong>ISU Parking App</strong>
      <small>I-install sa iyong Android phone para sa mabilisang access!</small>
    </div>
    <button class="button primary small" id="pwa-install-action" type="button">
      I-install
    </button>
    <button class="pwa-banner-close" id="pwa-close-action" type="button" aria-label="Isara">&times;</button>
  </div>

  <script>
    window.APP_CSRF = <?= json_encode(csrf_token(), JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP) ?>;
    
    // Register PWA Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
          console.warn('PWA Service Worker registration:', err);
        });
      });
    }
  </script>
  <script src="assets/js/app.js?v=20261021-mobile-v4" defer></script>
</body>
</html>
