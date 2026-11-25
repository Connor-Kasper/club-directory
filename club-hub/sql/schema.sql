CREATE TABLE IF NOT EXISTS users (
  user_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  firebase_uid VARCHAR(128) NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  role ENUM('student', 'teacher') NOT NULL DEFAULT 'student',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_firebase_uid (firebase_uid),
  UNIQUE KEY uq_users_email (email)
);

CREATE TABLE IF NOT EXISTS clubs (
  club_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  category VARCHAR(45) NOT NULL,
  meeting_time VARCHAR(45) NULL,
  meeting_day VARCHAR(45) NULL,
  location VARCHAR(120) NULL,
  contact_email VARCHAR(255) NULL,
  sponsor_name VARCHAR(120) NULL,
  dues VARCHAR(45) NULL,
  instagram_url VARCHAR(255) NULL,
  twitter_url VARCHAR(255) NULL,
  facebook_url VARCHAR(255) NULL,
  remind_url VARCHAR(255) NULL,
  images JSON NULL,
  events JSON NULL,
  PRIMARY KEY (club_id)
);

CREATE TABLE IF NOT EXISTS student_favorites (
  student_id INT UNSIGNED NOT NULL,
  club_id INT UNSIGNED NOT NULL,
  favorited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, club_id),
  KEY idx_favorites_club (club_id),
  CONSTRAINT fk_favorites_user FOREIGN KEY (student_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_favorites_club FOREIGN KEY (club_id) REFERENCES clubs (club_id) ON DELETE CASCADE
);
