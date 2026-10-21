<?php
declare(strict_types=1);
require_once __DIR__.'/../config/database.php'; require_once __DIR__.'/../includes/security.php';
try {
    $pdo=db(); $action=(string)($_GET['action'] ?? ''); $method=$_SERVER['REQUEST_METHOD'];
    if ($action==='csrf') { start_secure_session(); json_response(['token'=>csrf_token(),'admin'=>!empty($_SESSION['admin_id'])]); }
    if ($action==='slots' && $method==='GET') {
        $rows=$pdo->query('SELECT id,slot_number,row_position,column_position,status,is_enabled FROM parking_slots ORDER BY row_position,column_position,id')->fetchAll();
        json_response(['slots'=>$rows,'admin'=>admin_active()]);
    }
    if ($action==='stats' && $method==='GET') {
        $stats=$pdo->query("SELECT COUNT(*) total, SUM(status='available' AND is_enabled=1) available, SUM(status='occupied') occupied, SUM(status='reserved') reserved, SUM(status='restricted') restricted FROM parking_slots")->fetch();
        $stats['today']=(int)$pdo->query("SELECT COUNT(*) FROM parking_records WHERE DATE(submitted_at)=CURDATE()")->fetchColumn(); json_response($stats);
    }
    if ($action==='login' && $method==='POST') {
        require_csrf(); $d=request_data(); $username=trim((string)($d['username']??'')); $ip=substr($_SERVER['REMOTE_ADDR']??'unknown',0,45);
        $pdo->prepare('DELETE FROM admin_login_attempts WHERE attempted_at < DATE_SUB(NOW(), INTERVAL 1 DAY)')->execute();
        $q=$pdo->prepare('SELECT COUNT(*) FROM admin_login_attempts WHERE ip_address=? AND attempted_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)'); $q->execute([$ip]);
        if ((int)$q->fetchColumn()>=8) json_response(['error'=>'Too many attempts. Please wait 15 minutes.'],429);
        $q=$pdo->prepare('SELECT id,username,password_hash FROM admins WHERE username=?'); $q->execute([$username]); $admin=$q->fetch();
        $pdo->prepare('INSERT INTO admin_login_attempts(ip_address,attempted_at) VALUES(?,NOW())')->execute([$ip]);
        if (!$admin || !password_verify((string)($d['password']??''),$admin['password_hash'])) json_response(['error'=>'Invalid username or password.'],401);
        $pdo->prepare('DELETE FROM admin_login_attempts WHERE ip_address=?')->execute([$ip]); start_secure_session(); session_regenerate_id(true); $_SESSION['admin_id']=(int)$admin['id']; $_SESSION['admin_name']=$admin['username']; $_SESSION['csrf']=bin2hex(random_bytes(32));
        $pdo->prepare('UPDATE admins SET last_login_at=NOW() WHERE id=?')->execute([$admin['id']]); json_response(['ok'=>true,'name'=>$admin['username'],'token'=>$_SESSION['csrf']]);
    }
    if ($action==='logout' && $method==='POST') { $admin=require_admin(); require_csrf(); $_SESSION=[]; $cookie=session_get_cookie_params(); setcookie(session_name(),'',['expires'=>time()-3600,'path'=>$cookie['path'],'domain'=>$cookie['domain'],'secure'=>$cookie['secure'],'httponly'=>true,'samesite'=>'Strict']); session_destroy(); json_response(['ok'=>true]); }
    if ($action==='submit' && $method==='POST') {
        require_csrf(); $slot=(int)($_POST['slot_id']??0);
        if (!$slot || empty($_FILES['photo']) || $_FILES['photo']['error']!==UPLOAD_ERR_OK) json_response(['error'=>'Choose an available slot and capture a photo first.'],422);
        $file=$_FILES['photo']; if ($file['size']>8*1024*1024) json_response(['error'=>'Photo must be 8 MB or smaller.'],422);
        $finfo=new finfo(FILEINFO_MIME_TYPE); $mime=$finfo->file($file['tmp_name']); $types=['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'];
        if (!isset($types[$mime]) || !getimagesize($file['tmp_name'])) json_response(['error'=>'Use a valid JPEG, PNG, or WebP image.'],422);
        $pdo->beginTransaction();
        $q=$pdo->prepare('SELECT id,slot_number,status,is_enabled FROM parking_slots WHERE id=? FOR UPDATE'); $q->execute([$slot]); $row=$q->fetch();
        if (!$row || !$row['is_enabled'] || !in_array($row['status'], ['available', 'reserved'], true)) {
            $pdo->rollBack();
            json_response(['error'=>'That slot is no longer available. Refresh the map and choose another.'],409);
        }
        $name=bin2hex(random_bytes(24)).'.'.$types[$mime]; $path=private_storage_dir().DIRECTORY_SEPARATOR.$name;
        if (!move_uploaded_file($file['tmp_name'],$path)) { $pdo->rollBack(); json_response(['error'=>'Photo could not be stored.'],500); }
        try {
            $pdo->prepare("UPDATE parking_records SET submission_status='completed', exited_at=NOW() WHERE parking_slot_id=? AND submission_status='reserved' AND exited_at IS NULL")->execute([$slot]);
            $devName = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($_POST['device_name'] ?? '')));
            if (empty($devName)) $devName = 'PHONE';
            if (strlen($devName) > 16) $devName = substr($devName, 0, 16);
            $ref = $devName . '-' . strtoupper(bin2hex(random_bytes(3)));
            $q=$pdo->prepare("INSERT INTO parking_records(reference_number,parking_slot_id,motorcycle_photo_path,submission_status,submitted_at,approved_at) VALUES(?,?,?,'approved',NOW(),NOW())");
            $q->execute([$ref,$slot,$name]);
            $record=(int)$pdo->lastInsertId();
            $pdo->prepare("UPDATE parking_slots SET status='occupied',updated_at=NOW() WHERE id=?")->execute([$slot]);
            $pdo->commit();
            json_response(['ok'=>true,'reference'=>$ref,'message'=>"Photo uploaded successfully! Slot {$row['slot_number']} is now occupied. Have a great day!"]);
        } catch(Throwable $e) { if (is_file($path)) unlink($path); throw $e; }
    }
    if ($action==='reserve' && $method==='POST') {
        require_csrf();
        $d = request_data();
        $slotId = (int)($d['slot_id'] ?? 0);
        if (!$slotId) json_response(['error'=>'Pumili ng wastong parking slot.'], 422);

        $pdo->beginTransaction();
        $q = $pdo->prepare('SELECT id, slot_number, status, is_enabled FROM parking_slots WHERE id=? FOR UPDATE');
        $q->execute([$slotId]);
        $row = $q->fetch();
        if (!$row || !$row['is_enabled'] || $row['status'] !== 'available') {
            $pdo->rollBack();
            json_response(['error'=>'Hindi na available ang slot na ito. Pumili ng iba sa mapa.'], 409);
        }
        $devName = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($d['device_name'] ?? '')));
        if (empty($devName)) $devName = 'PHONE';
        if (strlen($devName) > 16) $devName = substr($devName, 0, 16);
        $ref = 'RES-' . $devName . '-' . strtoupper(bin2hex(random_bytes(2)));
        $pdo->prepare("INSERT INTO parking_records(reference_number, parking_slot_id, motorcycle_photo_path, submission_status, submitted_at) VALUES (?, ?, NULL, 'reserved', NOW())")->execute([$ref, $slotId]);
        $pdo->prepare("UPDATE parking_slots SET status='reserved', updated_at=NOW() WHERE id=?")->execute([$slotId]);
        $pdo->commit();
        json_response([
            'ok' => true,
            'reference' => $ref,
            'slot_number' => $row['slot_number'],
            'message' => "Slot {$row['slot_number']} reserved successfully! I-check in pagdating sa campus."
        ]);
    }
    if ($action==='cancel-reservation' && $method==='POST') {
        require_csrf();
        $slotId = (int)(request_data()['slot_id'] ?? 0);
        if (!$slotId) json_response(['error'=>'Pumili ng wastong slot.'], 422);

        $pdo->beginTransaction();
        $q = $pdo->prepare('SELECT id, slot_number, status FROM parking_slots WHERE id=? FOR UPDATE');
        $q->execute([$slotId]);
        $slot = $q->fetch();
        if (!$slot || $slot['status'] !== 'reserved') {
            $pdo->rollBack();
            json_response(['error'=>'Hindi naka-reserve ang slot na ito.'], 409);
        }
        $pdo->prepare("UPDATE parking_records SET exited_at=NOW(), submission_status='completed', rejection_reason='Reservation cancelled', updated_at=NOW() WHERE parking_slot_id=? AND submission_status='reserved' AND exited_at IS NULL ORDER BY id DESC LIMIT 1")->execute([$slotId]);
        $pdo->prepare("UPDATE parking_slots SET status='available', updated_at=NOW() WHERE id=?")->execute([$slotId]);
        $pdo->commit();
        json_response(['ok'=>true, 'message'=>"Nakansela na ang reserbasyon para sa Slot {$slot['slot_number']}. Bakante na muli ito."]);
    }
    if ($action==='records' && $method==='GET') {
        require_admin(); $status=(string)($_GET['status']??''); $sql="SELECT r.*,s.slot_number FROM parking_records r JOIN parking_slots s ON s.id=r.parking_slot_id"; $params=[];
        if (in_array($status,['pending','approved','rejected','completed','reserved'],true)) {$sql.=' WHERE r.submission_status=?';$params[]=$status;}
        $sql.=' ORDER BY r.submitted_at DESC LIMIT 500'; $q=$pdo->prepare($sql);$q->execute($params);json_response(['records'=>$q->fetchAll()]);
    }
    if ($action==='change-password' && $method==='POST') {
        $admin=require_admin(); require_csrf(); $d=request_data();
        $curr=(string)($d['current_password']??''); $new=(string)($d['new_password']??'');
        if (strlen($new)<6) json_response(['error'=>'Ang bagong password ay dapat mayroong hindi bababa sa 6 characters.'],422);
        $q=$pdo->prepare('SELECT password_hash FROM admins WHERE id=?'); $q->execute([$admin]); $hash=$q->fetchColumn();
        if (!$hash || !password_verify($curr,$hash)) json_response(['error'=>'Mali ang iyong kasalukuyang password. Pakisubukan muli.'],401);
        $newHash=password_hash($new,PASSWORD_BCRYPT);
        $pdo->prepare('UPDATE admins SET password_hash=?,updated_at=NOW() WHERE id=?')->execute([$newHash,$admin]);
        audit($pdo,$admin,'password_changed',null,null);
        json_response(['ok'=>true,'message'=>'Matagumpay na nabago ang iyong admin password!']);
    }
    if ($action==='verify' && $method==='POST') {
        $admin=require_admin();require_csrf();$d=request_data();$id=(int)($d['record_id']??0);$decision=$d['decision']??'';
        if(!in_array($decision,['approve','reject'],true))json_response(['error'=>'Choose approve or reject.'],422);
        $pdo->beginTransaction();$q=$pdo->prepare('SELECT r.*,s.status FROM parking_records r JOIN parking_slots s ON s.id=r.parking_slot_id WHERE r.id=? FOR UPDATE');$q->execute([$id]);$r=$q->fetch();
        if(!$r||$r['submission_status']!=='pending'){$pdo->rollBack();json_response(['error'=>'This submission has already been processed.'],409);}
        $status=$decision==='approve'?'approved':'rejected';$timestamp=$decision==='approve'?'approved_at':'rejected_at';
        $pdo->prepare("UPDATE parking_records SET submission_status=?,{$timestamp}=NOW(),verified_by_admin_id=?,rejection_reason=?,updated_at=NOW() WHERE id=?")->execute([$status,$admin, $decision==='reject'?mb_substr(trim((string)($d['reason']??'')),0,500):null,$id]);
        $slotStatus=$decision==='approve'?'occupied':'available';$pdo->prepare('UPDATE parking_slots SET status=?,updated_at=NOW() WHERE id=?')->execute([$slotStatus,$r['parking_slot_id']]);audit($pdo,$admin,$status,$id,(int)$r['parking_slot_id']);$pdo->commit();json_response(['ok'=>true]);
    }
    if ($action==='exit' && $method==='POST') {
        $admin=require_admin();require_csrf();$id=(int)(request_data()['record_id']??0);$pdo->beginTransaction();$q=$pdo->prepare("SELECT * FROM parking_records WHERE id=? AND submission_status='approved' AND exited_at IS NULL FOR UPDATE");$q->execute([$id]);$r=$q->fetch();
        if(!$r){$pdo->rollBack();json_response(['error'=>'No active approved parking record found.'],409);}
        $pdo->prepare("UPDATE parking_records SET exited_at=NOW(),submission_status='completed',updated_at=NOW() WHERE id=?")->execute([$id]);$pdo->prepare("UPDATE parking_slots SET status='available',updated_at=NOW() WHERE id=?")->execute([$r['parking_slot_id']]);audit($pdo,$admin,'exit_confirmed',$id,(int)$r['parking_slot_id']);$pdo->commit();json_response(['ok'=>true]);
    }
    if ($action==='student-exit' && $method==='POST') {
        require_csrf();
        $slotId = (int)(request_data()['slot_id'] ?? 0);
        if (!$slotId) json_response(['error'=>'Invalid parking slot selected.'], 422);

        $pdo->beginTransaction();
        $qSlot = $pdo->prepare('SELECT id, slot_number, status, is_enabled FROM parking_slots WHERE id=? FOR UPDATE');
        $qSlot->execute([$slotId]);
        $slot = $qSlot->fetch();
        if (!$slot || !$slot['is_enabled']) {
            $pdo->rollBack();
            json_response(['error'=>'Parking slot not found.'], 404);
        }
        if ($slot['status'] !== 'occupied') {
            $pdo->rollBack();
            json_response(['error'=>"Vehicle slot {$slot['slot_number']} is currently {$slot['status']}, not occupied."], 409);
        }

        $qRec = $pdo->prepare("SELECT id FROM parking_records WHERE parking_slot_id=? AND submission_status='approved' AND exited_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE");
        $qRec->execute([$slotId]);
        $recId = $qRec->fetchColumn();
        if ($recId) {
            $pdo->prepare("UPDATE parking_records SET exited_at=NOW(), submission_status='completed', updated_at=NOW() WHERE id=?")->execute([$recId]);
        }

        $pdo->prepare("UPDATE parking_slots SET status='available', updated_at=NOW() WHERE id=?")->execute([$slotId]);
        $pdo->commit();
        json_response([
            'ok' => true,
            'message' => "Departure confirmed! Vehicle slot {$slot['slot_number']} is now available for the next rider."
        ]);
    }
    if ($action==='photo' && $method==='GET') { require_admin();$id=(int)($_GET['record_id']??0);$q=$pdo->prepare('SELECT motorcycle_photo_path FROM parking_records WHERE id=?');$q->execute([$id]);$file=$q->fetchColumn();if(!$file) {http_response_code(404);exit;}$path=private_storage_dir().DIRECTORY_SEPARATOR.basename($file);if(!is_file($path)){http_response_code(404);exit;}header('Content-Type: '.(mime_content_type($path)?:'application/octet-stream'));header('Cache-Control: private, no-store');header('X-Content-Type-Options: nosniff');readfile($path);exit; }
    if ($action==='slots-admin' && $method==='POST') {
        $admin=require_admin();require_csrf();$d=request_data();$op=$d['op']??'';
        if($op==='add'){$num=trim((string)($d['slot_number']??''));$row=(int)($d['row']??0);$col=(int)($d['column']??0);if(!preg_match('/^[A-Za-z0-9-]{2,12}$/',$num)||$row<1||$row>100||$col<1||$col>100)json_response(['error'=>'Use a valid slot label and row/column positions from 1 to 100.'],422);$q=$pdo->prepare("INSERT INTO parking_slots(slot_number,row_position,column_position,status,is_enabled) VALUES(?,?,?,'available',1)");$q->execute([$num,$row,$col]);audit($pdo,$admin,'slot_added',null,(int)$pdo->lastInsertId());}
        elseif($op==='update'){$id=(int)($d['id']??0);$num=trim((string)($d['slot_number']??''));$row=(int)($d['row']??0);$col=(int)($d['column']??0);if(!$id||!preg_match('/^[A-Za-z0-9-]{2,12}$/',$num)||$row<1||$row>100||$col<1||$col>100)json_response(['error'=>'Use a valid slot label and row/column positions from 1 to 100.'],422);$q=$pdo->prepare('UPDATE parking_slots SET slot_number=?,row_position=?,column_position=?,updated_at=NOW() WHERE id=?');$q->execute([$num,$row,$col,$id]);if(!$q->rowCount()&&!(int)$pdo->query('SELECT COUNT(*) FROM parking_slots WHERE id='.(int)$id)->fetchColumn())json_response(['error'=>'Slot not found.'],404);}
        elseif($op==='delete'){$id=(int)($d['id']??0);if(!$id)json_response(['error'=>'Pumili ng wastong slot na buburahin.'],422);$pdo->prepare('DELETE FROM parking_slots WHERE id=?')->execute([$id]);audit($pdo,$admin,'slot_deleted',null,null);}
        elseif($op==='delete_all'){$pdo->prepare('DELETE FROM parking_slots')->execute();audit($pdo,$admin,'all_slots_deleted',null,null);}
        elseif($op==='release'){
            $id=(int)($d['id']??0);
            if(!$id) json_response(['error'=>'Pumili ng wastong slot.'],422);
            $pdo->beginTransaction();
            $q=$pdo->prepare('SELECT id,slot_number,status FROM parking_slots WHERE id=? FOR UPDATE');
            $q->execute([$id]);
            $slotRow=$q->fetch();
            if(!$slotRow){$pdo->rollBack();json_response(['error'=>'Slot not found.'],404);}
            $pdo->prepare("UPDATE parking_records SET exited_at=NOW(),submission_status='completed',rejection_reason='Released to Available by Admin',updated_at=NOW() WHERE parking_slot_id=? AND exited_at IS NULL AND submission_status IN ('approved','reserved','pending')")->execute([$id]);
            $pdo->prepare("UPDATE parking_slots SET status='available',is_enabled=1,updated_at=NOW() WHERE id=?")->execute([$id]);
            audit($pdo,$admin,'slot_released_available',null,$id);
            $pdo->commit();
            json_response(['ok'=>true,'message'=>"Vehicle slot {$slotRow['slot_number']} is now Available!"]);
        }
        elseif(in_array($op,['disable','enable','restrict','unrestrict','reserve','unreserve'],true)){$id=(int)($d['id']??0);$q=$pdo->prepare('SELECT status FROM parking_slots WHERE id=? FOR UPDATE');$pdo->beginTransaction();$q->execute([$id]);$s=$q->fetchColumn();if(!$s){$pdo->rollBack();json_response(['error'=>'Slot not found.'],404);}if(in_array($op,['disable','restrict'],true)&&in_array($s,['pending','occupied'],true)){$pdo->rollBack();json_response(['error'=>'Active slots cannot be disabled or restricted.'],409);}$new=match($op){'restrict'=>'restricted','unrestrict'=>'available','reserve'=>'reserved','unreserve'=>'available',default=>$s};$enabled=match($op){'disable'=>0,'enable'=>1,default=>1};$pdo->prepare('UPDATE parking_slots SET status=?,is_enabled=?,updated_at=NOW() WHERE id=?')->execute([$new,$enabled,$id]);audit($pdo,$admin,'slot_'.$op,null,$id);$pdo->commit();}
        else json_response(['error'=>'Unknown slot action.'],422);json_response(['ok'=>true]);
    }
    if ($action==='export' && $method==='GET') {require_admin();header('Content-Type:text/csv; charset=utf-8');header('Content-Disposition: attachment; filename="parking-history.csv"');$out=fopen('php://output','w');fputcsv($out,['Reference (Device)','Slot','Status','IN (Time In)','OUT (Time Out)','Remarks']);foreach($pdo->query('SELECT r.reference_number,s.slot_number,r.submission_status,COALESCE(r.approved_at,r.submitted_at) as time_in,r.exited_at,r.rejection_reason FROM parking_records r JOIN parking_slots s ON s.id=r.parking_slot_id ORDER BY r.submitted_at DESC') as $r)fputcsv($out,$r);exit;}
    json_response(['error'=>'Unknown API endpoint.'],404);
} catch(Throwable $e) { error_log((string)$e); if(isset($pdo)&&$pdo->inTransaction())$pdo->rollBack(); json_response(['error'=>'The request could not be completed. Check the database connection and try again.'],500); }
function admin_active(): bool { start_secure_session();return !empty($_SESSION['admin_id']); }
