const Database = require('better-sqlite3');
const path = require('path');

function initDB() {
    const dbPath = path.join(__dirname, '..', 'attendance.db');
    const db = new Database(dbPath);

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('student', 'faculty', 'admin')),
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
    `);

    // Runtime migration: ensure phone column exists in users (for existing DBs)
    try {
        db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    } catch(e) { /* column already exists, ignore */ }

    return db;
}

module.exports = { initDB };
