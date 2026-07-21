const Database = require('better-sqlite3');
const path = require('path');

function initDB() {
    const dbPath = path.join(__dirname, '..', 'attendance.db');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');

    // SQLite cannot alter a CHECK constraint. Upgrade legacy databases before
    // creating/using superadmin accounts while retaining all existing rows.
    const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    if (usersSql && !usersSql.sql.includes("'superadmin'")) {
        db.pragma('foreign_keys = OFF');
        db.exec(`
            CREATE TABLE users_upgrade (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('student', 'faculty', 'admin', 'superadmin')),
                name TEXT NOT NULL,
                email TEXT,
                phone TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO users_upgrade (id, username, password, role, name, email, phone, created_at)
            SELECT id, username, password, role, name, email, phone, created_at FROM users;
            DROP TABLE users;
            ALTER TABLE users_upgrade RENAME TO users;
        `);
        db.pragma('foreign_keys = ON');
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('student', 'faculty', 'admin', 'superadmin')),
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            reg_no TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            section TEXT DEFAULT 'A',
            year INTEGER DEFAULT 3,
            department TEXT DEFAULT 'Computer Science',
            phone TEXT,
            email TEXT
        );

        CREATE TABLE IF NOT EXISTS faculty (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            faculty_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            department TEXT DEFAULT 'Applied Sciences',
            designation TEXT,
            email TEXT
        );

        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            faculty_id INTEGER REFERENCES faculty(id),
            section TEXT DEFAULT 'A',
            year INTEGER DEFAULT 3,
            department TEXT DEFAULT 'Computer Science',
            target_attendance INTEGER DEFAULT 85
        );

        CREATE TABLE IF NOT EXISTS enrollments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER REFERENCES students(id),
            subject_id INTEGER REFERENCES subjects(id),
            UNIQUE(student_id, subject_id)
        );

        CREATE TABLE IF NOT EXISTS timetable (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER REFERENCES subjects(id),
            day_of_week TEXT NOT NULL,
            hour_number INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            room TEXT
        );

        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER REFERENCES students(id),
            subject_id INTEGER REFERENCES subjects(id),
            date TEXT NOT NULL,
            hour INTEGER,
            status TEXT NOT NULL CHECK(status IN ('P', 'A', 'L', 'OD', 'ML')),
            marked_by INTEGER REFERENCES users(id),
            marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified_by INTEGER REFERENCES users(id),
            modified_at DATETIME,
            UNIQUE(student_id, subject_id, date, hour)
        );

        CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_id INTEGER REFERENCES subjects(id),
            title TEXT NOT NULL,
            description TEXT,
            created_by INTEGER REFERENCES faculty(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS assignment_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assignment_id INTEGER REFERENCES assignments(id),
            student_id INTEGER REFERENCES students(id),
            status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'COMPLETED')),
            marked_by INTEGER REFERENCES users(id),
            marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(assignment_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS leaves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER REFERENCES students(id),
            type TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            reason TEXT,
            status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
            approved_by INTEGER REFERENCES users(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS departments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            code TEXT NOT NULL UNIQUE,
            hod_id INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            year INTEGER NOT NULL,
            semester INTEGER NOT NULL,
            faculty_advisor_id INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
            UNIQUE(department_id, name, year, semester)
        );
        CREATE TABLE IF NOT EXISTS academic_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT,
            user_agent TEXT
        );
        CREATE TABLE IF NOT EXISTS attendance_corrections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
            requested_by INTEGER NOT NULL REFERENCES users(id),
            old_status TEXT NOT NULL,
            new_status TEXT NOT NULL CHECK(new_status IN ('P', 'A', 'L', 'OD', 'ML')),
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
            reviewed_by INTEGER REFERENCES users(id),
            reviewed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Safe, idempotent migrations for existing installations.
    const migrations = [
        'ALTER TABLE users ADD COLUMN phone TEXT',
        'ALTER TABLE students ADD COLUMN faculty_advisor_id INTEGER REFERENCES faculty(id)',
        'ALTER TABLE subjects ADD COLUMN max_marks INTEGER DEFAULT 100',
        'ALTER TABLE assignment_tracking ADD COLUMN marks INTEGER'
    ];
    for (const sql of migrations) {
        try { db.exec(sql); } catch (e) { /* already applied */ }
    }

    return db;
}

module.exports = { initDB };
