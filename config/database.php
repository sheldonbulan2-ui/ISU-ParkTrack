<?php
declare(strict_types=1);

function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    $host = getenv('PARKING_DB_HOST') ?: '127.0.0.1';
    $port = getenv('PARKING_DB_PORT') ?: '3306';
    $name = getenv('PARKING_DB_NAME') ?: 'motorcycle_parking_system';
    $user = getenv('PARKING_DB_USER') ?: 'root';
    $pass = getenv('PARKING_DB_PASSWORD') ?: '';

    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];

    // Support TiDB Cloud Serverless (requires SSL connection, usually on port 4000)
    if ($port === '4000' || getenv('PARKING_DB_SSL') === 'true' || str_contains($host, 'tidbcloud.com')) {
        $caPaths = [
            '/etc/ssl/certs/ca-certificates.crt', // Debian / Ubuntu in Docker
            '/etc/pki/tls/certs/ca-bundle.crt',
            '/etc/ssl/ca-bundle.pem',
        ];
        foreach ($caPaths as $ca) {
            if (file_exists($ca)) {
                $options[PDO::MYSQL_ATTR_SSL_CA] = $ca;
                break;
            }
        }
        $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = false;
    }

    $pdo = new PDO($dsn, $user, $pass, $options);
    return $pdo;
}
