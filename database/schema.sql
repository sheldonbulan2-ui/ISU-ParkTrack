CREATE DATABASE IF NOT EXISTS motorcycle_parking_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE motorcycle_parking_system;

CREATE TABLE IF NOT EXISTS admins (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin') NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parking_slots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slot_number VARCHAR(12) NOT NULL UNIQUE,
  row_position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  column_position SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('available','pending','occupied','restricted','reserved') NOT NULL DEFAULT 'available',
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_slot_map(row_position,column_position), INDEX idx_slot_status(status,is_enabled)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS parking_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference_number VARCHAR(80) NOT NULL UNIQUE,
  parking_slot_id BIGINT UNSIGNED NOT NULL,
  motorcycle_photo_path VARCHAR(255) NULL,
  submission_status ENUM('pending','approved','rejected','completed','reserved') NOT NULL DEFAULT 'approved',
  submitted_at DATETIME NOT NULL,
  approved_at DATETIME NULL,
  rejected_at DATETIME NULL,
  exited_at DATETIME NULL,
  verified_by_admin_id BIGINT UNSIGNED NULL,
  rejection_reason VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_record_slot FOREIGN KEY(parking_slot_id) REFERENCES parking_slots(id) ON DELETE CASCADE,
  CONSTRAINT fk_record_admin FOREIGN KEY(verified_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL,
  INDEX idx_record_status(submission_status,submitted_at), INDEX idx_record_slot_active(parking_slot_id,submission_status,exited_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(40) NOT NULL,
  parking_record_id BIGINT UNSIGNED NULL,
  parking_slot_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_log_admin FOREIGN KEY(admin_id) REFERENCES admins(id),
  CONSTRAINT fk_log_record FOREIGN KEY(parking_record_id) REFERENCES parking_records(id) ON DELETE SET NULL,
  CONSTRAINT fk_log_slot FOREIGN KEY(parking_slot_id) REFERENCES parking_slots(id) ON DELETE SET NULL,
  INDEX idx_log_time(created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  attempted_at DATETIME NOT NULL,
  INDEX idx_login_ip_time(ip_address,attempted_at)
) ENGINE=InnoDB;

INSERT IGNORE INTO parking_slots(slot_number,row_position,column_position,status,is_enabled) VALUES
('P-01',1,1,'available',1),('P-02',1,2,'available',1),('P-03',1,3,'available',1),('P-04',1,4,'available',1),('P-05',1,5,'available',1),
('P-06',2,1,'available',1),('P-07',2,2,'available',1),('P-08',2,3,'available',1),('P-09',2,4,'available',1),('P-10',2,5,'available',1),
('P-11',3,1,'available',1),('P-12',3,2,'available',1),('P-13',3,3,'available',1),('P-14',3,4,'available',1),('P-15',3,5,'available',1),
('P-16',4,1,'available',1),('P-17',4,2,'available',1),('P-18',4,3,'available',1),('P-19',4,4,'available',1),('P-20',4,5,'available',1);

-- Default Admin Account (Username: isuadmin | Password: admin12345678)
-- Can be changed immediately via Admin Settings -> Change Password
INSERT IGNORE INTO admins(id, username, password_hash, role) VALUES
(1, 'isuadmin', '$2y$10$pHp/8/qdd.h19vGMR2JwKOx52JrUQ2WY9ZcI/8tr7yJiTMAQwJH7O', 'admin');
