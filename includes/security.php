<?php
declare(strict_types=1);

function start_secure_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>$https,'httponly'=>true,'samesite'=>'Strict']);
    session_name('parking_admin'); session_start();
}
function json_response(array $data, int $status=200): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store'); echo json_encode($data, JSON_UNESCAPED_SLASHES); exit;
}
function require_admin(): int {
    start_secure_session();
    if (empty($_SESSION['admin_id'])) json_response(['error'=>'Administrator login required.'],401);
    return (int)$_SESSION['admin_id'];
}
function csrf_token(): string {
    start_secure_session();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf']=bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}
function require_csrf(): void {
    start_secure_session();
    $given = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    if (!$given || !hash_equals($_SESSION['csrf'], $given)) {
        json_response([
            'error' => 'Session token expired. Refresh and try again.',
            'token' => $_SESSION['csrf']
        ], 419);
    }
}
function request_data(): array {
    $raw=file_get_contents('php://input'); $json=json_decode($raw ?: '',true);
    return is_array($json) ? $json : $_POST;
}
function private_storage_dir(): string {
    $dir=getenv('PARKING_PRIVATE_STORAGE') ?: dirname(__DIR__,3).DIRECTORY_SEPARATOR.'private_storage'.DIRECTORY_SEPARATOR.'motorcycle_parking';
    if (!is_dir($dir) && !mkdir($dir,0700,true) && !is_dir($dir)) throw new RuntimeException('Private photo storage could not be created.');
    return $dir;
}
function audit(PDO $pdo,int $admin,string $action,?int $record,?int $slot): void {
    $s=$pdo->prepare('INSERT INTO admin_activity_logs(admin_id,action,parking_record_id,parking_slot_id) VALUES(?,?,?,?)');
    $s->execute([$admin,$action,$record,$slot]);
}
